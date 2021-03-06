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
var fs = require('fs');
var Joi = require('joi');
var mime = require('mime');
var path = require('path');
var request = require('request');
var util = require('util');

var DB = require('col-core/lib/db');
var log = require('col-core/lib/logger')('col-canvas');

/**
 * Get a Canvas instance by its API domain and LTI key
 *
 * @param  {String}     apiDomain             The domain on which Canvas is running
 * @param  {String}     ltiKey                The basic LTI key that will be used to embed the tools into Canvas
 * @param  {Function}   callback              Standard callback function
 * @param  {Object}     callback.err          An error object, if any
 * @param  {Canvas}     callback.canvas       The retrieved Canvas instance
 */
var getCanvas = module.exports.getCanvas = function(apiDomain, ltiKey, callback) {
  // Parameter validation
  var validationSchema = Joi.object().keys({
    'apiDomain': Joi.string().required(),
    'ltiKey': Joi.string().alphanum().length(32)
  });

  var validationResult = Joi.validate({
    'apiDomain': apiDomain,
    'ltiKey': ltiKey
  }, validationSchema);

  if (validationResult.error) {
    return callback({'code': 400, 'msg': validationResult.error.details[0].message});
  }

  // Retrieve the Canvas instance from the DB
  var options = {
    'where': {
      'canvas_api_domain': apiDomain,
      'lti_key': ltiKey
    }
  };
  DB.Canvas.findOne(options).complete(function(err, canvas) {
    if (err) {
      log.error({'err': err, 'apiDomain': apiDomain}, 'Failed to get a Canvas instance');
      return callback({'code': 500, 'msg': err.message});
    } else if (!canvas) {
      log.warn({'err': err, 'apiDomain': apiDomain}, 'A Canvas instance with the specified api domain and consumer lti key could not be found');
      return callback({'code': 404, 'msg': 'A Canvas instance with the specified api domain and consumer lti key could not be found'});
    }

    return callback(null, canvas);
  });
};

/**
 * Get all Canvas instances
 *
 * @param  {Function}       callback                    Standard callback function
 * @param  {Object}         callback.err                An error that occurred, if any
 * @param  {Canvas[]}       callback.category           All Canvas instances
 */
var getCanvases = module.exports.getCanvases = function(callback) {
  DB.Canvas.findAll().complete(function(err, canvases) {
    if (err) {
      log.error({'err': err}, 'Failed to retrieve all Canvas instances');
      return callback({'code': 500, 'msg': err.message});
    }

    return callback(null, canvases);
  });
};

/* FILE UPLOAD */

/**
 * Upload the file to the storage back-end.
 *
 * @param  {Context}        ctx                   Standard context containing the current user and the current course
 * @param  {String}         filePath              The path of the file that should be uploaded
 * @param  {Object}         uploadInfo            The signed information that allows us to upload the file
 * @param  {Function}       callback              Standard callback function
 * @param  {Object}         callback.err          An error that occurred, if any
 * @param  {Object}         callback.fileInfo     The file information for the uploaded file
 * @api private
 */
var uploadFile = function(ctx, filePath, uploadInfo, callback) {
  var opts = {
    'url': uploadInfo.upload_url,
    'method': 'POST'
  };
  var r = request(opts, function(err, response, body) {
    if (err) {
      log.error({'err': err, 'course': ctx.course.id}, 'Failed to upload the file');
      return callback({'code': 500, 'msg': 'Failed to upload the file'});
    } else if (!(response.statusCode === 301 || response.statusCode === 302 || response.statusCode === 303)) {
      log.error({'err': err, 'course': ctx.course.id, 'body': body, 'statuscode': response.statusCode}, 'Failed to upload the file');
      return callback({'code': 500, 'msg': 'Failed to upload the file'});
    }

    var confirmUrl = response.headers.location;
    return callback(null, confirmUrl);
  });

  // We need to add the parameters as multi-part blocks
  var form = r.form();

  // Append all the parameters that we retrieved earlier
  _.each(uploadInfo.upload_params, function(value, key) {
    form.append(key, value);
  });

  // Append the file. Note that the file should always be appended last
  form.append('file', fs.createReadStream(filePath));
};

/* Sections */

/**
 * Get all sections of course
 *
 * @param  {Course}         course                      The course for which to get the enrolled users
 * @param  {Function}       callback                    Standard callback function
 * @param  {Object}         callback.err                An error that occurred, if any
 */
