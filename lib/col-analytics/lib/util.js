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

var CourseAPI = require('col-course');
var EventTypes = require('./constants');

/**
 * Certain object metadata is static and available elsewhere in the SuiteC schema. For example,
 * the 'asset_created_at' property. Other metadata is esoteric (e.g., 'whiteboard_element_scale_y')
 * and of little value. The 'events' table is best used to track properties that change over time,
 * like 'asset_views'.
 *
 * @return {Array}                  Event metadata properties to exclude from 'events' table
 */
var EVENT_METADATA_BLACKLIST = [
  'asset_categories',
  'asset_created_at',
  'asset_description_hashtag',
  'asset_description_length',
  'asset_dislikes',
  'asset_image_url',
  'asset_liked',
  'asset_mime',
  'asset_source',
  'asset_thumbnail_url',
  'asset_type',
  'asset_url',
  'asset_users',
  'comment_body_length',
  'comment_created_at',
  'comment_is_reply',
  'comment_parent_id',
  'whiteboard_batch_total',
  'whiteboard_chat_body',
  'whiteboard_chat_length',
  'whiteboard_created_at',
  'whiteboard_element_angle',
  'whiteboard_element_background_color',
  'whiteboard_element_fill',
  'whiteboard_element_index',
  'whiteboard_element_left',
  'whiteboard_element_scale_x',
  'whiteboard_element_scale_y',
  'whiteboard_element_stroke',
  'whiteboard_element_stroke_width',
  'whiteboard_element_text',
  'whiteboard_element_top',
  'whiteboard_element_type',
  'whiteboard_elements',
  'whiteboard_image_url',
  'whiteboard_thumbnail_url'
];

/**
 * We lazy init this variable. It is an inverted form of the EventTypes object.
 */
var categoriesPerEventName = null;

/**
 * Retrieve course associated with user, if not already present
 *
 * @param  {User}           user              The user associated with the event
 * @param  {Function}       callback          Standard callback function
 * @param  {Object}         callback.err      An error that occurred, if any
 * @param  {Asset}          callback.course   The requested course object
 * @return {void}
 */
var getCourseIfMissing = module.exports.getCourseIfMissing = function(user, callback) {
  if (user.course) {
    return callback(null, user.course);
  }

  CourseAPI.getCourse(user.course_id, callback);
};

/**
 * We do our best to find, for example, asset_id
 *
 * @param  {Object}         object            Asset, Whiteboard or similar (might contain multiple primary ids)
 * @param  {String}         key               For example, 'id' or 'asset_id'
 * @param  {Object}         metadata          Arbitrary set of ids and descriptors
 * @param  {Asset}          metadataKey       For example, 'whiteboard_id' or 'asset_id'
 * @return {Number}                           Object identifier
 */
var getObjectId = function(object, key, metadata, metadataKey) {
  return _.get(object, key) || _.get(object, metadataKey) || _.get(metadata, metadataKey);
};

/**
 * Extract relevant object ids per event type.
 *
 * @param  {String}         eventName                         The event type
 * @param  {Object}         metadata                          Event metadata
 * @param  {Object}         [object]                          [Optional] Object associated with the event
 * @param  {Object}         [contextObject]                   [Optional] Additional context (e.g., the asset associated with a comment)
 * @param  {Function}       callback                          Standard callback
 * @param  {Object}         [callback.err]                    Error, if any
 * @param  {Number}         [callback.activityId]             Object id
 * @param  {Number}         [callback.assetId]                Object id
 * @param  {Number}         [callback.commentId]              Object id
 * @param  {Number}         [callback.whiteboardId]           Object id
 * @param  {Number}         [callback.whiteboardElementUid]   Object id
 * @return {void}
 */
