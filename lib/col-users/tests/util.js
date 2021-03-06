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
var assert = require('assert');

var CollabosphereConstants = require('col-core/lib/constants');
var TestsUtil = require('col-tests/lib/util');

/**
 * Assert that a me object has all expected properties
 *
 * @param  {Me}                 me                      The me object to assert the properties for
 * @param  {Object}             [opts]                  Optional parameters to verify the me object with
 * @param  {Me}                 [opts.expectedMe]       The me object to which the provided me object should be compared
 * @throws {AssertionError}                             Error thrown when an assertion failed
 */
var assertMe = module.exports.assertMe = function(me, opts) {
  opts = opts || {};

  // Ensure that all expected properties are present
  assert.ok(me);
  assert.ok(me.id);
  assert.ok(me.canvas_user_id);
  assert.ok(me.course_id);
  assert.ok(me.canvas_course_role);
  assert.ok(me.canvas_full_name);
  assert.ok(me.bookmarklet_token);
  assert.ok(me.created_at);
  assert.ok(me.updated_at);
  assert.ok(_.isFinite(me.points));
  assert.ok(_.isBoolean(me.is_admin));
  assert.ok(_.isBoolean(me.looking_for_collaborators));
  assert(me.share_points === null || _.isBoolean(me.share_points));

  // Ensure that all expected properties are present on the course property
  var course = me.course;
  assert.ok(course);
  assert.ok(course.id);
  assert.strictEqual(course.id, me.course_id);
  assert.ok(course.canvas_course_id);
  assert.ok(course.canvas_api_domain);
  assert.ok(course.created_at);
  assert.ok(course.updated_at);
  assert.ok(_.isBoolean(course.enable_upload));
  assert.ok(_.isBoolean(course.active));

  // Ensure that all expected properties are present on the canvas property
  var canvas = course.canvas;
  assert.ok(canvas);
  assert.ok(_.isBoolean(canvas.use_https));
  // Ensure that none of the private properties return
  assert.ok(!canvas.api_key);
  assert.ok(!canvas.lti_key);
  assert.ok(!canvas.lti_secret);

  // Ensure that the user is correctly recognised as a (non-)admin
  var userRoles = (me.canvas_course_role || '').split(',');
  var allAdminRoles = _.union(CollabosphereConstants.ADMIN_ROLES, CollabosphereConstants.TEACHER_ROLES);
  if (_.intersection(allAdminRoles, userRoles).length > 0) {
    assert.strictEqual(me.is_admin, true);
  } else {
    assert.strictEqual(me.is_admin, false);
  }

  // Ensure that all the expected properties are the same as the ones for
  // the expected me object
  if (opts.expectedMe) {
    assert.strictEqual(me.id, opts.expectedMe.id);
    assert.strictEqual(me.canvas_user_id, opts.expectedMe.canvas_user_id);
    assert.strictEqual(me.course_id, opts.expectedMe.course_id);
    assert.strictEqual(me.canvas_course_role, opts.expectedMe.canvas_course_role);
    assert.strictEqual(me.canvas_course_sections, opts.expectedMe.canvas_course_sections);
    assert.strictEqual(me.canvas_full_name, opts.expectedMe.canvas_full_name);
    assert.strictEqual(me.bookmarklet_token, opts.expectedMe.bookmarklet_token);
    assert.strictEqual(me.created_at, opts.expectedMe.created_at);
    assert.strictEqual(me.updated_at, opts.expectedMe.updated_at);
    assert.strictEqual(me.personal_bio, opts.expectedMe.personal_bio);
    assert.strictEqual(me.points, opts.expectedMe.points);
    assert.strictEqual(me.share_points, opts.expectedMe.share_points);
    assert.strictEqual(me.is_admin, opts.expectedMe.is_admin);
    assert.strictEqual(me.looking_for_collaborators, opts.expectedMe.looking_for_collaborators);

    // Ensure that all the expected properties on the course property are the same
    assert.strictEqual(me.course.id, opts.expectedMe.course.id);
    assert.strictEqual(me.course.canvas_course_id, opts.expectedMe.course.canvas_course_id);
    assert.strictEqual(me.course.canvas_api_domain, opts.expectedMe.course.canvas_api_domain);
    assert.strictEqual(me.course.created_at, opts.expectedMe.course.created_at);
    assert.strictEqual(me.course.updated_at, opts.expectedMe.course.updated_at);
    assert.strictEqual(me.course.enable_upload, opts.expectedMe.course.enable_upload);
    assert.strictEqual(me.course.active, opts.expectedMe.course.active);

    // Ensure that all the expected properties on the canvas property are the same
    assert.strictEqual(me.course.canvas.use_https, opts.expectedMe.course.canvas.use_https);

    // Ensure that all optional properties are the same as the ones for the
    // expected me object
    if (me.canvas_image || opts.expectedMe.canvas_image) {
      assert.strictEqual(me.canvas_image, opts.expectedMe.canvas_image);
    }
  }
};

