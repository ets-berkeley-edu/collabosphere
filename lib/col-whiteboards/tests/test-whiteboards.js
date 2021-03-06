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
var randomstring = require('randomstring');

var CategoriesTestUtil = require('col-categories/tests/util');
var TestsUtil = require('col-tests');
var UsersTestUtil = require('col-users/tests/util');

var WhiteboardsTestUtil = require('./util');

describe('Whiteboards', function() {

  /**
   * Generate a set of test users and 2 courses for the whiteboard tests
   *
   * @param  {Function}         callback                                          Standard callback function
   * @param  {Object}           callback.users                                    Generated test users
   * @param  {Object}           callback.users.creator                            Object representing the main acting user
   * @param  {RestClient}       callback.users.creator.client                     The rest client for the main acting user
   * @param  {Me}               callback.users.creator.me                         The me object for the main acting user
   * @param  {Object}           callback.users.regularA                           Object representing a regular user in the main course
   * @param  {RestClient}       callback.users.regularA.client                    The rest client for a regular user in the main course
   * @param  {Me}               callback.users.regularA.me                        The me object for a regular user in the main course
   * @param  {Object}           callback.users.regularB                           Object representing a second regular user in the main course
   * @param  {RestClient}       callback.users.regularB.client                    The rest client for a second regular user in the main course
   * @param  {Me}               callback.users.regularB.me                        The me object for a second regular user in the main course
   * @param  {Object}           callback.users.instructor                         Object representing a course instructor in the main course
   * @param  {RestClient}       callback.users.instructor.client                  The rest client for a course instructor in the main course
   * @param  {Object}           callback.users.regularOtherCourse                 Object representing a regular user in a different course course
   * @param  {RestClient}       callback.users.regularOtherCourse.client          The rest client for a regular user in a different course course
   * @param  {Me}               callback.users.regularOtherCourse.me              The me object for a regular user in a different course course
   * @param  {Object}           callback.users.instructorOtherCourse              Object representing a course instructor in a different course course
   * @param  {RestClient}       callback.users.instructorOtherCourse.client       The rest client for a course instructor in a different course course
   * @param  {Course}           callback.course                                   Main course for the test
   * @param  {Course}           callback.otherCourse                              Other course for the test
   * @api private
   */
  var setUpUsers = function(callback) {
    // Generate the user that will be used as the main acting user
    TestsUtil.getAssetLibraryClient(null, null, null, function(creatorClient, course, creatorUser) {
      UsersTestUtil.assertGetMe(creatorClient, course, null, function(creatorMe) {
        // Generator a regular user in the same course
        TestsUtil.getAssetLibraryClient(null, course, null, function(regularClientA, course, regularUserA) {
          UsersTestUtil.assertGetMe(regularClientA, course, null, function(regularMeA) {
            // Generate a second regular user in the same course
            TestsUtil.getAssetLibraryClient(null, course, null, function(regularClientB, course, regularUserB) {
              UsersTestUtil.assertGetMe(regularClientB, course, null, function(regularMeB) {
                // Generate a course instructor in the same course
                var instructor = TestsUtil.generateUser(null, null, 'urn:lti:role:ims/lis/Instructor');
                TestsUtil.getAssetLibraryClient(null, course, instructor, function(instructorClient, course, instructor) {
                  // Generate a regular user in a different course
                  TestsUtil.getAssetLibraryClient(null, null, null, function(regularOtherCourseClient, otherCourse, regularOtherCourseUser) {
                    UsersTestUtil.assertGetMe(regularOtherCourseClient, otherCourse, null, function(regularOtherCourseMe) {
                      // Generate a course instructor in a different course
                      var instructorOtherCourse = TestsUtil.generateUser(null, null, 'urn:lti:role:ims/lis/Instructor');
                      TestsUtil.getAssetLibraryClient(null, otherCourse, instructorOtherCourse, function(instructorOtherCourseClient, otherCourse, instructorOtherCourse) {

                        var users = {
                          'creator': {
                            'client': creatorClient,
                            'me': creatorMe
                          },
                          'regularA': {
                            'client': regularClientA,
                            'me': regularMeA
                          },
                          'regularB': {
                            'client': regularClientB,
                            'me': regularMeB
                          },
                          'instructor': {
                            'client': instructorClient
                          },
                          'regularOtherCourse': {
                            'client': regularOtherCourseClient,
                            'me': regularOtherCourseMe
                          },
                          'instructorOtherCourse': {
                            'client': instructorOtherCourseClient
                          }
                        };

                        return callback(users, course, otherCourse);
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
  };

  describe('Create new whiteboard', function() {

    /**
     * Test that verifies that a new whiteboard can be created
     */
    it('can be created', function(callback) {
      setUpUsers(function(users, course, otherCourse) {

        // Create a whiteboard with no additional members
        WhiteboardsTestUtil.assertCreateWhiteboard(users.creator.client, course, 'UC Berkeley Whiteboard', null, function(whiteboard1) {
          // Create a whiteboard with a single additional member
          WhiteboardsTestUtil.assertCreateWhiteboard(users.creator.client, course, 'UC Davis Whiteboard', users.regularA.me.id, function(whiteboard2) {
            // Create a whiteboard with a single additional member and the current user
            WhiteboardsTestUtil.assertCreateWhiteboard(users.creator.client, course, 'UC Davis Whiteboard', [users.creator.me.id, users.regularA.me.id], function(whiteboard2) {
              // Create a whiteboard with multiple additional members
              WhiteboardsTestUtil.assertCreateWhiteboard(users.creator.client, course, 'UC Merced Whiteboard', [users.regularA.me.id, users.regularB.me.id], function(whiteboard3) {

                return callback();
              });
            });
          });
        });
      });
    });

    /**
     * Test that verifies validation when creating a new whiteboard
     */
    it('is validated', function(callback) {
      setUpUsers(function(users, course, otherCourse) {

        // Missing title
        WhiteboardsTestUtil.assertCreateWhiteboardFails(users.creator.client, course, null, null, 400, function() {
          // Too long title
          WhiteboardsTestUtil.assertCreateWhiteboardFails(users.creator.client, course, randomstring.generate(256), null, 400, function() {

            // Invalid user
            WhiteboardsTestUtil.assertCreateWhiteboardFails(users.creator.client, course, 'UC Berkeley Whiteboard', 'invalid', 400, function() {
              WhiteboardsTestUtil.assertCreateWhiteboardFails(users.creator.client, course, 'UC Berkeley Whiteboard', 4242, 404, function() {
                WhiteboardsTestUtil.assertCreateWhiteboardFails(users.creator.client, course, 'UC Berkeley Whiteboard', [users.regularA.me.id, 'invalid'], 400, function() {
                  WhiteboardsTestUtil.assertCreateWhiteboardFails(users.creator.client, course, 'UC Berkeley Whiteboard', [users.regularA.me.id.id, 4242], 404, function() {

                    // User from different course
                    WhiteboardsTestUtil.assertCreateWhiteboardFails(users.creator.client, course, 'UC Berkeley Whiteboard', users.regularOtherCourse.me.id, 404, function() {
                      WhiteboardsTestUtil.assertCreateWhiteboardFails(users.creator.client, course, 'UC Berkeley Whiteboard', [users.regularA.me.id, users.regularOtherCourse.me.id], 404, function() {

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

  describe('Get whiteboard', function() {

    /**
     * Test that verifies that a whiteboard can be retrieved
     */
    it('can be retrieved', function(callback) {
      setUpUsers(function(users, course, otherCourse) {

        // Create a whiteboard with no additional members
        WhiteboardsTestUtil.assertCreateWhiteboard(users.creator.client, course, 'UC Berkeley Whiteboard', null, function(whiteboard1) {
          WhiteboardsTestUtil.assertGetWhiteboard(users.creator.client, course, whiteboard1.id, whiteboard1, 1, function(whiteboard1) {

            // Create a whiteboard with the current user explicitly provided
            WhiteboardsTestUtil.assertCreateWhiteboard(users.creator.client, course, 'UC Davis Whiteboard', users.creator.me.id, function(whiteboard2) {
              WhiteboardsTestUtil.assertGetWhiteboard(users.creator.client, course, whiteboard2.id, whiteboard2, 1, function(whiteboard2) {

                // Create a whiteboard with additional members
                WhiteboardsTestUtil.assertCreateWhiteboard(users.creator.client, course, 'UC Merced Whiteboard', [users.regularA.me.id], function(whiteboard3) {
                  WhiteboardsTestUtil.assertGetWhiteboard(users.creator.client, course, whiteboard3.id, whiteboard3, 2, function(whiteboard3) {

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
     * Test that verifies validation when retrieving a whiteboard
     */
    it('is validated', function(callback) {
      setUpUsers(function(users, course, otherCourse) {
        WhiteboardsTestUtil.assertCreateWhiteboard(users.creator.client, course, 'UC Berkeley Whiteboard', null, function(whiteboard) {

          // Invalid whiteboard id
          WhiteboardsTestUtil.assertGetWhiteboardFails(users.creator.client, course, 'Not a number', 400, function() {
            WhiteboardsTestUtil.assertGetWhiteboardFails(users.creator.client, course, -1, 404, function() {
              WhiteboardsTestUtil.assertGetWhiteboardFails(users.creator.client, course, 234234233, 404, function() {

                return callback();
              });
            });
          });
        });
      });
    });

    /**
     * Test that verifies authorization when retrieving a whiteboard
     */
    it('verifies whiteboard retrieval authorization', function(callback) {
      setUpUsers(function(users, course, otherCourse) {

        WhiteboardsTestUtil.assertCreateWhiteboard(users.creator.client, course, 'UC Berkeley Whiteboard', users.regularA.me.id, function(whiteboard) {

          // Verify that a user that is not member can not retrieve the whiteboard
          WhiteboardsTestUtil.assertGetWhiteboardFails(users.regularB.client, course, whiteboard.id, 404, function() {

            // Verify that a user that is a member can retrieve the whiteboard
            WhiteboardsTestUtil.assertGetWhiteboard(users.regularA.client, course, whiteboard.id, whiteboard, 2, function(whiteboard) {

              // Verify that the user that created whiteboard can retrieve whiteboard
              WhiteboardsTestUtil.assertGetWhiteboard(users.creator.client, course, whiteboard.id, whiteboard, 2, function(whiteboard) {

                // Verify that a course instructor that is not a member can retrieve the whiteboard
                WhiteboardsTestUtil.assertGetWhiteboard(users.instructor.client, course, whiteboard.id, whiteboard, 2, function(whiteboard) {

                  // Verify that a whiteboard from a different course can not be retrieved
                  WhiteboardsTestUtil.assertGetWhiteboardFails(users.regularOtherCourse.client, otherCourse, whiteboard.id, 404, function() {

                    // Verify that a course instructor can not retrieve a whiteboard from a different course
                    WhiteboardsTestUtil.assertGetWhiteboardFails(users.instructorOtherCourse.client, otherCourse, whiteboard.id, 404, function() {

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

  describe('Get whiteboards', function() {

    /**
     * Test that verifies that the whiteboards in a course can be retrieved
     */
    it('can be retrieved', function(callback) {
      setUpUsers(function(users, course, otherCourse) {

        // Retrieve the empty whiteboards list
        WhiteboardsTestUtil.assertGetWhiteboards(users.creator.client, course, null, null, null, 0, function(whiteboards) {

          // Create a whiteboard
          WhiteboardsTestUtil.assertCreateWhiteboard(users.creator.client, course, 'UC Berkeley Whiteboard', users.regularA.me.id, function(whiteboard1) {
            // Verify that the whiteboard is returned for the creator
            WhiteboardsTestUtil.assertGetWhiteboards(users.creator.client, course, null, null, null, 1, function(whiteboards) {
              WhiteboardsTestUtil.assertWhiteboard(whiteboards.results[0], {'expectedWhiteboard': whiteboard1});
              // Verify that the whiteboard is returned for the other member
              WhiteboardsTestUtil.assertGetWhiteboards(users.regularA.client, course, null, null, null, 1, function(whiteboards) {
                WhiteboardsTestUtil.assertWhiteboard(whiteboards.results[0], {'expectedWhiteboard': whiteboard1});
                // Verify that the whiteboard is not returned for a user that isn't a member
                WhiteboardsTestUtil.assertGetWhiteboards(users.regularB.client, course, null, null, null, 0, function(whiteboards) {
                  // Verify that the whiteboard is returned for a course instructor
                  WhiteboardsTestUtil.assertGetWhiteboards(users.instructor.client, course, null, null, null, 1, function(whiteboards) {
                    WhiteboardsTestUtil.assertWhiteboard(whiteboards.results[0], {'expectedWhiteboard': whiteboard1});

                    // Create a second whiteboard as a different user
                    WhiteboardsTestUtil.assertCreateWhiteboard(users.regularA.client, course, 'UC Davis Whiteboard', users.regularB.me.id, function(whiteboard2) {
                      // Verify that the first user only has a single whiteboard
                      WhiteboardsTestUtil.assertGetWhiteboards(users.creator.client, course, null, null, null, 1, function(whiteboards) {
                        WhiteboardsTestUtil.assertWhiteboard(whiteboards.results[0], {'expectedWhiteboard': whiteboard1});
                        // Verify that the second user now has 2 whiteboards. The results are expected to return in descending creation date order
                        WhiteboardsTestUtil.assertGetWhiteboards(users.regularA.client, course, null, null, null, 2, function(whiteboards) {
                          WhiteboardsTestUtil.assertWhiteboard(whiteboards.results[0], {'expectedWhiteboard': whiteboard2});
                          WhiteboardsTestUtil.assertWhiteboard(whiteboards.results[1], {'expectedWhiteboard': whiteboard1});
                          // Verify that the third user has a single whiteboard
                          WhiteboardsTestUtil.assertGetWhiteboards(users.regularB.client, course, null, null, null, 1, function(whiteboards) {
                            WhiteboardsTestUtil.assertWhiteboard(whiteboards.results[0], {'expectedWhiteboard': whiteboard2});
                            // Verify that the course instructor has all whiteboards. The results are expected to return in descending creation date order
                            WhiteboardsTestUtil.assertGetWhiteboards(users.instructor.client, course, null, null, null, 2, function(whiteboards) {
                              WhiteboardsTestUtil.assertWhiteboard(whiteboards.results[0], {'expectedWhiteboard': whiteboard2});
                              WhiteboardsTestUtil.assertWhiteboard(whiteboards.results[1], {'expectedWhiteboard': whiteboard1});

                              // Verify that the created whiteboards don't show in a different course
                              WhiteboardsTestUtil.assertGetWhiteboards(users.instructorOtherCourse.client, otherCourse, null, null, null, 0, function(whiteboards) {

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
     * Test that verifies online user counts for whiteboards
     */
    it('counts other online whiteboard users', function(callback) {
      setUpUsers(function(users, course, otherCourse) {

        // Create a whiteboard
        WhiteboardsTestUtil.assertCreateWhiteboard(users.creator.client, course, 'UC Berkeley Whiteboard', [users.regularA.me.id, users.regularB.me.id], function(whiteboard) {

          // First user starts a whiteboard session
          WhiteboardsTestUtil.assertCreateWhiteboardSession(users.regularA.client, course, whiteboard.id, 'socket_id', function() {
            // Second user sees one user online
            WhiteboardsTestUtil.assertGetWhiteboards(users.regularB.client, course, null, null, null, 1, function(whiteboards) {
              WhiteboardsTestUtil.assertWhiteboard(whiteboards.results[0], {'expectedOnlineCount': 1});
              // First user sees one user online
              WhiteboardsTestUtil.assertGetWhiteboards(users.regularA.client, course, null, null, null, 1, function(whiteboards) {
                WhiteboardsTestUtil.assertWhiteboard(whiteboards.results[0], {'expectedOnlineCount': 1});

                // First user starts a second whiteboard session
                WhiteboardsTestUtil.assertCreateWhiteboardSession(users.regularA.client, course, whiteboard.id, 'socket_id_2', function() {
                  // Second user sees only one user online
                  WhiteboardsTestUtil.assertGetWhiteboards(users.regularB.client, course, null, null, null, 1, function(whiteboards) {
                    WhiteboardsTestUtil.assertWhiteboard(whiteboards.results[0], {'expectedOnlineCount': 1});

                    // Second user starts a whiteboard session
                    WhiteboardsTestUtil.assertCreateWhiteboardSession(users.regularB.client, course, whiteboard.id, 'socket_id_3', function() {
                      // First user sees two users online
                      WhiteboardsTestUtil.assertGetWhiteboards(users.regularA.client, course, null, null, null, 1, function(whiteboards) {
                        WhiteboardsTestUtil.assertWhiteboard(whiteboards.results[0], {'expectedOnlineCount': 2});

                        // Instructor, not a whiteboard member, starts a whiteboard session
                        WhiteboardsTestUtil.assertCreateWhiteboardSession(users.instructor.client, course, whiteboard.id, 'socket_id_4', function() {
                          // First user sees only two users online
                          WhiteboardsTestUtil.assertGetWhiteboards(users.regularA.client, course, null, null, null, 1, function(whiteboards) {
                            WhiteboardsTestUtil.assertWhiteboard(whiteboards.results[0], {'expectedOnlineCount': 2});

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
     * Test that verifies that whiteboards don't disappear when new whiteboards are added
     */
    it('verify retrieving whiteboards when adding new ones', function(callback) {
      // Generate a number of test whiteboards for a course
      setUpUsers(function(users, course, otherCourse) {

        // The first user generates some whiteboards
        TestsUtil.generateTestWhiteboards(users.regularA.client, course, 12, function(whiteboardsA) {
          // The results are expected to return in descending creation date order
          whiteboardsA = _.sortBy(whiteboardsA, 'id').reverse();

          // A second user generates more than 10 whiteboards. For this test case, it's important we
          // generate more whiteboards than the default page limit.
          TestsUtil.generateTestWhiteboards(users.regularB.client, course, 12, function(whiteboardsB) {
            // The results are expected to return in descending creation date order
            whiteboardsB = _.sortBy(whiteboardsB, 'id').reverse();

            // Assert that both users can still retrieve their own whiteboards
            WhiteboardsTestUtil.assertGetWhiteboards(users.regularA.client, course, null, null, null, 12, function(pagedWhiteboardsA) {
              assert.strictEqual(pagedWhiteboardsA.total, 12);
              assert.strictEqual(pagedWhiteboardsA.results.length, 10);
              _.each(pagedWhiteboardsA.results, function(pagedWhiteboard, index) {
                WhiteboardsTestUtil.assertWhiteboard(pagedWhiteboard, {'expectedWhiteboard': whiteboardsA[index]});
              });

              WhiteboardsTestUtil.assertGetWhiteboards(users.regularB.client, course, null, null, null, 12, function(pagedWhiteboardsB) {
                assert.strictEqual(pagedWhiteboardsB.total, 12);
                assert.strictEqual(pagedWhiteboardsB.results.length, 10);
                _.each(pagedWhiteboardsB.results, function(pagedWhiteboard, index) {
                  WhiteboardsTestUtil.assertWhiteboard(pagedWhiteboard, {'expectedWhiteboard': whiteboardsB[index]});
                });
                return callback();
              });
            });
          });
        });
      });
    });

    /**
     * Test that verifies that the whiteboards in a course can be paged
     */
    it('can be paged', function(callback) {
      // Generate a number of test whiteboards for a course
      setUpUsers(function(users, course, otherCourse) {
        TestsUtil.generateTestWhiteboards(users.creator.client, course, 12, function(whiteboards) {

          // The results are expected to return in descending creation date order
          whiteboards = _.sortBy(whiteboards, 'id').reverse();

          // Verify that the page size defaults to 10 and the page defaults to the first page
          WhiteboardsTestUtil.assertGetWhiteboards(users.creator.client, course, null, null, null, 12, function(pagedWhiteboards) {
            assert.strictEqual(pagedWhiteboards.results.length, 10);
            _.each(pagedWhiteboards.results, function(pagedWhiteboard, index) {
              WhiteboardsTestUtil.assertWhiteboard(pagedWhiteboard, {'expectedWhiteboard': whiteboards[index]});
            });

            // Verify that the second page can be retrieved
            WhiteboardsTestUtil.assertGetWhiteboards(users.creator.client, course, null, null, 10, 12, function(pagedWhiteboards) {
              assert.strictEqual(pagedWhiteboards.results.length, 2);
              _.each(pagedWhiteboards.results, function(pagedWhiteboard, index) {
                WhiteboardsTestUtil.assertWhiteboard(pagedWhiteboard, {'expectedWhiteboard': whiteboards[10 + index]});
              });

              // Verify that a custom page size can be specified
              WhiteboardsTestUtil.assertGetWhiteboards(users.creator.client, course, null, 5, null, 12, function(pagedWhiteboards) {
                assert.strictEqual(pagedWhiteboards.results.length, 5);
                _.each(pagedWhiteboards.results, function(pagedWhiteboard, index) {
                  WhiteboardsTestUtil.assertWhiteboard(pagedWhiteboard, {'expectedWhiteboard': whiteboards[index]});
                });
                // Get the second page using the custom page size
                WhiteboardsTestUtil.assertGetWhiteboards(users.creator.client, course, null, 5, 5, 12, function(pagedWhiteboards) {
                  assert.strictEqual(pagedWhiteboards.results.length, 5);
                  _.each(pagedWhiteboards.results, function(pagedWhiteboard, index) {
                    WhiteboardsTestUtil.assertWhiteboard(pagedWhiteboard, {'expectedWhiteboard': whiteboards[5 + index]});
                  });
                  // Get the last page using the custom page size
                  WhiteboardsTestUtil.assertGetWhiteboards(users.creator.client, course, null, 5, 10, 12, function(pagedWhiteboards) {
                    assert.strictEqual(pagedWhiteboards.results.length, 2);
                    _.each(pagedWhiteboards.results, function(pagedWhiteboard, index) {
                      WhiteboardsTestUtil.assertWhiteboard(pagedWhiteboard, {'expectedWhiteboard': whiteboards[10 + index]});
                    });
                    // Verify that further pages will be empty
                    WhiteboardsTestUtil.assertGetWhiteboards(users.creator.client, course, null, 5, 15, 12, function(pagedWhiteboards) {
                      assert.strictEqual(pagedWhiteboards.results.length, 0);

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
   * Verify that searching through whiteboards returns the expected whiteboards
   *
   * @param  {RestClient}         client                    The REST client to make the request with
   * @param  {Course}             course                    The Canvas course in which the user is interacting with the API
   * @param  {Object}             [filters]                 A set of options to filter the results by
   * @param  {String}             [filters.keywords]        String filter for whiteboard title
   * @param  {Number}             [filters.user]            The id of a user associated with the whiteboardss
   * @param  {Whiteboard[]}       expectedWhiteboards       The expected whiteboards
   * @param  {Function}           callback                  Standard callback function
   * @throws {AssertionError}                               Error thrown when an assertion failed
   * @api private
   */
  var verifySearch = function(client, course, filters, expectedWhiteboards, callback) {
    WhiteboardsTestUtil.assertGetWhiteboards(client, course, filters, null, null, expectedWhiteboards.length, function(whiteboards) {
      expectedWhiteboards = _.sortBy(expectedWhiteboards, 'id').reverse();

      // The 'total' value should always equal the total count of expected whiteboards
      assert.strictEqual(whiteboards.total, expectedWhiteboards.length);

      // If there are more than 10 expected whiteboards, only the first 10 should be included in
      // paged results
      if (expectedWhiteboards.length < 10) {
        assert.strictEqual(whiteboards.results.length, expectedWhiteboards.length);
      } else {
        assert.strictEqual(whiteboards.results.length, 10);
      }

      _.each(whiteboards.results, function(whiteboard, i) {
        WhiteboardsTestUtil.assertWhiteboard(whiteboard, {'expectedWhiteboard': expectedWhiteboards[i]});
      });
      return callback();
    });
  };

  /**
   * Test that verifies that whiteboards can be searched through
   */
  it('can be searched through', function(callback) {
    setUpUsers(function(users, course, otherCourse) {

      // Two users generate many inital whiteboards to test paging limit
      TestsUtil.generateTestWhiteboards(users.regularA.client, course, 12, function(whiteboardsA) {
        TestsUtil.generateTestWhiteboards(users.regularB.client, course, 12, function(whiteboardsB) {

          // First user creates a private whiteboard
          WhiteboardsTestUtil.assertCreateWhiteboard(users.regularA.client, course, 'Private Berkeley board', [users.regularA.me.id], function(privateBerkeleyBoard) {
            whiteboardsA.push(privateBerkeleyBoard);

            // Second user creates a private whiteboard
            WhiteboardsTestUtil.assertCreateWhiteboard(users.regularB.client, course, 'Private Davis board', [users.regularB.me.id], function(privateDavisBoard) {
              whiteboardsB.push(privateDavisBoard);

              // Each user creates one whiteboard shared with the other
              WhiteboardsTestUtil.assertCreateWhiteboard(users.regularA.client, course, 'Shared Berkeley board', [users.regularA.me.id, users.regularB.me.id], function(sharedBerkeleyBoard) {
                WhiteboardsTestUtil.assertCreateWhiteboard(users.regularB.client, course, 'Shared Davis board', [users.regularA.me.id, users.regularB.me.id], function(sharedDavisBoard) {
                  var whiteboardsShared = [sharedBerkeleyBoard, sharedDavisBoard];

                  // When no search filters are specified, a regular user should see all their whiteboards
                  verifySearch(users.regularA.client, course, null, whiteboardsA.concat(whiteboardsShared), function() {
                    verifySearch(users.regularB.client, course, null, whiteboardsB.concat(whiteboardsShared), function() {

                      // When keyword filters are applied, a regular user should see only their whiteboards with matching titles
                      verifySearch(users.regularA.client, course, {'keywords': 'Berkeley'}, [privateBerkeleyBoard, sharedBerkeleyBoard], function() {
                        verifySearch(users.regularB.client, course, {'keywords': 'Davis'}, [privateDavisBoard, sharedDavisBoard], function() {
                          verifySearch(users.regularA.client, course, {'keywords': 'Davis'}, [sharedDavisBoard], function() {
                            verifySearch(users.regularB.client, course, {'keywords': 'Berkeley'}, [sharedBerkeleyBoard], function() {

                              // An administrator should be able to see all whiteboards associated with a user
                              verifySearch(users.instructor.client, course, {'user': users.regularA.me.id}, whiteboardsA.concat(whiteboardsShared), function() {
                                verifySearch(users.instructor.client, course, {'user': users.regularB.me.id}, whiteboardsB.concat(whiteboardsShared), function() {

                                  // An administrator should be able to see all whiteboards with titles matching a keyword
                                  verifySearch(users.instructor.client, course, {'keywords': 'Berkeley'}, [privateBerkeleyBoard, sharedBerkeleyBoard], function() {
                                    verifySearch(users.instructor.client, course, {'keywords': 'Davis'}, [privateDavisBoard, sharedDavisBoard], function() {

                                      // An administrator should be able to filter by user and keyword both
                                      verifySearch(users.instructor.client, course, {'user': users.regularA.me.id, 'keywords': 'Berkeley'}, [privateBerkeleyBoard, sharedBerkeleyBoard], function() {
                                        verifySearch(users.instructor.client, course, {'user': users.regularA.me.id, 'keywords': 'Davis'}, [sharedDavisBoard], function() {
                                          verifySearch(users.instructor.client, course, {'user': users.regularB.me.id, 'keywords': 'Berkeley'}, [sharedBerkeleyBoard], function() {
                                            verifySearch(users.instructor.client, course, {'user': users.regularB.me.id, 'keywords': 'Davis'}, [privateDavisBoard, sharedDavisBoard], function() {

                                              // Keywords matching nothing should return empty
                                              verifySearch(users.regularA.client, course, {'keywords': 'This matches nothing'}, [], function() {
                                                // Keywords matching nothing for a regular user should return empty
                                                verifySearch(users.regularA.client, course, {'keywords': 'Private Davis'}, [], function() {
                                                  // Keywords matching nothing within a user filter should return empty
                                                  verifySearch(users.instructor.client, course, {'user': users.regularA.me.id, 'keywords': 'Private Davis'}, [], function() {

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
    });
  });

  describe('Edit whiteboard', function() {

    /**
     * Test that verifies that a whiteboard can be edited
     */
    it('can be edited', function(callback) {
      setUpUsers(function(users, course, otherCourse) {

        // Verify that the title and the members can be updated
        WhiteboardsTestUtil.assertCreateWhiteboard(users.creator.client, course, 'UC Berkeley Whiteboard', users.regularA.me.id, function(whiteboard) {
          WhiteboardsTestUtil.assertEditWhiteboard(users.creator.client, course, whiteboard.id, 'UC Davis Whiteboard', [users.creator.me.id, users.regularB.me.id], function(whiteboard) {

            return callback();
          });
        });
      });
    });

    /**
     * Test that verifies validation when editing a whiteboard
     */
    it('is validated', function(callback) {
      setUpUsers(function(users, course, otherCourse) {

        WhiteboardsTestUtil.assertCreateWhiteboard(users.creator.client, course, 'UC Berkeley Whiteboard', users.regularA.me.id, function(whiteboard) {

          // Invalid whiteboard id
          WhiteboardsTestUtil.assertEditWhiteboardFails(users.creator.client, course, 'Not a number', 'UC Davis Whiteboard', [users.creator.me.id, users.regularA.me.id], 400, function() {
            WhiteboardsTestUtil.assertEditWhiteboardFails(users.creator.client, course, -1, 'UC Davis Whiteboard', [users.creator.me.id, users.regularA.me.id], 404, function() {
              WhiteboardsTestUtil.assertEditWhiteboardFails(users.creator.client, course, 234234233, 'UC Davis Whiteboard', [users.creator.me.id, users.regularA.me.id], 404, function() {

                // Missing title
                WhiteboardsTestUtil.assertEditWhiteboardFails(users.creator.client, course, whiteboard.id, null, [users.creator.me.id.id, users.regularA.me.id], 400, function() {
                  WhiteboardsTestUtil.assertEditWhiteboardFails(users.creator.client, course, whiteboard.id, '', [users.creator.me.id.id, users.regularA.me.id], 400, function() {
                    // Too long title
                    WhiteboardsTestUtil.assertEditWhiteboardFails(users.creator.client, course, whiteboard.id, randomstring.generate(256), [users.creator.me.id.id, users.regularA.me.id], 400, function() {

                      // Invalid user
                      WhiteboardsTestUtil.assertEditWhiteboardFails(users.creator.client, course, whiteboard.id, 'UC Davis Whiteboard', [users.creator.me.id, 'invalid'], 400, function() {
                        WhiteboardsTestUtil.assertEditWhiteboardFails(users.creator.client, course, whiteboard.id, 'UC Davis Whiteboard', [users.creator.me.id, 4242], 404, function() {

                          // User from different course
                          WhiteboardsTestUtil.assertEditWhiteboardFails(users.creator.client, course, whiteboard.id, 'UC Davis Whiteboard', [users.creator.me.id, users.regularOtherCourse.me.id], 404, function() {

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
     * Test that verifies authorization when editing a whiteboard
     */
    it('verifies authorization', function(callback) {
      setUpUsers(function(users, course, otherCourse) {

        WhiteboardsTestUtil.assertCreateWhiteboard(users.creator.client, course, 'UC Berkeley Whiteboard', users.regularA.me.id, function(whiteboard) {

          // Verify that the whiteboard can be edited by the user that created the whiteboard
          WhiteboardsTestUtil.assertEditWhiteboard(users.creator.client, course, whiteboard.id, 'UC Davis Whiteboard', [users.creator.me.id, users.regularA.me.id], function(whiteboard) {

            // Verify that the whiteboard can be edited by a different member of the whiteboard
            WhiteboardsTestUtil.assertEditWhiteboard(users.regularA.client, course, whiteboard.id, 'UC Merced Whiteboard', [users.creator.me.id, users.regularA.me.id], function(whiteboard) {

              // Verify that the whiteboard can be edited by an instructor of the course
              WhiteboardsTestUtil.assertEditWhiteboard(users.instructor.client, course, whiteboard.id, 'UC Santa Cruz Whiteboard', [users.creator.me.id, users.regularA.me.id], function(whiteboard) {

                // Verify that the whiteboard can not be edited by a different regular user
                WhiteboardsTestUtil.assertEditWhiteboardFails(users.regularB.client, course, whiteboard.id, 'UCLA Whiteboard', [users.creator.me.id, users.regularB.me.id], 404, function() {

                  // Verify that an instructor in a different course can not edit the whiteboard
                  WhiteboardsTestUtil.assertEditWhiteboardFails(users.instructorOtherCourse.client, otherCourse, whiteboard.id, 'UCLA Whiteboard', [users.creator.me.id, users.regularB.me.id], 404, function() {

                    // Verify that the whiteboard has not been updated
                    WhiteboardsTestUtil.assertGetWhiteboard(users.creator.client, course, whiteboard.id, whiteboard, 2, function(whiteboard) {

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

  describe('Delete whiteboard', function() {

    /**
     * Test that verifies a whiteboard can be deleted
     */
    it('can be deleted', function(callback) {
      setUpUsers(function(users, course, otherCourse) {
        WhiteboardsTestUtil.assertCreateWhiteboard(users.creator.client, course, 'UC Berkeley Whiteboard', users.regularA.me.id, function(whiteboard) {

          // Verify that a collaborator can delete the whiteboard
          WhiteboardsTestUtil.assertDeleteWhiteboard(users.regularA.client, course, whiteboard.id, function() {

            // Verify that regular users cannot see the whiteboard
            WhiteboardsTestUtil.assertGetWhiteboardFails(users.regularA.client, course, whiteboard.id, 404, function() {

              // Verify that an administrator can still see the whiteboard
              WhiteboardsTestUtil.assertGetWhiteboard(users.instructor.client, course, whiteboard.id, whiteboard, 2, function() {

                // Verify that regular users see an empty whiteboards list
                WhiteboardsTestUtil.assertGetWhiteboards(users.regularA.client, course, null, null, null, 0, function(whiteboards) {

                  // Verify that an administrator sees an empty whiteboards list by default
                  WhiteboardsTestUtil.assertGetWhiteboards(users.instructor.client, course, null, null, null, 0, function(whiteboards) {

                    // Verify that an administrator can request deleted whiteboards and receives the expected board
                    WhiteboardsTestUtil.assertGetWhiteboards(users.instructor.client, course, {'includeDeleted': true}, null, null, 1, function(whiteboards) {
                      WhiteboardsTestUtil.assertWhiteboard(whiteboards.results[0], {'expectedWhiteboard': whiteboard});

                      // Verify that regular users cannot request deleted whiteboards
                      WhiteboardsTestUtil.assertGetWhiteboards(users.regularA.client, course, {'includeDeleted': true}, null, null, 0, function(whiteboards) {
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
     * Test that verifies that a non-collaborator cannot delete a whiteboard
     */
    it('verifies authorization', function(callback) {
      setUpUsers(function(users, course, otherCourse) {
        WhiteboardsTestUtil.assertCreateWhiteboard(users.creator.client, course, 'UC Berkeley Whiteboard', users.regularA.me.id, function(whiteboard) {

          // Verify that a non-collaborator cannot delete the whiteboard
          WhiteboardsTestUtil.assertDeleteWhiteboardFails(users.regularB.client, course, whiteboard.id, 404, function() {

            return callback();
          });
        });
      });
    });
  });

  describe('Restore whiteboard', function() {

    /**
     * Test that verifies that a deleted whiteboard can be restored
     */
    it('can be restored', function(callback) {
      setUpUsers(function(users, course, otherCourse) {
        // Create and delete a whitebaord
        WhiteboardsTestUtil.assertCreateWhiteboard(users.creator.client, course, 'UC Berkeley Whiteboard', users.regularA.me.id, function(whiteboard) {
          WhiteboardsTestUtil.assertDeleteWhiteboard(users.creator.client, course, whiteboard.id, function() {

            // Verify that an administrator can restore the whiteboard
            WhiteboardsTestUtil.assertRestoreWhiteboard(users.instructor.client, course, whiteboard.id, function() {

              // Verify that the creator can now see the whiteboard
              WhiteboardsTestUtil.assertGetWhiteboard(users.creator.client, course, whiteboard.id, whiteboard, 2, function() {

                return callback();
              });
            });
          });
        });
      });
    });

    /**
     * Test that verifies authorization when restoring a whiteboard
     */
    it('verifies authorization', function(callback) {
      setUpUsers(function(users, course, otherCourse) {
        // Create and delete a whitebaord
        WhiteboardsTestUtil.assertCreateWhiteboard(users.creator.client, course, 'UC Berkeley Whiteboard', users.regularA.me.id, function(whiteboard) {
          WhiteboardsTestUtil.assertDeleteWhiteboard(users.creator.client, course, whiteboard.id, function() {

            // Verify that a non-administrator cannot restore the whiteboard
            WhiteboardsTestUtil.assertRestoreWhiteboardFails(users.creator.client, course, whiteboard.id, 401, function() {

              return callback();
            });
          });
        });
      });
    });
  });

  describe('Export a whiteboard to a PNG file', function() {

    /**
     * Test that verifies that the whiteboard can be exported to a PNG file
     */
    it('can be exported', function(callback) {
      setUpUsers(function(users, course, otherCourse) {

        WhiteboardsTestUtil.assertCreateWhiteboard(users.creator.client, course, 'UC Berkeley Whiteboard', users.regularA.me.id, function(whiteboard) {

          // Ensure an empty board can not be exported
          WhiteboardsTestUtil.assertExportWhiteboardToPngFails(users.creator.client, course, whiteboard.id, 400, function() {

            // Add a few elements to the whiteboard
            WhiteboardsTestUtil.addElementsToWhiteboard(users.creator.client, course, whiteboard, function() {

              // Verify that the whiteboard can be exported to a PNG file
              WhiteboardsTestUtil.assertExportWhiteboardToPng(users.creator.client, course, whiteboard.id, function(data) {
                return callback();
              });
            });
          });
        });
      });
    });

    /**
     * Test that verifies authorization when exporting a whiteboard to a PNG file
     */
    it('verifies authorization', function(callback) {
      setUpUsers(function(users, course, otherCourse) {

        // Create a whiteboard with a few elements in it
        WhiteboardsTestUtil.assertCreateWhiteboardWithElements(users.creator.client, course, 'UC Berkeley Whiteboard', users.regularA.me.id, function(whiteboard) {

          // Verify that a user that is not member can not export the whiteboard to a PNG file
          WhiteboardsTestUtil.assertExportWhiteboardToPngFails(users.regularB.client, course, whiteboard.id, 404, function() {

            // Verify that a user that is a member can export the whiteboard to a PNG file
            WhiteboardsTestUtil.assertExportWhiteboardToPng(users.regularA.client, course, whiteboard.id, function(data) {

              // Verify that the user that created whiteboard can export the whiteboard to a PNG file
              WhiteboardsTestUtil.assertExportWhiteboardToPng(users.creator.client, course, whiteboard.id, function(data) {

                // Verify that a course administrator that is not a member can export the whiteboard to a PNG file
                WhiteboardsTestUtil.assertExportWhiteboardToPng(users.instructor.client, course, whiteboard.id, function(data) {

                  // Verify that a whiteboard from a different course can not be exported to a PNG file
                  WhiteboardsTestUtil.assertExportWhiteboardToPngFails(users.regularOtherCourse.client, otherCourse, whiteboard.id, 404, function() {

                    // Verify that a course administrator can not export a whiteboard from a different course
                    WhiteboardsTestUtil.assertExportWhiteboardToPngFails(users.instructorOtherCourse.client, otherCourse, whiteboard.id, 404, function() {

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

  describe('Export a whiteboard to an asset', function() {

    /**
     * Test that verifies that the whiteboard can be exported to an asset
     */
    it('can be exported', function(callback) {
      setUpUsers(function(users, course, otherCourse) {

        WhiteboardsTestUtil.assertCreateWhiteboard(users.creator.client, course, 'UC Berkeley Whiteboard', users.regularA.me.id, function(whiteboard) {

          // Ensure an empty board can not be exported
          WhiteboardsTestUtil.assertExportWhiteboardToAssetFails(users.creator.client, course, whiteboard.id, null, null, 400, function() {

            // Add a few elements to the whiteboard
            WhiteboardsTestUtil.addElementsToWhiteboard(users.creator.client, course, whiteboard, function() {

              // Verify that the whiteboard can be exported to an asset
              WhiteboardsTestUtil.assertExportWhiteboardToAsset(users.creator.client, course, whiteboard.id, null, null, function(data) {

                // Create a file asset with optional metadata
                CategoriesTestUtil.assertCreateCategory(users.instructor.client, course, 'A category', function(category) {
                  var opts = {
                    'categories': [category.id],
                    'description': 'A board with 2 special things in it'
                  };
                  WhiteboardsTestUtil.assertExportWhiteboardToAsset(users.creator.client, course, whiteboard.id, 'A special board', opts, function(data) {
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
     * Test that verifies validation when exporting a whiteboard to an asset
     */
    it('verifies validation', function(callback) {
      setUpUsers(function(users, course, otherCourse) {

        // Create a whiteboard that has a few elements so it can be exported
        WhiteboardsTestUtil.assertCreateWhiteboardWithElements(users.creator.client, course, 'UC Berkeley Whiteboard', users.regularA.me.id, function(whiteboard) {

          // Invalid id
          WhiteboardsTestUtil.assertExportWhiteboardToAssetFails(users.creator.client, course, 'Not an id', null, null, 400, function() {
            WhiteboardsTestUtil.assertExportWhiteboardToAssetFails(users.creator.client, course, -1, null, null, 404, function() {
              WhiteboardsTestUtil.assertExportWhiteboardToAssetFails(users.creator.client, course, 123123123, null, null, 404, function() {

                // Too long title
                WhiteboardsTestUtil.assertExportWhiteboardToAssetFails(users.creator.client, course, whiteboard.id, randomstring.generate(256), null, 400, function() {

                  // Invalid categories
                  WhiteboardsTestUtil.assertExportWhiteboardToAssetFails(users.creator.client, course, whiteboard.id, null, {'categories': 'not a number'}, 400, function() {
                    WhiteboardsTestUtil.assertExportWhiteboardToAssetFails(users.creator.client, course, whiteboard.id, null, {'categories': ['not a number']}, 400, function() {
                      WhiteboardsTestUtil.assertExportWhiteboardToAssetFails(users.creator.client, course, whiteboard.id, null, {'categories': [-1]}, 404, function() {
                        WhiteboardsTestUtil.assertExportWhiteboardToAssetFails(users.creator.client, course, whiteboard.id, null, {'categories': [12321312]}, 404, function() {

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
     * Test that verifies authorization when exporting a whiteboard to an asset
     */
    it('verifies authorization', function(callback) {
      setUpUsers(function(users, course, otherCourse) {

        // Create a whiteboard with a few elements in it
        WhiteboardsTestUtil.assertCreateWhiteboardWithElements(users.creator.client, course, 'UC Berkeley Whiteboard', users.regularA.me.id, function(whiteboard) {

          // Verify that a user that is not member can not export the whiteboard to an asset
          WhiteboardsTestUtil.assertExportWhiteboardToAssetFails(users.regularB.client, course, whiteboard.id, null, null, 404, function() {

            // Verify that a user that is a member can export the whiteboard to an asset
            WhiteboardsTestUtil.assertExportWhiteboardToAsset(users.regularA.client, course, whiteboard.id, null, null, function(asset) {

              // Verify that the user that created the whiteboard can export the whiteboard to an asset
              WhiteboardsTestUtil.assertExportWhiteboardToAsset(users.creator.client, course, whiteboard.id, null, null, function(asset) {

                // Verify that a course administrator that is not a member can export the whiteboard to a PNG file
                WhiteboardsTestUtil.assertExportWhiteboardToAsset(users.instructor.client, course, whiteboard.id, null, null, function(asset) {

                  // Verify that a whiteboard from a different course can not be exported to an asset
                  WhiteboardsTestUtil.assertExportWhiteboardToAssetFails(users.regularOtherCourse.client, otherCourse, whiteboard.id, null, null, 404, function() {

                    // Verify that a course administrator can not export a whiteboard from a different course
                    WhiteboardsTestUtil.assertExportWhiteboardToAssetFails(users.instructorOtherCourse.client, otherCourse, whiteboard.id, null, null, 404, function() {

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

  describe('Whiteboard emails', function() {

    /**
     * Test that verifies that whiteboard emails are only sent once
     */
    it('sends an email once', function() {
      setUpUsers(function(users, course, otherCourse) {

        TestsUtil.setExpectedEmail(users.creator.me.id, 0);
        TestsUtil.setExpectedEmail(users.regularA.me.id, 1);
        TestsUtil.setExpectedEmail(users.regularB.me.id, 1);
        TestsUtil.setExpectedEmail(users.instructor.me.id, 0);
        TestsUtil.setExpectedEmail(users.regularOtherCourse.me.id, 0);
        TestsUtil.setExpectedEmail(users.instructorOtherCourse.me.id, 0);

        // Create a whiteboard with a single additional member
        WhiteboardsTestUtil.assertCreateWhiteboard(users.creator.client, course, 'UC Davis Whiteboard', users.regularA.me.id, function(whiteboard) {

          // Share the whiteboard with 2 more people
          WhiteboardsTestUtil.assertEditWhiteboard(users.creator.client, course, whiteboard.id, 'UC Davis Whiteboard', [users.creator.me.id, users.regularA.me.id, users.regularB.me.id], function(whiteboard) {

            return callback();
          });
        });
      });
    });
  });
});

// TODO: Test whiteboard online
