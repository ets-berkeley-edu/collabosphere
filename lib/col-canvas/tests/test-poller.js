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
var config = require('config');
var moment = require('moment-timezone');
var util = require('util');

var ActivitiesDefault = require('col-activities/lib/default');
var ActivitiesTestUtil = require('col-activities/tests/util');
var AssetsTestsUtil = require('col-assets/tests/util');
var CanvasPoller = require('col-canvas/lib/poller');
var CanvasTestsModel = require('col-canvas/tests/model');
var CategoriesTestUtil = require('col-categories/tests/util');
var CollabosphereConstants = require('col-core/lib/constants');
var DB = require('col-core/lib/db');
var LtiTestsUtil = require('col-lti/tests/util');
var MockedRequest = require('col-tests/lib/model').MockedRequest;
var TestsUtil = require('col-tests/lib/util');
var UsersAPI = require('col-users');
var UsersTestUtil = require('col-users/tests/util');

var CanvasAssignment = require('./model').CanvasAssignment;
var CanvasDiscussion = require('./model').CanvasDiscussion;
var CanvasDiscussionEntry = require('./model').CanvasDiscussionEntry;
var CanvasFile = require('./model').CanvasFile;
var CanvasSection = require('./model').CanvasSection;
var CanvasSubmission = require('./model').CanvasSubmission;
var CanvasTabs = require('./model').CanvasTabs;
var CanvasTestsUtil = require('./util');
var CanvasUser = require('./model').CanvasUser;

