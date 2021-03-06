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

var AssetsTestUtil = require('col-assets/tests/util');
var CourseTestUtil = require('col-course/tests/util');
var TestsUtil = require('col-tests');
var UsersTestUtil = require('col-users/tests/util');

var ActivitiesDefaults = require('col-activities/lib/default');
var ActivitiesTestUtil = require('./util');

describe('Weekly activity emails', function() {

  /**
   * Test that verifies authorization when manually triggering a weekly activity email for a course
   */
  it('verifies authorization', function(callback) {
    TestsUtil.getAssetLibraryClient(null, null, null, function(client, course, user) {
      ActivitiesTestUtil.assertSendWeeklyNotificationsFails(client, course, 401, function() {

        return callback();
      });
    });
  });

  /**
   * Test that verifies that emails are sent to active users in a course with tools enabled
   */
  it('sends emails to all active users in a course with tools enabled', function(callback) {
    ActivitiesTestUtil.setupCourseWithInstructor(function(dbCourse, course, users, instructor) {
      var userObjects = _.map(users, function(user) {
        return user.me;
      });

      // Verify that no one gets an email before LTI tools are initialized
      ActivitiesTestUtil.assertSendWeeklyNotificationsEmpty(users.instructor.client, course, dbCourse, userObjects, function() {

        // Initialize asset library but not engagement index
        dbCourse.assetlibrary_url = 'http://bcourses.berkeley.edu/courses/1/external_tools/1';

        dbCourse.save().complete(function(err, dbCourse) {
          // Verify that, once again, no one gets an email
          ActivitiesTestUtil.assertSendWeeklyNotificationsEmpty(users.instructor.client, course, dbCourse, userObjects, function() {

            // Initialize engagement index
            dbCourse.engagementindex_url = 'http://bcourses.berkeley.edu/courses/1/external_tools/2';
            dbCourse.save().complete(function(err, dbCourse) {

              // Verify that everyone gets an email
              ActivitiesTestUtil.assertSendWeeklyNotifications(users.instructor.client, course, dbCourse, userObjects, function(emails) {
                return callback();
              });
            });
          });
        });
      });
    });
  });

  /**
   * Test that verifies that emails are sent only when weekly notifications are enabled
   */
  it('sends emails only if weekly notifications are enabled for course', function(callback) {
    ActivitiesTestUtil.setupCourseWithInstructor(function(dbCourse, course, users, instructor) {
      var userObjects = _.map(users, function(user) {
        return user.me;
      });

      // Initialize LTI tools
      dbCourse.assetlibrary_url = 'http://bcourses.berkeley.edu/courses/1/external_tools/1';
      dbCourse.engagementindex_url = 'http://bcourses.berkeley.edu/courses/1/external_tools/2';

      dbCourse.save().complete(function(err, dbCourse) {
        // Disable weekly notifications
        CourseTestUtil.assertUpdateWeeklyNotifications(users.instructor.client, course, false, function() {
          // Verify that no one gets an email
          ActivitiesTestUtil.assertSendWeeklyNotificationsEmpty(users.instructor.client, course, dbCourse, userObjects, function() {
            // Enable weekly notifications
            CourseTestUtil.assertUpdateWeeklyNotifications(users.instructor.client, course, true, function() {
              // Verify that everyone gets an email
              ActivitiesTestUtil.assertSendWeeklyNotifications(users.instructor.client, course, dbCourse, userObjects, function(emails) {
                return callback();
              });
            });
          });
        });
      });
    });
  });
});
