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
var moment = require('moment-timezone');

var AssetsTestUtil = require('col-assets/tests/util');
var CourseTestUtil = require('col-course/tests/util');
var DB = require('col-core/lib/db');
var TestsUtil = require('col-tests');
var UsersTestsUtil = require('col-users/tests/util');
var WhiteboardsTestUtil = require('col-whiteboards/tests/util');

var ActivitiesAPI = require('col-activities');
var ActivitiesUtil = require('col-activities/lib/util');
var ActivitiesTestUtil = require('./util');

describe('Activity Points', function() {

  /**
   * Test that verifies that users do not earn points for disabled activities
   */
  it('does not update the points for disabled activities', function(callback) {
    TestsUtil.getAssetLibraryClient(null, null, null, function(client1, course, user1) {
      TestsUtil.getAssetLibraryClient(null, course, null, function(client2, course, user2) {
        TestsUtil.getAssetLibraryClient(null, course, null, function(client3, course, user3) {
          var instructorUser = TestsUtil.generateInstructor();
          TestsUtil.getAssetLibraryClient(null, course, instructorUser, function(instructorClient, course, instructorUser) {

            var activityTypeOverride = [{
              'type': 'add_asset',
              'enabled': false
            }];
            ActivitiesTestUtil.assertEditActivityTypeConfiguration(instructorClient, course, activityTypeOverride, function() {

              // As no activities have occurred yet, each user should have 0 points
              UsersTestsUtil.assertGetLeaderboard(instructorClient, course, 4, true, function(users) {
                _.each(users, function(user) {
                  assert.strictEqual(user.points, 0);
                });

                // Each user adds an asset
                AssetsTestUtil.assertCreateLink(client1, course, 'UC Davis', 'http://www.ucdavis.edu/', null, function(asset1) {
                  AssetsTestUtil.assertCreateLink(client2, course, 'UC Davis', 'http://www.ucdavis.edu/', null, function(asset2) {
                    AssetsTestUtil.assertCreateLink(client3, course, 'UC Davis', 'http://www.ucdavis.edu/', null, function(asset3) {

                      // Because we disabled the `add_asset`, each user should still have 0 points
                      UsersTestsUtil.assertGetLeaderboard(instructorClient, course, 4, true, function(users) {
                        _.each(users, function(user) {
                          assert.strictEqual(user.points, 0);
                        });

                        // Each user likes another asset
                        AssetsTestUtil.assertLike(client1, course, asset2.id, true, function() {
                          AssetsTestUtil.assertLike(client2, course, asset3.id, true, function() {
                            AssetsTestUtil.assertLike(client3, course, asset1.id, true, function() {

                              // As the `like` and `get_like` activities are still enabled, users should still earn points
                              ActivitiesTestUtil.assertGetActivityTypeConfiguration(instructorClient, course, function(configuration) {
                                var likePoints = _.find(configuration, {'type': 'like'}).points;
                                var getLikePoints = _.find(configuration, {'type': 'get_like'}).points;
                                UsersTestsUtil.assertGetLeaderboard(instructorClient, course, 4, true, function(users) {
                                  _.each(users, function(user) {
                                    if (!user.is_admin) {
                                      assert.strictEqual(user.points, likePoints + getLikePoints);
                                    }
                                  });

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

  describe('Create a new asset', function() {

    /**
     * Test that verifies that creating a new link asset updates the points for the creator
     */
    it('updates the points', function(callback) {
      TestsUtil.getAssetLibraryClient(null, null, null, function(client, course, user) {
        // Verify that creating a new link asset correctly updates the points
        ActivitiesTestUtil.assertCreateLinkActivity(client, course, 'UC Davis', 'http://www.ucdavis.edu/', null, function(asset1) {
          // Verify that creating another link asset correctly updates the points
          ActivitiesTestUtil.assertCreateLinkActivity(client, course, 'UC Berkeley', 'http://www.berkeley.edu/', null, function(asset2) {
            return callback();
          });
        });
      });
    });

    /**
     * Test that verifies that creating a hidden link asset does not update points for the creator
     */
    it('does not update points for hidden assets', function(callback) {
      TestsUtil.getAssetLibraryClient(null, null, null, function(client, course, user) {
        // Verify that creating a hidden link asset does not update the points
        ActivitiesTestUtil.assertCreateHiddenLink(client, course, 'UC Berkeley', 'http://www.berkeley.edu/', function(asset1) {
          return callback();
        });
      });
    });
  });

  describe('Viewing an asset', function() {

    /**
     * Test that verifies that viewing an asset updates points only when points are overridden
     */
    it('updates points only when points are overridden', function(callback) {
      TestsUtil.getAssetLibraryClient(null, null, null, function(client1, course, user) {
        ActivitiesTestUtil.assertCreateLinkActivity(client1, course, 'UC Davis', 'http://www.ucdavis.edu/', null, function(asset) {

          // Verify that viewing an asset does not update points by default
          TestsUtil.getAssetLibraryClient(null, course, null, function(client2, course, user2) {
            ActivitiesTestUtil.assertViewAssetActivity(client2, client1, course, asset.id, function() {

              // Assign points to asset view
              var instructorUser = TestsUtil.generateInstructor();
              TestsUtil.getAssetLibraryClient(null, course, instructorUser, function(instructorClient, course, instructorUser) {

                var activityTypeOverride = [{
                  'type': 'view_asset',
                  'points': 2
                }];
                ActivitiesTestUtil.assertEditActivityTypeConfiguration(instructorClient, course, activityTypeOverride, function() {

                  // Verify that viewing an asset now updates points
                  ActivitiesTestUtil.assertViewAssetActivity(client2, client1, course, asset.id, function() {

                    // Verify that a user viewing their own asset does not update points
                    ActivitiesTestUtil.assertViewAssetActivity(client1, client1, course, asset.id, function() {

                      // Assign points to receiving an asset view
                      var activityTypeOverride = [{
                        'type': 'get_view_asset',
                        'points': 1
                      }];
                      ActivitiesTestUtil.assertEditActivityTypeConfiguration(instructorClient, course, activityTypeOverride, function() {

                        // Verify that viewing an asset still updates points
                        ActivitiesTestUtil.assertViewAssetActivity(client2, client1, course, asset.id, function() {

                          // Verify that a user viewing their own asset still does not update points
                          ActivitiesTestUtil.assertViewAssetActivity(client1, client1, course, asset.id, function() {

                            ActivitiesTestUtil.assertReciprocals(course, 'get_view_asset', 'view_asset', function() {

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

  describe('Liking', function() {

    /**
     * Test that verifies that liking an asset updates the points for the liker and the
     * user receiving the like
     */
    it('updates the points when liking', function(callback) {
      TestsUtil.getAssetLibraryClient(null, null, null, function(client1, course, user1) {
        AssetsTestUtil.assertCreateLink(client1, course, 'UC Davis', 'http://www.ucdavis.edu/', null, function(asset) {

          // Verify that liking an asset correctly updates the points
          TestsUtil.getAssetLibraryClient(null, course, null, function(client2, course, user2) {
            ActivitiesTestUtil.assertLikeActivity(client2, client1, course, asset.id, true, function() {

              // Verify that re-liking an asset doesn't update the points
              ActivitiesTestUtil.assertLikeActivity(client2, client1, course, asset.id, true, function() {

                ActivitiesTestUtil.assertReciprocals(course, 'get_like', 'like', function() {

                  return callback();
                });
              });
            });
          });
        });
      });
    });

    /**
     * Test that verifies that exporting a whiteboard as an asset updates the points for all collaborators
     */
    it('updates the points when exporting a whiteboard as an asset', function(callback) {
      TestsUtil.getAssetLibraryClient(null, null, null, function(client1, course, user1) {
        TestsUtil.getAssetLibraryClient(null, course, null, function(client2, course, user2) {
          UsersTestsUtil.assertGetMe(client2, course, null, function(user2Me) {

            // Create a whiteboard with a few elements in it and share it with the second user
            WhiteboardsTestUtil.assertCreateWhiteboardWithElements(client1, course, 'UC Berkeley Whiteboard', user2Me.id, function(whiteboard) {

              // Export the whiteboard to an asset
              ActivitiesTestUtil.assertExportWhiteboardToAssetActivity(client1, course, whiteboard.id, null, null, function(data) {

                return callback();
              });
            });
          });
        });
      });
    });

    /**
     * Test that verifies that disliking an asset updates the points for the disliker and the
     * user receiving the dislike
     */
    it('updates the points when disliking', function(callback) {
      TestsUtil.getAssetLibraryClient(null, null, null, function(client1, course, user1) {
        AssetsTestUtil.assertCreateLink(client1, course, 'UC Davis', 'http://www.ucdavis.edu/', null, function(asset) {

          // Verify that disliking an asset correctly updates the points
          TestsUtil.getAssetLibraryClient(null, course, null, function(client2, course, user2) {
            ActivitiesTestUtil.assertLikeActivity(client2, client1, course, asset.id, false, function() {

              // Verify that re-disliking an asset doesn't update the points
              ActivitiesTestUtil.assertLikeActivity(client2, client1, course, asset.id, false, function() {

                return callback();
              });
            });
          });
        });
      });
    });

    /**
     * Test that verifies that updating a like or dislike updates the points for the (dis)liker and the
     * user receiving the (dis)like
     */
    it('updates the points when liking or disliking', function(callback) {
      TestsUtil.getAssetLibraryClient(null, null, null, function(client1, course, user1) {
        AssetsTestUtil.assertCreateLink(client1, course, 'UC Davis', 'http://www.ucdavis.edu/', null, function(asset) {

          // Verify that undoing a like updates the points
          TestsUtil.getAssetLibraryClient(null, course, null, function(client2, course, user2) {
            ActivitiesTestUtil.assertLikeActivity(client2, client1, course, asset.id, true, function() {
              ActivitiesTestUtil.assertLikeActivity(client2, client1, course, asset.id, null, function() {

                // Verify that undoing a dislike updates the points
                ActivitiesTestUtil.assertLikeActivity(client2, client1, course, asset.id, false, function() {
                  ActivitiesTestUtil.assertLikeActivity(client2, client1, course, asset.id, null, function() {

                    // Verify that switching a dislike to a like updates the points
                    ActivitiesTestUtil.assertLikeActivity(client2, client1, course, asset.id, false, function() {
                      ActivitiesTestUtil.assertLikeActivity(client2, client1, course, asset.id, true, function() {

                        // Verify that switching a like to a dislike updates the points
                        ActivitiesTestUtil.assertLikeActivity(client2, client1, course, asset.id, false, function() {

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

  describe('Pins', function() {

    /**
     * Test verifies that pinning an asset updates points for the appropriate users
     */
    it('updates points when pinning', function(callback) {
      // The asset_users are user1 and user2; the asset has been pinned by user2 and user3.
      AssetsTestUtil.createPinningScenario(function(client1, client2, client3, course, user1, user2, user3, asset) {

        AssetsTestUtil.getDbUser(user1.id, function(dbUser1) {
          AssetsTestUtil.getDbUser(user2.id, function(dbUser2) {
            AssetsTestUtil.getDbUser(user3.id, function(dbUser3) {

              // Verify appropriate activity counts
              ActivitiesTestUtil.assertGetActivitiesForUserId(client1, course, dbUser1.id, function(activities1) {
                // user1 received one pin
                assert.ok(!activities1.actions.counts.user.pin_asset);
                assert.strictEqual(activities1.impacts.counts.user.get_pin_asset, 1);

                // Verify course totals
                assert.strictEqual(activities1.impacts.counts.course.get_pin_asset, 2);

                ActivitiesTestUtil.assertGetActivitiesForUserId(client2, course, dbUser2.id, function(activities2) {
                  // user2 gets no credit for pinning his own asset but he does get credit from user3's pin
                  assert.ok(!activities2.actions.counts.user.pin_asset);
                  assert.strictEqual(activities2.impacts.counts.user.get_pin_asset, 1);

                  ActivitiesTestUtil.assertGetActivitiesForUserId(client3, course, dbUser3.id, function(activities3) {
                    // user3 pinned
                    assert.strictEqual(activities3.actions.counts.user.pin_asset, 1);
                    assert.ok(!activities3.impacts.counts.user.get_pin_asset);

                      ActivitiesTestUtil.assertReciprocals(course, 'get_pin_asset', 'pin_asset', function() {

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
     * Test verifies that pinning an asset updates and then repinning an asset creates two activities of different types
     */
    it('recognizes repinning as a separate activity', function(callback) {
      // The asset_users are user1 and user2; the asset has been pinned by user2 and user3.
      AssetsTestUtil.createPinningScenario(function(client1, client2, client3, course, user1, user2, user3, asset) {
        // user3 will do the pinning
        AssetsTestUtil.getDbUser(user3.id, function(dbUser3) {
          ActivitiesTestUtil.assertGetActivitiesForUserId(client3, course, dbUser3.id, function(activities3) {
            // user3 pinned
            assert.strictEqual(activities3.actions.counts.user.pin_asset, 1);

            // Asset must be unpinned prior to repinning
            AssetsTestUtil.assertUnpinAsset(client3, course, asset.id, function(asset) {
              // Repin
              AssetsTestUtil.assertPinAsset(client3, course, asset.id, function(asset) {
                ActivitiesTestUtil.assertGetActivitiesForUserId(client3, course, dbUser3.id, function(activities3) {

                  // Verify that asset owners receive 'get_pin' and 'get_repin' activities
                  AssetsTestUtil.getDbUser(user1.id, function(dbUser1) {
                    AssetsTestUtil.getDbUser(user2.id, function(dbUser2) {
                      ActivitiesTestUtil.assertGetActivitiesForUserId(client1, course, dbUser1.id, function(activities1) {
                        ActivitiesTestUtil.assertGetActivitiesForUserId(client2, course, dbUser2.id, function(activities2) {

                          // user3 pinned once and repinned once
                          assert.strictEqual(activities3.actions.counts.user.pin_asset, 1);
                          assert.strictEqual(activities3.actions.counts.user.repin_asset, 1);

                          // user1, a co-creator of the asset, gets two get_pins and one get_repin
                          assert.strictEqual(activities1.impacts.counts.user.get_pin_asset, 1);
                          assert.strictEqual(activities1.impacts.counts.user.get_repin_asset, 1);

                          // user2, a co-creator of the asset, one get_pin and one get_repin
                          assert.strictEqual(activities2.impacts.counts.user.get_pin_asset, 1);
                          assert.strictEqual(activities2.impacts.counts.user.get_repin_asset, 1);

                            ActivitiesTestUtil.assertReciprocals(course, 'get_repin_asset', 'repin_asset', function() {

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

  describe('Comments', function() {

    /**
     * Test that verifies that creating a comment updates the points for the appropriate users
     */
    it('updates the points when commenting', function(callback) {
      // Bump the default test time-out as this test is doing quite a few things
      this.timeout(5000);

      TestsUtil.getAssetLibraryClient(null, null, null, function(client1, course, user1) {
        TestsUtil.getAssetLibraryClient(null, course, null, function(client2, course, user2) {
          TestsUtil.getAssetLibraryClient(null, course, null, function(client3, course, user3) {

            // Each user creates an asset
            AssetsTestUtil.assertCreateLink(client1, course, 'UC Davis', 'http://www.ucdavis.edu/', null, function(asset1) {
              AssetsTestUtil.assertCreateLink(client2, course, 'UC Davis', 'http://www.ucdavis.edu/', null, function(asset2) {
                AssetsTestUtil.assertCreateLink(client3, course, 'UC Davis', 'http://www.ucdavis.edu/', null, function(asset3) {

                  // Top level comment on an asset from the current user
                  ActivitiesTestUtil.assertCreateCommentActivity(client1, [client1], course, asset1.id, function() {
                    // Top level comment on an asset from another user
                    ActivitiesTestUtil.assertCreateCommentActivity(client1, [client2], course, asset2.id, function() {

                      // Create some top-level comments
                      AssetsTestUtil.assertCreateComment(client1, course, asset1.id, 'A top-level comment by user 1 on asset 1', null, function(commentOnAsset1By1) {
                        AssetsTestUtil.assertCreateComment(client2, course, asset1.id, 'A top-level comment by user 2 on asset 1', null, function(commentOnAsset1By2) {
                          AssetsTestUtil.assertCreateComment(client3, course, asset1.id, 'A top-level comment by user 3 on asset 1', null, function(commentOnAsset1By3) {
                            AssetsTestUtil.assertCreateComment(client1, course, asset2.id, 'A top-level comment by user 1 on asset 2', null, function(commentOnAsset2By1) {
                              AssetsTestUtil.assertCreateComment(client2, course, asset2.id, 'A top-level comment by user 2 on asset 2', null, function(commentOnAsset2By2) {
                                AssetsTestUtil.assertCreateComment(client3, course, asset2.id, 'A top-level comment by user 3 on asset 2', null, function(commentOnAsset2By3) {

                                  // Reply on a comment from the current user on an asset from the current user
                                  ActivitiesTestUtil.assertCreateReplyActivity(client1, [client1], client1, course, asset1.id, commentOnAsset1By1.id, function() {
                                    // Reply on a comment from another user on an asset from the current user
                                    ActivitiesTestUtil.assertCreateReplyActivity(client1, [client1], client2, course, asset1.id, commentOnAsset1By2.id, function() {
                                      // Reply on a comment from the current user on an asset from another user
                                      ActivitiesTestUtil.assertCreateReplyActivity(client1, [client2], client1, course, asset2.id, commentOnAsset2By1.id, function() {
                                        // Reply on a comment from another user on an asset from that other user
                                        ActivitiesTestUtil.assertCreateReplyActivity(client1, [client2], client2, course, asset2.id, commentOnAsset2By2.id, function() {
                                          // Reply on a comment from another user on an asset from yet another user
                                          ActivitiesTestUtil.assertCreateReplyActivity(client1, [client2], client3, course, asset2.id, commentOnAsset2By3.id, function() {
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

    /**
     * Test that verifies that creating a comment on an asset with multiple owners updates the points for the appropriate users
     */
    it('updates the points when commenting on an asset with multiple owners', function(callback) {
      // Bump the default test time-out as this test is doing quite a few things
      this.timeout(5000);

      TestsUtil.getAssetLibraryClient(null, null, null, function(client1, course, user1) {
        TestsUtil.getAssetLibraryClient(null, course, null, function(client2, course, user2) {
          TestsUtil.getAssetLibraryClient(null, course, null, function(client3, course, user3) {
            TestsUtil.getAssetLibraryClient(null, course, null, function(client4, course, user4) {
              UsersTestsUtil.assertGetMe(client2, course, null, function(user2Me) {

                // Create a whiteboard with a few elements in it, share it with the second user and
                // export the whiteboard to the asset library
                WhiteboardsTestUtil.assertCreateWhiteboardWithElements(client1, course, 'UC Berkeley Whiteboard', user2Me.id, function(whiteboard) {
                  ActivitiesTestUtil.assertExportWhiteboardToAssetActivity(client1, course, whiteboard.id, null, null, function(asset) {

                    // Top level comment on an asset from an asset owner
                    ActivitiesTestUtil.assertCreateCommentActivity(client1, [client1, client2], course, asset.id, function() {
                      // Top level comment on an asset from a non asset owner
                      ActivitiesTestUtil.assertCreateCommentActivity(client3, [client1, client2], course, asset.id, function() {

                        // Create some top-level comments
                        AssetsTestUtil.assertCreateComment(client1, course, asset.id, 'A top-level comment by user 1', null, function(commentByUser1) {
                          AssetsTestUtil.assertCreateComment(client2, course, asset.id, 'A top-level comment by user 2', null, function(commentByUser2) {
                            AssetsTestUtil.assertCreateComment(client3, course, asset.id, 'A top-level comment by user 3', null, function(commentByUser3) {
                              AssetsTestUtil.assertCreateComment(client4, course, asset.id, 'A top-level comment by user 3', null, function(commentByUser4) {

                                // As an asset owner reply on your own comment
                                ActivitiesTestUtil.assertCreateReplyActivity(client1, [client1, client2], client1, course, asset.id, commentByUser1.id, function() {
                                  // As an asset owner reply on a comment from another asset owner
                                  ActivitiesTestUtil.assertCreateReplyActivity(client1, [client1, client2], client2, course, asset.id, commentByUser2.id, function() {
                                    // As an asset owner reply on a comment from an unaffiliated user
                                    ActivitiesTestUtil.assertCreateReplyActivity(client1, [client1, client2], client3, course, asset.id, commentByUser3.id, function() {
                                      // As an unaffiliated user reply on a comment from yourself
                                      ActivitiesTestUtil.assertCreateReplyActivity(client3, [client1, client2], client3, course, asset.id, commentByUser3.id, function() {
                                        // As an unaffiliated user reply on a comment from an asset owner
                                        ActivitiesTestUtil.assertCreateReplyActivity(client3, [client1, client2], client1, course, asset.id, commentByUser1.id, function() {
                                          // As an unaffiliated user reply on a comment from an another unaffiliated user
                                          ActivitiesTestUtil.assertCreateReplyActivity(client3, [client1, client2], client4, course, asset.id, commentByUser4.id, function() {

                                            ActivitiesTestUtil.assertReciprocals(course, 'get_asset_comment', 'asset_comment', function() {
                                              ActivitiesTestUtil.assertReciprocals(course, 'get_asset_comment_reply', 'asset_comment', function() {

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

    /**
     * Create an asset, comment on it and verify that the points are properly adjusted when the
     * comment is deleted
     *
     * @param  {RestClient}         commenterClient                 The REST client representing the user that will be deleting the comment
     * @param  {RestClient}         creatorClient                   The REST client representing the user that owns the asset
     * @param  {Course}             course                          The Canvas course in which the user is interacting with the API
     * @param  {Function}           callback                        Standard callback function
     */
    var verifyDeleteCommentActivity = function(commenterClient, creatorClient, course, callback) {
      AssetsTestUtil.assertCreateLink(creatorClient, course, 'UC Davis', 'http://www.ucdavis.edu/', null, function(asset) {
        AssetsTestUtil.assertCreateComment(commenterClient, course, asset.id, 'Comment 1', null, function(comment) {

          ActivitiesTestUtil.assertDeleteCommentActivity(commenterClient, creatorClient, course, asset.id, comment.id, callback);
        });
      });
    };

    /**
     * Test that verifies that deleting a comment updates the points for the appropriate users
     */
    it('updates the points when deleting a comment', function(callback) {
      TestsUtil.getAssetLibraryClient(null, null, null, function(client1, course, user1) {
        TestsUtil.getAssetLibraryClient(null, course, null, function(client2, course, user2) {

          verifyDeleteCommentActivity(client1, client1, course, function() {
            verifyDeleteCommentActivity(client1, client2, course, function() {
              return callback();
            });
          });
        });
      });
    });

    /**
     * Create an asset, comment and reply and verify that the points are properly adjusted when the
     * reply is deleted
     *
     * @param  {RestClient}         commenterClient                 The REST client representing the user that will be deleting the comment
     * @param  {RestClient}         creatorClient                   The REST client representing the user that owns the asset
     * @param  {RestClient}         parentClient                    The REST client representing the user that will make the parent comment
     * @param  {Course}             course                          The Canvas course in which the user is interacting with the API
     * @param  {Function}           callback                        Standard callback function
     */
    var verifyDeleteReplyActivity = function(commenterClient, creatorClient, parentClient, course, callback) {
      AssetsTestUtil.assertCreateLink(creatorClient, course, 'UC Davis', 'http://www.ucdavis.edu/', null, function(asset) {
        AssetsTestUtil.assertCreateComment(parentClient, course, asset.id, 'Comment 1', null, function(comment) {
          AssetsTestUtil.assertCreateComment(commenterClient, course, asset.id, 'Reply on comment 1', comment.id, function(reply) {

            ActivitiesTestUtil.assertDeleteReplyActivity(commenterClient, creatorClient, parentClient, course, asset.id, reply.id, callback);
          });
        });
      });
    };

    /**
     * Test that verifies that deleting a reply on a comment updates the points for the appropriate users
     */
    it('updates the points when deleting a reply on a comment', function(callback) {
      // Bump the default test time-out as this test is doing quite a few things
      this.timeout(5000);

      TestsUtil.getAssetLibraryClient(null, null, null, function(client1, course, user1) {
        TestsUtil.getAssetLibraryClient(null, course, null, function(client2, course, user2) {
          TestsUtil.getAssetLibraryClient(null, course, null, function(client3, course, user3) {

            // A user deletes a reply on a comment of their own on an asset they own
            verifyDeleteReplyActivity(client1, client1, client1, course, function() {
              // A user deletes a reply on a comment of another user on an asset they own
              verifyDeleteReplyActivity(client1, client1, client2, course, function() {
                // A user deletes a reply on a comment of their own on an asset of another user
                verifyDeleteReplyActivity(client1, client2, client1, course, function() {
                  // A user deletes a reply on a comment of another user on an asset owned by that other user
                  verifyDeleteReplyActivity(client1, client2, client2, course, function() {
                    // A user deletes a reply on a comment of another user on an asset owned by yet another user
                    verifyDeleteReplyActivity(client1, client2, client3, course, function() {
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

  describe('Remixing a whiteboard', function() {

    /**
     * Test that verifies that remixing a whiteboard updates points for the remixer and all collaborators
     */
    it('updates the points', function(callback) {
      // Create an exported whiteboard and two users
      AssetsTestUtil.setupExportedWhiteboard(null, null, null, null, null, function(creatorClient1, creatorClient2, course, creatorUser1, creatorClient2, exportedWhiteboard) {
        TestsUtil.getAssetLibraryClient(null, course, null, function(remixerClient, course, remixerUser) {

          // Define activity points for whiteboard remixes
          var instructorUser = TestsUtil.generateInstructor();
          TestsUtil.getAssetLibraryClient(null, course, instructorUser, function(instructorClient, course, instructorUser) {
            var activityTypeOverride = [
              {
                'type': 'remix_whiteboard',
                'points': 2
              },
              {
                'type': 'get_remix_whiteboard',
                'points': 3
              }
            ];
            ActivitiesTestUtil.assertEditActivityTypeConfiguration(instructorClient, course, activityTypeOverride, function() {

              // Verify that remixing another user's whiteboard generates activity and points
              ActivitiesTestUtil.assertRemixWhiteboardActivities(remixerClient, course, exportedWhiteboard, function() {

                // Verify that remixing one's own whiteboard generates activity points as remixer but not as creator
                ActivitiesTestUtil.assertRemixWhiteboardActivities(creatorClient1, course, exportedWhiteboard, function() {

                  ActivitiesTestUtil.assertReciprocals(course, 'get_remix_whiteboard', 'remix_whiteboard', function() {

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

  describe('Recalculating impact scores', function() {

    /**
     * Test that verifies that impact scores can be recalculated from activities
     */
    it('correctly recalculates impact scores', function(callback) {
      ActivitiesTestUtil.setupCourseWithActivity(function(dbCourse, course, users) {

        // Get the assets from the database
        AssetsTestUtil.getDbAsset(users.nico.asset.id, function(nicoAsset) {
          AssetsTestUtil.getDbAsset(users.paul.asset.id, function(paulAsset) {

            // Verify that they each have impact scores from initial activity
            assert.strictEqual(nicoAsset.impact_score, 12);
            assert.strictEqual(paulAsset.impact_score, 12);

            // Oh no, a corrupting event in the database!
            paulAsset.update({'impact_score': 400}).complete(function(err, paulAsset) {
              assert.strictEqual(paulAsset.impact_score, 400);

              // Recalculate impact scores
              CourseTestUtil.getDbCourse(course.id, function(dbCourse) {
                ActivitiesAPI.recalculateImpactScores(dbCourse, function(err) {
                  assert.ifError(err);

                  // Re-fetch the assets
                  AssetsTestUtil.getDbAsset(users.nico.asset.id, function(nicoAsset) {
                    AssetsTestUtil.getDbAsset(users.paul.asset.id, function(paulAsset) {

                      // Verify that both assets are back where they should be
                      assert.strictEqual(nicoAsset.impact_score, 12);
                      assert.strictEqual(paulAsset.impact_score, 12);

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
     * Test that verifies that trending scores can be recalculated from recent activities
     */
    it('correctly recalculates trending scores', function(callback) {
      ActivitiesTestUtil.setupCourseWithActivity(function(dbCourse, course, users) {

        // Get the assets from the database and verify no initial scores
        AssetsTestUtil.getDbAsset(users.nico.asset.id, function(nicoAsset) {
          AssetsTestUtil.getDbAsset(users.paul.asset.id, function(paulAsset) {
            assert.strictEqual(nicoAsset.trending_score, 0);
            assert.strictEqual(paulAsset.trending_score, 0);

            // Recalculate trending scores and verify that recent activity is reflected
            CourseTestUtil.getDbCourse(course.id, function(dbCourse) {
              ActivitiesUtil.recalculateTrendingScores(dbCourse, function(err) {
                assert.ifError(err);
                AssetsTestUtil.getDbAsset(users.nico.asset.id, function(nicoAsset) {
                  AssetsTestUtil.getDbAsset(users.paul.asset.id, function(paulAsset) {
                    assert.strictEqual(nicoAsset.trending_score, 12);
                    assert.strictEqual(paulAsset.trending_score, 12);

                    // Time-shift activity on Nico's asset back five days and activity on Paul's asset back eight days
                    DB.Activity.update({'created_at': moment().subtract(5, 'day').toDate()}, {'where': {'asset_id': nicoAsset.id}}).then(function() {
                      DB.Activity.update({'created_at': moment().subtract(8, 'day').toDate()}, {'where': {'asset_id': paulAsset.id}}).then(function() {

                        // Recalculate trending scores and re-fetch the assets
                        CourseTestUtil.getDbCourse(course.id, function(dbCourse) {
                          ActivitiesUtil.recalculateTrendingScores(dbCourse, function(err) {
                            assert.ifError(err);
                            AssetsTestUtil.getDbAsset(users.nico.asset.id, function(nicoAsset) {
                              AssetsTestUtil.getDbAsset(users.paul.asset.id, function(paulAsset) {

                                // Verify that Nico's asset is still trending; Paul's asset is not
                                assert.strictEqual(nicoAsset.trending_score, 12);
                                assert.strictEqual(paulAsset.trending_score, 0);

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