/**
 * Assert that a user has all expected properties
 *
 * @param  {User}               user                        The user to assert the properties for
 * @param  {Object}             [opts]                      Optional parameters to verify the user with
 * @param  {User}               [opts.expectedUser]         The user to which the provided user should be compared
 * @param  {Boolean}            [opts.expectPoints]         Whether the points related properties should be returned
 * @param  {Boolean}            [opts.expectEmail]          Whether the canvas_email should be returned
 * @param  {Boolean}            [opts.allowNotSharePoints]  Whether the user is allowed to not be sharing their engagement index points
 * @throws {AssertionError}                                 Error thrown when an assertion failed
 */
var assertUser = module.exports.assertUser = function(user, opts) {
  opts = opts || {};

  // Ensure that all expected properties are present
  assert.ok(user);
  assert.ok(user.id);
  assert.ok(user.canvas_course_role);
  assert.ok(user.canvas_full_name);
  assert.ok(user.canvas_enrollment_state);
  assert.ok(_.isUndefined(user.bookmarklet_token));
  assert.ok(_.isBoolean(user.looking_for_collaborators));

  if (opts.expectPoints) {
    assert.ok(_.isFinite(user.points));
    assert(user.share_points === null || _.isBoolean(user.share_points));
    if (user.points > 0) {
      assert.ok(user.last_activity);
    }

    if (!opts.allowNotSharePoints) {
      assert.strictEqual(user.share_points, true);
    }
  } else if (opts.expectPoints === false) {
    assert.ok(_.isUndefined(user.points));
    assert.ok(_.isUndefined(user.share_points));
  }

  if (opts.expectEmail === true) {
    assert.ok(!_.isUndefined(user.canvas_email));
  } else if (opts.expectEmail === false) {
    assert.ok(_.isUndefined(user.canvas_email));
  }

  // Ensure that all the expected properties are the same as the ones for
  // the expected user
  if (opts.expectedUser) {
    assert.strictEqual(user.id, opts.expectedUser.id);
    assert.strictEqual(user.canvas_course_role, opts.expectedUser.canvas_course_role);
    assert.deepEqual(user.canvas_course_sections, opts.expectedUser.canvas_course_sections);
    assert.strictEqual(user.canvas_full_name, opts.expectedUser.canvas_full_name);
    assert.equal(user.personal_bio, opts.expectedUser.personal_bio);
    assert.strictEqual(user.points, opts.expectedUser.points);
    assert.strictEqual(user.share_points, opts.expectedUser.share_points);
    assert.strictEqual(user.looking_for_collaborators, opts.expectedUser.looking_for_collaborators);

    // Ensure that all optional properties are the same as the ones for the
    // expected user
    if (user.canvas_image || opts.expectedUser.canvas_image) {
      assert.strictEqual(user.canvas_image, opts.expectedUser.canvas_image);
    }
    if (user.last_activity || opts.expectedUser.last_activity) {
      assert.strictEqual(user.last_activity, opts.expectedUser.last_activity);
    }
  }
};

/**
 * Assert that the me feed for a client can be retrieved
 *
 * @param  {Client}             client              The REST client to make the request with
 * @param  {Course}             course              The Canvas course the user is launched in
 * @param  {Me}                 [expectedMe]        The expected user that should be returned
 * @param  {Function}           callback            Standard callback function
 * @param  {Me}                 callback.me         The me data as returned by the API
 * @throws {AssertionError}                         Error thrown when an assertion failed
 */
var assertGetMe = module.exports.assertGetMe = function(client, course, expectedMe, callback) {
  client.users.getMe(course, function(err, me) {
    assert.ifError(err);
    assert.ok(me);
    assertMe(me, {'expectedMe': expectedMe});
    assert.strictEqual(me.course.canvas_course_id, course.id);

    return callback(me);
  });
};

/**
 * Assert that the user feed is available
 *
 * @param  {Client}             client              The REST client to make the request with
 * @param  {Course}             course              The Canvas course the user is launched in
 * @param  {Number}             userId              Id of the requested user
 * @param  {Function}           callback            Standard callback function
 * @param  {User}               callback.user       User data returned by the API
 */