var describeEvent = module.exports.describeEvent = function(eventName, metadata, object, contextObject, callback) {
  var err = null;
  var activityId = null;
  var assetId = null;
  var commentId = null;
  var whiteboardId = null;
  var whiteboardElementUid = null;
  var c = getCategoriesPerEvent(eventName);

  if (_.size(c) === 2) {
    var category = c[0];
    var subCategory = c[1];
    switch (category) {
      case 'asset':
        assetId = getObjectId(object, 'id', metadata, 'asset_id');
        whiteboardId = _.get(object, 'whiteboard_id') || _.get(metadata, 'whiteboard_id');
        break;
      case 'assetComment':
        commentId = getObjectId(object, 'id', metadata, 'comment_id');
        assetId = _.get(object, 'asset_id') || getObjectId(contextObject, 'id', metadata, 'asset_id');
        break;
      case 'whiteboard':
        whiteboardId = getObjectId(object, 'id', metadata, 'whiteboard_id');
        assetId = _.get(object, 'asset_id') || getObjectId(contextObject, 'id', metadata, 'asset_id');
        break;
      case 'whiteboardChat':
        // object.id is chatMessage.id
        whiteboardId = getObjectId(contextObject, 'id', metadata, 'whiteboard_id');
        break;
      case 'whiteboardElement':
        whiteboardElementUid = getObjectId(object, 'uid', metadata, 'whiteboard_element_uid');
        whiteboardId = _.get(object, 'whiteboard_id') || getObjectId(contextObject, 'id', metadata, 'whiteboard_id');
        assetId = _.get(object, 'asset_id') || _.get(metadata, 'whiteboard_element_asset_id');
        break;
      case 'assets':
      case 'bookmarklet':
      case 'engagementIndex':
      case 'ltiLaunch':
      case 'profile':
      case 'whiteboards':
        // No object association
        break;
      default:
        log.warn('Unrecognized event category: ' + category);
    }
  } else {
    err = {
      message: 'Unrecognized or wrongly-worded event name: ' + eventName
    };
  }
  callback(err, activityId, assetId, commentId, whiteboardId, whiteboardElementUid);
};

/**
 * Remove unnecessary and duplicative metadata.
 *
 * @param  {Object}         metadata                  Event metadata
 * @param  {Number}         activityId]               Object id
 * @param  {Number}         assetId                   Object id
 * @param  {Number}         commentId                 Object id
 * @param  {Number}         whiteboardId              Object id
 * @param  {Number}         whiteboardElementUid      Object id
 * @param  {Function}       callback                  Standard callback
 * @param  {Object}         callback.metadata         Filtered metadata; discard the useless stuff
 * @return {void}
 */
var scrubMetadata = module.exports.scrubMetadata = function(
  metadata,
  activityId,
  assetId,
  commentId,
  whiteboardId,
  whiteboardElementUid,
  callback
) {
  // Exclude the extraneous stuff
  var exclusions = EVENT_METADATA_BLACKLIST;
  // Object ids, if present, can be excluded from metadata.
  if (activityId) {
    exclusions.push('activity_id', 'activityId');
  }
  if (assetId) {
    exclusions.push('asset_id', 'assetId');
  }
  if (commentId) {
    exclusions.push('comment_id');
  }
  if (whiteboardId) {
    exclusions.push('whiteboard_id');
  }
  if (whiteboardElementUid) {
    exclusions.push('whiteboard_element_uid', 'whiteboard_element_id');
  }
  var scrubbed = _.omit(metadata, exclusions);
  // Omit metadata entries with nil value
  return callback(_.omitBy(scrubbed, _.isNil));
};

/**
 * Retrieve event category, sub-category associated with event name.
 *
 * @param  {String}     eventName       Human readable name of event
 * @return {Array}                      Category, sub-category of event
 */
var getCategoriesPerEvent = function(eventName) {
  // Lazy init
  if (categoriesPerEventName === null) {
    categoriesPerEventName = {};
    _.each(EventTypes, function(entries, category) {
      _.each(entries, function(message, subCategory) {
        categoriesPerEventName[message] = [category, subCategory];
      });
    });
  }
  return categoriesPerEventName[eventName];
};
