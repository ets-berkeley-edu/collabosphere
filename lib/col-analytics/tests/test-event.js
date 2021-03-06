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
var util = require('util');

var AnalyticsTestsUtil = require('./util');
var AssetsTestUtil = require('col-assets/tests/util');
var EventTypes = require('../lib/constants');
var LtiTestsUtil = require('col-lti/tests/util');
var TestsUtil = require('col-tests');
var WhiteboardsTestsUtil = require('col-whiteboards/tests/util');

describe('Analytics', function() {
  describe('Event', function() {

    it('API endpoint tracks event metadata', function(callback) {
      TestsUtil.getAssetLibraryClient(null, null, null, function(client, course, user) {
        var eventName = EventTypes.asset.openFromWhiteboard;
        var assetId = 1;
        var whiteboardId = 2;
        var eventMetadata = {
          asset_id: assetId,
          asset_title: 'Divine Hammer',
          asset_updated_at: '2018-02-13T00:22:15.591Z',
          whiteboard_id: whiteboardId,
          whiteboard_title: 'No Aloha',
          whiteboard_updated_at: '2018-02-13T00:22:15.591Z',
          comment_id: null,
          comment_updated_at: undefined
        };
        // Create event
        AnalyticsTestsUtil.assertTrackAPI(client, course, eventName, eventMetadata, null, assetId, null, whiteboardId, null, function(apiErr) {
          assert.ifError(apiErr);
          // Get newly created event
          AnalyticsTestsUtil.getMostRecentEvent(course, user, function(err, event) {
            assert.ifError(err);
            assert.ok(event);
            var metadata = event.event_metadata;
            assert.ok(metadata);
            assert.ok(_.isUndefined(metadata.asset_id));
            assert.ok(_.isUndefined(metadata.whiteboard_id));
            // We expect metadata entries with nil value to be removed
            assert.ok(_.isUndefined(metadata.comment_id));
            assert.ok(_.isUndefined(metadata.comment_updated_at));

            // Verify event
            var idSet = {
              assetId: assetId,
              whiteboardId: whiteboardId
            };
            AnalyticsTestsUtil.assertEvent(event, eventName, user, course, idSet, function() {
              return callback();
            });
          });
        });
      });
    });

    describe('Asset', function() {
      it('tracks Like event', function(callback) {
        TestsUtil.getAssetLibraryClient(null, null, null, function(client1, course1, user1) {
          // Create asset
          AssetsTestUtil.assertCreateLink(client1, course1, 'Super Disco Hits', 'http://www.k-tel.com/', null, function(asset) {
            TestsUtil.getAssetLibraryClient(null, course1, null, function(client2, course2, user2) {
              // Other user likes asset
              AssetsTestUtil.assertLike(client2, course2, asset.id, true, function() {
                AnalyticsTestsUtil.getMostRecentEvent(course2, user2, function(err, event) {
                  assert.ifError(err);
                  // Verify event
                  AnalyticsTestsUtil.assertEvent(event, EventTypes.asset.like, user2, course2, null, callback);
                });
              });
            });
          });
        });
      });
    });

    describe('Asset comment', function() {
      it('tracks \'create\' event', function(callback) {
        TestsUtil.getAssetLibraryClient(null, null, null, function(client, course, user) {
          // Create asset and comment
          AssetsTestUtil.assertCreateLink(client, course, 'The Swinging Sixties', 'http://www.theswingingsixties.info/', null, function(asset) {
            AssetsTestUtil.assertCreateComment(client, course, asset.id, 'Dig that sound!', null, function(comment) {
              // Verify event
              AnalyticsTestsUtil.getMostRecentEvent(course, user, function(err, event) {
                assert.ifError(err);
                var ids = {
                  assetId: asset.id,
                  commentId: comment.id
                };
                AnalyticsTestsUtil.assertEvent(event, EventTypes.assetComment.create, user, course, ids, callback);
              });
            });
          });
        });
      });
    });
  });

  describe('Whiteboard element', function() {
    it('tracks \'create\' event', function(callback) {
      TestsUtil.getAssetLibraryClient(null, null, null, function(client, course, user) {
        WhiteboardsTestsUtil.assertCreateWhiteboard(client, course, 'UC Berkeley Whiteboard', null, function(whiteboard) {
          // Verify whiteboard event
          AnalyticsTestsUtil.getMostRecentEvent(course, user, function(err1, event1) {
            assert.ifError(err1);

            AnalyticsTestsUtil.assertEvent(event1, EventTypes.whiteboard.create, user, course, {whiteboardId: whiteboard.id}, function() {
              // Next, add element to whiteboard
              WhiteboardsTestsUtil.addElementsToWhiteboard(client, course, whiteboard, function(elements) {
                var element = _.last(elements);

                // Verify whiteboardElement event
                AnalyticsTestsUtil.getMostRecentEvent(course, user, function(err2, event2) {
                  assert.ifError(err2);
                  var ids = {
                    whiteboardId: whiteboard.id,
                    whiteboardElementUid: element.id
                  };

                  AnalyticsTestsUtil.assertEvent(event2, EventTypes.whiteboardElement.create, user, course, ids, callback);
                });
              });
            });
          });
        });
      });
    });
  });
});
