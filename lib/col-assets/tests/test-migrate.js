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

var AssetsTestUtil = require('./util');
var CategoriesTestUtil = require('col-categories/tests/util');
var TestsUtil = require('col-tests');
var UsersTestUtil = require('col-users/tests/util');

describe('Migrate', function() {

  describe('assets', function() {

    /**
     * Test that verifies asset and category migration
     */
    it('migrates file and link assets with categories', function(callback) {
      var course1 = TestsUtil.generateCourse(global.tests.canvas.ucberkeley);
      var course2 = TestsUtil.generateCourse(global.tests.canvas.ucberkeley);

      var instructor = TestsUtil.generateInstructor(global.tests.canvas.ucberkeley);

      // Instructor is teaching course 1
      TestsUtil.getAssetLibraryClient(null, course1, instructor, function(client1, course1, instructor1) {
        // Instructor is teaching course 2
        TestsUtil.getAssetLibraryClient(null, course2, instructor, function(client2, course2, instructor2) {

          // Instructor creates categories in course 1
          CategoriesTestUtil.assertCreateCategory(client1, course1, 'Category 1', function(category1) {
            CategoriesTestUtil.assertCreateCategory(client1, course1, 'Category 2', function(category2) {

              // Instructor creates assets in course 1
              var opts = {'categories': category1.id};
              AssetsTestUtil.assertCreateLink(client1, course1, 'UC Berkeley', 'http://www.ucberkeley.edu/', opts, function(asset1) {
                opts = {'categories': [category1.id, category2.id]};
                AssetsTestUtil.assertCreateLink(client1, course1, 'UC Davis', 'http://www.ucdavis.edu/', opts, function(asset2) {

                  // Migrate assets from instructor's course 1 id to instructor's course 2 id
                  UsersTestUtil.assertGetMe(client2, course2, null, function(me2) {
                    AssetsTestUtil.assertMigrationCompletes(client1, course1, me2.id, 0, 2, function() {

                      // Get instructor's assets in course 2
                      AssetsTestUtil.assertGetAssets(client2, course2, null, null, null, null, 2, function(assets) {

                        // Verify that assets were migrated and categories preserved
                        var migratedAsset1 = _.find(assets.results, {'title': 'UC Berkeley'});
                        AssetsTestUtil.assertGetMigratedAsset(client2, course2, migratedAsset1.id, ['Category 1'], function() {
                          var migratedAsset2 = _.find(assets.results, {'title': 'UC Davis'});
                          AssetsTestUtil.assertGetMigratedAsset(client2, course2, migratedAsset2.id, ['Category 1', 'Category 2'], function() {

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
     * Test that verifies migration from a course directory in Amazon S3 to a different course directory in Amazon S3
     */
    it('migrates files from Amazon S3 to Amazon S3', function(callback) {
      var course = TestsUtil.generateCourse(global.tests.canvas.ucberkeley);
      var instructor = TestsUtil.generateInstructor(global.tests.canvas.ucberkeley);
      var categoryName = 'Category 1';

      // Our first course stores its files in Amazon S3
      AssetsTestUtil.setUpAmazonS3BackedCourse(instructor, function(s3Client1, s3Course1, instructor1) {
        CategoriesTestUtil.assertCreateCategory(s3Client1, s3Course1, categoryName, function(category) {

          var opts = {'categories': category.id};
          AssetsTestUtil.assertFileCreateAndStorage(s3Client1, s3Course1, opts, function(s3Assets1) {
            _.each(s3Assets1.results, function(asset) {
              assert.ok(_.startsWith(asset.download_url, 's3://'));
            });

            // Our second course also stores its files in Amazon S3
            AssetsTestUtil.setUpAmazonS3BackedCourse(instructor, function(s3Client2, s3Course2, instructor2) {

              // Migrate!
              UsersTestUtil.assertGetMe(s3Client2, s3Course2, null, function(s3me) {
                AssetsTestUtil.assertMigrationCompletes(s3Client1, s3Course1, s3me.id, 3, 0, function() {

                  // Verify!
                  AssetsTestUtil.assertGetAssets(s3Client2, s3Course2, null, null, null, null, 3, function(s3Assets2) {
                    _.each(s3Assets2.results, function(asset) {
                      assert.ok(_.startsWith(asset.download_url, 's3://'));
                    });

                    AssetsTestUtil.assertGetMigratedAsset(s3Client2, s3Course2, s3Assets2.results[0].id, [categoryName], function() {

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
     * Test that verifies migration can be started from the REST API
     */
    it('starts migration from REST API', function(callback) {
      var course1 = TestsUtil.generateCourse(global.tests.canvas.ucberkeley);
      var course2 = TestsUtil.generateCourse(global.tests.canvas.ucberkeley);

      var instructor = TestsUtil.generateInstructor(global.tests.canvas.ucberkeley);

      // Instructor is teaching course 1
      TestsUtil.getAssetLibraryClient(null, course1, instructor, function(client1, course1, instructor1) {
        // Instructor is teaching course 2
        TestsUtil.getAssetLibraryClient(null, course2, instructor, function(client2, course2, instructor2) {

          // Instructor creates categories in course 1
          CategoriesTestUtil.assertCreateCategory(client1, course1, 'Category 1', function(category1) {
            CategoriesTestUtil.assertCreateCategory(client1, course1, 'Category 2', function(category2) {

              // Instructor creates assets in course 1
              var opts = {'categories': category1.id};
              AssetsTestUtil.assertCreateLink(client1, course1, 'UC Berkeley', 'http://www.ucberkeley.edu/', opts, function(asset1) {
                opts = {'categories': [category1.id, category2.id]};
                AssetsTestUtil.assertCreateLink(client1, course1, 'UC Davis', 'http://www.ucdavis.edu/', opts, function(asset2) {

                  // Verify that migration from instructor's course 1 id to instructor's course 2 id is started
                  UsersTestUtil.assertGetMe(client2, course2, null, function(me2) {
                    AssetsTestUtil.assertMigrationStarts(client1, course1, me2.id, function() {

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
     * Test that verifies admin authorization in source course
     */
    it('verifies admin authorization in source course', function(callback) {
      var course1 = TestsUtil.generateCourse(global.tests.canvas.ucberkeley);
      var course2 = TestsUtil.generateCourse(global.tests.canvas.ucberkeley);

      var user = TestsUtil.generateUser(global.tests.canvas.ucberkeley);
      var userAsInstructor = TestsUtil.generateInstructor(global.tests.canvas.ucberkeley);
      user.id = userAsInstructor.id;

      // User is a regular user in course 1
      TestsUtil.getAssetLibraryClient(null, course1, user, function(client1, course1, user) {
        // User is an instructor in course 2
        TestsUtil.getAssetLibraryClient(null, course2, userAsInstructor, function(client2, course2, userAsInstructor) {

          // Verify that migration from course 1 to course 2 fails
          UsersTestUtil.assertGetMe(client2, course2, null, function(me2) {
            AssetsTestUtil.assertMigrationFails(client1, course1, me2.id, 401, function() {
              return callback();
            });
          });
        });
      });
    });

    /**
     * Test that verifies admin authorization in destination course
     */
    it('verifies admin authorization in destination course', function(callback) {
      var course1 = TestsUtil.generateCourse(global.tests.canvas.ucberkeley);
      var course2 = TestsUtil.generateCourse(global.tests.canvas.ucberkeley);

      var user = TestsUtil.generateUser(global.tests.canvas.ucberkeley);
      var userAsInstructor = TestsUtil.generateInstructor(global.tests.canvas.ucberkeley);
      user.id = userAsInstructor.id;

      // User is an instructor in course 1
      TestsUtil.getAssetLibraryClient(null, course1, userAsInstructor, function(client1, course1, userAsInstructor) {
        // User is a regular user in course 2
        TestsUtil.getAssetLibraryClient(null, course2, user, function(client2, course2, user) {

          // Verify that migration from course 1 to course 2 fails
          UsersTestUtil.assertGetMe(client2, course2, null, function(me2) {
            AssetsTestUtil.assertMigrationFails(client1, course1, me2.id, 401, function() {
              return callback();
            });
          });
        });
      });
    });

    /**
     * Test that verifies Canvas user account must match between source and destination course
     */
    it('insists on matching Canvas user accounts', function(callback) {
      var course1 = TestsUtil.generateCourse(global.tests.canvas.ucberkeley);
      var course2 = TestsUtil.generateCourse(global.tests.canvas.ucberkeley);

      var instructor1 = TestsUtil.generateInstructor(global.tests.canvas.ucberkeley);
      var instructor2 = TestsUtil.generateInstructor(global.tests.canvas.ucberkeley);

      // Instructor 1 teaches course 1
      TestsUtil.getAssetLibraryClient(null, course1, instructor1, function(client1, course1, instructor1) {
        // Instructor 2 teaches course 2
        TestsUtil.getAssetLibraryClient(null, course2, instructor2, function(client2, course2, instructor2) {

          // Verify that migration from course 1 to course 2 fails
          UsersTestUtil.assertGetMe(client2, course2, null, function(me2) {
            AssetsTestUtil.assertMigrationFails(client1, course1, me2.id, 400, function() {
              return callback();
            });
          });
        });
      });
    });

    /**
     * Test that verifies Canvas instance must match between source and destination course
     */
    it('insists on matching Canvas instances', function(callback) {
      var berkeleyCourse = TestsUtil.generateCourse(global.tests.canvas.ucberkeley);
      var davisCourse = TestsUtil.generateCourse(global.tests.canvas.ucdavis);

      var berkeleyInstructor = TestsUtil.generateInstructor(global.tests.canvas.ucberkeley);
      var davisInstructor = TestsUtil.generateInstructor(global.tests.canvas.ucdavis);

      // Berkeley and Davis instructors happen to have the same Canvas account id
      berkeleyInstructor.id = davisInstructor.id;

      // Berkeley instructor teaches Berkeley course
      TestsUtil.getAssetLibraryClient(null, berkeleyCourse, berkeleyInstructor, function(berkeleyClient, berkeleyCourse, berkeleyInstructor) {
        // Davis instructor teaches Davis course
        TestsUtil.getAssetLibraryClient(null, davisCourse, davisInstructor, function(davisClient, davisCourse, davisInstructor) {

          // Verify that migration from Berkeley course to Davis course fails
          UsersTestUtil.assertGetMe(davisClient, davisCourse, null, function(davisMe) {
            AssetsTestUtil.assertMigrationFails(berkeleyClient, berkeleyCourse, davisMe.id, 400, function() {
              return callback();
            });
          });
        });
      });
    });

    /**
     * Test that verifies source and destination course must differ
     */
    it('refuses to migrate a course to itself', function(callback) {
      var course = TestsUtil.generateCourse(global.tests.canvas.ucberkeley);
      var instructor = TestsUtil.generateInstructor(global.tests.canvas.ucberkeley);

      // Instructor teaches course
      TestsUtil.getAssetLibraryClient(null, course, instructor, function(client, course, instructor) {

        // Verify that migration from course to itself fails
        UsersTestUtil.assertGetMe(client, course, null, function(me) {
          AssetsTestUtil.assertMigrationFails(client, course, me.id, 400, function() {
            return callback();
          });
        });
      });
    });
  });
});
