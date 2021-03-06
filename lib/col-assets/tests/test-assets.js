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

var AssetsTestUtil = require('./util');
var DB = require('col-core/lib/db');
var LtiTestsUtil = require('col-lti/tests/util');
var Storage = require('col-core/lib/storage');
var TestsUtil = require('col-tests');
var UsersTestUtil = require('col-users/tests/util');
var WhiteboardsTestUtil = require('col-whiteboards/tests/util');

describe('Assets', function() {

  describe('Create new assets', function() {

    describe('Links', function() {

      /**
       * Test that verifies that a new link asset can be created
       */
      it('can be created', function(callback) {
        TestsUtil.getAssetLibraryClient(null, null, null, function(client, course, user) {
          // Create a link asset with no optional metadata
          AssetsTestUtil.assertCreateLink(client, course, 'UC Davis', 'http://www.ucdavis.edu/', null, function(asset) {

            // Create a link asset with no title. This should default the title to the provided URL
            var url = 'http://uci.edu';
            AssetsTestUtil.assertCreateLink(client, course, null, url, null, function(asset) {
              assert.equal(asset.title, url);

              // Create a link asset with optional metadata
              var opts = {
                'description': 'University of California, Berkeley homepage',
                'source': 'http://www.universityofcalifornia.edu/uc-system',
                'thumbnail_url': 'https://previews.s3.amazonaws.com/uploads/110198/352390/thumbnail.jpeg?AWSAccessKeyId=AKIAJ4WBDILJQGNGADIQ&Expires=1761522146&Signature=bU7ABJ8yyb9iX1zK3yvkTd1cl1s%3D',
                'image_url': 'https://previews.s3.amazonaws.com/uploads/110198/352390/image.jpeg?AWSAccessKeyId=AKIAJ4WBDILJQGNGADIQ&Expires=1761522146&Signature=bU7ABJ8yyb9iX1zK3yvkTd1cl1s%3D',
                'pdf_url': 'https://previews.s3.amazonaws.com/uploads/110198/352390/image.jpeg?AWSAccessKeyId=AKIAJ4WBDILJQGNGADIQ&Expires=1761522146&Signature=bU7ABJ8yyb9iX1zK3yvkTd1cl1s%3D',
                'metadata': '{"foo": "bar"}'
              };
              AssetsTestUtil.assertCreateLink(client, course, 'UC Berkeley', 'http://www.berkeley.edu/', opts, function(asset) {

                // Verify that `thumbnail_url`, `image_url`, `pdf_url` and `metadata`
                // were not set as these can only be set through the preview service
                assert.ok(!asset.thumbnail_url);
                assert.ok(!asset.image_url);
                assert.ok(!asset.pdf_url);
                assert.ok(!asset.metadata);

                return callback();
              });
            });
          });
        });
      });

      /**
       * Test that verifies validation when creating a new link asset
       */
      it('is validated', function(callback) {
        TestsUtil.getAssetLibraryClient(null, null, null, function(client, course, user) {
          // Too long title
          AssetsTestUtil.assertCreateLinkFails(client, course, randomstring.generate(256), 'http://www.berkeley.edu/', null, 400, function() {

            // Missing URL
            AssetsTestUtil.assertCreateLinkFails(client, course, 'UC Berkeley', null, null, 400, function() {
              // Invalid URL
              AssetsTestUtil.assertCreateLinkFails(client, course, 'UC Berkeley', 'invalid url', null, 400, function() {
                AssetsTestUtil.assertCreateLinkFails(client, course, 'UC Berkeley', '/invalidurl', null, 400, function() {
                  // Too long URL
                  AssetsTestUtil.assertCreateLinkFails(client, course, 'UC Berkeley', 'http://www.berkeley.edu/?q=' + randomstring.generate(229), null, 400, function() {

                    return callback();
                  });
                });
              });
            });
          });
        });
      });
    });

    describe('file in Amazon S3', function() {

      /**
       * Test verifies file creation against Amazon S3
       */
      it('can be created and stored', function(callback) {
        AssetsTestUtil.setUpAmazonS3BackedCourse(null, function(client, course, user) {
          AssetsTestUtil.assertFileCreateAndStorage(client, course, null, function(assets) {
            // If one asset has S3 URI then we assume they all do.
            client.assets.getAsset(course, assets[0].id, null, function(err, asset) {
              assert.ok(asset);
              assert.ok(Storage.isS3Uri(asset.download_url));

              return callback();
            });
          });
        });
      });

      /**
       * Test that verifies validation when creating a new file asset
       */
      it('is validated', function(callback) {
        AssetsTestUtil.setUpAmazonS3BackedCourse(null, function(client, course, user) {
          // Missing file
          AssetsTestUtil.assertCreateFileFails(client, course, 'UC Berkeley', null, null, 400, function() {
            // Invalid file
            AssetsTestUtil.assertCreateFileFails(client, course, 'UC Berkeley', 'invalid file', null, 400, function() {
              AssetsTestUtil.assertCreateFileFails(client, course, 'UC Berkeley', '42', null, 400, function() {

                // Invalid source
                AssetsTestUtil.assertCreateFileFails(client, course, 'UC Berkeley', AssetsTestUtil.getFileStream('logo-ucberkeley.png'), {'source': 'invalid url'}, 400, function() {
                  AssetsTestUtil.assertCreateFileFails(client, course, 'UC Berkeley', AssetsTestUtil.getFileStream('logo-ucberkeley.png'), {'source': '/invalidurl'}, 400, function() {

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

  describe('Get asset', function() {

    /**
     * Test that verifies that an asset can be retrieved
     */
    it('can be retrieved', function(callback) {
      TestsUtil.getAssetLibraryClient(null, null, null, function(client, course, user) {
        // Create a link asset with no optional metadata
        AssetsTestUtil.assertCreateLink(client, course, 'UC Davis', 'http://www.ucdavis.edu/', null, function(linkAsset1) {
          AssetsTestUtil.assertGetAsset(client, course, linkAsset1.id, linkAsset1, 0, function(asset) {

            // Create a link asset with optional metadata
            var opts = {
              'description': 'University of California, Berkeley homepage',
              'source': 'http://www.universityofcalifornia.edu/uc-system'
            };
            AssetsTestUtil.assertCreateLink(client, course, 'UC Berkeley', 'http://www.berkeley.edu/', opts, function(linkAsset2) {
              AssetsTestUtil.assertGetAsset(client, course, linkAsset2.id, linkAsset2, 0, function(linkAsset2) {

                // Create a file asset with no optional metadata
                AssetsTestUtil.assertCreateFile(client, course, 'UC Berkeley', AssetsTestUtil.getFileStream('logo-ucberkeley.png'), null, function(fileAsset1) {
                  AssetsTestUtil.assertGetAsset(client, course, fileAsset1.id, fileAsset1, 0, function(asset) {

                    // Create a file asset with optional metadata
                    opts = {
                      'description': 'University of California, Berkeley logo',
                      'source': 'http://www.universityofcalifornia.edu/uc-system'
                    };
                    AssetsTestUtil.assertCreateFile(client, course, 'UC Berkeley', AssetsTestUtil.getFileStream('logo-ucberkeley.png'), opts, function(fileAsset2) {
                      AssetsTestUtil.assertGetAsset(client, course, fileAsset2.id, fileAsset2, 0, function(fileAsset2) {

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
     * Test that verifies validation when retrieving an asset
     */
    it('is validated', function(callback) {
      TestsUtil.getAssetLibraryClient(null, null, null, function(client, course, user) {
        AssetsTestUtil.assertCreateLink(client, course, 'UC Davis', 'http://www.ucdavis.edu/', null, function(asset) {

          // Invalid asset id
          AssetsTestUtil.assertGetAssetFails(client, course, 'Not a number', 400, function() {
            AssetsTestUtil.assertGetAssetFails(client, course, -1, 404, function() {
              AssetsTestUtil.assertGetAssetFails(client, course, 234234233, 404, function() {

                return callback();
              });
            });
          });
        });
      });
    });

    /**
     * Test that verifies authorization when retrieving an asset
     */
    it('verifies asset retrieval authorization', function(callback) {
      TestsUtil.getAssetLibraryClient(null, null, null, function(client, course, user) {
        AssetsTestUtil.assertCreateLink(client, course, 'UC Davis', 'http://www.ucdavis.edu/', null, function(asset) {

          // Verify that a user from a different course is not able to retrieve the created asset
          TestsUtil.getAssetLibraryClient(null, null, null, function(otherClient, otherCourse, otherUser) {
            AssetsTestUtil.assertGetAssetFails(otherClient, otherCourse, asset.id, 404, function(asset) {

              return callback();
            });
          });
        });
      });
    });

    /**
     * Test that verifies that the total number of asset views is updated correctly
     */
    it('increments total number of views', function(callback) {
      TestsUtil.getAssetLibraryClient(null, null, null, function(client1, course, user1) {
        TestsUtil.getAssetLibraryClient(null, course, null, function(client2, course, user2) {
          TestsUtil.getAssetLibraryClient(null, course, null, function(client3, course, user3) {
            AssetsTestUtil.assertCreateLink(client1, course, 'UC Davis', 'http://www.ucdavis.edu/', null, function(asset) {
              assert.strictEqual(asset.views, 0);

              // Verify the total number of views is incremented
              AssetsTestUtil.assertGetAsset(client2, course, asset.id, asset, 0, function(asset) {
                assert.strictEqual(asset.views, 1);

                // Verify the total number of views is incremented again when requested by a different user
                AssetsTestUtil.assertGetAsset(client3, course, asset.id, asset, 0, function(asset) {
                  assert.strictEqual(asset.views, 2);

                  // Verify the total number of views is not incremented when requested by asset creator
                  AssetsTestUtil.assertGetAsset(client1, course, asset.id, asset, 0, function(asset) {
                    assert.strictEqual(asset.views, 2);

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

  describe('Hidden assets', function() {

    /**
     * Test that verifies that hidden links can be created
     */
    it('can create hidden links', function(callback) {
      TestsUtil.getAssetLibraryClient(null, null, null, function(client, course, user) {

        // Create a link without specifying its visibility
        AssetsTestUtil.assertCreateLink(client, course, 'UC Davis', 'http://www.ucdavis.edu/', null, function(visibleAsset1) {
          // Create a hidden file
          AssetsTestUtil.assertCreateFile(client, course, 'UC Berkeley', AssetsTestUtil.getFileStream('logo-ucberkeley.png'), {'visible': false}, function(hiddenAsset) {

            // Create a link with visibility explicitly set to true
            AssetsTestUtil.assertCreateLink(client, course, 'UC Irvine', 'http://www.uci.edu/', {'visible': true}, function(visibleAsset2) {

              // Verify that only the visible assets are returned when listing the assets
              AssetsTestUtil.assertGetAssets(client, course, null, null, null, null, 2, function(assets) {
                AssetsTestUtil.assertAsset(assets.results[0], {'expectedAsset': visibleAsset2});
                AssetsTestUtil.assertAsset(assets.results[1], {'expectedAsset': visibleAsset1});

                // Despite the 'hidden' status, user CAN view the asset via the asset detail page.
                AssetsTestUtil.assertGetAsset(client, course, hiddenAsset.id, hiddenAsset, 0, function(asset) {
                  AssetsTestUtil.assertAssetDownloadSucceeds(client, course, hiddenAsset.id, function() {

                    TestsUtil.getAssetLibraryClient(null, null, null, function(client2, course2, user2) {
                      // Download of hidden asset fails for other users
                      AssetsTestUtil.assertAssetDownloadFails(client2, course2, hiddenAsset.id, 404, function() {

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
     * Test that verifies that hidden files can be created
     */
    it('can create hidden files', function(callback) {
      TestsUtil.getAssetLibraryClient(null, null, null, function(client, course, user) {

        // Create a file without specifying its visibility
        AssetsTestUtil.assertCreateFile(client, course, 'UC Davis', AssetsTestUtil.getFileStream('logo-ucberkeley.png'), null, function(visibleAsset1) {
          // Create a hidden file
          AssetsTestUtil.assertCreateFile(client, course, 'UC Berkeley', AssetsTestUtil.getFileStream('logo-ucberkeley.png'), {'visible': false}, function(hiddenAsset) {
            // Create a file with visibility explicitly set to true
            AssetsTestUtil.assertCreateFile(client, course, 'UC Irvine', AssetsTestUtil.getFileStream('logo-ucberkeley.png'), {'visible': true}, function(visibleAsset2) {

              // Verify that only the visible assets are returned when listing the assets
              AssetsTestUtil.assertGetAssets(client, course, null, null, null, null, 2, function(assets) {
                AssetsTestUtil.assertAsset(assets.results[0], {'expectedAsset': visibleAsset2});
                AssetsTestUtil.assertAsset(assets.results[1], {'expectedAsset': visibleAsset1});

                return callback();
              });
            });
          });
        });
      });
    });
  });

  describe('Edit asset', function() {

    /**
     * Test that verifies that an asset can be edited
     */
    it('can be edited', function(callback) {
      TestsUtil.getAssetLibraryClient(null, null, null, function(client, course, user) {
        AssetsTestUtil.assertCreateLink(client, course, 'UC Davis', 'http://www.ucdavis.edu/', null, function(asset) {

          // Verify that the title and the description can be updated
          AssetsTestUtil.assertEditAsset(client, course, asset.id, 'UC Berkeley', {'description': 'University of California, Berkeley'}, function(asset) {

            // Verify that the title can be updated and the description can be cleared
            AssetsTestUtil.assertEditAsset(client, course, asset.id, 'UC Berkeley', null, function(asset) {

              return callback();
            });
          });
        });
      });
    });

    /**
     * Test that verifies validation when editing an asset
     */
    it('is validated', function(callback) {
      TestsUtil.getAssetLibraryClient(null, null, null, function(client, course, user) {
        AssetsTestUtil.assertCreateLink(client, course, 'UC Davis', 'http://www.ucdavis.edu/', null, function(asset) {

          // Invalid asset id
          AssetsTestUtil.assertEditAssetFails(client, course, 'Not a number', 'UC Irvine', null, 400, function() {
            AssetsTestUtil.assertEditAssetFails(client, course, -1, 'UC Irvine', null, 404, function() {
              AssetsTestUtil.assertEditAssetFails(client, course, 234234233, 'UC Irvine', null, 404, function() {

                // Missing title
                AssetsTestUtil.assertEditAssetFails(client, course, asset.id, null, null, 400, function() {
                  AssetsTestUtil.assertEditAssetFails(client, course, asset.id, '', null, 400, function() {
                    // Too long title
                    AssetsTestUtil.assertEditAssetFails(client, course, asset.id, randomstring.generate(256), null, 400, function() {

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
     * Test that verifies authorization when editing an asset
     */
    it('verifies authorization', function(callback) {
      TestsUtil.getAssetLibraryClient(null, null, null, function(client1, course1, user1) {
        AssetsTestUtil.assertCreateLink(client1, course1, 'UC Davis', 'http://www.ucdavis.edu/', null, function(asset) {

          // Verify that the asset can be edited by the user that added the asset
          AssetsTestUtil.assertEditAsset(client1, course1, asset.id, 'UC Berkeley', null, function(asset) {

            // Verify that the asset can be edited by an instructor of the course
            var instructor1 = TestsUtil.generateInstructor();
            TestsUtil.getAssetLibraryClient(null, course1, instructor1, function(client2, course1, instructor1) {
              AssetsTestUtil.assertEditAsset(client1, course1, asset.id, 'UCLA', null, function(asset) {

                // Verify that an asset can not be edited by a regular student
                TestsUtil.getAssetLibraryClient(null, course1, null, function(client3, course1, user2) {
                  AssetsTestUtil.assertEditAssetFails(client3, course1, asset.id, 'UC Irvine', null, 401, function() {

                    // Verify that an instructor in a different course can not edit the asset
                    var instructor2 = TestsUtil.generateInstructor();
                    TestsUtil.getAssetLibraryClient(null, null, instructor2, function(client4, course2, instructor2) {
                      AssetsTestUtil.assertEditAssetFails(client4, course2, asset.id, 'UC Irvine', null, 404, function() {

                        // Verify that the asset has not been updated
                        AssetsTestUtil.assertGetAsset(client1, course1, asset.id, asset, 0, function(asset) {

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

  describe('Delete asset', function() {

    /**
     * Test that verifies that an asset can be deleted by an administrator
     */
    it('can be deleted by instructor', function(callback) {
      var instructor = TestsUtil.generateInstructor();
      TestsUtil.getAssetLibraryClient(null, null, instructor, function(client1, course, instructor) {
        AssetsTestUtil.assertCreateLink(client1, course, 'UC Berkeley', 'http://www.ucberkeley.edu/', null, function(asset1) {

          // Verify that the asset can be deleted
          AssetsTestUtil.assertDeleteAsset(client1, course, asset1.id, function() {

            // Verify that an asset with likes and comments can be deleted
            AssetsTestUtil.assertCreateLink(client1, course, 'UC Davis', 'http://www.ucdavis.edu/', null, function(asset2) {
              // Like the asset
              TestsUtil.getAssetLibraryClient(null, course, null, function(client2, course, user2) {
                AssetsTestUtil.assertLike(client2, course, asset2.id, true, function() {
                  // Add a comment to the asset
                  TestsUtil.getAssetLibraryClient(null, course, null, function(client3, course, user3) {
                    AssetsTestUtil.assertCreateComment(client3, course, asset2.id, 'Comment 1', null, function(comment) {
                      // Verify that the asset can be deleted
                      AssetsTestUtil.assertDeleteAsset(client1, course, asset2.id, function() {

                        // Sanity check there are no assets in the asset library
                        AssetsTestUtil.assertGetAssets(client1, course, null, null, null, null, 0, function(assets) {
                          assert.strictEqual(assets.total, 0);
                          assert.strictEqual(assets.results.length, 0);
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
     * Test that verifies that an asset with no interactions can be deleted by an associated user
     */
    it('can be deleted by user', function(callback) {
      TestsUtil.getAssetLibraryClient(null, null, null, function(client1, course, user1) {
        AssetsTestUtil.assertCreateLink(client1, course, 'UC Berkeley', 'http://www.ucberkeley.edu/', null, function(asset1) {

          // Verify that a different user cannot delete the asset
          TestsUtil.getAssetLibraryClient(null, course, null, function(client2, course, user2) {
            AssetsTestUtil.assertDeleteAssetFails(client2, course, asset1.id, 401, function() {
              //Verify that the creator can delete the asset
              AssetsTestUtil.assertDeleteAsset(client1, course, asset1.id, function() {

                // Create an asset with comments
                AssetsTestUtil.assertCreateLink(client1, course, 'UC Davis', 'http://www.ucdavis.edu/', null, function(asset2) {
                  AssetsTestUtil.assertCreateComment(client2, course, asset2.id, 'Comment 1', null, function(comment) {
                    // Verify that the creator cannot delete the commented asset
                    AssetsTestUtil.assertDeleteAssetFails(client1, course, asset2.id, 401, function() {

                      // Create an asset with likes
                      AssetsTestUtil.assertCreateLink(client1, course, 'UC Riverside', 'http://www.ucr.edu/', null, function(asset3) {
                        AssetsTestUtil.assertLike(client2, course, asset3.id, true, function() {
                          // Verify that the creator cannot delete the liked asset
                          AssetsTestUtil.assertDeleteAssetFails(client1, course, asset3.id, 401, function() {

                            // Create an asset for use in a whiteboard
                            AssetsTestUtil.assertCreateLink(client1, course, 'UC Riverside', 'http://www.ucr.edu/', null, function(asset4) {
                              AssetsTestUtil.mockPreviewData(asset4, function() {
                                UsersTestUtil.assertGetMe(client1, course, null, function(user1Me) {
                                  WhiteboardsTestUtil.assertCreateWhiteboard(client1, course, 'UC Riverside Whiteboard', [user1Me.id], function(whiteboard) {
                                    WhiteboardsTestUtil.addAssetToWhiteboard(client1, course, asset4, whiteboard, function() {
                                      // Verify that the creator cannot delete the used asset
                                      AssetsTestUtil.assertDeleteAssetFails(client1, course, asset4.id, 401, function() {

                                        // Export the whiteboard and remove asset from active whiteboard
                                        WhiteboardsTestUtil.assertExportWhiteboardToAsset(client1, course, whiteboard.id, null, null, function(exportedAsset) {
                                          WhiteboardsTestUtil.removeAssetFromWhiteboard(client1, course, asset4, whiteboard, function() {
                                            // Verify that the creator cannot delete the asset
                                            AssetsTestUtil.assertDeleteAssetFails(client1, course, asset4.id, 401, function() {

                                              // Delete the exported whiteboard
                                              AssetsTestUtil.assertDeleteAsset(client1, course, exportedAsset.id, function() {
                                                // Verify that the creator can delete the asset
                                                AssetsTestUtil.assertDeleteAsset(client1, course, asset4.id, function() {

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
     * Test that verifies validation when deleting a category
     */
    it('is validated', function(callback) {
      var instructor = TestsUtil.generateInstructor();
      TestsUtil.getAssetLibraryClient(null, null, instructor, function(client, course, instructor) {
        AssetsTestUtil.assertCreateLink(client, course, 'UC Berkeley', 'http://www.ucberkeley.edu/', null, function(asset) {

          // Invalid asset id
          AssetsTestUtil.assertDeleteAssetFails(client, course, 'Not a number', 400, function() {
            AssetsTestUtil.assertDeleteAssetFails(client, course, -1, 404, function() {
              AssetsTestUtil.assertDeleteAssetFails(client, course, 234234233, 404, function() {

                return callback();
              });
            });
          });
        });
      });
    });

    /**
     * Test that verifies authorization when deleting a category
     */
    it('verifies authorization', function(callback) {
      var instructor1 = TestsUtil.generateInstructor();
      TestsUtil.getAssetLibraryClient(null, null, instructor1, function(client1, course1, instructor1) {
        AssetsTestUtil.assertCreateLink(client1, course1, 'UC Berkeley', 'http://www.ucberkeley.edu/', null, function(asset1) {

          // Verify that an asset can not be deleted by a non-administrator
          TestsUtil.getAssetLibraryClient(null, course1, null, function(client2, course, user2) {
            AssetsTestUtil.assertDeleteAssetFails(client2, course1, asset1.id, 401, function() {

              // Verify that the asset has not been deleted
              AssetsTestUtil.assertGetAsset(client2, course1, asset1.id, asset1, 0, function() {

                // Verify that an asset in a different course can not be deleted
                var instructor2 = TestsUtil.generateInstructor();
                TestsUtil.getAssetLibraryClient(null, null, instructor2, function(client3, course2, instructor2) {
                  AssetsTestUtil.assertCreateLink(client3, course2, 'UC Davis', 'http://www.ucdavis.edu/', null, function(asset2) {
                    AssetsTestUtil.assertDeleteAssetFails(client1, course2, asset2.id, 401, function() {

                      // Verify that the asset has not been deleted
                      AssetsTestUtil.assertGetAsset(client3, course2, asset2.id, asset2, 0, function() {

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

  describe('Remix an exported whiteboard', function() {

    /**
     * Test that verifies that an exported whiteboard asset can be remixed
     */
    it('can be remixed', function(callback) {
      AssetsTestUtil.setupExportedWhiteboard(null, null, null, null, null, function(client1, client2, course, user1, user2, exportedWhiteboard) {
        AssetsTestUtil.assertRemixWhiteboard(client1, course, exportedWhiteboard, function() {

          return callback();
        });
      });
    });

    /**
     * Test that verifies that non-whiteboard assets are rejected
     */
    it('rejects assets that are not whiteboards', function(callback) {
      TestsUtil.getAssetLibraryClient(null, null, null, function(client, course, user) {
        AssetsTestUtil.assertCreateLink(client, course, 'UC Davis', 'http://www.ucdavis.edu/', null, function(asset) {
          AssetsTestUtil.assertRemixWhiteboardFails(client, course, asset, 400, function() {

            return callback();
          });
        });
      });
    });

    /**
     * Test that verifies authorization when remixing an exported whiteboard
     */
    it('verifies authorization', function(callback) {
      AssetsTestUtil.setupExportedWhiteboard(null, null, null, null, null, function(client1, client2, course, user1, user2, exportedWhiteboard) {

        // Verify that a user in a different course can't remix the whiteboard
        TestsUtil.getAssetLibraryClient(null, null, null, function(foreignClient, foreignCourse, foreignUser) {
          AssetsTestUtil.assertRemixWhiteboardFails(foreignClient, foreignCourse, exportedWhiteboard, 404, function() {

            // Verify that an administrator in a different course can't remix the whiteboard
            var instructor = TestsUtil.generateInstructor();
            TestsUtil.getAssetLibraryClient(null, foreignCourse, instructor, function(instructorClient, foreignCourse, instructor) {
              AssetsTestUtil.assertRemixWhiteboardFails(instructorClient, foreignCourse, exportedWhiteboard, 404, function() {

                return callback();
              });
            });
          });
        });
      });
    });
  });

  describe('Badges', function() {

    /**
     * Test that verifies badges on impactful assets
     */
    it('awards badges to impactful assets', function(callback) {
      // Create impactful assets and retrieve them in impactful order.
      AssetsTestUtil.setupImpactfulAssets(function(assets, client1, client2, client3, client4, course, user1, user2, user3, user4) {
        AssetsTestUtil.assertGetAssets(client1, course, null, 'impact', 12, null, 12, function(assets) {

          // No one gets a badge if the Impact Studio is not enabled.
          AssetsTestUtil.assertBadges(assets, []);

          // Launch the Impact Studio and refresh the assets.
          LtiTestsUtil.assertImpactStudioLaunchSucceeds(client4, course, user4, function() {
            AssetsTestUtil.assertGetAssets(client1, course, null, 'impact', 12, null, 12, function(assets) {
              // The two most impactful assets should have badges.
              AssetsTestUtil.assertBadges(assets, [0, 1]);

              // Individual asset views should also return the expected badge information.
              AssetsTestUtil.assertGetAsset(client1, course, assets.results[0].id, null, null, function(asset) {
                assert.ok(asset.badged);
                AssetsTestUtil.assertGetAsset(client1, course, assets.results[2].id, null, null, function(asset) {
                  assert.ok(!asset.badged);

                  // An instructor and student co-create a highly impactful exported whiteboard.
                  var instructor = TestsUtil.generateInstructor();
                  TestsUtil.getAssetLibraryClient(null, course, instructor, function(instructorClient, course, instructor) {
                    AssetsTestUtil.setupExportedWhiteboard(client1, instructorClient, course, user1, instructor, function(client1, instructorClient, course, user1, instructor, exportedWhiteboard) {
                      AssetsTestUtil.assertRemixWhiteboard(client2, course, exportedWhiteboard, function() {
                        AssetsTestUtil.assertRemixWhiteboard(client3, course, exportedWhiteboard, function() {
                          AssetsTestUtil.assertGetAssets(client1, course, null, 'impact', 13, null, 13, function(assets) {

                            // The much-remixed whiteboard is at the top of the charts, but is not eligible for a badge, so the two
                            // previously badged assets retain their badges.
                            assert.strictEqual(assets.results[0].type, 'whiteboard');
                            AssetsTestUtil.assertBadges(assets, [1, 2]);

                            // An individual asset view on the instructor asset should also suppress the badge.
                            AssetsTestUtil.assertGetAsset(client1, course, assets.results[0].id, null, null, function(asset) {
                              assert.ok(!asset.badged);

                              // Two students co-create an even more impactful exported whiteboard.
                              AssetsTestUtil.setupExportedWhiteboard(client1, client2, course, user1, user2, function(client1, client2, course, user1, user2, exportedWhiteboard) {
                                AssetsTestUtil.assertRemixWhiteboard(client3, course, exportedWhiteboard, function() {
                                  AssetsTestUtil.assertRemixWhiteboard(client4, course, exportedWhiteboard, function() {
                                    AssetsTestUtil.assertRemixWhiteboard(instructorClient, course, exportedWhiteboard, function() {

                                      // The student whiteboard is now at the top of the charts and has a badge. The more impactful of the previously badged
                                      // assets retains its badge; the less impactful has lost its badge.
                                      AssetsTestUtil.assertGetAssets(client1, course, null, 'impact', 14, null, 14, function(assets) {
                                        assert.strictEqual(assets.results[0].type, 'whiteboard');
                                        AssetsTestUtil.assertBadges(assets, [0, 2]);

                                        // With extreme prejudice, the instructor deletes a bunch of less impactful assets.
                                        AssetsTestUtil.assertDeleteAsset(client1, course, assets.results[10].id, function() {
                                          AssetsTestUtil.assertDeleteAsset(client1, course, assets.results[11].id, function() {
                                            AssetsTestUtil.assertDeleteAsset(client1, course, assets.results[12].id, function() {
                                              AssetsTestUtil.assertDeleteAsset(client1, course, assets.results[13].id, function() {

                                                // We now have ten assets in the course, but because one of the assets is instructor-associated, only nine assets are
                                                // badge-eligible. Everyone's fun is spoiled and no one gets a badge.
                                                AssetsTestUtil.assertGetAssets(client1, course, null, 'impact', 10, null, 10, function(assets) {
                                                  AssetsTestUtil.assertBadges(assets, []);

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
