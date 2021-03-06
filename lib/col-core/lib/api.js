/**
 * Copyright ©2020. The Regents of the University of California (Regents). All Rights Reserved.
 *
 * Permission to use, copy, modify, and distribute this software and its documentation
 * for educational, research, and not-for-profit purposes, without fee and without a
 * signed licensing agreement, is hereby granted, provided that the above copyright
 * notice, this paragraph and the following two paragraphs appear in all copies,
 * modifications, and distributions.
 *
 * Contact The Office of Technology Licensing, UC Berkeley, 2150 Shattuck Avenue,
 * Suite 510, Berkeley, CA 94720-1620, (510) 643-7201, otl@berkeley.edu,
 * http://ipira.berkeley.edu/industry-info for commercial licensing opportunities.
 *
 * IN NO EVENT SHALL REGENTS BE LIABLE TO ANY PARTY FOR DIRECT, INDIRECT, SPECIAL,
 * INCIDENTAL, OR CONSEQUENTIAL DAMAGES, INCLUDING LOST PROFITS, ARISING OUT OF
 * THE USE OF THIS SOFTWARE AND ITS DOCUMENTATION, EVEN IF REGENTS HAS BEEN ADVISED
 * OF THE POSSIBILITY OF SUCH DAMAGE.
 *
 * REGENTS SPECIFICALLY DISCLAIMS ANY WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE. THE
 * SOFTWARE AND ACCOMPANYING DOCUMENTATION, IF ANY, PROVIDED HEREUNDER IS PROVIDED
 * "AS IS". REGENTS HAS NO OBLIGATION TO PROVIDE MAINTENANCE, SUPPORT, UPDATES,
 * ENHANCEMENTS, OR MODIFICATIONS.
 */

var _ = require('lodash');
var appPackage = require('../../../package.json');
var config = require('config');
var crypto = require('crypto');
var express = require('express');
var fs = require('fs');
var moment = require('moment-timezone');
var os = require('os');
var path = require('path');
var request = require('request');
var util = require('util');

var ActivitiesAPI = require('col-activities');
var CanvasAPI = require('col-canvas');
var CanvasPoller = require('col-canvas/lib/poller');
var CollabosphereConstants = require('./constants');
var DB = require('./db');
var log = require('./logger')('col-core');
var Modules = require('./modules');
var Server = require('./server');
var Storage = require('col-core/lib/storage');
var UsersAPI = require('col-users');

/**
 * Initialize the LTI tools
 *
 * @param  {Function}       callback            Standard callback function
 * @param  {Object}         callback.err        An error object, if any
 */
var init = module.exports.init = function(callback) {
  // Apply global utilities
  require('./globals');

  // All unexpected or uncaught errors will be caught and logged here. At this point we cannot
  // guarantee that the system is functioning properly anymore so we kill the process. When running
  // in production, the service script will automatically respawn the instance
  process.on('uncaughtException', function(err) {
    log.error({'err': err, 'stack': err.stack}, 'Uncaught exception was raised, restarting the process');
    process.exit(1);
  });

  // Initialize the database
  DB.init(function() {
    // Initialize the modules
    Modules.init(function() {
      // Initialize the Express server
      initializeServer();

      // Initialize the Canvas poller
      initializeCanvasPoller();

      // Schedule recurrent activity calculations and notifications
      ActivitiesAPI.scheduleRecurrentJobs();

      return callback();
    });
  });
};

/**
 * Initialize SuiteC server and initialize the REST API endpoints
 *
 * @api private
 */
