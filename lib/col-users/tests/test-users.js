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

var MockedRequest = require('col-tests/lib/model').MockedRequest;
var TestsUtil = require('col-tests');
var UsersTestUtil = require('col-users/tests/util');

describe('Users', function() {

  describe('Me', function() {

    /**
     * Test that verifies that the me feed can be retrieved
     */
    it('can be retrieved', function(callback) {
      TestsUtil.getAssetLibraryClient(null, null, null, function(client, course, user) {
        UsersTestUtil.assertGetMe(client, course, null, function(me) {
          assert.ok(!_.isUndefined(me.points));

          return callback();
        });
      });
    });

    /**
     * Test that verifies the security of /user/:id feed
     */
    it('can exclude sensitive user data', function(callback) {
      TestsUtil.getAssetLibraryClient(null, null, null, function(client1, course) {
        UsersTestUtil.assertUpdateSharePoints(client1, course, false, function(user1) {
          // We must toggle 'share_points' in order to give user defined 'points' value (e.g., zero)
          assert.ok(!user1.share_points && user1.points >= 0);

          TestsUtil.getAssetLibraryClient(null, course, null, function(client2, course, user2) {

            // Email address and points are excluded when user2 views user1
            UsersTestUtil.assertGetUser(client2, course, user1.id, function(user1) {
              assert.ok(_.isUndefined(user1.share_points));
              assert.ok(_.isUndefined(user1.points));
              assert.ok(_.isUndefined(user1.canvas_email));

              // Finally, verify that points are served in proper circumstance
              var admin = TestsUtil.generateUser(null, null, 'urn:lti:role:ims/lis/Instructor');
              TestsUtil.getAssetLibraryClient(null, course, admin, function(client3, course, admin) {
                UsersTestUtil.assertGetUser(client3, course, user1.id, function(user1) {
                  assert.ok(user1.points >= 0);
                  assert.ok(user1.canvas_email);

                  return callback();
                });
              });
            });
          });
        });
      });
    });

    /**
     * Test that verifies that administrators and non-administrators are
     * correctly identified
     */
    it('correctly identifies admins', function(callback) {
      // Verify that all admin roles are correctly returned as admins
      var admin1 = TestsUtil.generateUser(null, null, 'urn:lti:role:ims/lis/Instructor');
      TestsUtil.getAssetLibraryClient(null, null, admin1, function(client, course, user) {
        UsersTestUtil.assertGetMe(client, course, null, function(me) {
          assert.strictEqual(me.is_admin, true);

          var admin2 = TestsUtil.generateUser(null, null, 'urn:lti:role:ims/lis/ContentDeveloper');
          TestsUtil.getAssetLibraryClient(null, null, admin2, function(client, course, user) {
            UsersTestUtil.assertGetMe(client, course, null, function(me) {
              assert.strictEqual(me.is_admin, true);

              var admin3 = TestsUtil.generateUser(null, null, 'urn:lti:role:ims/lis/TeachingAssistant');
              TestsUtil.getAssetLibraryClient(null, null, admin3, function(client, course, user) {
                UsersTestUtil.assertGetMe(client, course, null, function(me) {
                  assert.strictEqual(me.is_admin, true);

                  var admin4 = TestsUtil.generateUser(null, null, 'Instructor,urn:lti:role:ims/lis/TeachingAssistant');
                  TestsUtil.getAssetLibraryClient(null, null, admin4, function(client, course, user) {
                    UsersTestUtil.assertGetMe(client, course, null, function(me) {
                      assert.strictEqual(me.is_admin, true);

                      var admin5 = TestsUtil.generateUser(null, null, 'urn:lti:role:ims/lis/Instructor,FooBar');
                      TestsUtil.getAssetLibraryClient(null, null, admin5, function(client, course, user) {
                        UsersTestUtil.assertGetMe(client, course, null, function(me) {
                          assert.strictEqual(me.is_admin, true);

                          // Verify that other roles are not returned as admins
                          var nonAdmin1 = TestsUtil.generateUser(null, null, 'Student');
                          TestsUtil.getAssetLibraryClient(null, null, nonAdmin1, function(client, course, user) {
                            UsersTestUtil.assertGetMe(client, course, null, function(me) {
                              assert.strictEqual(me.is_admin, false);

                              var nonAdmin2 = TestsUtil.generateUser(null, null, 'FooBar');
                              TestsUtil.getAssetLibraryClient(null, null, nonAdmin2, function(client, course, user) {
                                UsersTestUtil.assertGetMe(client, course, null, function(me) {
                                  assert.strictEqual(me.is_admin, false);

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

  describe('Get users', function() {

    /**
     * Test that verifies that the users for the current course can be listed
     */
    it('can be retrieved', function(callback) {
      TestsUtil.getAssetLibraryClient(null, null, null, function(client1, course, user1) {
        TestsUtil.getAssetLibraryClient(null, course, null, function(client2, course, user2) {
          TestsUtil.getAssetLibraryClient(null, course, null, function(client3, course, user3) {

            UsersTestUtil.assertGetAllUsers(client1, course, 3, function(users) {
              var expectedUserNames = _.map([user1, user2, user3], 'fullName').sort();
              var retrievedUserNames = _.map(users, 'canvas_full_name').sort();
              assert.deepEqual(retrievedUserNames, expectedUserNames);
              return callback();
            });
          });
        });
      });
    });

    // TODO: Users synchronized through the Canvas poller but who haven't launched into the tool should appear as well
  });


  describe('Edit users', function() {

    describe('Update personal bio', function() {

      /**
       * Test verifies that we can edit and retrieve user's personal bio
       */
      it('can modify', function(callback) {
        TestsUtil.getAssetLibraryClient(null, null, null, function(client, course, user) {
          var expectedBio = 'I am not a crook.';

          UsersTestUtil.assertUpdatePersonalBio(client, course, expectedBio, function(user) {
            assert.equal(expectedBio, user.personal_bio);
            return callback();
          });
        });
      });

      /**
       * Test that verifies validation when updating user's personal bio
       */
      it('is validated', function(callback) {
        TestsUtil.getAssetLibraryClient(null, null, null, function(client, course, user) {

          // Invalid personal bio
          UsersTestUtil.assertUpdatePersonalBioFails(client, course, randomstring.generate(257), 400, function() {

            // Verify that can be set to empty
            UsersTestUtil.assertUpdatePersonalBio(client, course, '', function(me) {

              // Verify updated personal_bio
              UsersTestUtil.assertGetMe(client, course, me, function(me) {
                assert.ok(!me.personal_bio);

                return callback();
              });
            });
          });
        });
      });
    });
  });

  describe('Looking for collaborators', function() {

    it('can be turned on and off', function(callback) {
      TestsUtil.getAssetLibraryClient(null, null, null, function(client, course, user) {

        // "Looking for collaborators" starts out disabled
        UsersTestUtil.assertGetMe(client, course, null, function(me) {
          assert.strictEqual(me.looking_for_collaborators, false);

          // Turn on "looking for collaborators"
          UsersTestUtil.assertUpdateLookingForCollaborators(client, course, true, function(me) {
            // Verify the value has changed on subsequent feed retrieval
            UsersTestUtil.assertGetMe(client, course, me, function(me) {

              // Turn it back off and verify updated feed
              UsersTestUtil.assertUpdateLookingForCollaborators(client, course, false, function(me) {
                UsersTestUtil.assertGetMe(client, course, me, function(me) {

                  return callback();
                });
              });
            });
          });
        });
      });
    });

    it('is validated', function(callback) {
      TestsUtil.getAssetLibraryClient(null, null, null, function(client, course, user) {

        // Post invalid status values
        UsersTestUtil.assertUpdateLookingForCollaboratorsFails(client, course, 'Not a boolean', 400, function() {
          UsersTestUtil.assertUpdateLookingForCollaboratorsFails(client, course, null, 400, function() {
            UsersTestUtil.assertUpdateLookingForCollaboratorsFails(client, course, undefined, 400, function() {

              // Verify that the status remains default false
              UsersTestUtil.assertGetMe(client, course, null, function(me) {
                assert.strictEqual(me.looking_for_collaborators, false);

                return callback();
              });
            });
          });
        });
      });
    });
  });
});
