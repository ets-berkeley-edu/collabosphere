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
var config = require('config');
var randomstring = require('randomstring');
var util = require('util');

var AssetsTestUtil = require('col-assets/tests/util');
var EmailUtil = require('col-core/lib/email');
var LtiTestUtil = require('col-lti/tests/util');
var RestAPI = require('col-rest');
var Storage = require('col-core/lib/storage');
var WhiteboardsTestUtil = require('col-whiteboards/tests/util');

/**
 * Get an anonymous REST client
 *
 * @return {RestClient}                     An anonymous app user REST client
 */
var getAnonymousClient = module.exports.getAnonymousClient = function() {
  var options = {
    'host': util.format('localhost:%s', config.get('app.port'))
  };
  return RestAPI.createClient(options);
};

/**
 * Generate a number of assets in a course
 *
 * @param  {Client}           client                  The REST client to make the request with
 * @param  {Course}           course                  The Canvas course in which the user is interacting with the API
 * @param  {Number}           total                   The total number of assets that should be created
 * @param  {Function}         callback                Standard callback function
 * @param  {Asset[]}          callback.assets         The created assets
 * @return {Object}                                   Prepared assets
 */
var generateTestAssets = module.exports.generateTestAssets = function(client, course, total, callback) {
  // Keep track of the assets that have been successfully created
  var createdAssets = [];

  var returnAssets = _.after(total, function() {
    return callback(createdAssets);
  });

  // Create the requested number of assets
  _.times(total, function() {
    var title = randomstring.generate(10);
    var url = util.format('http://www.%s.com/', randomstring.generate(10));
    AssetsTestUtil.assertCreateLink(client, course, title, url, null, function(asset) {
      createdAssets.push(asset);
      returnAssets();
    });
  });
};

/**
 * Generate a number of whiteboards in a course
 *
 * @param  {Client}           client                  The REST client to make the request with
 * @param  {Course}           course                  The Canvas course in which the user is interacting with the API
 * @param  {Number}           total                   The total number of whiteboards that should be created
 * @param  {Function}         callback                Standard callback function
 * @param  {Whiteboard[]}     callback.whiteboards    The created whiteboards
 * @return {Object}                                   Prepared whiteboards
 */
var generateTestWhiteboards = module.exports.generateTestWhiteboards = function(client, course, total, callback) {
  // `WhiteboardsTestUtil.assertCreateWhiteboard` will attach an event listener each time we create
  // a new whiteboard. To avoid node's `possible EventEmitter memory leak detected` message, we
  // temporarily disable the limit
  // Require the whiteboards API inline as it requires the entire application to be bootstrapped
  require('col-whiteboards').setMaxListeners(0);
  EmailUtil.setMaxListeners(0);

  // Keep track of the whiteboards that have been successfully created
  var createdWhiteboards = [];

  var returnWhiteboards = _.after(total, function() {
    require('col-whiteboards').setMaxListeners(10);
    EmailUtil.setMaxListeners(10);
    return callback(createdWhiteboards);
  });

  // Create the requested number of whiteboards
  _.times(total, function() {
    var title = randomstring.generate(10);
    WhiteboardsTestUtil.assertCreateWhiteboard(client, course, title, null, function(whiteboard) {
      createdWhiteboards.push(whiteboard);
      returnWhiteboards();
    });
  });
};

/**
 * Get an authenticated  client for a given Canvas course and user.
 * This is a utility method that allows for more streamlined testing by defaulting all its parameters.
 *
 * @param  {Client}           [client]                The REST client to make the request with. Defaults to an anonymous client
 * @param  {Course}           [course]                The Canvas course the Asset Library will be launched in. Defaults to a new course in the `ucberkeley` Canvas instance
 * @param  {User}             [user]                  The user in Canvas. Defaults to a new user in the `ucberkeley` Canvas instance
 * @param  {Function}         callback                Standard callback function
 * @param  {Client}           callback.client         The REST client that was used
 * @param  {Course}           callback.course         The Canvas course that was used
 * @param  {User}             callback.user           The Canvas user that was used
 * @return {Object}                                   Prepared client
 * @throws {AssertionError}                           Error thrown when an assertion failed
 */
var getAssetLibraryClient = module.exports.getAssetLibraryClient = function(client, course, user, callback) {
  client = client || getAnonymousClient();
  course = course || generateCourse(global.tests.canvas.ucberkeley);
  user = user || generateUser(global.tests.canvas.ucberkeley);
  LtiTestUtil.assertAssetLibraryLaunchSucceeds(client, course, user, function() {
    return callback(client, course, user);
  });
};

/**
 * Get the mocked Canvas App server for a given canvas instance
 *
 * @param  {Canvas}   canvas    The canvas instance for which to get the mocked Canvas REST API
 * @return {Express}            The express application that holds the mocked Canvas REST API
 */
var getMockedCanvasAppServer = module.exports.getMockedCanvasAppServer = function(canvas) {
  if (canvas.canvas_api_domain === global.tests.canvas.ucdavis.canvas_api_domain) {
    return global.tests.canvas.ucdavis.appServer;
  } else {
    return global.tests.canvas.ucberkeley.appServer;
  }
};