var getCourseSections = module.exports.getCourseSections = function(course, callback) {
  var url = util.format('/api/v1/courses/%d/sections?include[]=students', course.canvas_course_id);

  log.debug({
    'course': course.id,
    'url': url
  }, 'Getting course sections');

  return getDataFromCanvas(course.canvas, url, callback);
};

/* Course users */

/**
 * Get the enrolled users of a course
 *
 * @param  {Course}         course                      The course for which to get the enrolled users
 * @param  {Object}         [options]                   A set of optional parameters
 * @param  {String[]}       [options.enrollment_state]  When set, only return users where the enrollment workflow state is of one of the given types. `active` and `invited` enrollments are returned by default. Should be one of @{link CollabosphereConstants.ENROLLMENT_STATE}
 * @param  {Function}       callback                    Standard callback function
 * @param  {Object}         callback.err                An error that occurred, if any
 * @param  {Object[]}       callback.users              The enrolled users of the given course
 */
var getCourseUsers = module.exports.getCourseUsers = function(course, options, callback) {
  options = options || {};

  log.debug({
    'course': course.id,
    'canvas_course_id': course.canvas_course_id,
    'canvas_api_domain': course.canvas_api_domain,
    'options': options
  }, 'Getting users');

  var url = util.format('/api/v1/courses/%d/users?include[]=enrollments&include[]=avatar_url&include[]=email', course.canvas_course_id);
  return getDataFromCanvas(course.canvas, url, callback);
};

/* Assignments */

/**
 * Get the assignments for a course
 *
 * @param  {Course}         course                    The course for which to get the assignments
 * @param  {Function}       callback                  Standard callback function
 * @param  {Object}         callback.err              An error that occurred, if any
 * @param  {Object[]}       callback.assignments      The assignments for the given course
 */
var getAssignments = module.exports.getAssignments = function(course, callback) {
  log.debug({
    'course': course.id,
    'canvas_course_id': course.canvas_course_id,
    'canvas_api_domain': course.canvas_api_domain
  }, 'Getting assignments');

  var url = util.format('/api/v1/courses/%d/assignments', course.canvas_course_id);
  return getDataFromCanvas(course.canvas, url, callback);
};

/**
 * Get the submissions for an assignment
 *
 * @param  {Course}         course                    The course for which to get the submissions
 * @param  {Object}         assignment                The assignment for which to get the submissions
 * @param  {Function}       callback                  Standard callback function
 * @param  {Object}         callback.err              An error that occurred, if any
 * @param  {Object[]}       callback.submissions      The submissions for the given assignment
 */
var getSubmissions = module.exports.getSubmissions = function(course, assignment, callback) {
  log.debug({
    'assignment': {
      'id': assignment.id,
      'name': assignment.name
    },
    'course': course.id,
    'canvas_course_id': course.canvas_course_id,
    'canvas_api_domain': course.canvas_api_domain
  }, 'Getting submissions');

  var url = util.format('/api/v1/courses/%d/assignments/%d/submissions', course.canvas_course_id, assignment.id);
  return getDataFromCanvas(course.canvas, url, callback);
};

/* Discussions */

/**
 * Get the discussions for a course
 *
 * @param  {Course}         course                    The course for which to get the discussions
 * @param  {Function}       callback                  Standard callback function
 * @param  {Object}         callback.err              An error that occurred, if any
 * @param  {Object[]}       callback.discussions      The discussions for the given course
 */
var getDiscussions = module.exports.getDiscussions = function(course, callback) {
  log.debug({
    'course': course.id,
    'canvas_course_id': course.canvas_course_id,
    'canvas_api_domain': course.canvas_api_domain
  }, 'Getting discussions');

  var url = util.format('/api/v1/courses/%d/discussion_topics', course.canvas_course_id);
  return getDataFromCanvas(course.canvas, url, callback);
};

/**
 * Get the entries on a discussion
 *
 * @param  {Course}         course                    The course for which to get the entries
 * @param  {Object}         discussion                The discussion for which to get the entries
 * @param  {Function}       callback                  Standard callback function
 * @param  {Object}         callback.err              An error that occurred, if any
 * @param  {Object[]}       callback.entries          The entries for the given discussion
 */
var getDiscussionEntries = module.exports.getDiscussionEntries = function(course, discussion, callback) {
  log.debug({
    'discussion': {
      'id': discussion.id,
      'name': discussion.name
    },
    'course': course.id,
    'canvas_course_id': course.canvas_course_id,
    'canvas_api_domain': course.canvas_api_domain
  }, 'Getting discussion entries');

  var url = util.format('/api/v1/courses/%d/discussion_topics/%d/entries', course.canvas_course_id, discussion.id);
  return getDataFromCanvas(course.canvas, url, callback);
};

