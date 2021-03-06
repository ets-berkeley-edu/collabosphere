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

var ActivitiesAPI = require('col-activities');
var CategoriesAPI = require('col-categories');
var CollabosphereConstants = require('col-core/lib/constants');
var DB = require('col-core/lib/db');
var log = require('col-core/lib/logger')('col-assets');
var UserConstants = require('col-users/lib/constants');

/**
 * Determine whether a user is authorized to delete an asset. Assets with no interactions may be deleted
 * by associated users. Assets with interactions may be deleted only by course administrators.
 *
 * @param  {User}         user              The user to perform the authorization check for
 * @param  {Asset}        asset             The asset to be deleted
 */
var canDeleteAsset = module.exports.canDeleteAsset = function(user, asset) {
  if (user.is_admin) {
    return true;
  } else {
    var isAssociatedUser = _.find(asset.users, {'id': user.id});
    var hasNoInteractions = !(asset.comment_count || asset.dislikes || asset.likes) &&
      _.isEmpty(asset.whiteboard_usages) &&
      _.isEmpty(asset.exported_whiteboards);
    return isAssociatedUser && hasNoInteractions;
  }
};

/**
 * Increment the view count for an asset if required
 *
 * @param  {Context}        ctx                     Standard context containing the current user and the current course
 * @param  {Asset}          asset                   The asset for which to increment the view count
 * @param  {Boolean}        incrementViews          Whether to increment the asset's view count or not
 * @param  {Function}       callback                Standard callback function
 * @param  {Object}         callback.err            An error that occurred, if any
 * @param  {Object}         callback.asset          The updated asset
 * @api private
 */
var incrementViewsIfRequired = module.exports.incrementViewsIfRequired = function(ctx, asset, incrementViews, callback) {
  if (!incrementViews) {
    return callback(null, asset);
  }

  // If the user is viewing their own asset, do not increment the view count or create activities.
  var isAssetOwner = _.find(asset.users, {'id': ctx.user.id});
  if (isAssetOwner) {
    return callback(null, asset);
  }

  asset.increment('views').complete(function(err) {
    if (err) {
      log.error({'err': err, 'id': asset.id}, 'Failed to increase the views on an asset');
      return callback({'code': 500, 'msg': err.message});
    }

    ActivitiesAPI.createActivity(ctx.course, ctx.user, 'view_asset', asset.id, CollabosphereConstants.ACTIVITY.OBJECT_TYPES.ASSET, null, null, function(err, viewActivity) {
      if (err) {
        log.error({'user': ctx.user, 'err': err}, 'Failed to create activity \'view_asset\' for user');
        return callback(err);
      }
      if (!viewActivity) {
        log.error({'user': ctx.user, 'assetId': asset.id}, 'Failed to retrieve newly created view activity');
        return callback({'code': 500, 'msg': 'Failed to retrieve newly created view activity'});
      }

      createGetViewActivities(ctx, asset, viewActivity.id, function(err) {
        if (err) {
          return callback(err);
        }

        return callback(null, asset);
      });
    });
  });
};

/**
 * Create a `get_view_asset` activity for each author of an asset
 *
 * @param  {Context}        ctx               Standard context containing the current user and the current course
 * @param  {Asset}          asset             The asset receiving the view
 * @param  {Number}         reciprocalId      The id of the reciprocal activity
 * @param  {Function}       callback          Standard callback function
 * @param  {Object}         callback.err      An error that occurred, if any
 * @api private
 */
var createGetViewActivities = function(ctx, asset, reciprocalId, callback) {
  var done = _.after(asset.users.length, callback);
  var errorCallback = _.once(callback);
  var metadata = {
    'reciprocalId': reciprocalId
  };
  _.each(asset.users, function(user) {
    ActivitiesAPI.createActivity(ctx.course, user, 'get_view_asset', asset.id, CollabosphereConstants.ACTIVITY.OBJECT_TYPES.ASSET, metadata, ctx.user, function(err) {
      if (err) {
        log.error({
          'err': err,
          'user': user.id,
          'asset': asset.id
        }, 'Failed to create a get_view_asset activity');
        return errorCallback(err);
      }
      return done();
    });
  });
};

/* (DIS)LIKING */