var initializeServer = function() {
  // Initialize the Express server
  var appServer = module.exports.appServer = Server.setUpServer();

  // A router for all routes on /lti
  var ltiRouter = module.exports.ltiRouter = express.Router();
  appServer.use('/lti', ltiRouter);

  // A router for all routes on /api/:api_domain/:course_id
  var apiRouter = module.exports.apiRouter = express.Router();

  // Set up the authorization middleware
  initializeAuthorizationMiddleware(apiRouter);

  // Add the api router
  appServer.use('/api/:apidomain/:course', apiRouter);

  // Check if a `rest.js` file exists in the `lib` folder in each
  // module. If such a file exists, we require it. This allows other
  // modules to add in their own REST apis
  var collabosphereModules = Modules.getAvailableModules();
  _.each(collabosphereModules, function(module) {
    var restFile = path.join(__dirname, '../..', module, '/lib/rest.js');
    if (fs.existsSync(restFile)) {
      log.debug({'module': module}, util.format('Registering REST APIs for %s', module));
      require(module + '/lib/rest');
    }
  });
  log.info('Finished initializing REST APIs');
};

/**
 * Authorization can happen in 2 different ways. First of all, the user
 * can be authorized to interact with a course through a valid LTI launch of a SuiteC
 * tool in that course. When a successful LTI launch has taken place, a cookie will be
 * set to authorize the user to use the REST APIs for that course.
 * However, SuiteC also provides a Bookmarklet that allows the user to interact
 * with the SuiteC APIs through a browser bookmarklet. As this is not preceded by
 * a successful LTI launch, we provide a way in which a user can be authorized to interact
 * with a course by passing in a personal course-bound bookmarklet access token.
 *
 * @param  {Object}         apiRouter       The router for all routes on /api/:api_domain/:course_id
 * @api private
 */
var initializeAuthorizationMiddleware = function(apiRouter) {
  // 1. Check if the user is authorized by passing in a valid Bookmarklet token. This requires
  // two custom headers to be sent along with the REST API request:
  //  - `x-collabosphere-user`: the user id of the user using the Bookmarklet
  //  - `x-collabosphere-token`: the bookmarklet access token of the user using the Bookmarklet
  apiRouter.use(function(req, res, next) {
    // Extract the user id and bookmarklet token from the request headers
    var userId = req.headers['x-collabosphere-user'];
    var bookmarkletToken = req.headers['x-collabosphere-token'];

    // If the custom headers are not present, move on through the middleware chain
    if (!userId || !bookmarkletToken) {
      return next();
    }

    // Get the user for the provided bookmarklet token
    UsersAPI.getUserByBookmarkletToken(userId, bookmarkletToken, function(err, user) {
      if (err) {
        log.error({'err': err}, 'Unauthorized bookmarklet authentication attempt');
        return next();
      } else if (user.canvas_enrollment_state !== CollabosphereConstants.ENROLLMENT_STATE.ACTIVE) {
        log.warn({'user': user}, 'Bookmarklet authentication attempt from user that is no longer in course');
        return next();
      }

      // Add the current user and course to the request
      setRequestContext(req, user);
      return next();
    });
  });

  // 2. Check if the user is authorized to interact with the given course through a cookie that
  //    was set when launching the LTI tool
  apiRouter.use(function(req, res, next) {
    // If the request already has a context object, a successful bookmarklet token has taken
    // place and we can continue moving through the middleware
    if (req.ctx) {
      return next();
    }

    // Extract the API domain and course id from the API URL. The expected format for all API urls
    // is `/api/ucberkeley.canvas.com/21312`
    var apiDomain = decodeURIComponent(req.baseUrl.split('/')[2]);
    var courseId = decodeURIComponent(req.baseUrl.split('/')[3]);

    // Get the user id from the client's cookies. As a user can have multiple tools open
    // in multiple courses, we have a cookie per domain/course tuple
    var cookieName = encodeURIComponent(apiDomain + '_' + courseId);
    var userId = req.signedCookies[cookieName];

    // If no user id could be found, we bail out immediately
    if (!userId) {
      return res.status(401).send('Incorrect cookie information present');
    }

    // Get the user
    UsersAPI.getUser(userId, function(err, user) {
      if (err) {
        return next(err);
      }

      // Add the current user and course to the request object
      setRequestContext(req, user);

      return next();
    });
  });
};