/* External tools */

/**
 * Get the external tool configurations for an account
 *
 * @param  {Canvas}         canvas                    The Canvas instance to query
 * @param  {Number}         accountId                 The id of the account
 * @param  {Function}       callback                  Standard callback function
 * @param  {Object}         callback.err              An error that occurred, if any
 * @param  {Object[]}       callback.tools            The external tool configurations for the given account
 */
var getExternalToolsForAccount = module.exports.getExternalToolsForAccount = function(canvas, accountId, callback) {
  log.debug({
    'account_id': accountId,
    'canvas_api_domain': canvas.canvas_api_domain
  }, 'Getting external tool configurations');

  var url = util.format('/api/v1/accounts/%d/external_tools', accountId);
  return getDataFromCanvas(canvas, url, callback);
};

/**
 * Get the external tool configurations for a course
 *
 * @param  {Course}         course                    The course for which to get the external tool configurations
 * @param  {Function}       callback                  Standard callback function
 * @param  {Object}         callback.err              An error that occurred, if any
 * @param  {Object[]}       callback.tools            The external tool configurations for the given course
 */
var getExternalToolsForCourse = module.exports.getExternalToolsForCourse = function(course, callback) {
  log.debug({
    'course': course.id,
    'canvas_course_id': course.canvas_course_id,
    'canvas_api_domain': course.canvas_api_domain
  }, 'Getting external tool configurations');

  var url = util.format('/api/v1/courses/%d/external_tools', course.canvas_course_id);
  return getDataFromCanvas(course.canvas, url, callback);
};

/**
 * Update an external tool in an account context
 *
 * @param  {Canvas}         canvas                    The Canvas instance to query
 * @param  {Number}         accountId                 The Canvas id of the account under which the tool is configured
 * @param  {Number}         toolId                    The Canvas id of the tool
 * @param  {String}         toolName                  The name of the tool
 * @param  {String}         appBaseURI                The base URI for the SuiteC app that will provide the configuration
 * @param  {Function}       callback                  Standard callback function
 * @param  {Object}         callback.err              An error that occurred, if any
 * @param  {Object[]}       callback.discussions      The external tool configurations for the given course
 */
var updateExternalToolForAccount = module.exports.updateExternalToolForAccount = function(canvas, accountId, toolId, toolName, appBaseURI, callback) {
  var requestUrl = util.format('%s/api/v1/accounts/%d/external_tools/%d', getCanvasBaseURI(canvas), accountId, toolId);
  var configUrl = util.format('%s/lti/%s.xml', appBaseURI, toolName);
  var opts = {
    'url': requestUrl,
    'method': 'PUT',
    'headers': {
      'Authorization': util.format('Bearer %s', canvas.api_key)
    },
    'form': {
      'config_type': 'by_url',
      'config_url': configUrl,
      'consumer_key': canvas.lti_key,
      'shared_secret': canvas.lti_secret
    }
  };

  log.debug({
    'account': accountId,
    'canvas_api_domain': canvas.canvas_api_domain,
    'toolId': toolId,
    'toolName': toolName
  }, 'Updating external tool configurations');

  request(opts, function(err, response, body) {
    if (err || response.statusCode !== 200) {
      log.error({
        'err': err,
        'canvas': canvas.canvas_api_domain,
        'statusCode': response.statusCode,
        'account': accountId
      }, 'Failed to update external tools for account');
      return callback({'code': 500, 'msg': 'Failed to update external tools for account'});
    }

    var data = null;
    try {
      data = JSON.parse(body);
    } catch (parseErr) {
      log.error({'err': parseErr, 'account': accountId, 'canvas': canvas.canvas_api_domain}, 'Failed to parse external tool update for account');
      return callback({'code': 500, 'msg': 'Failed to parse external tool update for account'});
    }

    return callback(null, data);
  });
};

/**
 * Update an external tool in a course context
 *
 * @param  {Course}         course                    The course under which the tool is configured
 * @param  {Number}         toolId                    The Canvas id of the tool
 * @param  {String}         toolName                  The name of the tool
 * @param  {String}         appBaseURI                The base URI for the SuiteC app that will provide the configuration
 * @param  {Function}       callback                  Standard callback function
 * @param  {Object}         callback.err              An error that occurred, if any
 * @param  {Object[]}       callback.discussions      The external tool configurations for the given course
 */
