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

// var AssetsTestUtil = require('col-assets/tests/util');
var TestsUtil = require('col-tests');

var ActivitiesTestUtil = require('./util');

describe('Activities', function() {

  describe('CSV export', function() {

    /**
     * Test that verifies that the activities for a course can be exported as a CSV file
     */
    it('can be exported', function(callback) {
      var instructor = TestsUtil.generateInstructor();
      TestsUtil.getAssetLibraryClient(null, null, instructor, function(client1, course, instructor) {

        ActivitiesTestUtil.assertEditActivityTypeConfiguration(client1, course, ActivitiesTestUtil.OVERRIDE_VIEWS_DISABLED, function() {

          // Verify that the activity CSV export is empty before any activities have taken place
          ActivitiesTestUtil.assertExportActivities(client1, course, 0, function(activities) {

            // Verify that adding a new asset is reflected in the activities CSV export
            TestsUtil.getAssetLibraryClient(null, course, null, function(client2, course, user2) {
              ActivitiesTestUtil.assertCreateLinkActivity(client2, course, 'UC Davis', 'http://www.ucdavis.edu/', null, function(asset) {
                ActivitiesTestUtil.assertExportActivities(client1, course, 1, function(activities) {
                  assert.strictEqual(activities[0].action, 'add_asset');

                  // Verify that liking an asset is reflected in the activities CSV export
                  TestsUtil.getAssetLibraryClient(null, course, null, function(client3, course, user3) {
                    ActivitiesTestUtil.assertLikeActivity(client3, client2, course, asset.id, true, function() {
                      ActivitiesTestUtil.assertExportActivities(client1, course, 3, function(activities) {
                        assert.strictEqual(activities[0].action, 'add_asset');
                        assert.strictEqual(activities[1].action, 'like');
                        assert.strictEqual(activities[2].action, 'get_like');

                        // Verify that replacing an activity is reflected in the activities CSV export
                        ActivitiesTestUtil.assertLikeActivity(client3, client2, course, asset.id, false, function() {
                          ActivitiesTestUtil.assertExportActivities(client1, course, 3, function(activities) {
                            assert.strictEqual(activities[0].action, 'add_asset');
                            assert.strictEqual(activities[1].action, 'dislike');
                            assert.strictEqual(activities[2].action, 'get_dislike');

                            // Verify that removing an activity is reflected in the activities CSV export
                            ActivitiesTestUtil.assertLikeActivity(client3, client2, course, asset.id, null, function() {
                              ActivitiesTestUtil.assertExportActivities(client1, course, 1, function(activities) {
                                assert.strictEqual(activities[0].action, 'add_asset');

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
     * Test that verifies authorization when exporting the activities for a course as a CSV file
     */
    it('verifies authorization', function(callback) {
      // Verify that the activities for a course can not be exported as a CSV file by a non-administrator
      TestsUtil.getAssetLibraryClient(null, null, null, function(client, course, user) {
        ActivitiesTestUtil.assertExportActivitiesFails(client, course, 401, function() {

          return callback();
        });
      });
    });

    /**
     * Test that verifies that disabled activities are not included when exporting the activities
     * for a course as a CSV file
     */
    it('does not include disabled activities', function(callback) {
      var instructor = TestsUtil.generateInstructor();
      TestsUtil.getAssetLibraryClient(null, null, instructor, function(instructorClient, course, instructor) {
        TestsUtil.getAssetLibraryClient(null, course, null, function(studentClient1, course, studentUser1) {
          TestsUtil.getAssetLibraryClient(null, course, null, function(studentClient2, course, studentUser2) {

            ActivitiesTestUtil.assertEditActivityTypeConfiguration(instructorClient, course, ActivitiesTestUtil.OVERRIDE_VIEWS_DISABLED, function() {

              // Generate a few activities by creating a link and liking it
              ActivitiesTestUtil.assertCreateLinkActivity(studentClient1, course, 'UC Davis', 'http://www.ucdavis.edu/', null, function(asset) {
                ActivitiesTestUtil.assertLikeActivity(studentClient2, studentClient1, course, asset.id, true, function() {

                  // Sanity check the activities have been created and are all included in the export
                  ActivitiesTestUtil.assertExportActivities(instructorClient, course, 3, function(activities) {
                    assert.strictEqual(activities[0].action, 'add_asset');
                    assert.strictEqual(activities[1].action, 'like');
                    assert.strictEqual(activities[2].action, 'get_like');

                    // Disable the `add_asset` activity
                    var activityTypeOverride = [{
                      'type': 'add_asset',
                      'enabled': false
                    }];
                    ActivitiesTestUtil.assertEditActivityTypeConfiguration(instructorClient, course, activityTypeOverride, function() {

                      // Verify the `add_asset` activity is not included in the export
                      ActivitiesTestUtil.assertExportActivities(instructorClient, course, 2, function(activities) {
                        assert.strictEqual(activities[0].action, 'like');
                        assert.strictEqual(activities[1].action, 'get_like');

                        // Re-enable the `add_asset` activity and verify it's included in the export
                        activityTypeOverride[0].enabled = true;
                        ActivitiesTestUtil.assertEditActivityTypeConfiguration(instructorClient, course, activityTypeOverride, function() {
                          ActivitiesTestUtil.assertExportActivities(instructorClient, course, 3, function(activities) {
                            assert.strictEqual(activities[0].action, 'add_asset');
                            assert.strictEqual(activities[1].action, 'like');
                            assert.strictEqual(activities[2].action, 'get_like');

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