/**
 * Generate previews for an asset or whiteboard
 *
 * @param  {Number}       id                    The id identifying the asset or whiteboard
 * @param  {String}       uri                   S3 Object Key (or URL) of asset or whiteboard
 * @param  {String}       postbackEndPoint      The endpoint where the results should be reported on by the preview service
 * @param  {Function}     callback              Standard callback function
 * @param  {Object}       callback.err          An error object, if any
 */
var generatePreviews = module.exports.generatePreviews = function(id, uri, postBackEndpoint, callback) {
  if (!config.get('previews.enabled')) {
    return callback();
  }

  var protocol = config.get('app.https') ? 'https' : 'http';
  var authorizationHeader = generatePreviewServiceSignature();
  var params = {
    'form': {
      'id': id,
      'url': uri,
      'postBackUrl': util.format('%s://%s%s', protocol, config.get('app.host'), postBackEndpoint)
    },
    'headers': {
      'authorization': authorizationHeader
    }
  };
  request.post(config.get('previews.url'), params, function(err, response, body) {
    if (err) {
      log.error({
        'err': err,
        'id': id,
        'postBackEndpoint': postBackEndpoint
      }, 'An error occurred when generating previews');
      return callback({'code': 500, 'msg': 'Failed to contact the previews service'});
    } else if (response.statusCode !== 200) {
      log.error({
        'err': err,
        'id': id,
        'postBackEndpoint': postBackEndpoint,
        'response': {
          'statusCode': response.statusCode,
          'body': body
        }
      }, 'An error occurred when generating previews');
      return callback({'code': 500, 'msg': 'The previews service returned an error'});
    }

    return callback();
  });
};

/**
 * Verify the passed in header from the previews service
 *
 * @param  {String}   authorizationHeader     The passed in authorization header
 * @return {Boolean}                          `true` if the authorization header is valid, `false` otherwise
 */
var verifyPreviewsAuthorization = module.exports.verifyPreviewsAuthorization = function(authorizationHeader) {
  if (!authorizationHeader) {
    log.warn('No authorization header was provided for the previews callback endpoint');
    return false;
  } else if (authorizationHeader.substring(0, 7) !== 'Bearer ') {
    log.warn('The wrong authorization protocol was used for the the previews callback endpoint');
    return false;
  }

  var parts = authorizationHeader.substring(7).split(':');

  // Ensure a valid nonce was passed in
  var nonce = parseInt(parts[0].trim(), 10);
  if (_.isNaN(nonce)) {
    log.warn('An invalid authorization nonce was specified');
    return false;
  }

  // Ensure the nonce isn't being replaced by forcing it to be within 10 minutes of
  // the current timestamp. This also means that there can't be a timedrift of more
  // than 10 minutes between the server running SuiteC and the server running
  // the preview service
  var before = Date.now() - 10 * 60 * 1000;
  var after = Date.now() + 10 * 60 * 1000;
  if (!_.inRange(nonce, before, after)) {
    log.warn({'nonce': nonce}, 'An invalid authorization nonce was specified, replay attack?');
    return false;
  }

  var signature = parts[1].trim();
  if (generatePreviewServiceSignature(nonce) !== authorizationHeader) {
    log.warn('An invalid authorization signature was returned');
    return false;
  }

  return true;
};

/**
 * Sign the previews nonce
 *
 * @param  {Number}   [nonce]     The nonce that should be used to communicate with the previews service, if undefined it defaults to the current timestamp
 * @return {String}               The signed nonce
 */
var generatePreviewServiceSignature = module.exports.generatePreviewServiceSignature = function(nonce) {
  nonce = nonce || Date.now();
  var signKey = config.get('previews.apiKey');
  var hmac = crypto.createHmac('sha1', signKey);
  hmac.update(nonce.toString());
  var signature = hmac.digest('base64');
  return util.format('Bearer %d:%s', nonce, signature);
};

