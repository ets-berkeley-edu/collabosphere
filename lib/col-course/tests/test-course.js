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

var assert = require('assert');

var CourseAPI = require('col-course');
var TestsUtil = require('col-tests');
var UsersTestUtil = require('col-users/tests/util');

var CourseTestUtil = require('./util');

describe('Course', function() {

  describe('Public attributes', function() {

    /**
     * Test that verifies that public attributes are returned
     */
    it('returns public attributes', function(callback) {
      TestsUtil.getAssetLibraryClient(null, null, null, function(client, course, user) {
        client.course.getCourse(course, function(err, course) {
          assert.ifError(err);
          assert.ok(course);
          assert.ok(course.id);
          assert.ok(course.canvas_course_id);

          // Canvas properties include secrets and should not be returned.
          assert.ok(!course.canvas);

          return callback();
        });
      });
    });
  });

  describe('User course listing', function() {
    /**
     * Test that verifies that courses associated with a user's Canvas account are returned
     */
    it('returns courses associated with a user\'s Canvas account', function(callback) {
      var course1 = TestsUtil.generateCourse(global.tests.canvas.ucberkeley);
      var course2 = TestsUtil.generateCourse(global.tests.canvas.ucberkeley);
      var course3 = TestsUtil.generateCourse(global.tests.canvas.ucberkeley);

      var user1 = TestsUtil.generateUser(global.tests.canvas.ucberkeley);
      var user2 = TestsUtil.generateUser(global.tests.canvas.ucberkeley);
      var user3 = TestsUtil.generateUser(global.tests.canvas.ucberkeley);

      // User 1 is in course 1
      TestsUtil.getAssetLibraryClient(null, course1, user1, function(client1_1, course1, user1) {
        // User 1 is in course 2
        TestsUtil.getAssetLibraryClient(null, course2, user1, function(client1_2, course2, user1) {
          //User 2 is in course 2
          TestsUtil.getAssetLibraryClient(null, course2, user2, function(client2_2, course2, user2) {
            //User 3 is in course 3
            TestsUtil.getAssetLibraryClient(null, course3, user3, function(client3_3, course3, user3) {

              // User 1's first client gets both of User 1's courses
              CourseTestUtil.assertGetUserCourses(client1_1, course1, null, [course1, course2], function() {
                // User 1's second client gets both of User 1's courses
                CourseTestUtil.assertGetUserCourses(client1_2, course2, null, [course1, course2], function() {
                  // User 2's client gets User 2's only course
                  CourseTestUtil.assertGetUserCourses(client2_2, course2, null, [course2], function() {
                    // User 3's client gets User 3's only course
                    CourseTestUtil.assertGetUserCourses(client3_3, course3, null, [course3], function() {

                      return callback();
                    });
                  });
                });
              });
            });
          });
        });
      });
    });

    it('excludes the current course if requested', function(callback) {
      var course1 = TestsUtil.generateCourse(global.tests.canvas.ucberkeley);
      var course2 = TestsUtil.generateCourse(global.tests.canvas.ucberkeley);

      var user = TestsUtil.generateUser(global.tests.canvas.ucberkeley);

      // User is in course 1
      TestsUtil.getAssetLibraryClient(null, course1, user, function(client1, course1, user) {
        // User is in course 2
        TestsUtil.getAssetLibraryClient(null, course2, user, function(client2, course2, user) {

          // Set excludeCurrent option
          var opts = {'excludeCurrent': true};
          // Request excludes the current course
          CourseTestUtil.assertGetUserCourses(client1, course1, opts, [course2], function() {

            return callback();
          });
        });
      });
    });

    it('returns only courses with the Asset Library enabled if requested', function(callback) {
      var course1 = TestsUtil.generateCourse(global.tests.canvas.ucberkeley);
      var course2 = TestsUtil.generateCourse(global.tests.canvas.ucberkeley);

      var user = TestsUtil.generateUser(global.tests.canvas.ucberkeley);

      // User is in course 1
      TestsUtil.getAssetLibraryClient(null, course1, user, function(client1, course1, user) {
        // User is in course 2
        TestsUtil.getAssetLibraryClient(null, course2, user, function(client2, course2, user) {

          // Disable asset library in course 2
          CourseTestUtil.getDbCourse(course2.id, function(dbCourse) {
            dbCourse.assetlibrary_url = null;
            dbCourse.save().complete(function(err, dbCourse) {

              // Set assetLibrary option
              var opts = {'assetLibrary': true};
              // Request returns only course 1
              CourseTestUtil.assertGetUserCourses(client1, course1, opts, [course1], function() {

                return callback();
              });
            });
          });
        });
      });
    });

    it('returns only courses where user has an admin role if requested', function(callback) {
      var course1 = TestsUtil.generateCourse(global.tests.canvas.ucberkeley);
      var course2 = TestsUtil.generateCourse(global.tests.canvas.ucberkeley);

      var user = TestsUtil.generateUser(global.tests.canvas.ucberkeley);
      var userAsInstructor = TestsUtil.generateInstructor(global.tests.canvas.ucberkeley);
      user.id = userAsInstructor.id;

      // User is a regular user in course 1
      TestsUtil.getAssetLibraryClient(null, course1, user, function(client1, course1, user) {
        // User is an instructor in course 2
        TestsUtil.getAssetLibraryClient(null, course2, userAsInstructor, function(client2, course2, userAsInstructor) {

          // Set admin option
          var opts = {'admin': true};
          // User 1's client returns only course 2
          CourseTestUtil.assertGetUserCourses(client1, course1, opts, [course2], function() {

            return callback();
          });
        });
      });
    });

    it('does not erroneously match user account IDs between Canvas instances', function(callback) {
      var berkeleyCourse = TestsUtil.generateCourse(global.tests.canvas.ucberkeley);
      var davisCourse = TestsUtil.generateCourse(global.tests.canvas.ucdavis);

      var berkeleyUser = TestsUtil.generateUser(global.tests.canvas.ucberkeley);
      var davisUser = TestsUtil.generateUser(global.tests.canvas.ucdavis);

      // Berkeley and Davis users happen to have the same ID in their respective instances
      berkeleyUser.id = davisUser.id;

      // Berkeley user is in Berkeley course
      TestsUtil.getAssetLibraryClient(null, berkeleyCourse, berkeleyUser, function(berkeleyClient, berkeleyCourse, berkeleyUser) {
        // Davis user is in Davis course
        TestsUtil.getAssetLibraryClient(null, davisCourse, davisUser, function(davisClient, davisCourse, davisUser) {

          // Berkeley client gets only Berkeley course
          CourseTestUtil.assertGetUserCourses(berkeleyClient, berkeleyCourse, null, [berkeleyCourse], function() {
            // Davis client gets only Davis course
            CourseTestUtil.assertGetUserCourses(davisClient, davisCourse, null, [davisCourse], function() {

              return callback();
            });
          });
        });
      });
    });
  });

  describe('Active setting', function() {
    /**
     * Test that verifies that courses are active by default
     */
    it('is enabled by default', function(callback) {
      TestsUtil.getAssetLibraryClient(null, null, null, function(client, course, user) {
        client.course.getCourse(course, function(err, course) {
          assert.ifError(err);
          assert.ok(course.active);

          return callback();
        });
      });
    });

    /**
     * Test that verifies an admin can reactivate an inactive course
     */
    it('can reactivate', function(callback) {
      var instructor = TestsUtil.generateInstructor();
      TestsUtil.getAssetLibraryClient(null, null, instructor, function(client, course, instructor) {

        // Inactivate course in database
        CourseTestUtil.getDbCourse(course.id, function(dbCourse) {
          dbCourse.active = false;
          dbCourse.save().complete(function(err, dbCourse) {
            assert.ifError(err);

            // Assert that instructor has no activity
            UsersTestUtil.assertGetMe(client, course, null, function(instructorMe) {
              assert.ok(!instructorMe.last_activity);

              // Get current time
              var now = new Date().toISOString();

              // Activate course through API
              CourseTestUtil.assertActivateCourse(client, course, function() {

                // Assert that instructor's last activity has been updated
                UsersTestUtil.assertGetMe(client, course, null, function(instructorMe) {
                  assert.ok(instructorMe.last_activity >= now);

                  return callback();
                });
              });
            });
          });
        });
      });
    });

    /**
     * Test that verifies a non-admin cannot reactivate an inactive course
     */
    it('verifies authorization when reactivating', function(callback) {
      TestsUtil.getAssetLibraryClient(null, null, null, function(client, course, user) {

        // Inactivate course in database
        CourseTestUtil.getDbCourse(course.id, function(dbCourse) {
          dbCourse.active = false;
          dbCourse.save().complete(function(err, dbCourse) {
            assert.ifError(err);

            // Activate course through API
            CourseTestUtil.assertActivateCourseFails(client, course, 401, function() {

              return callback();
            });
          });
        });
      });
    });
  });

  describe('Daily notification settings', function() {
    /**
     * Test that verifies that daily notifications are enabled by default
     */
    it('is enabled by default', function(callback) {
      TestsUtil.getAssetLibraryClient(null, null, null, function(client, course, user) {
        client.course.getCourse(course, function(err, course) {
          assert.ifError(err);
          assert.ok(course);

          // Verify that daily notifications are enabled
          assert.ok(course.enable_daily_notifications);

          return callback();
        });
      });
    });

    /**
     * Test that verifies daily notifications can be disabled and re-enabled
     */
    it('updates daily notifications', function(callback) {
      var instructor = TestsUtil.generateInstructor();
      TestsUtil.getAssetLibraryClient(null, null, instructor, function(client, course, instructor) {
        // Assert disable
        CourseTestUtil.assertUpdateDailyNotifications(client, course, false, function() {
          // Assert re-enable
          CourseTestUtil.assertUpdateDailyNotifications(client, course, true, function() {
            return callback();
          });
        });
      });
    });

    /**
     * Test that verifies authorization when updating daily notification settings
     */
    it('verifies authorization when updating', function(callback) {
      TestsUtil.getAssetLibraryClient(null, null, null, function(client, course, user) {
        CourseTestUtil.assertUpdateDailyNotificationsFails(client, course, false, 401, function() {

          return callback();
        });
      });
    });
  });

  describe('Weekly notification settings', function() {
    /**
     * Test that verifies that weekly notifications are enabled by default
     */
    it('is enabled by default', function(callback) {
      TestsUtil.getAssetLibraryClient(null, null, null, function(client, course, user) {
        client.course.getCourse(course, function(err, course) {
          assert.ifError(err);
          assert.ok(course);

          // Verify that weekly notifications are enabled
          assert.ok(course.enable_weekly_notifications);

          return callback();
        });
      });
    });

    /**
     * Test that verifies weekly notifications can be disabled and re-enabled
     */
    it('updates weekly notifications', function(callback) {
      var instructor = TestsUtil.generateInstructor();
      TestsUtil.getAssetLibraryClient(null, null, instructor, function(client, course, instructor) {
        // Assert disable
        CourseTestUtil.assertUpdateWeeklyNotifications(client, course, false, function() {
          // Assert re-enable
          CourseTestUtil.assertUpdateWeeklyNotifications(client, course, true, function() {
            return callback();
          });
        });
      });
    });

    /**
     * Test that verifies authorization when updating weekly notification settings
     */
    it('verifies authorization when updating', function(callback) {
      TestsUtil.getAssetLibraryClient(null, null, null, function(client, course, user) {
        CourseTestUtil.assertUpdateWeeklyNotificationsFails(client, course, false, 401, function() {

          return callback();
        });
      });
    });
  });
});