var assertGetUser = module.exports.assertGetUser = function(client, course, userId, callback) {
  client.users.getUser(course, userId, function(err, user) {
    assert.ifError(err);
    assert.ok(user);
    assert.strictEqual(user.course.canvas_course_id, course.id);

    return callback(user);
  });
};

/**
 * Assert that the me feed for a client can not be retrieved
 *
 * @param  {Client}             client              The REST client to make the request with
 * @param  {Course}             course              The Canvas course the user is launched in
 * @param  {Number}             code                The expected HTTP error code
 * @param  {Function}           callback            Standard callback function
 * @throws {AssertionError}                         Error thrown when an assertion failed
 */
var assertGetMeFails = module.exports.assertGetMeFails = function(client, course, code, callback) {
  client.users.getMe(course, function(err, me) {
    assert.ok(err);
    assert.strictEqual(err.code, code);
    assert.ok(!me);

    return callback();
  });
};

/**
 * Assert that user's personal bio can be updated
 *
 * @param  {Client}             client              The REST client to make the request with
 * @param  {Course}             course              The Canvas course the user is launched in
 * @param  {Boolean}            personalBio         User's personal description
 * @param  {Function}           callback            Standard callback function
 * @param  {Me}                 callback.me         The updated me data
 * @throws {AssertionError}                         Error thrown when an assertion failed
 */
var assertUpdatePersonalBio = module.exports.assertUpdatePersonalBio = function(client, course, personalBio, callback) {
  client.users.updatePersonalBio(course, personalBio, function(err, me) {
    assert.ifError(err);
    assert.ok(me);
    assertMe(me);
    assert.strictEqual(me.personal_bio, personalBio);

    return callback(me);
  });
};

/**
 * Assert that user's personal bio is validated (e.g., can not exceed a certain length)
 *
 * @param  {Client}             client              The REST client to make the request with
 * @param  {Course}             course              The Canvas course the user is launched in
 * @param  {Boolean}            personalBio         User's personal description
 * @param  {Number}             code                The expected HTTP error code
 * @param  {Function}           callback            Standard callback function
 * @throws {AssertionError}                         Error thrown when an assertion failed
 */
var assertUpdatePersonalBioFails = module.exports.assertUpdatePersonalBioFails = function(client, course, personalBio, code, callback) {
  client.users.updatePersonalBio(course, personalBio, function(err, me) {
    assert.ok(err);
    assert.strictEqual(err.code, code);
    assert.ok(!me);

    return callback();
  });
};

/**
 * Assert that the points share status for a user can be updated
 *
 * @param  {Client}             client              The REST client to make the request with
 * @param  {Course}             course              The Canvas course the user is launched in
 * @param  {Boolean}            share               Whether the user's points should be shared with the course
 * @param  {Function}           callback            Standard callback function
 * @param  {Me}                 callback.me         The updated me data
 * @throws {AssertionError}                         Error thrown when an assertion failed
 */
var assertUpdateSharePoints = module.exports.assertUpdateSharePoints = function(client, course, share, callback) {
  client.users.updateSharePoints(course, share, function(err, me) {
    assert.ifError(err);
    assert.ok(me);
    assertMe(me);
    assert.strictEqual(me.share_points, share);

    return callback(me);
  });
};

/**
 * Assert that the points share status for a user can not be updated
 *
 * @param  {Client}             client              The REST client to make the request with
 * @param  {Course}             course              The Canvas course the user is launched in
 * @param  {Boolean}            share               Whether the user's points should be shared with the course
 * @param  {Number}             code                The expected HTTP error code
 * @param  {Function}           callback            Standard callback function
 * @throws {AssertionError}                         Error thrown when an assertion failed
 */
var assertUpdateSharePointsFails = module.exports.assertUpdateSharePointsFails = function(client, course, share, code, callback) {
  client.users.updateSharePoints(course, share, function(err, me) {
    assert.ok(err);
    assert.strictEqual(err.code, code);
    assert.ok(!me);

    return callback();
  });
};

/**
 * Assert success updating the current user's looking-for-collaborators status
 *
 * @param  {Client}             client              The REST client to make the request with
 * @param  {Course}             course              The Canvas course the user is launched in
 * @param  {Boolean}            looking             Whether the user is looking for collaborators
 * @param  {Function}           callback            Standard callback function
 * @param  {Me}                 callback.me         The updated me data
 * @throws {AssertionError}                         Error thrown when an assertion failed
 */
var assertUpdateLookingForCollaborators = module.exports.assertUpdateLookingForCollaborators = function(client, course, looking, callback) {
  client.users.updateLookingForCollaborators(course, looking, function(err, me) {
    assert.ifError(err);
    assert.ok(me);
    assertMe(me);
    assert.strictEqual(me.looking_for_collaborators, looking);

    return callback(me);
  });
};

