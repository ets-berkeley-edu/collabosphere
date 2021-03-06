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

var CourseAPI = require('col-course');
var DB = require('col-core/lib/db');

/**
 * Assert that daily notification settings can be updated
 *
 * @param  {RestClient}         client                          The REST client to make the request with
 * @param  {Course}             course                          The Canvas course in which the user is interacting with the API
 * @param  {Boolean}            enabled                         Whether daily notifications should be enabled
 * @param  {Function}           callback                        Standard callback function
 * @throws {AssertionError}                                     Error thrown when an assertion failed
 */
var assertUpdateDailyNotifications = module.exports.assertUpdateDailyNotifications = function(client, course, enabled, callback) {
  client.course.updateDailyNotifications(course, enabled, function(err) {
    assert.ifError(err);

    // Verify that daily notification settings have been changed
    client.course.getCourse(course, function(err, course) {
      assert.ifError(err);
      assert.ok(course);
      assert.strictEqual(course.enable_daily_notifications, enabled);

      return callback();
    });
  });
};

/**
 * Assert that daily notification settings cannot be updated
 *
 * @param  {RestClient}         client                          The REST client to make the request with
 * @param  {Course}             course                          The Canvas course in which the user is interacting with the API
 * @param  {Boolean}            enabled                         Whether daily notifications should be enabled
 * @param  {Number}             code                            The expected HTTP error code
 * @param  {Function}           callback                        Standard callback function
 * @throws {AssertionError}                                     Error thrown when an assertion failed
 */
var assertUpdateDailyNotificationsFails = module.exports.assertUpdateDailyNotificationsFails = function(client, course, enabled, code, callback) {
  client.course.updateDailyNotifications(course, enabled, function(err) {
    assert.ok(err);
    assert.strictEqual(err.code, code);

    return callback();
  });
};

/**
 * Assert that weekly notification settings can be updated
 *
 * @param  {RestClient}         client                          The REST client to make the request with
 * @param  {Course}             course                          The Canvas course in which the user is interacting with the API
 * @param  {Boolean}            enabled                         Whether weekly notifications should be enabled
 * @param  {Function}           callback                        Standard callback function
 * @throws {AssertionError}                                     Error thrown when an assertion failed
 */
var assertUpdateWeeklyNotifications = module.exports.assertUpdateWeeklyNotifications = function(client, course, enabled, callback) {
  client.course.updateWeeklyNotifications(course, enabled, function(err) {
    assert.ifError(err);

    // Verify that weekly notification settings have been changed
    client.course.getCourse(course, function(err, course) {
      assert.ifError(err);
      assert.ok(course);
      assert.strictEqual(course.enable_weekly_notifications, enabled);

      return callback();
    });
  });
};

/**
 * Assert that weekly notification settings cannot be updated
 *
 * @param  {RestClient}         client                          The REST client to make the request with
 * @param  {Course}             course                          The Canvas course in which the user is interacting with the API
 * @param  {Boolean}            enabled                         Whether weekly notifications should be enabled
 * @param  {Number}             code                            The expected HTTP error code
 * @param  {Function}           callback                        Standard callback function
 * @throws {AssertionError}                                     Error thrown when an assertion failed
 */
var assertUpdateWeeklyNotificationsFails = module.exports.assertUpdateWeeklyNotificationsFails = function(client, course, enabled, code, callback) {
  client.course.updateWeeklyNotifications(course, enabled, function(err) {
    assert.ok(err);
    assert.strictEqual(err.code, code);

    return callback();
  });
};

/**
 * Assert that a course can be activated
 *
 * @param  {RestClient}         client                          The REST client to make the request with
 * @param  {Course}             course                          The Canvas course in which the user is interacting with the API
 * @param  {Function}           callback                        Standard callback function
 * @throws {AssertionError}                                     Error thrown when an assertion failed
 */
var assertActivateCourse = module.exports.assertActivateCourse = function(client, course, callback) {
  client.course.activateCourse(course, function(err) {
    assert.ifError(err);

    // Verify that course has been activated
    client.course.getCourse(course, function(err, course) {
      assert.ifError(err);
      assert.ok(course.active);

      return callback();
    });
  });
};

/**
 * Assert that a course cannot be activated
 *
 * @param  {RestClient}         client                          The REST client to make the request with
 * @param  {Course}             course                          The Canvas course in which the user is interacting with the API
 * @param  {Number}             code                            The expected HTTP error code
 * @param  {Function}           callback                        Standard callback function
 * @throws {AssertionError}                                     Error thrown when an assertion failed
 */
var assertActivateCourseFails = module.exports.assertActivateCourseFails = function(client, course, code, callback) {
  client.course.activateCourse(course, function(err) {
    assert.ok(err);
    assert.strictEqual(err.code, code);

    return callback();
  });
};

/**
 * Assert that user courses are retrieved
 *
 * @param  {RestClient}         client                          The REST client to make the request with
 * @param  {Course}             course                          The Canvas course in which the user is interacting with the API
 * @param  {Object}             opts                            Request options
 * @param  {Course[]}           expectedCourses                 Canvas course expected to be returned
 * @param  {Function}           callback                        Standard callback function
 * @throws {AssertionError}                                     Error thrown when an assertion failed
 */
var assertGetUserCourses = module.exports.assertGetUserCourses = function(client, course, opts, expectedCourses, callback) {
  client.course.getUserCourses(course, opts, function(err, userCourses) {
    assert.ifError(err);
    assert.strictEqual(userCourses.length, expectedCourses.length);

    _.each(userCourses, function(userCourse) {
      assert.ok(userCourse.id);
      assert.ok(userCourse.canvas_course_role);
      assert.ok(userCourse.course);
      assert.ok(_.find(expectedCourses, {'id': userCourse.course.canvas_course_id}));
    });

    return callback();
  });
};

/**
 * Get a database-backed course object given a Canvas course id
 *
 * @param  {Number}           canvasCourseId      The id of the course in Canvas
 * @param  {Function}         callback            Invoked when the course has been retrieved
 * @param  {Course}           callback.course     The retrieved course object
 * @throws {AssertionError}                       Error thrown when an assertion failed
 * @api private
 */
var getDbCourse = module.exports.getDbCourse = function(canvasCourseId, callback) {
  var options = {
    'where': {
      'canvas_course_id': canvasCourseId
    },
    'include': [{
      'model': DB.Canvas,
      'as': 'canvas'
    }]
  };
  DB.Course.findOne(options).complete(function(err, course) {
    assert.ifError(err);
    assert.ok(course);
    return callback(course);
  });
};