/**
 * Generate a fake Canvas Course that can be used to launch a tool. All of the inputs
 * are optional and will be generated if omitted.
 *
 * @param  {Canvas}           canvas                  The canvas instance in which the course lives
 * @param  {Number}           [id]                    The id of the course in Canvas
 * @param  {String}           [label]                 The label of the course in Canvas
 * @param  {String}           [title]                 The title of the course in Canvas
 * @return {Course}                                   An object that contains the information about the course
 */
var generateCourse = module.exports.generateCourse = function(canvas, id, label, title) {
  return {
    'canvas': _.extend({}, canvas),
    'id': id || _.random(10000000),
    'label': label || randomstring.generate(10),
    'title': title || randomstring.generate(25)
  };
};

/**
 * Generate a fake Canvas administrator that can be used to launch a tool. All of the inputs
 * are optional and will be generated if omitted.

 * @param  {Canvas}           [canvas]                The canvas instance in which the user lives
 * @param  {Number}           [id]                    The id of the user in Canvas
 * @param  {String}           [givenName]             The given name of the user
 * @param  {String}           [familyName]            The family name of the user
 * @param  {String}           [loginId]               The login id for the user
 * @param  {String}           [userImage]             The url that points to a profile picture for the user
 * @return {User}                                     An object that contains the information about the user
 */
var generateCanvasAdmin = module.exports.generateCanvasAdmin = function(canvas, id, givenName, familyName, loginId, userImage) {
  return generateUser(canvas, id, 'urn:lti:instrole:ims/lis/Administrator', givenName, familyName, loginId, userImage);
};

/**
 * Generate a fake Canvas Course instructor that can be used to launch a tool. All of the inputs
 * are optional and will be generated if omitted.

 * @param  {Canvas}           [canvas]                The canvas instance in which the user lives
 * @param  {Number}           [id]                    The id of the user in Canvas
 * @param  {String}           [givenName]             The given name of the user
 * @param  {String}           [familyName]            The family name of the user
 * @param  {String}           [loginId]               The login id for the user
 * @param  {String}           [userImage]             The url that points to a profile picture for the user
 * @return {User}                                     An object that contains the information about the user
 */
var generateInstructor = module.exports.generateInstructor = function(canvas, id, givenName, familyName, loginId, userImage) {
  return generateUser(canvas, id, 'urn:lti:role:ims/lis/Instructor', givenName, familyName, loginId, userImage);
};

/**
 * Generate a fake Canvas User that can be used to launch a tool. All of the inputs
 * are optional and will be generated if omitted.

 * @param  {Canvas}           [canvas]                The canvas instance in which the user lives
 * @param  {Number}           [id]                    The id of the user in Canvas
 * @param  {String}           [roles]                 The role of the user in the course, defaults to `Student`
 * @param  {String}           [givenName]             The given name of the user
 * @param  {String}           [familyName]            The family name of the user
 * @param  {String}           [loginId]               The login id for the user
 * @param  {String}           [userImage]             The url that points to a profile picture for the user
 * @param  {String}           [personalBio]           User's personal description
 * @return {User}                                     An object that contains the information about the user
 */
var generateUser = module.exports.generateUser = function(canvas, id, roles, givenName, familyName, loginId, userImage, personalBio) {
  givenName = givenName || randomstring.generate(10);
  familyName = familyName || randomstring.generate(15);
  return {
    'canvas': _.extend({}, canvas),
    'id': id || _.random(10000000),
    'givenName': givenName,
    'familyName': familyName,
    'fullName': givenName + ' ' + familyName,
    'personal_bio': personalBio || 'I live in a van down by the river.',
    'roles': roles || 'Student',
    'ext_roles': roles || 'Student',
    'loginId': loginId || (_.random(1000000) + '@berkeley.edu'),
    'guid': _.random(100000),
    'userImage': userImage || 'http://url.to/an/image.jpg'
  };
};

// Variable that will keep track of the expected and sent number of emails for a user
var expectedEmailCounts = {};

/**
 * Set the number of emails that should be expected for a user. When more than the expected `total`
 * emails are sent to the user, an assertion error will be thrown.
 *
 * @param  {Number}    userId      The id of the user to expect a total number of emails for
 * @param  {Number}    total       The number of emails to expect
 * @return {void}
 */
var setExpectedEmail = module.exports.setExpectedEmail = function(userId, total) {
  expectedEmailCounts[userId] = {
    'expected': total,
    'sent': 0
  };
};

// Listen for emails and ensure we're not sending more emails than we're configured to do so
EmailUtil.on(EmailUtil.EVENT_NAMES.EMAIL_SENT, function(email, user, course) {
  if (expectedEmailCounts[user.id]) {
    expectedEmailCounts[user.id].sent = expectedEmailCounts[user.id].sent + 1;
    if (expectedEmailCounts[user.id].sent > expectedEmailCounts[user.id]) {
      assert.fail(sentEmails, expectedEmailCounts[user.id], 'Sent more emails to ' + user.id + ' than expected');
    }
  }
});