/**
 * Create a `get_like` or `get_dislike` activity for each author of the asset
 *
 * @param  {Context}        ctx               Standard context containing the current user and the current course
 * @param  {Asset}          asset             The asset that is liked or disliked
 * @param  {String}         type              Which type of activities the asset users are getting. One of `get_like` or `get_dislike`
 * @param  {Number}         reciprocalId      The id of the reciprocal `like` or `dislike` activity
 * @param  {Function}       callback          Standard callback function
 * @param  {Object}         callback.err      An error that occurred, if any
 * @api private
 */
var createGetLikeActivities = module.exports.createGetLikeActivities = function(ctx, asset, type, reciprocalId, callback) {
  var done = _.after(asset.users.length, callback);
  var errorCallback = _.once(callback);
  var metadata = {
    'reciprocalId': reciprocalId
  };
  _.each(asset.users, function(user) {
    ActivitiesAPI.createActivity(ctx.course, user, type, asset.id, CollabosphereConstants.ACTIVITY.OBJECT_TYPES.ASSET, metadata, ctx.user, function(err) {
      if (err) {
        log.error({
          'err': err,
          'user': user.id
        }, 'Failed to create the get_like or get_dislike activities on an asset for a user');
        return errorCallback(err);
      }

      return done();
    });
  });
};

/**
 * Adjust the cached like and dislike count on an asset after removing a previous like or dislike
 *
 * @param  {Asset}          asset                           The asset for which to update the like and dislike count
 * @param  {Boolean}        like                            `true` when the asset should be liked, `false` when the asset should be disliked. When `null` is provided, the previous like or dislike will be undone
 * @param  {Activity}       deletedLike                     The removed like or dislike activity on the asset
 * @param  {Function}       callback                        Standard callback function
 * @param  {Object}         callback.err                    An error that occurred, if any
 * @param  {Asset}          callback.asset                  The updated asset
 * @api private
 */
var updateAssetLikeCount = module.exports.updateAssetLikeCount = function(asset, like, deletedLike, callback) {
  var likeDelta = 0;
  var dislikeDelta = 0;
  if (deletedLike) {
    if (deletedLike.type === 'like') {
      likeDelta--;
    } else {
      dislikeDelta--;
    }
  }
  if (like === true) {
    likeDelta++;
  } else if (like === false) {
    dislikeDelta++;
  }

  asset.increment({'likes': likeDelta, 'dislikes': dislikeDelta}).complete(function(err, asset) {
    if (err) {
      log.error({'err': err, 'asset': asset}, 'Failed to update the like and dislike count on an asset');
      return callback({'code': 500, 'msg': err.message});
    }

    return callback(null, asset);
  });
};

/**
 * Delete all the `get_like` or `get_dislike` activities created by the current user in context for
 * each author of the asset
 *
 * @param  {Context}        ctx               Standard context containing the current user and the current course
 * @param  {Asset}          asset             The asset for which the like or dislike should be deleted
 * @param  {Function}       callback          Standard callback function
 * @param  {Object}         callback.err      An error that occurred, if any
 * @api private
 */
var deleteGetLikeActivities = module.exports.deleteGetLikeActivities = function(ctx, asset, callback) {
  var done = _.after(asset.users.length, callback);
  var errorCallback = _.once(callback);
  _.each(asset.users, function(user) {
    ActivitiesAPI.deleteActivity(ctx.course, user, ['get_like', 'get_dislike'], asset.id, CollabosphereConstants.ACTIVITY.OBJECT_TYPES.ASSET, ctx.user, function(err) {
      if (err) {
        log.error({
          'err': err,
          'user': user.id
        }, 'Failed to delete the get_like or get_dislike activities on an asset for a user');
        return errorCallback(err);
      }

      return done();
    });
  });
};

/* COMMENTS */

/**
 * Get a comment.
 * Note that this is a private method that doesn't do any validation
 *
 * @param  {Number}         id                              The id of the comment to retrieve
 * @param  {Function}       callback                        Standard callback function
 * @param  {Object}         callback.err                    An error that occurred, if any
 * @param  {Comment}        callback.comment                The created comment
 * @param  {User}           callback.comment.user           The user that created the comment
 * @api private
 */