var updateExternalToolForCourse = module.exports.updateExternalToolForCourse = function(course, toolId, toolName, appBaseURI, callback) {
  var requestUrl = util.format('%s/api/v1/courses/%d/external_tools/%d', getCanvasBaseURI(course.canvas), course.canvas_course_id, toolId);
  var configUrl = util.format('%s/lti/%s.xml', appBaseURI, toolName);
  var opts = {
    'url': requestUrl,
    'method': 'PUT',
    'headers': {
      'Authorization': util.format('Bearer %s', course.canvas.api_key)
    },
    'form': {
      'config_type': 'by_url',
      'config_url': configUrl,
      'consumer_key': course.canvas.lti_key,
      'shared_secret': course.canvas.lti_secret
    }
  };

  log.debug({
    'course': course.id,
    'canvas_api_domain': course.canvas_api_domain,
    'toolId': toolId,
    'toolName': toolName
  }, 'Updating external tool configurations');

  request(opts, function(err, response, body) {
    if (err || response.statusCode !== 200) {
      log.error({
        'err': err,
        'canvas': course.canvas_api_domain,
        'statusCode': response.statusCode,
        'course': course.id
      }, 'Failed to update external tools for course');
      return callback({'code': 500, 'msg': 'Failed to update external tools for course'});
    }

    var data = null;
    try {
      data = JSON.parse(body);
    } catch (parseErr) {
      log.error({'err': parseErr, 'course': course.id, 'canvas': course.canvas_api_domain}, 'Failed to parse external tool update for course');
      return callback({'code': 500, 'msg': 'Failed to parse external tool update for course'});
    }

    return callback(null, data);
  });
};

/**
 * Get tabs for a Canvas course
 *
 * @param  {Course}         course                    The course to query
 * @param  {Function}       callback                  Standard callback function
 * @param  {Object}         callback.err              An error that occurred, if any
 * @param  {Object[]}       callback.tabs             The tabs for the given course
 */
var getCourseTabs = module.exports.getCourseTabs = function(course, callback) {
  log.debug({
    'course': course.id,
    'canvas_course_id': course.canvas_course_id,
    'canvas_api_domain': course.canvas_api_domain
  }, 'Getting tabs');

  var url = util.format('/api/v1/courses/%d/tabs', course.canvas_course_id);
  return getDataFromCanvas(course.canvas, url, callback);
}

/* Courses and accounts */

/**
 * Get properties of a Canvas account
 *
 * @param  {Canvas}         canvas                      The Canvas instance to query
 * @param  {Number}         accountId                   The id of the account
 * @param  {Function}       callback                    Standard callback function
 * @param  {Object}         callback.err                An error that occurred, if any
 * @param  {Object}         callback.accountProperties  Account properties
 */
var getAccountProperties = module.exports.getAccountProperties = function(canvas, accountId, callback) {
  log.debug({
    'account': accountId,
    'canvas_api_domain': canvas.canvas_api_domain
  }, 'Getting Canvas account properties');

  var url = util.format('%s/api/v1/accounts/%d', getCanvasBaseURI(canvas), accountId);
  var requestOpts = {
    'url': url,
    'method': 'GET',
    'headers': {
      'Authorization': util.format('Bearer %s', canvas.api_key)
    }
  };

  request(requestOpts, function(err, response, body) {
    if (err || response.statusCode !== 200) {
      log.error({
        'err': err,
        'canvas': canvas.canvas_api_domain,
        'statusCode': response.statusCode,
        'account': accountId
      }, 'Failed to get Canvas account properties');
      return callback({'code': 500, 'msg': 'Failed to get Canvas account properties'});
    }

    var data = null;
    try {
      data = JSON.parse(body);
    } catch (parseErr) {
      log.error({'err': parseErr, 'account': accountId, 'canvas': canvas.canvas_api_domain}, 'Failed to parse Canvas account properties');
      return callback({'code': 500, 'msg': 'Failed to parse Canvas account properties'});
    }

    return callback(null, data);
  });
};

/**
 * Get properties of a Canvas course
 *
 * @param  {Course}         course                      The course for which to get properties
 * @param  {Function}       callback                    Standard callback function
 * @param  {Object}         callback.err                An error that occurred, if any
 * @param  {Object}         callback.courseProperties   Course properties
 */