/**
 * Set a context on the request that contains information about the current user
 * and the current course
 *
 * @param  {Object}         req             The express request object to set the context on
 * @param  {User}           user            The current user
 * @api private
 */
var setRequestContext = function(req, user) {
  req.ctx = {
    'user': user,
    'course': user.course
  };
};

/**
 * Initialize the Canvas poller if it has been enabled. The poller will check the Canvas REST API
 * for new assignment submissions, discussion topics or discussion entries and track them as activities
 *
 * @api private
 */
var initializeCanvasPoller = function() {
  var isEnabled = config.get('canvasPoller.enabled');
  var delay = config.get('canvasPoller.delay') || 60;
  var threshold = config.get('canvasPoller.deactivationThreshold');
  if (isEnabled) {
    CanvasPoller.enable(delay, threshold);
  }
};

// Timestamp for last completed thumbnail generation
var lastWhiteboardThumbnails = Date.now();

/**
 * Update last completed thumbnail generation timestamp
 */
var updateLastWhiteboardThumbnails = module.exports.updateLastWhiteboardThumbnails = function() {
  lastWhiteboardThumbnails = Date.now();
};

/**
 * Get the status of the SuiteC app. By being able to execute this function, the SuiteC
 * Node.js process is up by definition. Next to this, the database connection and the ability to write
 * to the temporary space will be tested as well
 *
 * @param  {Function}       callback                Standard callback function
 * @param  {Object}         callback.status         The current status of the SuiteC app
 * @param  {Boolean}        callback.status.app     Whether the SuiteC app is up. When this function can be successfully called, the SuiteC app is up by definition
 * @param  {Boolean}        callback.status.db      Whether the database is up and SuiteC is able to successfully communicate with it
 * @param  {Boolean}        callback.status.tmp     Whether SuiteC is able to write to the temporary disk location
 */
var getStatus = module.exports.getStatus = function(callback) {
  // Indicate that the Node.js process is up
  var status = {
    'app': true
  };

  // Check if a connection with the database can be made
  CanvasAPI.getCanvases(function(err, canvases) {
    status.db = err ? false : true;

    // Check for recent poller activity
    var lastCoursePoll = CanvasPoller.getLastCoursePoll();
    if (Date.now() - lastCoursePoll < (config.get('canvasPoller.timeout') * 1000)) {
      status.poller = true;
    } else {
      status.poller = false;
      status.pollerLastActive = moment(lastCoursePoll).format();
    }

    // Check for recent whiteboard thumbnail activity
    if (Date.now() - lastWhiteboardThumbnails < (config.get('whiteboardThumbnails.timeout') * 1000)) {
      status.whiteboardThumbnails = true;
    } else {
      status.whiteboardThumbnails = false;
      status.whiteboardThumbnailsLastActive = moment(lastWhiteboardThumbnails).format();
    }

    // Check if a file can be written to the temporary disk location
    var filePath = path.join(os.tmpdir(), 'collabosphere_status_check');
    var fileStream = fs.createWriteStream(filePath);

    /*!
     * Clean up the tmp file
     */
    var cleanUpTmpFile = function() {
      fs.unlink(filePath, function(unlinkErr) {
        return callback(status);
      });
    };

    fileStream.on('error', function(err) {
      status.tmp = false;
      cleanUpTmpFile();
    });
    fileStream.on('finish', function() {
      status.tmp = true;
      cleanUpTmpFile();
    });

    fileStream.write('Collabosphere');
    fileStream.end();
  });
};

/**
 * Get the current version number of the SuiteC app.
 *
 * @param  {Function}      callback                Standard callback function
 * @param  {Object}        callback.version        The current version number of the SuiteC app
 */
var getVersion = module.exports.getVersion = function(callback) {
  var version = {
    'version': appPackage.version
  };

  // Add build info, if available
  var buildStats = '../../../config/build-stats.json';
  if (fs.existsSync(path.join(__dirname, buildStats))) {
    _.extend(version, require(buildStats));
  };

  return callback(version);
};