var getComment = module.exports.getComment = function(id, callback) {
  var options = {
    'where': {
      'id': id
    },
    'include': [{
      'model': DB.User,
      'attributes': UserConstants.BASIC_USER_FIELDS
    }, {
      'model': DB.Comment,
      'as': 'parent',
      'required': false,
      'include': [DB.User]
    }]
  };
  DB.Comment.findOne(options).complete(function(err, comment) {
    if (err) {
      log.error({'err': err, 'id': id}, 'Failed to retrieve the comment');
      return callback({'code': 500, 'msg': err.message});
    } else if (!comment) {
      log.error({'err': err, 'id': id}, 'Failed to retrieve the comment');
      return callback({'code': 404, 'msg': 'Failed to retrieve the comment'});
    }

    return callback(null, comment);
  });
};

/**
 * Create the comment activities when a comment rolls in.
 *
 * We distinguish the following situations:
 *   - Alice creates a top-level comment on an asset owned by Alice
 *       - Nothing happens
 *   - Alice creates a top-level comment on an asset owned by Bob
 *       - Alice gets points for a `create_comment` activity
 *       - Bob gets points for a `get_comment` activity
 *   - Alice replies to a comment made by Alice on an asset owned by Alice
 *       - Nothing happens
 *   - Alice replies to a comment made by Bob on an asset owned by Alice
 *       - Alice gets points for a `create_comment` activity
 *       - Alice gets points for a `get_asset_comment` activity
 *       - Bob gets points for a `get_comment_reply` activity
 *   - Alice replies to a comment made by Bob on an asset owned by Bob
 *       - Alice gets points for a `create_comment` activity
 *       - Bob gets points for a `get_comment` activity
 *       - Bob gets points for a `get_asset_comment` activity
 *   - Alice replies to a comment made by Bob on an asset owned by Chris
 *       - Alice gets points for a `create_comment` activity
 *       - Bob gets points for a `get_comment` activity
 *       - Chris gets points for a `get_asset_comment` activity
 *
 * @param  {Context}        ctx                             Standard context containing the current user and the current course
 * @param  {Asset}          asset                           The asset to which the comment is added
 * @param  {Comment}        comment                         The created comment
 * @param  {Comment}        [parent]                        The parent comment to which the comment is a reply, if any
 * @param  {Function}       callback                        Standard callback function
 * @param  {Object}         callback.err                    An error that occurred, if any
 * @api private
 */
var createCommentActivities = module.exports.createCommentActivities = function(ctx, asset, comment, parent, callback) {
  createCommentActivityAssetComment(ctx, asset, comment, parent, function(err, commentActivity) {
    if (err) {
      return callback(err);
    }

    var reciprocalId = commentActivity ? commentActivity.id : null;

    createCommentActivityGetAssetComment(ctx, asset, comment, parent, reciprocalId, function(err) {
      if (err) {
        return callback(err);
      }

      return createCommentActivityGetAssetCommentReply(ctx, asset, comment, parent, reciprocalId, callback);
    });
  });
};

/**
 * Delete the `asset_comment` activity for the user who created the comment
 *
 * @param  {Context}        ctx               Standard context containing the current user and the current course
 * @param  {Comment}        comment           The comment that is being removed
 * @param  {Function}       callback          Standard callback function
 * @param  {Object}         callback.err      An error that occurred, if any
 * @api private
 */
var deleteAssetCommentActivity = module.exports.deleteAssetCommentActivity = function(ctx, comment, callback) {
  ActivitiesAPI.deleteActivity(ctx.course, comment.user, 'asset_comment', comment.id, CollabosphereConstants.ACTIVITY.OBJECT_TYPES.COMMENT, null, callback);
};

/**
 * Delete all the `get_asset_comment` activities created by the current user in context for
 * each owner of the asset
 *
 * @param  {Context}        ctx               Standard context containing the current user and the current course
 * @param  {Comment}        comment           The comment that is being removed
 * @param  {Asset}          asset             The asset to which the comment belongs
 * @param  {Function}       callback          Standard callback function
 * @param  {Object}         callback.err      An error that occurred, if any
 * @api private
 */
var deleteGetAssetCommentActivities = module.exports.deleteGetAssetCommentActivities = function(ctx, comment, asset, callback) {
  var done = _.after(asset.users.length, callback);
  var errorCallback = _.once(callback);

  // Delete the get_asset_comment activity for each asset owner
  _.each(asset.users, function(assetUser) {
    ActivitiesAPI.deleteActivity(ctx.course, assetUser, 'get_asset_comment', comment.id, CollabosphereConstants.ACTIVITY.OBJECT_TYPES.COMMENT, comment.user, function(err) {
      if (err) {
        log.error({
          'err': err,
          'comment': comment.id,
          'user': assetUser.id
        }, 'Failed to delete a get_asset_comment activity, the engagement index is now out of sync');
        return errorCallback(err);
      }

      done();
    });
  });
};