var getCourseProperties = module.exports.getCourseProperties = function(course, callback) {
  log.debug({
    'course': course.id,
    'canvas_course_id': course.canvas_course_id,
    'canvas_api_domain': course.canvas_api_domain
  }, 'Getting Canvas course properties');

  var url = util.format('%s/api/v1/courses/%d', getCanvasBaseURI(course.canvas), course.canvas_course_id);
  var requestOpts = {
    'url': url,
    'method': 'GET',
    'headers': {
      'Authorization': util.format('Bearer %s', course.canvas.api_key)
    }
  };

  request(requestOpts, function(err, response, body) {
    if (err || response.statusCode !== 200) {
      log.error({
        'err': err,
        'canvas': canvas.canvas_api_domain,
        'statusCode': response.statusCode,
        'course': ctx.course.id
      }, 'Failed to get Canvas course properties');
      return callback({'code': 500, 'msg': 'Failed to get Canvas course properties'});
    }

    var data = null;
    try {
      data = JSON.parse(body);
    } catch (parseErr) {
      log.error({'err': parseErr, 'course': course.id, 'canvas': canvas.canvas_api_domain}, 'Failed to parse Canvas course properties');
      return callback({'code': 500, 'msg': 'Failed to parse Canvas course properties'});
    }

    return callback(null, data);
  });
};

/* Utilities */

/**
 * For security reasons, the canvas object on the course API usually only contains the `use_https`
 * and `canvas_api_domain` attributes. By reloading the instance, all other attributes such as
 * the `canvas_api_key` will be retrieved
 *
 * @param  {Canvas}         canvas            The canvas object to reload
 * @param  {Function}       callback          Standard callback function
 * @param  {Object}         callback.err      An error that occurred, if any
 * @api private
 */
var reloadCanvasObject = function(canvas, callback) {
  if (canvas.canvas_api_domain && canvas.canvas_api_key) {
    return callback();
  }

  // Reload the canvas object
  canvas.reload().complete(callback);
};

/**
 * Get the base URI on which a Canvas REST API can be reached. This includes
 * the protocol and hostname.
 *
 * @param  {Canvas}        canvas                 The canvas object for which to get the base URI
 * @return {String}                               The base URI where the Canvas API can be reached on
 * @api private
 */
var getCanvasBaseURI = function(canvas) {
  var canvasProtocol = (canvas.use_https ? 'https' : 'http');
  return util.format('%s://%s', canvasProtocol, canvas.canvas_api_domain);
};

/**
 * Get data from the Canvas REST API. This method will respect Canvas' paging parameters
 * and will pull down the full dataset
 *
 * @param  {Canvas}         canvas                The canvas object that holds information about the REST API
 * @param  {String}         apiUrl                The relative API URL to get the data from
 * @param  {Function}       callback              Standard callback function
 * @param  {Object}         callback.err          An error that occurred, if any
 * @param  {Object}         callback.data         The data as returned by the Canvas REST API
 * @api private
 */
var getDataFromCanvas = function(canvas, apiUrl, callback, page, allData) {
  page = page || 1;
  allData = allData || [];

  reloadCanvasObject(canvas, function(err) {
    if (err) {
      return callback(err);
    }

    var questionMark = (apiUrl.indexOf('?') === -1 ? '?' : '&');
    var url = util.format('%s%s%spage=%d&per_page=50', getCanvasBaseURI(canvas), apiUrl, questionMark, page);

    var opts = {
      'url': url,
      'method': 'GET',
      'headers': {
        'Authorization': util.format('Bearer %s', canvas.api_key)
      }
    };
    request(opts, function(err, response, body) {
      if (err) {
        log.error({'err': err, 'canvas': canvas.canvas_api_domain}, 'Failed to interact with the Canvas REST API');
        return callback({'code': 500, 'msg': 'Failed to interact with the Canvas REST API'});
      } else if (response.statusCode !== 200) {
        log.error({
          'err': err,
          'canvas': canvas.canvas_api_domain,
          'statusCode': response.statusCode,
          'body': body
        }, 'Canvas returned a non-200 status code');
        return callback({'code': 500, 'msg': 'Canvas returned a non-200 status code'});
      }

      // Canvas always returns JSON
      var data = null;
      try {
        data = JSON.parse(body);
      } catch (parseErr) {
        log.error({'err': parseErr, 'canvas': canvas.canvas_api_domain}, 'Failed to parse the Canvas response');
        return callback({'code': 500, 'msg': 'Failed to parse the Canvas data'});
      }

      allData = _.union(allData, data);

      // Check if there is more data to retrieve
      if (!_.isEmpty(data) && _.has(response, 'headers.link') && response.headers.link.indexOf('rel="next"') > -1) {
        return getDataFromCanvas(canvas, apiUrl, callback, page + 1, allData);

      // If not, we return all the data to the caller
      } else {
        return callback(null, allData);
      }
    });
  });
};