describe('Canvas poller', function() {

  /**
   * Get a course object given a Canvas course id
   *
   * @param  {Number}           canvasCourseId          The id of the course in Canvas
   * @param  {Function}         callback                Invoked when the course has been retrieved
   * @param  {Course}           callback.course         The retrieved course object
   * @throws {AssertionError}                           Error thrown when an assertion failed
   */
  var getCourse = function(canvasCourseId, callback) {
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

  /**
   * Get a client in a course who has shared their points with the rest of the users in the course
   *
   * @param  {Course}         [course]              The course in which the client should be launched. If no course is provided, one will be created
   * @param  {Function}       callback              Standard callback function
   * @param  {RestClient}     callback.client       The client
   * @param  {Course}         callback.course       The course in which the client was launched
   * @param  {User}           callback.user         The user information of the client
   */
  var getClient = function(course, callback) {
    TestsUtil.getAssetLibraryClient(null, course, null, function(client, course, user) {
      UsersTestUtil.assertUpdateSharePoints(client, course, true, function() {
        return callback(client, course, user);
      });
    });
  };

  /**
   * Get a user by their name in a set of user objects
   *
   * @param  {CanvasUser[]}   users   The users to search through
   * @param  {String}         name    The name of the user to search for
   * @return {User}                   The user with the matching name, or `null` if no user with that name could be found
   */
  var getUserByName = function(users, name) {
    return _.find(users, {'canvas_full_name': name});
  };

  /**
   * Get the points for an activity
   *
   * @param  {String}   name    The name of the activity to get the points for
   * @return {Number}           The points for the activity
   */
  var getActivitiesDefaultPoints = function(name) {
    return _.find(ActivitiesDefault, {'type': name}).points;
  };

  /**
   * Test that verifies that the Canvas poller can gracefully handle errors
   */
  it('handles Canvas errors gracefully', function(callback) {
    // Bump the timeout as the poller adds 5 seconds between each course
    this.timeout(15000);

    // Delete all courses from the DB so we can run a full polling cycle
    DB.Course.truncate({'cascade': true}).complete(function(err) {
      assert.ifError(err);

      // Generate a test course
      getClient(null, function(client, course, user) {

        // Get the actual course object so we can pass it into the poller
        getCourse(course.id, function(dbCourse) {

          // Mock a Canvas failure for this course
          var url = util.format('/api/v1/courses/%d/tabs', dbCourse.canvas_course_id);
          var mockedRequest = new MockedRequest('GET', url, 404, 'This course could not be found');
          TestsUtil.getMockedCanvasAppServer(dbCourse.canvas).expect(mockedRequest);

          // Generate a second course
          getClient(null, function(client2, course2, user2) {

            // Get the actual course object so we can pass it into the poller
            getCourse(course2.id, function(dbCourse2) {

              // Mock the requests for this course
              var mockedCanvasUsers = [
                new CanvasUser('Active student', course2.id, 'active', null, 'user1@berkeley.edu'),
                new CanvasUser('Active teacher', course2.id, 'active', 'TeacherEnrollment'),
                new CanvasUser('Completed student', course2.id, 'completed', null, 'user3@berkeley.edu')
              ];
              CanvasTestsUtil.mockPollingRequests(dbCourse2, mockedCanvasUsers);

              var initialCoursePoll = CanvasPoller.getLastCoursePoll();

              // Let the poller fetch all the courses
              CanvasPoller.runOnce(function(err) {
                assert.ifError(err);

                // Verify that the last course poll has been updated to a sane value
                var lastCoursePoll = CanvasPoller.getLastCoursePoll();
                assert.ok(lastCoursePoll);
                assert.ok(lastCoursePoll > initialCoursePoll);
                assert.ok(lastCoursePoll <= Date.now());

                // Verify the users for the second course were created
                var options = {
                  'enrollmentStates': _.values(CollabosphereConstants.ENROLLMENT_STATE),
                  'includeEmail': true
                };
                UsersAPI.getAllUsers({'course': dbCourse2}, options, function(err, users) {
                  assert.ifError(err);
                  assert.strictEqual(users.length, 4);
                  return callback();
                });
              });
            });
          });
        });
      });
    });
  });

  describe('Users', function() {

    /**
     * Test that verifies that the Canvas poller creates a record for users that haven't launched a tool yet
     */
    it('creates records for users that have not launched a tool yet', function(callback) {
      // Generate a test course
      getClient(null, function(client, course, user) {

        // Get the actual course object so we can pass it into the poller
        getCourse(course.id, function(dbCourse) {

          // Prepare the mocked requests to Canvas
          var activeStudent = new CanvasUser('Active student', course.id, 'active', null, 'user1@berkeley.edu');
          var activeTeacher = new CanvasUser('Active teacher', course.id, 'active', 'TeacherEnrollment');
          var completedStudent = new CanvasUser('Completed student', course.id, 'completed', null, 'user3@berkeley.edu');
          var mockedCanvasUsers = [
            activeStudent,
            activeTeacher,
            completedStudent
          ];
          // For the sake of simplicity, we have only one student per mock section
          var mockedCanvasSections = [
            new CanvasSection(activeStudent, 'Section 001', course.id),
            new CanvasSection(completedStudent, 'Section 002', course.id)
          ];
          CanvasTestsUtil.mockPollingRequests(dbCourse, mockedCanvasUsers, [], [], mockedCanvasSections);

          // Poll the Canvas API for information
          CanvasPoller.handleCourse(dbCourse, null, function(err) {
            assert.ifError(err);

            // The poller should've created user accounts for each user. Note that we can't use
            // the UsersTestsUtil.assertGetAllUsers function here as the REST endpoint it uses will
            // only return the active and invited users
            var ctx = {'course': dbCourse};
            var options = {
              'enrollmentStates': _.values(CollabosphereConstants.ENROLLMENT_STATE),
              'includeEmail': true
            };
            UsersAPI.getAllUsers(ctx, options, function(err, users) {
              assert.ifError(err);
              assert.strictEqual(users.length, 4);

              var activeStudent = getUserByName(users, 'Active student');
              UsersTestUtil.assertUser(activeStudent, {'expectEmail': true});
              assert.strictEqual(activeStudent.canvas_course_role, 'Student');
              assert.deepEqual(activeStudent.canvas_course_sections, ['Section 001']);
              assert.strictEqual(activeStudent.canvas_enrollment_state, 'active');
              assert.strictEqual(activeStudent.canvas_email, 'user1@berkeley.edu');

              var completedStudent = getUserByName(users, 'Completed student');
              UsersTestUtil.assertUser(completedStudent, {'expectEmail': true});
              assert.strictEqual(completedStudent.canvas_course_role, 'Student');
              assert.deepEqual(completedStudent.canvas_course_sections, ['Section 002']);
              assert.strictEqual(completedStudent.canvas_enrollment_state, 'completed');
              assert.strictEqual(completedStudent.canvas_email, 'user3@berkeley.edu');

              var teacher = getUserByName(users, 'Active teacher');
              UsersTestUtil.assertUser(teacher, {'expectEmail': true});
              assert.strictEqual(teacher.canvas_course_role, 'urn:lti:role:ims/lis/Instructor');
              assert.strictEqual(teacher.canvas_enrollment_state, 'active');

              // Verify a subsequent run won't create another user record
              CanvasTestsUtil.mockPollingRequests(dbCourse, mockedCanvasUsers);
              CanvasPoller.handleCourse(dbCourse, null, function(err) {
                assert.ifError(err);

                var options = {
                  'enrollmentStates': _.values(CollabosphereConstants.ENROLLMENT_STATE),
                  'includeEmail': true
                };
                UsersAPI.getAllUsers(ctx, options, function(err, users) {
                  assert.ifError(err);
                  assert.strictEqual(users.length, 4);
                  UsersTestUtil.assertUser(getUserByName(users, 'Active student'), {'expectEmail': true});
                  UsersTestUtil.assertUser(getUserByName(users, 'Completed student'), {'expectEmail': true});
                  UsersTestUtil.assertUser(getUserByName(users, 'Active teacher'), {'expectEmail': true});
                  return callback();
                });
              });
            });
          });
        });
      });
    });

    /**
     * Test that verifies that the poller can page the Canvas User REST API
     */
    it('can page Canvas', function(callback) {
      getClient(null, function(client, course, user) {

        // Get the actual course object so we can pass it into the poller
        getCourse(course.id, function(dbCourse) {

          // Prepare the mocked requests to Canvas
          var mockedCanvasUsers = _.times(100, function(n) {
            return new CanvasUser('Test student ' + n);
          });
          CanvasTestsUtil.mockPollingRequests(dbCourse, mockedCanvasUsers);

          // Poll the Canvas API for information
          CanvasPoller.handleCourse(dbCourse, null, function(err) {
            assert.ifError(err);

            // There should now be 101 users in the course, 100 users synced through the poller and 1
            // test client
            var ctx = {'course': dbCourse};
            var options = {
              'enrollmentStates': _.values(CollabosphereConstants.ENROLLMENT_STATE),
              'includeEmail': true
            };
            UsersAPI.getAllUsers(ctx, options, function(err, users) {
              assert.ifError(err);
              assert.strictEqual(users.length, 101);
              return callback();
            });
          });
        });
      });
    });

    /**
     * Test that verifies that the poller updates user records if user information changes in Canvas
     */
    it('updates user records if user information changes in Canvas', function(callback) {
      // Generate a test course
      getClient(null, function(client, course, user) {

        // Get the actual course object so we can pass it into the poller
        getCourse(course.id, function(dbCourse) {

          // Prepare the mocked requests to Canvas
          var mockedCanvasUsers = [new CanvasUser('Jack McJackerson')];
          CanvasTestsUtil.mockPollingRequests(dbCourse, mockedCanvasUsers);

          // Poll the Canvas API for information
          CanvasPoller.handleCourse(dbCourse, null, function(err) {
            assert.ifError(err);

            // The poller should've created a user account for Jack
            var ctx = {'course': dbCourse};
            var options = {
              'enrollmentStates': _.values(CollabosphereConstants.ENROLLMENT_STATE),
              'includeEmail': true
            };
            UsersAPI.getAllUsers(ctx, options, function(err, users) {
              assert.ifError(err);
              assert.strictEqual(users.length, 2);
              assert.ok(getUserByName(users, 'Jack McJackerson'));

              // Update Jack's name in Canvas
              mockedCanvasUsers[0].name = 'Jack "Jacko" McJackerson';
              CanvasTestsUtil.mockPollingRequests(dbCourse, mockedCanvasUsers);
              CanvasPoller.handleCourse(dbCourse, null, function(err) {
                assert.ifError(err);

                // The poller should've updated Jack's user account
                UsersAPI.getAllUsers(ctx, options, function(err, users) {
                  assert.ifError(err);
                  assert.strictEqual(users.length, 2);
                  var user = getUserByName(users, 'Jack "Jacko" McJackerson');
                  assert.ok(user);
                  return callback();
                });
              });
            });
          });
        });
      });
    });
  });

  describe('Assignments', function() {

    /**
     * Test that verifies that activities are created for submissions
     */
    it('creates activities for submissions', function(callback) {
      // Generate a test course with a few users who will make submissions
      getClient(null, function(client1, course, user1) {
        getClient(course, function(client2, course, user2) {
          getClient(course, function(client3, course, user3) {
            getClient(course, function(client4, course, user4) {

              // Get the actual course object so we can pass it into the poller
              getCourse(course.id, function(dbCourse) {

                // Poll the canvas API but don't return the assignment just yet
                var mockedUsers = [
                  CanvasTestsModel.getCanvasUser(user1, course),
                  CanvasTestsModel.getCanvasUser(user2, course),
                  CanvasTestsModel.getCanvasUser(user3, course),
                  CanvasTestsModel.getCanvasUser(user4, course)
                ];
                CanvasTestsUtil.mockPollingRequests(dbCourse, mockedUsers, [], []);
                CanvasPoller.handleCourse(dbCourse, null, function(err) {
                  assert.ifError(err);

                  // Get all the users, they should all have 0 points
                  UsersTestUtil.assertGetLeaderboard(client1, course, 4, false, function(users) {
                    _.each(users, function(user) {
                      assert.strictEqual(user.points, 0);
                    });

                    // Poll the Canvas API and return an assignment without any submissions
                    var assignments = [
                      new CanvasAssignment(course.id)
                    ];
                    CanvasTestsUtil.mockPollingRequests(dbCourse, mockedUsers, assignments, []);
                    CanvasPoller.handleCourse(dbCourse, null, function(err) {
                      assert.ifError(err);

                      // All the users should still have 0 points
                      UsersTestUtil.assertGetLeaderboard(client1, course, 4, false, function(users) {
                        _.each(users, function(user) {
                          assert.strictEqual(user.points, 0);
                        });

                        // Poll the Canvas API and return an assignment with a few submissions
                        var assignments = [
                          new CanvasAssignment(course.id, [
                            new CanvasSubmission(user1.id, 'online_url', 'http://www.google.com'),
                            new CanvasSubmission(user2.id, 'online_text_entry', 'Here is my essay on ...'),
                            new CanvasSubmission(user3.id, 'online_upload', [
                              new CanvasFile('image/jpeg', 'Oh noes', 'ohnoes.jpg')
                            ])
                          ])
                        ];
                        assignments[0].submissions[2].attachments[0].expectProcessing = false;
                        CanvasTestsUtil.mockPollingRequests(dbCourse, mockedUsers, assignments, []);
                        CanvasPoller.handleCourse(dbCourse, null, function(err) {
                          assert.ifError(err);

                          // All the users who made a submission should've received points
                          UsersTestUtil.assertGetLeaderboard(client1, course, 4, false, function(users) {

                            var expectedPoints = getActivitiesDefaultPoints('submit_assignment');
                            assert.strictEqual(getUserByName(users, user1.fullName).points, expectedPoints);
                            assert.strictEqual(getUserByName(users, user2.fullName).points, expectedPoints);
                            assert.strictEqual(getUserByName(users, user3.fullName).points, expectedPoints);

                            // Users without submissions don't get any points
                            assert.strictEqual(getUserByName(users, user4.fullName).points, 0);

                            // Subsequent polls should not result in new activities
                            assignments[0].submissions[2].attachments[0].expectProcessing = false;
                            CanvasTestsUtil.mockPollingRequests(dbCourse, mockedUsers, assignments, []);
                            CanvasPoller.handleCourse(dbCourse, null, function(err) {
                              assert.ifError(err);
                              UsersTestUtil.assertGetLeaderboard(client1, course, 4, false, function(users) {
                                assert.strictEqual(getUserByName(users, user1.fullName).points, expectedPoints);
                                assert.strictEqual(getUserByName(users, user2.fullName).points, expectedPoints);
                                assert.strictEqual(getUserByName(users, user3.fullName).points, expectedPoints);
                                assert.strictEqual(getUserByName(users, user4.fullName).points, 0);

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
            });
          });
        });
      });
    });

    /**
     * Test that verifies that the poller can page the Canvas Assignments REST API
     */
    it('can page Canvas', function(callback) {
      getClient(null, function(client, course, user) {

        // Get the actual course object so we can pass it into the poller
        getCourse(course.id, function(dbCourse) {

          // Prepare the mocked requests to Canvas
          var assignments = _.times(100, function(n) {
            return new CanvasAssignment(course.id, [
              new CanvasSubmission(user.id, 'online_url', 'http://www.google.com')
            ]);
          });
          var mockedUsers = [
            CanvasTestsModel.getCanvasUser(user, course)
          ];
          CanvasTestsUtil.mockPollingRequests(dbCourse, mockedUsers, assignments);

          // Poll the Canvas API for information
          CanvasPoller.handleCourse(dbCourse, null, function(err) {
            assert.ifError(err);

            // The test user made a 100 submissions which should result in earning 2000 points
            UsersTestUtil.assertGetLeaderboard(client, course, 1, false, function(leaderboard) {
              assert.strictEqual(leaderboard[0].points, 2000);
              return callback();
            });
          });
        });
      });
    });

    /**
     * Test that verifies that re-submissions don't create extra activities or points
     */
    it('does not create activities for re-submissions', function(callback) {
      getClient(null, function(client1, course, user1) {

        // Get the actual course object so we can pass it into the poller
        getCourse(course.id, function(dbCourse) {

          // Poll the Canvas API and return an assignment with a few submissions
          var mockedUsers = [
            CanvasTestsModel.getCanvasUser(user1, course)
          ];
          var assignments = [
            new CanvasAssignment(course.id, [
              new CanvasSubmission(user1.id, 'online_url', 'http://www.google.com')
            ])
          ];
          CanvasTestsUtil.mockPollingRequests(dbCourse, mockedUsers, assignments, []);
          CanvasPoller.handleCourse(dbCourse, null, function(err) {
            assert.ifError(err);

            // Get the leaderboard so we can check the points don't change
            UsersTestUtil.assertGetLeaderboard(client1, course, 1, false, function(oldLeaderboard) {

              // Re-submit an assignment and change the type
              assignments[0].submissions[0].attempt++;
              assignments[0].submissions[0].submission_type = 'online_upload';
              assignments[0].submissions[0].attachments = [new CanvasFile('image/jpeg', 'Oh noes', 'ohnoes.jpg')];
              assignments[0].submissions[0].attachments[0].expectProcessing = false;

              CanvasTestsUtil.mockPollingRequests(dbCourse, mockedUsers, assignments, []);
              CanvasPoller.handleCourse(dbCourse, null, function(err) {
                assert.ifError(err);

                // Ensure the points didn't change
                UsersTestUtil.assertGetLeaderboard(client1, course, 1, false, function(newLeaderboard) {
                  assert.deepEqual(oldLeaderboard, newLeaderboard);

                  // Re-submit the assignment again and ensure the points don't change
                  assignments[0].submissions[0].attempt++;
                  CanvasTestsUtil.mockPollingRequests(dbCourse, mockedUsers, assignments, []);
                  CanvasPoller.handleCourse(dbCourse, null, function(err) {
                    assert.ifError(err);

                    // Ensure the points didn't change
                    UsersTestUtil.assertGetLeaderboard(client1, course, 1, false, function(newLeaderboard) {
                      assert.deepEqual(oldLeaderboard, newLeaderboard);

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

    /**
     * Test that verifies that submissions larger than the maximum file size submission
     * are not processed
     */
    it('does not create assets for large submissions', function(callback) {
      getClient(null, function(client1, course, user1) {
        getClient(course, function(client2, course, user2) {

          // Get the actual course object so we can pass it into the poller
          getCourse(course.id, function(dbCourse) {

            var mockedUsers = [
              CanvasTestsModel.getCanvasUser(user1, course),
              CanvasTestsModel.getCanvasUser(user2, course)
            ];

            var largeFile = new CanvasFile('image/jpeg', 'File 1', 'file1.jpg');
            largeFile.size = 1000000001;
            var user1Submission = new CanvasSubmission(user1.id, 'online_upload', [largeFile]);
            var user2Submission = new CanvasSubmission(user2.id, 'online_upload', [
              new CanvasFile('image/jpeg', 'File 2', 'file2.jpg')
            ]);
            var assignments = [
              new CanvasAssignment(course.id, [user1Submission, user2Submission])
            ];
            assignments[0].submissions[0].attachments[0].expectProcessing = false;

            CanvasTestsUtil.mockPollingRequests(dbCourse, mockedUsers, assignments, []);
            CanvasPoller.handleCourse(dbCourse, {'enableAssignmentCategories': true}, function(err) {
              assert.ifError(err);

              // Assert that an asset was created for the regular file upload only
              AssetsTestsUtil.assertGetAssets(client1, course, null, null, null, null, 1, function(assets) {
                assert.strictEqual(assets.results[0].title, 'File 2');

                // Assert that both users have received assignment submission points
                UsersTestUtil.assertGetLeaderboard(client1, course, 2, false, function(users) {
                  var expectedPoints = getActivitiesDefaultPoints('submit_assignment');
                  _.each(users, function(user) {
                    assert.strictEqual(user.points, expectedPoints);
                  });

                  return callback();
                });
              });
            });
          });
        });
      });
    });

    /**
     * Test that verifies that the poller uses the configured activity type configuration when scoring activities
     */
    it('uses the configured activity type configuration for scoring', function(callback) {
      getClient(null, function(client1, course, user1) {
        var instructor = TestsUtil.generateInstructor();
        TestsUtil.getAssetLibraryClient(null, course, instructor, function(instructorClient, course, instructor) {

          // Configure a new point setting for assignment submissions
          var config = [{'type': 'submit_assignment', 'points': 42, 'enabled': true}];
          ActivitiesTestUtil.assertEditActivityTypeConfiguration(instructorClient, course, config, function() {

            // Get the actual course object so we can pass it into the poller
            getCourse(course.id, function(dbCourse) {

              // Poll the Canvas API and return an assignment with a few submissions
              var mockedUsers = [
                CanvasTestsModel.getCanvasUser(user1, course)
              ];
              var assignments = [
                new CanvasAssignment(course.id, [
                  new CanvasSubmission(user1.id, 'online_url', 'http://www.google.com')
                ])
              ];
              CanvasTestsUtil.mockPollingRequests(dbCourse, mockedUsers, assignments, []);
              CanvasPoller.handleCourse(dbCourse, null, function(err) {
                assert.ifError(err);

                // Get the leaderboard and verify the user got the configured amount of points
                UsersTestUtil.assertGetLeaderboard(client1, course, 1, false, function(leaderboard) {
                  assert.strictEqual(leaderboard[0].points, 42);
                  return callback();
                });
              });
            });
          });
        });
      });
    });

    /**
     * Test that verifies that the poller creates assets for file submissions
     */
    it('creates assets for file submissions', function(callback) {
      // Generate a test course with a few users who will make submissions
      getClient(null, function(client1, course, user1) {
        getClient(course, function(client2, course, user2) {
          getClient(course, function(client3, course, user3) {
            getClient(course, function(client4, course, user4) {

              // Get the actual course object so we can pass it into the poller
              getCourse(course.id, function(dbCourse) {

                // Each user submits something different
                var user1Submission = new CanvasSubmission(user1.id, 'online_url', 'http://www.google.com');
                var user2Submission = new CanvasSubmission(user2.id, 'online_text_entry', 'Here is my essay on ...');
                var user3Submission = new CanvasSubmission(user3.id, 'online_upload', [
                  new CanvasFile('image/jpeg', 'File 1', 'file1.jpg')
                ]);
                var user4Submission = new CanvasSubmission(user4.id, 'online_upload', [
                  new CanvasFile('image/jpeg', 'File 2.1', 'file2.1.jpg'),
                  new CanvasFile('image/jpeg', 'File 2.2', 'file2.2.jpg')
                ]);
                var assignments = [
                  new CanvasAssignment(course.id, [user1Submission, user2Submission, user3Submission, user4Submission])
                ];
                CanvasTestsUtil.mockPollingRequests(dbCourse, [], assignments, []);
                CanvasPoller.handleCourse(dbCourse, {'enableAssignmentCategories': true}, function(err) {
                  assert.ifError(err);

                  // Assert the assets were created
                  AssetsTestsUtil.assertGetAssets(client1, course, null, null, null, null, 4, function(assets) {
                    // Assert the link was created correctly
                    var linkAsset = _.find(assets.results, {'type': 'link'});
                    assert.ok(linkAsset);
                    assert.strictEqual(linkAsset.title, 'http://www.google.com');
                    assert.strictEqual(linkAsset.url, 'http://www.google.com');

                    // Assert user3's file was created correctly
                    assert.ok(_.find(assets.results, {'type': 'file', 'title': 'File 1'}));

                    // Assert user4's files were created correctly
                    assert.ok(_.find(assets.results, {'type': 'file', 'title': 'File 2.1'}));
                    assert.ok(_.find(assets.results, {'type': 'file', 'title': 'File 2.2'}));

                    // Verify that polling again won't create or delete any additional assets
                    assignments[0].submissions[2].attachments[0].expectProcessing = false;
                    assignments[0].submissions[3].attachments[0].expectProcessing = false;
                    assignments[0].submissions[3].attachments[1].expectProcessing = false;
                    CanvasTestsUtil.mockPollingRequests(dbCourse, [], assignments, []);
                    CanvasPoller.handleCourse(dbCourse, {'enableAssignmentCategories': true}, function(err) {
                      assert.ifError(err);
                      AssetsTestsUtil.assertGetAssets(client1, course, null, null, null, null, 4, function(newAssets) {
                        var newAssetIds = _.map(newAssets.results, 'id');
                        var oldAssetIds = _.map(assets.results, 'id');
                        assert.strictEqual(_.intersection(newAssetIds, oldAssetIds).length, 4);

                        // Verify that resubmitting each assignment causes the files to be deleted
                        user1Submission.attempt++;
                        user1Submission.url = 'http://www.yahoo.com';

                        user2Submission.attempt++;
                        user2Submission.body = 'My new essay';

                        user3Submission.attempt++;
                        user3Submission.attachments = [
                          new CanvasFile('image/jpeg', 'File 1-updated', 'file1-updated.jpg')
                        ];

                        user4Submission.attempt++;
                        user4Submission.attachments = [
                          new CanvasFile('image/jpeg', 'File 2.1-updated', 'file2.1-updated.jpg'),
                          new CanvasFile('image/jpeg', 'File 2.2-updated', 'file2.2-updated.jpg')
                        ];

                        CanvasTestsUtil.mockPollingRequests(dbCourse, [], assignments, []);
                        CanvasPoller.handleCourse(dbCourse, {'enableAssignmentCategories': true}, function(err) {
                          assert.ifError(err);

                          // Assert the old assets have been removed
                          AssetsTestsUtil.assertGetAssets(client1, course, null, null, null, null, 4, function(newAssets) {
                            // Assert these are all new assets
                            newAssetIds = _.map(newAssets.results, 'id');
                            assert.strictEqual(_.intersection(newAssetIds, oldAssetIds).length, 0);

                            // Assert the link was created correctly
                            var linkAsset = _.find(newAssets.results, {'type': 'link'});
                            assert.ok(linkAsset);
                            assert.strictEqual(linkAsset.title, 'http://www.yahoo.com');
                            assert.strictEqual(linkAsset.url, 'http://www.yahoo.com');

                            // Assert user3's file was created correctly
                            assert.ok(_.find(newAssets.results, {'type': 'file', 'title': 'File 1-updated'}));

                            // Assert user4's files were created correctly
                            assert.ok(_.find(newAssets.results, {'type': 'file', 'title': 'File 2.1-updated'}));
                            assert.ok(_.find(newAssets.results, {'type': 'file', 'title': 'File 2.2-updated'}));
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
        });
      });
    });

    /**
     * Test that verifies that submission attachments are dedeuplicated
     */
    it('does not create duplicate assets for duplicate submission attachments', function(callback) {
      // Generate a test course with a few users who will make submissions
      getClient(null, function(client1, course, user1) {
        getClient(course, function(client2, course, user2) {
          getClient(course, function(client3, course, user3) {
            getClient(course, function(client4, course, user4) {

              // Get the actual course object so we can pass it into the poller
              getCourse(course.id, function(dbCourse) {

                // Users 1 and 2 submit the same URL
                var user1Submission = new CanvasSubmission(user1.id, 'online_url', 'http://www.google.com');
                var user2Submission = new CanvasSubmission(user2.id, 'online_url', 'http://www.google.com');

                // Users 3 and 4 submit the same file
                var canvasFile = new CanvasFile('image/jpeg', 'File 1', 'file1.jpg');
                var user3Submission = new CanvasSubmission(user3.id, 'online_upload', [canvasFile]);
                var user4Submission = new CanvasSubmission(user4.id, 'online_upload', [canvasFile]);

                // Run the poller
                var assignments = [
                  new CanvasAssignment(course.id, [user1Submission, user2Submission, user3Submission, user4Submission])
                ];
                CanvasTestsUtil.mockPollingRequests(dbCourse, [], assignments, []);
                CanvasPoller.handleCourse(dbCourse, {'enableAssignmentCategories': true}, function(err) {
                  assert.ifError(err);

                  // Assert that two assets were created
                  AssetsTestsUtil.assertGetAssets(client1, course, null, null, null, null, 2, function(assets) {

                    // Assert that the link asset is associated with users 1 and 2
                    var linkAsset = _.find(assets.results, {'type': 'link'});
                    assert.strictEqual(linkAsset.users.length, 2);
                    assert.ok(_.find(linkAsset.users, {'canvas_user_id': user1.id}));
                    assert.ok(_.find(linkAsset.users, {'canvas_user_id': user2.id}));

                    // Assert that the file asset is associated with users 3 and 4
                    var fileAsset = _.find(assets.results, {'type': 'file'});
                    assert.strictEqual(fileAsset.users.length, 2);
                    assert.ok(_.find(fileAsset.users, {'canvas_user_id': user3.id}));
                    assert.ok(_.find(fileAsset.users, {'canvas_user_id': user4.id}));

                    return callback();
                  });
                });
              });
            });
          });
        });
      });
    });

    it('ignores submissions in unsubmitted state', function(callback) {
      getClient(null, function(client1, course, user1) {
        getCourse(course.id, function(dbCourse) {

          // Verify there are no assets in the library yet
          AssetsTestsUtil.assertGetAssets(client1, course, null, null, null, null, 0, function(assets) {

            // Create a file submission in unsubmitted state
            var assignments = [
              new CanvasAssignment(course.id, [
                new CanvasSubmission(user1.id, 'online_upload', [new CanvasFile('image/jpeg', 'File 1', 'file1.jpg')], 'unsubmitted')
              ])
            ];
            assignments[0].submissions[0].attachments[0].expectProcessing = false;

            CanvasTestsUtil.mockPollingRequests(dbCourse, [], assignments, []);
            CanvasPoller.handleCourse(dbCourse, {'enableAssignmentCategories': true}, function(err) {
              assert.ifError(err);

              // Verify that the submission was ignored
              AssetsTestsUtil.assertGetAssets(client1, course, null, null, null, null, 0, function(assets) {

                return callback();
              });
            });
          });
        });
      });
    });

    it('ignores submissions when attachment is in pending_upload state', function(callback) {
      getClient(null, function(client1, course, user1) {
        getCourse(course.id, function(dbCourse) {

          // Verify there are no assets in the library yet
          AssetsTestsUtil.assertGetAssets(client1, course, null, null, null, null, 0, function(assets) {

            // Create a file submission in pending_upload state
            var assignments = [
              new CanvasAssignment(course.id, [
                new CanvasSubmission(user1.id, 'online_upload', [new CanvasFile('image/jpeg', 'File 1', 'file1.jpg', null, 'pending_upload')], 'submitted')
              ])
            ];
            assignments[0].submissions[0].attachments[0].expectProcessing = false;

            CanvasTestsUtil.mockPollingRequests(dbCourse, [], assignments, []);
            CanvasPoller.handleCourse(dbCourse, {'enableAssignmentCategories': true}, function(err) {
              assert.ifError(err);

              // Verify that the submission was ignored
              AssetsTestsUtil.assertGetAssets(client1, course, null, null, null, null, 0, function(assets) {

                return callback();
              });
            });
          });
        });
      });
    });

    /**
     * Test that verifies that the poller removes outdated submissions from the asset library
     */
    it('removes outdated submissions from the asset library', function(callback) {
      // Generate a test course with a user who will make submissions
      getClient(null, function(client1, course, user1) {

        // Verify there are no assets in the library yet
        AssetsTestsUtil.assertGetAssets(client1, course, null, null, null, null, 0, function(assets) {

          // Get the actual course object so we can pass it into the poller
          getCourse(course.id, function(dbCourse) {

            // Submit a file
            var assignments = [
              new CanvasAssignment(course.id, [
                new CanvasSubmission(user1.id, 'online_upload', [
                  new CanvasFile('image/jpeg', 'File 1', 'file1.jpg')
                ])
              ])
            ];
            CanvasTestsUtil.mockPollingRequests(dbCourse, [], assignments, []);
            CanvasPoller.handleCourse(dbCourse, {'enableAssignmentCategories': true}, function(err) {
              assert.ifError(err);

              // Verify an asset was added for the submission
              AssetsTestsUtil.assertGetAssets(client1, course, null, null, null, null, 1, function(assets) {
                var fileAsset = assets.results[0];

                // The user re-submits their assignment
                assignments[0].submissions[0].attempt++;
                assignments[0].submissions[0].attachments = [new CanvasFile('image/jpeg', 'File 1-updated', 'file1-updated.jpg')];

                CanvasTestsUtil.mockPollingRequests(dbCourse, [], assignments, []);
                CanvasPoller.handleCourse(dbCourse, {'enableAssignmentCategories': true}, function(err) {
                  assert.ifError(err);

                  // The previous asset should be replaced
                  AssetsTestsUtil.assertGetAssets(client1, course, null, null, null, null, 1, function(assets) {
                    var newAsset = assets.results[0];
                    assert.notStrictEqual(newAsset.id, fileAsset.id);
                    return callback();
                  });
                });
              });
            });
          });
        });
      });
    });

    /**
     * Test that verifies that the poller does not remove activities that are linked to the old
     * asset when resubmitting an assignment
     */
    it('does not remove activities linked to the old asset when resubmitting an assignment', function(callback) {
      // Generate a test course with a few users who will make submissions
      getClient(null, function(client1, course, user1) {
        getClient(course, function(client2, course, user2) {

          // Get the actual course object so we can pass it into the poller
          getCourse(course.id, function(dbCourse) {

            // Submit a file
            var assignments = [
              new CanvasAssignment(course.id, [
                new CanvasSubmission(user1.id, 'online_upload', [
                  new CanvasFile('image/jpeg', 'File 1', 'file1.jpg')
                ])
              ])
            ];
            CanvasTestsUtil.mockPollingRequests(dbCourse, [], assignments, []);
            CanvasPoller.handleCourse(dbCourse, {'enableAssignmentCategories': true}, function(err) {
              assert.ifError(err);

              // Second user will like the asset and create an activity associated with the asset
              AssetsTestsUtil.assertGetAssets(client2, course, null, null, null, null, 1, function(assets) {
                AssetsTestsUtil.assertLike(client2, course, assets.results[0].id, true, function() {

                  // Get the leaderboard so we can check later that no points were lost
                  UsersTestUtil.assertGetLeaderboard(client2, course, null, null, function(oldLeaderboard) {

                    // The first user now re-submits their assignment
                    assignments[0].submissions[0].attempt++;
                    assignments[0].submissions[0].attachments = [new CanvasFile('image/jpeg', 'File 1-updated', 'file1-updated.jpg')];
                    CanvasTestsUtil.mockPollingRequests(dbCourse, [], assignments, []);
                    CanvasPoller.handleCourse(dbCourse, {'enableAssignmentCategories': true}, function(err) {
                      assert.ifError(err);

                      // Verify no activities were lost
                      UsersTestUtil.assertGetLeaderboard(client2, course, null, null, function(newLeaderboard) {
                        assert.deepEqual(newLeaderboard, oldLeaderboard);
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
    });

    /**
     * Test that verifies that the poller only creates a new asset once when resubmitting an assignment
     */
    it('only creates a new asset once when resubmitting an assignment', function(callback) {
      getClient(null, function(client, course, user) {

        // Get the actual course object so we can pass it into the poller
        getCourse(course.id, function(dbCourse) {

          // Submit an assignment
          var submission = new CanvasSubmission(user.id, 'online_url', 'http://www.google.com');
          var assignments = [
            new CanvasAssignment(course.id, [submission])
          ];
          CanvasTestsUtil.mockPollingRequests(dbCourse, [], assignments, []);
          CanvasPoller.handleCourse(dbCourse, {'enableAssignmentCategories': true}, function(err) {
            assert.ifError(err);

            // Assert the asset was created
            AssetsTestsUtil.assertGetAssets(client, course, null, null, null, null, 1, function(assets) {
              var preResubmitAsset = assets.results[0];
              assert.strictEqual(preResubmitAsset.url, 'http://www.google.com');

              // Do another poll and ensure the asset does not get recreated
              CanvasTestsUtil.mockPollingRequests(dbCourse, [], assignments, []);
              CanvasPoller.handleCourse(dbCourse, {'enableAssignmentCategories': true}, function(err) {
                assert.ifError(err);

                // Assert the asset was not recreated
                AssetsTestsUtil.assertGetAssets(client, course, null, null, null, null, 1, function(assets) {
                  var postSecondRunAsset = assets.results[0];
                  assert.strictEqual(postSecondRunAsset.url, 'http://www.google.com');
                  assert.strictEqual(postSecondRunAsset.id, preResubmitAsset.id);

                  // Resubmit the assignment
                  submission.attempt++;
                  submission.url = 'http://www.yahoo.com';
                  CanvasTestsUtil.mockPollingRequests(dbCourse, [], assignments, []);
                  CanvasPoller.handleCourse(dbCourse, {'enableAssignmentCategories': true}, function(err) {
                    assert.ifError(err);

                    AssetsTestsUtil.assertGetAssets(client, course, null, null, null, null, 1, function(assets) {
                      var postResubmitAsset = assets.results[0];
                      assert.strictEqual(postResubmitAsset.url, 'http://www.yahoo.com');
                      assert.notStrictEqual(preResubmitAsset.id, postResubmitAsset.id);

                      // Verify that subsequent runs don't create new assets
                      CanvasTestsUtil.mockPollingRequests(dbCourse, [], assignments, []);
                      CanvasPoller.handleCourse(dbCourse, {'enableAssignmentCategories': true}, function(err) {
                        assert.ifError(err);
                        AssetsTestsUtil.assertGetAssets(client, course, null, null, null, null, 1, function(assets) {
                          var secondRunAsset = assets.results[0];
                          assert.strictEqual(secondRunAsset.url, 'http://www.yahoo.com');
                          assert.notStrictEqual(preResubmitAsset.id, secondRunAsset.id);
                          assert.strictEqual(postResubmitAsset.id, secondRunAsset.id);

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
      });
    });

    /**
     * Test that verifies that the poller creates categories for each assignment
     */
    it('creates categories for assignments', function(callback) {
      // Generate a test course with a few users who will make submissions
      getClient(null, function(client1, course, user1) {
        getClient(course, function(client2, course, user2) {
          getClient(course, function(client3, course, user3) {
            var instructor = TestsUtil.generateInstructor();
            TestsUtil.getAssetLibraryClient(null, course, instructor, function(instructorClient, course, instructor) {

              // Get the actual course object so we can pass it into the poller
              getCourse(course.id, function(dbCourse) {

                // Poll a few assignments
                var assignment1 = new CanvasAssignment(course.id, [
                  new CanvasSubmission(user1.id, 'online_url', 'http://www.ucberkeley.edu')
                ], 'Assignment #1');
                var assignment2 = new CanvasAssignment(course.id, [
                  new CanvasSubmission(user2.id, 'online_url', 'http://www.google.com')
                ], 'Assignment #2');
                var emptyAssignment = new CanvasAssignment(course.id, [], 'Empty Assignment');
                var assignments = [assignment1, assignment2, emptyAssignment];
                CanvasTestsUtil.mockPollingRequests(dbCourse, [], assignments, []);
                CanvasPoller.handleCourse(dbCourse, {'enableAssignmentCategories': true}, function(err) {
                  assert.ifError(err);

                  // Assert the categories were synchronized
                  CategoriesTestUtil.assertGetCategories(instructorClient, course, true, 3, function(categories) {
                    var category1 = _.find(categories, {'canvas_assignment_id': assignment1.id});
                    var category2 = _.find(categories, {'canvas_assignment_id': assignment2.id});
                    var emptyCategory = _.find(categories, {'canvas_assignment_id': emptyAssignment.id});
                    CategoriesTestUtil.assertCategory(category1, {'expectAssetCount': 1});
                    CategoriesTestUtil.assertCategory(category2, {'expectAssetCount': 1});
                    CategoriesTestUtil.assertCategory(emptyCategory, {'expectAssetCount': 0});
                    assert.strictEqual(category1.title, assignment1.name);
                    assert.strictEqual(category2.title, assignment2.name);
                    assert.strictEqual(emptyCategory.title, emptyAssignment.name);

                    // Subsequent polls should not result in new categories
                    CanvasTestsUtil.mockPollingRequests(dbCourse, [], assignments, []);
                    CanvasPoller.handleCourse(dbCourse, {'enableAssignmentCategories': true}, function(err) {
                      assert.ifError(err);
                      CategoriesTestUtil.assertGetCategories(instructorClient, course, true, 3, function(categories) {
                        var retrievedCategory1 = _.find(categories, {'canvas_assignment_id': assignment1.id});
                        var retrievedCategory2 = _.find(categories, {'canvas_assignment_id': assignment2.id});
                        var retrievedCategory3 = _.find(categories, {'canvas_assignment_id': emptyAssignment.id});
                        CategoriesTestUtil.assertCategory(retrievedCategory1, {'expectedCategory': category1});
                        CategoriesTestUtil.assertCategory(retrievedCategory2, {'expectedCategory': category2});
                        CategoriesTestUtil.assertCategory(retrievedCategory3, {'expectedCategory': emptyCategory});

                        // Assert that updating the name of the assignment causes the category's title to be updated
                        assignment1.name = 'Updated assignment';
                        CanvasTestsUtil.mockPollingRequests(dbCourse, [], assignments, []);
                        CanvasPoller.handleCourse(dbCourse, {'enableAssignmentCategories': true}, function(err) {
                          assert.ifError(err);
                          CategoriesTestUtil.assertGetCategories(instructorClient, course, true, 3, function(categories) {
                            var updatedCategory = _.find(categories, {'canvas_assignment_id': assignment1.id});
                            CategoriesTestUtil.assertCategory(updatedCategory, {'expectAssetCount': 1});
                            assert.strictEqual(updatedCategory.title, assignment1.name);

                            // When the name of the category is changed in the application, further updates
                            // to the Canvas assignment's name will not impact the title of the category
                            CategoriesTestUtil.assertEditCategory(instructorClient, course, updatedCategory.id, 'Updated in the app', updatedCategory.visible, function() {
                              assignment1.name = 'Another change to the assignment name';
                              CanvasTestsUtil.mockPollingRequests(dbCourse, [], assignments, []);
                              CanvasPoller.handleCourse(dbCourse, {'enableAssignmentCategories': true}, function(err) {
                                assert.ifError(err);
                                CategoriesTestUtil.assertGetCategories(instructorClient, course, true, 3, function(categories) {
                                  var updatedCategory = _.find(categories, {'canvas_assignment_id': assignment1.id});
                                  CategoriesTestUtil.assertCategory(updatedCategory, {'expectAssetCount': 1});
                                  assert.strictEqual(updatedCategory.title, 'Updated in the app');

                                  // Two assignments are removed from the course; one remains
                                  CanvasTestsUtil.mockPollingRequests(dbCourse, [], [assignment1], []);
                                  CanvasPoller.handleCourse(dbCourse, {'enableAssignmentCategories': true}, function(err) {
                                    assert.ifError(err);
                                    // The poller should remove the empty category and retain the category with an assignment
                                    CategoriesTestUtil.assertGetCategories(instructorClient, course, true, 2, function(categories) {
                                      var category1 = _.find(categories, {'canvas_assignment_id': assignment1.id});
                                      var category2 = _.find(categories, {'canvas_assignment_id': assignment2.id});
                                      var emptyCategory = _.find(categories, {'canvas_assignment_id': emptyAssignment.id});
                                      CategoriesTestUtil.assertCategory(category1, {'expectAssetCount': 1});
                                      CategoriesTestUtil.assertCategory(category2, {'expectAssetCount': 1});
                                      assert.ok(!emptyCategory);

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
                  });
                });
              });
            });
          });
        });
      });
    });

    it('ignores non-syncable assignments', function(callback) {
      // Generate test client, course and users.
      getClient(null, function(client1, course, user1) {
        var instructor = TestsUtil.generateInstructor();
        TestsUtil.getAssetLibraryClient(null, course, instructor, function(instructorClient, course, instructor) {
          getCourse(course.id, function(dbCourse) {
            var mockedUsers = [
              CanvasTestsModel.getCanvasUser(user1, course)
            ];

            // Mock some assignments. Based on submission types, only assignments 2 and 3 are syncable.
            var assignment1 = new CanvasAssignment(course.id, []);
            assignment1.submission_types = [ 'online_text_entry' ];
            var assignment2 = new CanvasAssignment(course.id, []);
            assignment2.submission_types = ['online_url', 'online_text_entry'];
            var assignment3 = new CanvasAssignment(course.id, []);
            assignment3.submission_types = ['online_upload', 'online_text_entry'];

            CanvasTestsUtil.mockPollingRequests(dbCourse, mockedUsers, [assignment1, assignment2, assignment3]);
            CanvasPoller.handleCourse(dbCourse, null, function(err) {
              assert.ifError(err);

              // Assignments 2 and 3 have associated categories.
              CategoriesTestUtil.assertGetCategories(instructorClient, course, true, 2, function(categories) {
                assert.ok(_.find(categories, {'canvas_assignment_id': assignment2.id}));
                assert.ok(_.find(categories, {'canvas_assignment_id': assignment3.id}));

                // Now assignment 1 becomes syncable and assignment 2 becomes unsyncable.
                assignment1.submission_types = ['online_text_entry', 'online_upload'];
                assignment2.submission_types = [ 'online_text_entry' ];

                CanvasTestsUtil.mockPollingRequests(dbCourse, mockedUsers, [assignment1, assignment2, assignment3]);
                CanvasPoller.handleCourse(dbCourse, null, function(err) {
                  assert.ifError(err);

                  // Assignments 1 and 3 have categories, assignment 2 does not.
                  CategoriesTestUtil.assertGetCategories(instructorClient, course, true, 2, function(categories) {
                    assert.ok(_.find(categories, {'canvas_assignment_id': assignment1.id}));
                    assert.ok(_.find(categories, {'canvas_assignment_id': assignment3.id}));

                    // Lastly, re-enable assignment 2.
                    assignment2.submission_types = [ 'online_upload' ];

                    CanvasTestsUtil.mockPollingRequests(dbCourse, mockedUsers, [assignment1, assignment2, assignment3]);
                    CanvasPoller.handleCourse(dbCourse, null, function(err) {
                      assert.ifError(err);

                      // All assignments have categories.
                      CategoriesTestUtil.assertGetCategories(instructorClient, course, true, 3, function(categories) {
                        assert.ok(_.find(categories, {'canvas_assignment_id': assignment1.id}));
                        assert.ok(_.find(categories, {'canvas_assignment_id': assignment2.id}));
                        assert.ok(_.find(categories, {'canvas_assignment_id': assignment3.id}));

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
    });

    /**
     * Test that verifies that assignment categories are created as invisible by default
     */
    it('creates assignment categories as invisible', function(callback) {
      // Generate a test course with an assignment and a submission
      getClient(null, function(client1, course, user) {
        var instructor = TestsUtil.generateInstructor();
        TestsUtil.getAssetLibraryClient(null, course, instructor, function(instructorClient, course, instructor) {

          // Get the actual course object so we can pass it into the poller
          getCourse(course.id, function(dbCourse) {

            // Poll an assignment and a submission
            var assignment = new CanvasAssignment(course.id, [
              new CanvasSubmission(user.id, 'online_url', 'http://www.ucberkeley.edu')
            ], 'Assignment');

            CanvasTestsUtil.mockPollingRequests(dbCourse, [], [assignment], []);
            CanvasPoller.handleCourse(dbCourse, null, function(err) {
              assert.ifError(err);

              // Assert that the category is invisible by default
              CategoriesTestUtil.assertGetCategories(instructorClient, course, false, 0, function(categories) {
                CategoriesTestUtil.assertGetCategories(instructorClient, course, true, 1, function(categories) {

                  // Assert that the assignment submission associated to the category is not returned
                  AssetsTestsUtil.assertGetAssets(client1, course, null, null, null, null, 0, function(assets) {

                    return callback();
                  });
                });
              });
            });
          });
        });
      });
    });

    /**
     * Test that verifies that the poller does not recreate deleted categories
     */
    it('does not recreate deleted categories', function(callback) {
      getClient(null, function(client1, course, user1) {
        var instructor = TestsUtil.generateInstructor();
        TestsUtil.getAssetLibraryClient(null, course, instructor, function(instructorClient, course, instructor) {

          // Get the actual course object so we can pass it into the poller
          getCourse(course.id, function(dbCourse) {

            // Poll a few assignments
            var submissions = [
              new CanvasSubmission(user1.id, 'online_url', 'http://www.google.com')
            ];
            var assignment1 = new CanvasAssignment(course.id, submissions, 'Assignment #1');
            var assignment2 = new CanvasAssignment(course.id, [], 'Assignment #2');
            var assignments = [assignment1, assignment2];
            CanvasTestsUtil.mockPollingRequests(dbCourse, [], assignments, []);
            CanvasPoller.handleCourse(dbCourse, {'enableAssignmentCategories': true}, function(err) {
              assert.ifError(err);

              // Assert the categories were synchronized
              CategoriesTestUtil.assertGetCategories(instructorClient, course, true, 2, function(categories) {
                var category1 = _.find(categories, {'canvas_assignment_id': assignment1.id});
                var category2 = _.find(categories, {'canvas_assignment_id': assignment2.id});
                CategoriesTestUtil.assertCategory(category1, {'expectAssetCount': 1});
                CategoriesTestUtil.assertCategory(category2, {'expectAssetCount': 1});
                assert.strictEqual(category1.title, assignment1.name);
                assert.strictEqual(category2.title, assignment2.name);

                // Assert the asset was assigned to the correct category
                AssetsTestsUtil.assertGetAssets(client1, course, null, null, null, null, 1, function(assets) {
                  AssetsTestsUtil.assertGetAsset(client1, course, assets.results[0].id, null, null, function(asset) {
                    assert.strictEqual(asset.categories.length, 1);
                    assert.strictEqual(asset.categories[0].id, category1.id);

                    // Delete the first category
                    CategoriesTestUtil.assertDeleteCategory(instructorClient, course, category1.id, function() {

                      // Poll the Canvas API again
                      CanvasTestsUtil.mockPollingRequests(dbCourse, [], assignments, []);
                      CanvasPoller.handleCourse(dbCourse, {'enableAssignmentCategories': true}, function(err) {
                        assert.ifError(err);

                        // Ensure the category wasn't re-created
                        CategoriesTestUtil.assertGetCategories(instructorClient, course, true, 1, function(categories) {
                          assert.strictEqual(categories[0].id, category2.id);

                          // Assert the category is unlinked from the asset
                          AssetsTestsUtil.assertGetAsset(client1, course, assets.results[0].id, null, null, function(asset) {
                            assert.strictEqual(asset.categories.length, 0);
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
        });
      });
    });

    /**
     * Test that verifies that the poller ignores submissions made by users who are removed from a course
     */
    it('ignores submissions made by users who are removed from a course', function(callback) {
      getClient(null, function(client1, course, user1) {

        // Get the actual course object so we can pass it into the poller
        getCourse(course.id, function(dbCourse) {

          // Poll a few assignments
          var submissions = [
            new CanvasSubmission('unknown-user-id', 'online_url', 'http://www.google.com'),
            new CanvasSubmission(user1.id, 'online_url', 'http://www.yahoo.com')
          ];
          var assignment = new CanvasAssignment(course.id, submissions, 'Assignment');
          CanvasTestsUtil.mockPollingRequests(dbCourse, [], [assignment], []);
          CanvasPoller.handleCourse(dbCourse, {'enableAssignmentCategories': true}, function(err) {
            assert.ifError(err);

            // Assert that only an asset for user1's submission got created
            AssetsTestsUtil.assertGetAssets(client1, course, null, null, null, null, 1, function(assets) {
              assert.strictEqual(assets.results.length, 1);
              assert.strictEqual(assets.results[0].url, 'http://www.yahoo.com');
              return callback();
            });
          });
        });
      });
    });
  });

  describe('Course inactivation', function() {

    /**
     * Test that verifies that courses with no recent activity are inactivated
     */
    it('inactivates a course with activity in the distant past', function(callback) {
      // Create a user who will get some old activity
      TestsUtil.getAssetLibraryClient(null, null, null, function(client, course, user) {
        // Create a second user who does nothing; inactivation logic should ignore this user
        TestsUtil.getAssetLibraryClient(null, course, null, function(doNothingClient, course, doNothingUser) {
          // Create a link asset with no optional metadata
          AssetsTestsUtil.assertCreateLink(client, course, 'UC Davis', 'http://www.ucdavis.edu/', null, function(asset) {

            // Set the user's last_activity in the database to the distant past
            DB.User.findOne({'where': {'canvas_user_id': user.id}}).complete(function(err, dbUser) {
              assert.ifError(err);
              var ninetyOneDaysAgo = moment().subtract(91, 'days');
              dbUser.update({'last_activity': ninetyOneDaysAgo}).complete(function(err) {
                assert.ifError(err);

                // Get the actual course object so we can pass it into the poller
                getCourse(course.id, function(dbCourse) {

                  // Set poller's deactivation threshold
                  CanvasPoller.setDeactivationThreshold(config.get('canvasPoller.deactivationThreshold'));

                  // Prepare the mocked requests to Canvas
                  var mockedUsers = [
                    CanvasTestsModel.getCanvasUser(user, course)
                  ];
                  CanvasTestsUtil.mockPollingRequests(dbCourse, mockedUsers);

                  // Poll the Canvas API for information
                  CanvasPoller.handleCourse(dbCourse, null, function(err) {
                    assert.ifError(err);

                    // Assert that the course was inactivated
                    client.course.getCourse(course, function(err, course) {
                      assert.ifError(err);
                      assert.ok(!course.active);

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

    /**
     * Test that verifies that courses with recent activity are not inactivated
     */
    it('does not inactivate a course with recent activity', function(callback) {
      TestsUtil.getAssetLibraryClient(null, null, null, function(client, course, user) {
        // Create a link asset
        AssetsTestsUtil.assertCreateLink(client, course, 'UC Davis', 'http://www.ucdavis.edu/', null, function(asset) {

          // Get the actual course object so we can pass it into the poller
          getCourse(course.id, function(dbCourse) {

            // Set poller's deactivation threshold
            CanvasPoller.setDeactivationThreshold(config.get('canvasPoller.deactivationThreshold'));

            // Prepare the mocked requests to Canvas
            var mockedUsers = [
              CanvasTestsModel.getCanvasUser(user, course)
            ];
            CanvasTestsUtil.mockPollingRequests(dbCourse, mockedUsers);

            // Poll the Canvas API for information
            CanvasPoller.handleCourse(dbCourse, null, function(err) {
              assert.ifError(err);

              // Assert that the course remains active
              client.course.getCourse(course, function(err, course) {
                assert.ifError(err);
                assert.ok(course.active);

                return callback();
              });
            });
          });
        });
      });
    });

    /**
     * Test that verifies that courses with no activity are not inactivated
     */
    it('does not inactivate a course with no activity', function(callback) {
      var instructor = TestsUtil.generateInstructor();
      TestsUtil.getAssetLibraryClient(null, null, instructor, function(client, course, instructor) {
        // Verify that the new course has no activities
        ActivitiesTestUtil.assertExportActivities(client, course, 0, function(activities) {

          // Get the actual course object so we can pass it into the poller
          getCourse(course.id, function(dbCourse) {

            // Set poller's deactivation threshold
            CanvasPoller.setDeactivationThreshold(config.get('canvasPoller.deactivationThreshold'));

            // Prepare the mocked requests to Canvas
            var mockedUsers = [
              CanvasTestsModel.getCanvasUser(instructor, course)
            ];
            CanvasTestsUtil.mockPollingRequests(dbCourse, mockedUsers);

            // Poll the Canvas API for information
            CanvasPoller.handleCourse(dbCourse, null, function(err) {
              assert.ifError(err);

              // Assert that the course remains active
              client.course.getCourse(course, function(err, course) {
                assert.ifError(err);
                assert.ok(course.active);

                return callback();
              });
            });
          });
        });
      });
    });
  });

  describe('Tool removal', function() {

    /**
     * Test verifying that tools hidden in course navigation have their URLs removed from the database
     */
    it('removes hidden tools', function(callback) {
      // Create a new course with three tools
      TestsUtil.getAssetLibraryClient(null, null, null, function(client, course, user) {
        LtiTestsUtil.assertEngagementIndexLaunchSucceeds(client, course, user, function() {
          LtiTestsUtil.assertWhiteboardsLaunchSucceeds(client, course, user, function() {

            // Hide the asset library in Canvas
            getCourse(course.id, function(dbCourse) {
              var mockTabsResponse = new CanvasTabs(dbCourse);
              _.find(mockTabsResponse, {'label': 'Asset Library'}).hidden = true;
              CanvasTestsUtil.mockPollingRequests(dbCourse, null, null, null, null, mockTabsResponse);

              // Poll the course
              CanvasPoller.handleCourse(dbCourse, null, function(err) {
                assert.ifError(err);

                client.course.getCourse(course, function(err, course) {
                  assert.ifError(err);
                  // Verify that the course remains active
                  assert.ok(course.active);
                  // Verify that the asset library URL has been removed
                  assert.ok(!course.assetlibrary_url);
                  // Verify that other tools are left alone
                  assert.ok(course.engagementindex_url);
                  assert.ok(course.whiteboards_url);

                  return callback();
                });
              });
            });
          });
        });
      });
    });

    /**
     * Test verifying that tools not found under a course have their URLs removed from the database
     */
    it('removes missing tools', function(callback) {
      // Create a new course with three tools
      TestsUtil.getAssetLibraryClient(null, null, null, function(client, course, user) {
        LtiTestsUtil.assertEngagementIndexLaunchSucceeds(client, course, user, function() {
          LtiTestsUtil.assertWhiteboardsLaunchSucceeds(client, course, user, function() {

            // Remove the engagement index in Canvas
            getCourse(course.id, function(dbCourse) {
              var mockTabsResponse = new CanvasTabs(dbCourse);
              _.remove(mockTabsResponse, {'label': 'Engagement Index'});
              CanvasTestsUtil.mockPollingRequests(dbCourse, null, null, null, null, mockTabsResponse);

              // Poll the course
              CanvasPoller.handleCourse(dbCourse, null, function(err) {
                assert.ifError(err);

                client.course.getCourse(course, function(err, course) {
                  assert.ifError(err);
                  // Verify that the course remains active
                  assert.ok(course.active);
                  // Verify that the engagement index URL has been removed
                  assert.ok(!course.engagementindex_url);
                  // Verify that other tools are left alone
                  assert.ok(course.assetlibrary_url);
                  assert.ok(course.whiteboards_url);

                  return callback();
                });
              });
            });
          });
        });
      });
    });

    /**
     * Test verifying that courses with no visible tools are marked inactive
     */
    it('inactivates courses with no visible tools', function(callback) {
      // Create a new course with three tools
      TestsUtil.getAssetLibraryClient(null, null, null, function(client, course, user) {
        LtiTestsUtil.assertEngagementIndexLaunchSucceeds(client, course, user, function() {
          LtiTestsUtil.assertWhiteboardsLaunchSucceeds(client, course, user, function() {

            // Hide whiteboards and remove the other tools in Canvas
            getCourse(course.id, function(dbCourse) {
              var mockTabsResponse = new CanvasTabs(dbCourse);
              _.remove(mockTabsResponse, {'label': 'Asset Library'});
              _.remove(mockTabsResponse, {'label': 'Engagement Index'});
              _.find(mockTabsResponse, {'label': 'Whiteboards'}).hidden = true;
              CanvasTestsUtil.mockGetCourseTabs(dbCourse, mockTabsResponse);

              // Poll the course
              CanvasPoller.handleCourse(dbCourse, null, function(err) {
                assert.ifError(err);

                client.course.getCourse(course, function(err, course) {
                  assert.ifError(err);
                  // Verify that the course is inactive
                  assert.ok(!course.active);
                  // Verify that the all URLs have been removed
                  assert.ok(!course.assetlibrary_url);
                  assert.ok(!course.engagementindex_url);
                  assert.ok(!course.whiteboards_url);

                  return callback();
                });
              });
            });
          });
        });
      });
    });
  });

  describe('Discussions', function() {

    /**
     * Test that verifies that activities are created for discussions
     */
    it('creates activities for discussions', function(callback) {
      // Generate a test course with a few users who will add entries
      getClient(null, function(client1, course, user1) {
        getClient(course, function(client2, course, user2) {
          getClient(course, function(client3, course, user3) {

            // Get the actual course object so we can pass it into the poller
            getCourse(course.id, function(dbCourse) {

              // Poll the canvas API but don't return a discussion just yet
              var mockedUsers = [
                CanvasTestsModel.getCanvasUser(user1, course),
                CanvasTestsModel.getCanvasUser(user2, course),
                CanvasTestsModel.getCanvasUser(user3, course)
              ];
              CanvasTestsUtil.mockPollingRequests(dbCourse, mockedUsers, [], []);
              CanvasPoller.handleCourse(dbCourse, null, function(err) {
                assert.ifError(err);

                // Get all the users, they should all have 0 points
                UsersTestUtil.assertGetLeaderboard(client1, course, 3, false, function(users) {
                  _.each(users, function(user) {
                    assert.strictEqual(user.points, 0);
                  });

                  // Poll the Canvas API and return the discussion
                  var discussion = new CanvasDiscussion(user1);
                  CanvasTestsUtil.mockPollingRequests(dbCourse, mockedUsers, [], [discussion]);
                  CanvasPoller.handleCourse(dbCourse, null, function(err) {
                    assert.ifError(err);

                    var topicPoints = getActivitiesDefaultPoints('discussion_topic');
                    var entryPoints = getActivitiesDefaultPoints('discussion_entry');
                    var entryGetReplyPoints = getActivitiesDefaultPoints('get_discussion_entry_reply');

                    // The user who created the discussion should've received points
                    UsersTestUtil.assertGetLeaderboard(client1, course, 3, false, function(users) {
                      assert.strictEqual(getUserByName(users, user1.fullName).points, topicPoints);
                      assert.strictEqual(getUserByName(users, user2.fullName).points, 0);
                      assert.strictEqual(getUserByName(users, user3.fullName).points, 0);

                      // Subsequent polls should not result in new activities
                      CanvasTestsUtil.mockPollingRequests(dbCourse, mockedUsers, [], [discussion]);
                      CanvasPoller.handleCourse(dbCourse, null, function(err) {
                        assert.ifError(err);
                        UsersTestUtil.assertGetLeaderboard(client1, course, 3, false, function(users) {
                          assert.strictEqual(getUserByName(users, user1.fullName).points, topicPoints);
                          assert.strictEqual(getUserByName(users, user2.fullName).points, 0);
                          assert.strictEqual(getUserByName(users, user3.fullName).points, 0);

                          // Add an entry to a discussion
                          discussion.addEntry(new CanvasDiscussionEntry(user2));
                          CanvasTestsUtil.mockPollingRequests(dbCourse, mockedUsers, [], [discussion]);
                          CanvasPoller.handleCourse(dbCourse, null, function(err) {
                            assert.ifError(err);

                            // The user who added an entry on the discussion should now also have some points
                            UsersTestUtil.assertGetLeaderboard(client1, course, 3, false, function(users) {
                              assert.strictEqual(getUserByName(users, user1.fullName).points, topicPoints);
                              assert.strictEqual(getUserByName(users, user2.fullName).points, entryPoints);
                              assert.strictEqual(getUserByName(users, user3.fullName).points, 0);

                              // Reply to an entry
                              discussion.addEntry(new CanvasDiscussionEntry(user3, discussion.getEntries()[0].id));
                              CanvasTestsUtil.mockPollingRequests(dbCourse, mockedUsers, [], [discussion]);
                              CanvasPoller.handleCourse(dbCourse, null, function(err) {
                                assert.ifError(err);

                                // The user who replied to an entry should've received some points. The user
                                // who made the original entry will get additional points
                                UsersTestUtil.assertGetLeaderboard(client1, course, 3, false, function(users) {
                                  assert.strictEqual(getUserByName(users, user1.fullName).points, topicPoints);
                                  assert.strictEqual(getUserByName(users, user2.fullName).points, entryPoints + entryGetReplyPoints);
                                  assert.strictEqual(getUserByName(users, user3.fullName).points, entryPoints);

                                  // Creating an entry on your own topic or replying to your own entry should
                                  // not result in users owning points
                                  discussion.addEntry(new CanvasDiscussionEntry(user1));
                                  discussion.addEntry(new CanvasDiscussionEntry(user2, discussion.getEntries()[0].id));
                                  CanvasTestsUtil.mockPollingRequests(dbCourse, mockedUsers, [], [discussion]);
                                  CanvasPoller.handleCourse(dbCourse, null, function(err) {
                                    assert.ifError(err);

                                    // The user who replied to an entry should've received some points. The user
                                    // who made the original entry will get additional points
                                    UsersTestUtil.assertGetLeaderboard(client1, course, 3, false, function(users) {
                                      assert.strictEqual(getUserByName(users, user1.fullName).points, topicPoints);
                                      assert.strictEqual(getUserByName(users, user2.fullName).points, entryPoints + entryGetReplyPoints);
                                      assert.strictEqual(getUserByName(users, user3.fullName).points, entryPoints);

                                      // User 2, who made the previous entry, makes another entry on the same topic.
                                      discussion.addEntry(new CanvasDiscussionEntry(user2));
                                      CanvasTestsUtil.mockPollingRequests(dbCourse, mockedUsers, [], [discussion]);
                                      CanvasPoller.handleCourse(dbCourse, null, function(err) {
                                        assert.ifError(err);

                                        // User 2 should get additional points for the second entry.
                                        UsersTestUtil.assertGetLeaderboard(client1, course, 3, false, function(users) {
                                          assert.strictEqual(getUserByName(users, user2.fullName).points, (entryPoints * 2) + entryGetReplyPoints);

                                          // User 2 replies to User 3's reply on User 2's entry
                                          var user3Reply = discussion.getEntries()[0].recent_replies[0];
                                          discussion.addEntry(new CanvasDiscussionEntry(user2, user3Reply.id));
                                          CanvasTestsUtil.mockPollingRequests(dbCourse, mockedUsers, [], [discussion]);
                                          CanvasPoller.handleCourse(dbCourse, null, function(err) {
                                            assert.ifError(err);

                                            // User 2 and User 3 should get additional points
                                            UsersTestUtil.assertGetLeaderboard(client1, course, 3, false, function(users) {
                                              assert.strictEqual(getUserByName(users, user2.fullName).points, (entryPoints * 3) + entryGetReplyPoints);
                                              assert.strictEqual(getUserByName(users, user3.fullName).points, entryPoints + entryGetReplyPoints);

                                              // User 3 replies to User 3's reply on User 2's entry
                                              discussion.addEntry(new CanvasDiscussionEntry(user3, user3Reply.id));
                                              CanvasTestsUtil.mockPollingRequests(dbCourse, mockedUsers, [], [discussion]);
                                              CanvasPoller.handleCourse(dbCourse, null, function(err) {
                                                assert.ifError(err);

                                                // No one should get additional points
                                                UsersTestUtil.assertGetLeaderboard(client1, course, 3, false, function(users) {
                                                  assert.strictEqual(getUserByName(users, user2.fullName).points, (entryPoints * 3) + entryGetReplyPoints);
                                                  assert.strictEqual(getUserByName(users, user3.fullName).points, entryPoints + entryGetReplyPoints);
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
                              });
                            });
                          });
                        });
                      });
                    });
                  });
                });
              });
            });
          });
        });
      });
    });

    /**
     * Test that verifies that the poller can page the Canvas Discussions REST API
     */
    it('can page Canvas', function(callback) {
      // Generate a test course with a few users who will add entries
      getClient(null, function(client1, course, user1) {
        getClient(course, function(client2, course, user2) {
          getClient(course, function(client3, course, user3) {
            var instructor = TestsUtil.generateInstructor();
            TestsUtil.getAssetLibraryClient(null, course, instructor, function(instructorClient, course, instructor) {

              // Get the actual course object so we can pass it into the poller
              getCourse(course.id, function(dbCourse) {

                // Prepare the mocked requests to Canvas
                var mockedUsers = [
                  CanvasTestsModel.getCanvasUser(user1, course),
                  CanvasTestsModel.getCanvasUser(user2, course),
                  CanvasTestsModel.getCanvasUser(user3, course)
                ];
                var discussions = _.times(100, function(n) {
                  return new CanvasDiscussion(user1);
                });
                CanvasTestsUtil.mockPollingRequests(dbCourse, mockedUsers, [], discussions);

                // Poll the Canvas API for information
                CanvasPoller.handleCourse(dbCourse, null, function(err) {
                  assert.ifError(err);

                  // The first user made a 100 discussion topics which should result in earning 500 points
                  UsersTestUtil.assertGetLeaderboard(instructorClient, course, 3, false, function(leaderboard) {
                    assert.strictEqual(getUserByName(leaderboard, user1.fullName).points, 100 * getActivitiesDefaultPoints('discussion_topic'));
                    assert.strictEqual(getUserByName(leaderboard, user2.fullName).points, 0);
                    assert.strictEqual(getUserByName(leaderboard, user3.fullName).points, 0);

                    // Add 100 entries
                    _.each(discussions, function(discussion) {
                      discussion.addEntry(new CanvasDiscussionEntry(user2));
                    });
                    CanvasTestsUtil.mockPollingRequests(dbCourse, mockedUsers, [], discussions);

                    // Poll the Canvas API for information
                    CanvasPoller.handleCourse(dbCourse, null, function(err) {
                      assert.ifError(err);

                      // The second user made a 100 entries which should result in earning 300 points
                      UsersTestUtil.assertGetLeaderboard(instructorClient, course, 3, false, function(leaderboard) {
                        assert.strictEqual(getUserByName(leaderboard, user1.fullName).points, 100 * getActivitiesDefaultPoints('discussion_topic'));
                        assert.strictEqual(getUserByName(leaderboard, user2.fullName).points, 100 * getActivitiesDefaultPoints('discussion_entry'));
                        assert.strictEqual(getUserByName(leaderboard, user3.fullName).points, 0);

                        // Add 100 replies to entries
                        _.each(discussions, function(discussion) {
                          discussion.addEntry(new CanvasDiscussionEntry(user3, discussion.getEntries()[0].id));
                        });
                        CanvasTestsUtil.mockPollingRequests(dbCourse, mockedUsers, [], discussions);

                        // Poll the Canvas API for information
                        CanvasPoller.handleCourse(dbCourse, null, function(err) {
                          assert.ifError(err);

                          // The third user made a 100 replies which should result in earning 200 points. Additionally
                          // the second user should've received a 100 points extra for getting 100 replies to their entries
                          UsersTestUtil.assertGetLeaderboard(instructorClient, course, 3, false, function(leaderboard) {
                            assert.strictEqual(getUserByName(leaderboard, user1.fullName).points, 100 * getActivitiesDefaultPoints('discussion_topic'));
                            assert.strictEqual(getUserByName(leaderboard, user2.fullName).points, (100 * getActivitiesDefaultPoints('discussion_entry')) + (100 * getActivitiesDefaultPoints('get_discussion_entry_reply')));
                            assert.strictEqual(getUserByName(leaderboard, user3.fullName).points, 100 * getActivitiesDefaultPoints('discussion_entry'));
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
        });
      });
    });

    /**
     * Test that verifies that the poller ignores assignment discussions
     */
    it('ignores assignment discussions', function(callback) {
      // Generate a test course with a few users who will add entries
      getClient(null, function(client1, course, user1) {
        getClient(course, function(client2, course, user2) {
          getClient(course, function(client3, course, user3) {

            // Get the actual course object so we can pass it into the poller
            getCourse(course.id, function(dbCourse) {

              // Mock the users in the course
              var mockedUsers = [
                CanvasTestsModel.getCanvasUser(user1, course),
                CanvasTestsModel.getCanvasUser(user2, course),
                CanvasTestsModel.getCanvasUser(user3, course)
              ];
              // Mock the assigned discussion
              var assignment = new CanvasAssignment(course.id, []);
              assignment.submission_types = ['discussion_topic'];
              var discussion = new CanvasDiscussion(user1, [], assignment);
              CanvasTestsUtil.mockPollingRequests(dbCourse, mockedUsers, [assignment], [discussion]);
              CanvasPoller.handleCourse(dbCourse, null, function(err) {
                assert.ifError(err);

                // Get all the users, they should all have 0 points
                UsersTestUtil.assertGetLeaderboard(client1, course, 3, false, function(users) {
                  _.each(users, function(user) {
                    assert.strictEqual(user.points, 0);
                  });

                  // The second user creates an entry to which the third user replies
                  discussion.addEntry(new CanvasDiscussionEntry(user2));
                  discussion.addEntry(new CanvasDiscussionEntry(user3, discussion.getEntries()[0].id));

                  // Canvas considers a discussion entry on an assigned discussion an assignment submission. We
                  // mock this behaviour so the poller gets the same data during a test as it would in production
                  assignment.submissions.push(new CanvasSubmission(user2.id, 'discussion_topic', [discussion.getEntries()[0]]));
                  assignment.submissions.push(new CanvasSubmission(user3.id, 'discussion_topic', [discussion.getEntries()[1]]));

                  CanvasTestsUtil.mockPollingRequests(dbCourse, mockedUsers, [assignment], [discussion]);
                  CanvasPoller.handleCourse(dbCourse, null, function(err) {
                    assert.ifError(err);

                    var entryPoints = getActivitiesDefaultPoints('discussion_entry');
                    var entryGetReplyPoints = getActivitiesDefaultPoints('get_discussion_entry_reply');

                    // Event though the users technically submitted an assignment, activities should only
                    // be created for replying (and getting a reply) on the discussion. Assert that the
                    // poller ignored the submissions but created activities for the discussion entries
                    UsersTestUtil.assertGetLeaderboard(client1, course, 3, false, function(users) {
                      assert.strictEqual(getUserByName(users, user1.fullName).points, 0);
                      assert.strictEqual(getUserByName(users, user2.fullName).points, entryPoints + entryGetReplyPoints);
                      assert.strictEqual(getUserByName(users, user3.fullName).points, entryPoints);

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
  });
});