/**
 * Delete the `get_asset_comment_reply` activity for the user whose comment recevied a reply
 *
 * @param  {Context}        ctx               Standard context containing the current user and the current course
 * @param  {Comment}        comment           The comment that is being removed
 * @param  {Function}       callback          Standard callback function
 * @param  {Object}         callback.err      An error that occurred, if any
 * @api private
 */
var deleteGetAssetCommentReplyActivity = module.exports.deleteGetAssetCommentReplyActivity = function(ctx, comment, callback) {
  // If the comment has no parent comment, it means a root comment was removed. There's
  // no need to remove any get_asset_comment_reply activities as it's not a reply and
  // no such activities were generated for this comment
  if (!comment.parent) {
    return callback();
  }

  // Delete the get_asset_comment_reply activity for the user whose comment received a reply
  ActivitiesAPI.deleteActivity(ctx.course, comment.parent.user, 'get_asset_comment_reply', comment.parent.id, CollabosphereConstants.ACTIVITY.OBJECT_TYPES.COMMENT, comment.user, callback);
};

/**
 * When appropriate, create an activity for the asset user when their asset gets a comment
 *
 * @see {@link _createCommentActivities}
 * @param  {Context}        ctx                             Standard context containing the current user and the current course
 * @param  {Asset}          asset                           The asset to which the comment is added
 * @param  {Comment}        comment                         The created comment
 * @param  {Comment}        [parent]                        The parent comment to which the comment is a reply, if any
 * @param  {Number}         [reciprocalId]                  The id of the reciprocal asset_comment activity, if any
 * @param  {Function}       callback                        Standard callback function
 * @param  {Object}         callback.err                    An error that occurred, if any
 * @api private
 */
var createCommentActivityGetAssetComment = function(ctx, asset, comment, parent, reciprocalId, callback) {
  // We create a `get_asset_comment` activity for the asset owner if the person
  // who creates the comment is:
  //  - not the asset owner or
  //  - is replying to another user
  var isAssetOwner = _.find(asset.users, {'id': ctx.user.id});
  if (!isAssetOwner || (parent && ctx.user.id !== parent.user.id)) {
    var done = _.after(asset.users.length, function() {
      return callback();
    });
    var errorCallback = _.once(callback);
    var metadata = {'assetId': asset.id};
    if (reciprocalId) {
      metadata.reciprocalId = reciprocalId;
    }

    _.each(asset.users, function(assetUser) {
      ActivitiesAPI.createActivity(ctx.course, assetUser, 'get_asset_comment', comment.id, CollabosphereConstants.ACTIVITY.OBJECT_TYPES.COMMENT, metadata, ctx.user, function(err) {
        if (err) {
          log.error({
            'err': err,
            'comment': comment.id,
            'user': assetUser.id
          }, 'Failed to create a get_asset_comment activity, the engagement index is now out of sync');
          return errorCallback();
        }

        done();
      });
    });
  } else {
    return callback();
  }
};

/**
 * When appropriate, create an activity for the commenter when they comment on an asset
 *
 * @see {@link _createCommentActivities}
 * @param  {Context}        ctx                             Standard context containing the current user and the current course
 * @param  {Asset}          asset                           The asset to which the comment is added
 * @param  {Comment}        comment                         The created comment
 * @param  {Comment}        [parent]                        The parent comment to which the comment is a reply, if any
 * @param  {Function}       callback                        Standard callback function
 * @param  {Object}         callback.err                    An error that occurred, if any
 * @param  {Activity}       callback.activity               The newly created activity, if any
 * @api private
 */
var createCommentActivityAssetComment = function(ctx, asset, comment, parent, callback) {
  // We create an `asset_comment` activity for the commenter if:
  //  - they are not the asset owner or
  //  - they are replying to another user
  var isAssetOwner = _.find(asset.users, {'id': ctx.user.id});
  if (!isAssetOwner || (parent && ctx.user.id !== parent.user.id)) {
    var metadata = {'assetId': asset.id};
    return ActivitiesAPI.createActivity(ctx.course, ctx.user, 'asset_comment', comment.id, CollabosphereConstants.ACTIVITY.OBJECT_TYPES.COMMENT, metadata, null, callback);
  } else {
    return callback();
  }
};