/**
 * Assert failure updating the current user's looking-for-collaborators status
 *
 * @param  {Client}             client              The REST client to make the request with
 * @param  {Course}             course              The Canvas course the user is launched in
 * @param  {Boolean}            looking             Whether the user is looking for collaborators
 * @param  {Number}             code                The expected HTTP error code
 * @param  {Function}           callback            Standard callback function
 * @throws {AssertionError}                         Error thrown when an assertion failed
 */
var assertUpdateLookingForCollaboratorsFails = module.exports.assertUpdateLookingForCollaboratorsFails = function(client, course, looking, code, callback) {
  client.users.updateLookingForCollaborators(course, looking, function(err, me) {
    assert.ok(err);
    assert.strictEqual(err.code, code);
    assert.ok(!me);

    return callback();
  });
};

/**
 * Assert that all users in the current course can be retrieved
 *
 * @param  {Client}             client              The REST client to make the request with
 * @param  {Course}             course              The Canvas course the user is launched in
 * @param  {Number}             [expectedTotal]     The expected number of returned users
 * @param  {Function}           callback            Standard callback function
 * @param  {User[]}             callback.users      The users in the current course
 * @throws {AssertionError}                         Error thrown when an assertion failed
 */
var assertGetAllUsers = module.exports.assertGetAllUsers = function(client, course, expectedTotal, callback) {
  client.users.getAllUsers(course, function(err, users) {
    assert.ifError(err);
    assert.ok(users);
    if (_.isFinite(expectedTotal)) {
      assert.strictEqual(users.length, expectedTotal);
    }

    // No points should be returned for any user
    _.each(users, function(user) {
      assertUser(user, {'expectPoints': false, 'expectEmail': false});
      assert.ok(!user.points);
    });

    // Assert the returned users are sorted alphabetically
    for (var i = 1; i < users.length; i++) {
      assert.ok(users[i].canvas_full_name.toLowerCase() >= users[i - 1].canvas_full_name.toLowerCase());
    }

    return callback(users);
  });
};

/**
 * Assert that all users in the current course and their points can not be retrieved
 *
 * @param  {Client}             client              The REST client to make the request with
 * @param  {Course}             course              The Canvas course the user is launched in
 * @param  {Number}             code                The expected HTTP error code
 * @param  {Function}           callback            Standard callback function
 * @throws {AssertionError}                         Error thrown when an assertion failed
 */
var assertGetAllUsersFails = module.exports.assertGetAllUsersFails = function(client, course, code, callback) {
  client.users.getAllUsers(course, function(err, users) {
    assert.ok(err);
    assert.strictEqual(err.code, code);
    assert.ok(!users);

    return callback();
  });
};

/**
 * Assert that the users in the current course and their points can be retrieved
 *
 * @param  {Client}             client              The REST client to make the request with
 * @param  {Course}             course              The Canvas course the user is launched in
 * @param  {Number}             [expectedTotal]     The expected number of returned users
 * @param  {Boolean}            [expectEveryone]    Whether all users in the course are expected to be returned
 * @param  {Function}           callback            Standard callback function
 * @param  {User[]}             callback.users      The users and their points in the current course
 * @throws {AssertionError}                         Error thrown when an assertion failed
 */
var assertGetLeaderboard = module.exports.assertGetLeaderboard = function(client, course, expectedTotal, expectEveryone, callback) {
  client.users.getLeaderboard(course, function(err, users) {
    assert.ifError(err);
    assert.ok(users);
    if (_.isFinite(expectedTotal)) {
      assert.strictEqual(users.length, expectedTotal);
    }
    _.each(users, function(user) {
      assertUser(user, {'expectPoints': true, 'allowNotSharePoints': expectEveryone, 'expectEmail': false});
    });

    return callback(users);
  });
};

/**
 * Assert that the users in the current course and their points can not be retrieved
 *
 * @param  {Client}             client              The REST client to make the request with
 * @param  {Course}             course              The Canvas course the user is launched in
 * @param  {Number}             code                The expected HTTP error code
 * @param  {Function}           callback            Standard callback function
 * @throws {AssertionError}                         Error thrown when an assertion failed
 */
var assertGetLeaderboardFails = module.exports.assertGetLeaderboardFails = function(client, course, code, callback) {
  client.users.getLeaderboard(course, function(err, users) {
    assert.ok(err);
    assert.strictEqual(err.code, code);
    assert.ok(!users);

    return callback();
  });
};