/**
 * When appropriate, create an activity for the parent commenter when a reply is made on one of their comments
 *
 * @see {@link _createCommentActivities}
 * @param  {Context}        ctx                             Standard context containing the current user and the current course
 * @param  {Asset}          asset                           The asset to which the comment is added
 * @param  {Comment}        comment                         The created comment
 * @param  {Comment}        [parent]                        The parent comment to which the comment is a reply
 * @param  {Number}         [reciprocalId]                  The id of the reciprocal asset_comment activity, if any
 * @param  {Function}       callback                        Standard callback function
 * @param  {Object}         callback.err                    An error that occurred, if any
 * @api private
 */
var createCommentActivityGetAssetCommentReply = function(ctx, asset, comment, parent, reciprocalId, callback) {
  // We create an `get_asset_comment_reply` activity for the parent commenter if:
  //  - there is a parent comment and
  //  - the parent commenter is another user
  if (parent && ctx.user.id !== parent.user.id) {
    var metadata = {'assetId': asset.id};
    if (reciprocalId) {
      metadata.reciprocalId = reciprocalId;
    }
    return ActivitiesAPI.createActivity(ctx.course, parent.user, 'get_asset_comment_reply', parent.id, CollabosphereConstants.ACTIVITY.OBJECT_TYPES.COMMENT, metadata, ctx.user, callback);
  } else {
    return callback();
  }
};

/* (UN)PINNING */

var addPinToAsset = module.exports.addPinToAsset = function(assetId, userId, callback) {
  var pin = {
    'asset_id': assetId,
    'user_id': userId
  };

  DB.Pin.create(pin).complete(function(err, pin) {
    if (err) {
      log.error({'err': err, 'asset': assetId, 'user': userId}, 'Failed to create a new pin');
      return callback({'code': 500, 'msg': err.message});
    }

    return callback(null, pin);
  });
};

var unPinAsset = module.exports.unPinAsset = function(assetId, userId, callback) {
  var options = {
    'where': {
      'asset_id': assetId,
      'user_id': userId
    }
  };
  DB.Pin.findOne(options).complete(function(err, pin) {
    if (err) {
      log.error({'err': err, 'asset': assetId, 'user': userId}, 'Failed to retrieve existing pin');
      return callback({'code': 500, 'msg': err.message});
    } else if (!pin) {
      var msg = 'Asset has no pin owned by this user';
      log.error({'asset': assetId, 'user': userId}, msg);
      return callback({'code': 404, 'msg': msg});
    }
    pin.destroy().complete(function(err) {
      if (err) {
        log.error({'err': err, 'pin': pin}, 'Failed to delete pin');
        return callback({'code': 500, 'msg': err.message});
      }

      return callback(null, pin);
    });
  });
};

/* WHITEBOARDS */

/**
 * Create a `get_remix_whiteboard` activity for each author of an asset
 *
 * @param  {Context}        ctx               Standard context containing the current user and the current course
 * @param  {Asset}          asset             The asset from which the whiteboard was generated
 * @param  {Object}         metadata          Activity metadata
 * @param  {Function}       callback          Standard callback function
 * @param  {Object}         callback.err      An error that occurred, if any
 * @api private
 */
var createGetRemixWhiteboardActivities = module.exports.createGetRemixWhiteboardActivities = function(ctx, asset, metadata, callback) {
  var done = _.after(asset.users.length, callback);
  var errorCallback = _.once(callback);
  _.each(asset.users, function(user) {
    // If the user is among the asset creators, skip activity creation for that user only.
    if (user.id === ctx.user.id) {
      return done();
    }

    ActivitiesAPI.createActivity(ctx.course, user, 'get_remix_whiteboard', asset.id, CollabosphereConstants.ACTIVITY.OBJECT_TYPES.ASSET, metadata, ctx.user, function(err) {
      if (err) {
        log.error({
          'err': err,
          'user': user.id,
          'asset': asset.id
        }, 'Failed to create a get_remix_whiteboard activity');
        return errorCallback(err);
      }
      return done();
    });
  });
};
