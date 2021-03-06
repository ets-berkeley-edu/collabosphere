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
var async = require('async');
var config = require('config');
var moment = require('moment-timezone');

var ActivitiesAPI = require('col-activities');
var AssetsAPI = require('col-assets');
var CourseAPI = require('col-course');
var CollabosphereConstants = require('col-core/lib/constants');
var DB = require('col-core/lib/db');
var EmailUtil = require('col-core/lib/email');
var log = require('col-core/lib/logger')('col-activities/notifications');
var UsersAPI = require('col-users');
var UserConstants = require('col-users/lib/constants');

/**
 * Manually trigger daily notification emails for a given course. This method is made publicly available for testing and
 * administrative purposes only; it should not be used for regular scheduling of emails.
 *
 * @param  {Context}          ctx                               Standard context containing the current user and the current course
 * @param  {Function}         callback                          Standard callback function
 * @param  {Object}           callback.err                      An error that occurred, if any
 */
var sendDailyNotificationsForCourse = module.exports.sendDailyNotificationsForCourse = function(ctx, callback) {
  // Only admins can manually trigger the daily email.
  if (!ctx.user.is_admin) {
    log.error({'id': ctx.user.id, 'course': ctx.course.id}, 'Unauthorized to send daily notifications for course');
    return callback({'code': 401, 'msg': 'Unauthorized to send daily notifications for a course'});
  }

  return collectCourse(ctx.course, callback);
};

/**
 * Run through all the active courses and send out the daily notification email
 *
 * @param  {Function}     callback    Standard callback function
 */
var collect = module.exports.collect = function(callback) {
  var start = Date.now();

  // 1. Get all the active courses
  CourseAPI.getCourses(null, null, function(err, courses) {
    if (err) {
      return log.error({'err': err}, 'Unable to retrieve the courses when sending notifications');
    }

    // 2. Iterate through all the courses
    async.eachSeries(courses, collectCourse, function(err) {
      if (err) {
        return log.error({'err': err}, 'Unable to collect a course when sending notifications');
      }

      log.info({'duration': (Date.now() - start)}, 'Sent emails for all courses');

      return callback();
    });
  });
};

/**
 * Send out the daily notifications for a specific course.
 *
 * Note that this method is only made publicly available so it can be called from the integration
 * tests. Do not call this method directly.
 *
 * @param  {Course}         course          The course for which to send out the daily notifications
 * @param  {Function}       callback        Standard callback function
 * @api private
 */
var collectCourse = module.exports.collectCourse = function(course, callback) {
  var start = Date.now();

  // Do not send the email unless daily notifications are enabled
  if (!course.enable_daily_notifications) {
    log.info({'course': course}, 'Skipping email for course with daily notifications disabled');
    return callback();
  }

  // 1. Get all the data for this course
  getCourseData(course, function(err, data) {
    if (err) {
      // Don't pass the error up
      log.error({'course': course, 'err': err}, 'Unable to collect course data for daily notification email.');
      return callback();
    }

    // Return early if there's no course data
    if (_.isEmpty(data.assets) && _.isEmpty(data.whiteboards)) {
      log.error({'course': course, 'err': err}, 'Course has no data for daily notification email.');
      return callback();
    }

    // 2. Iterate through all the users in this course and notify them if necessary
    var userIterator = handleUser.bind(null, course, data);
    async.eachSeries(data.users, userIterator, function() {
      log.info({
        'course': course.id,
        'duration': (Date.now() - start)
      }, 'Sent emails for course');
      return callback();
    });
  });
};

/**
 * Send notifications for a user in a course.
 *
 * Note that this function won't pass up any errors.
 *
 * @param  {Course}     course        The course for which to send out the daily notifications
 * @param  {Object}     data          The relevant data in the given course
 * @param  {User}       user          The user to notify
 * @param  {Function}   callback      Standard callback function
 * @api private
 */
var handleUser = function(course, data, user, callback) {
  // Ignore users that don't have an email address
  if (!user.canvas_email) {
    return callback();
  }

  // Get all the activities for the user
  var activities = getActivitiesForUser(data, user);

  // If nothing noteworthy happened for this user, then they should not get an email
  if (_.isEmpty(activities)) {
    return callback();
  }

  var subject = getSubject(course, activities, user);

  // The data that's used in the daily email template
  var data = {
    'activities': activities,
    'getSummaryActors': getSummaryActors,
  };
  EmailUtil.sendEmail(subject, user, course, data, 'daily', function(err) {
    // Don't pass errors up as otherwise all the following users would be ignored.
    // The error itself is logged in the sendEmail implementation
    return callback();
  });
};

/**
 * Get the subject for the daily email
 *
 * @param  {Course}                                 course        The course for which to send out the daily notifications
 * @param  {(AssetActivity|WhiteboardActivity)[]}   activities    The set of activities for which to generate an email subject
 * @param  {User}                                   currentUser   The user to whom the email will be sent
 * @return {String}                                               An appropriate email subject
 * @api private
 */
var getSubject = function(course, activities, currentUser) {
  var subject = null;

  // The email's subject depends on the activities in it. If only one activity took place,
  // we figure out who was part of the activity so we can create a subject of the form:
  //   <actor(s)> <verb> on your <object>
  // For example:
  //   - Nicolaas commented on your asset "Kitties"
  //   - Ray and Paul replied to your comment
  //   - Chris, Jack and Jones commented on your whiteboard "Ships"
  if (activities.length === 1) {
    var activity = activities[0];
    var summaryActors = getSummaryActors(activity.actors, currentUser);
    if (activity.type === 'asset_comment') {
      subject = summaryActors + ' commented on your asset "' + activity.asset.title + '"';
    } else if (activity.type === 'asset_comment_reply') {
      var comment = activity.asset.comments[0].body;
      if (comment.length > 40) {
        comment = comment.substring(0, 40) + '...';
      }
      subject = summaryActors + ' replied to your comment';
    } else if (activity.type === 'whiteboard_chat') {
      subject = summaryActors + ' commented on your whiteboard "' + activity.whiteboard.title + '"';
    }

  // Default to a generic subject title if there's more than 1 activity
  //  - Both Asset Library and Whiteboards activity: New Asset Library and Whiteboard activity is waiting for you
  //  - Only Asset Library activity: New Asset Library activity is waiting for you
  //  - Only Whiteboards activity: New Whiteboard activity is waiting for you
  } else {
    var activityCounts = _.countBy(activities, 'type');
    var hasLibraryActivities = (activityCounts.asset_comment > 0 || activityCounts.asset_comment_reply > 0);
    var hasWhiteboardActivities = (activityCounts.whiteboard_chat > 0);
    if (hasLibraryActivities && hasWhiteboardActivities) {
      subject = 'New Asset Library and Whiteboard activity is waiting for you';
    } else if (hasLibraryActivities) {
      subject = 'New Asset Library activity is waiting for you';
    } else if (hasWhiteboardActivities) {
      subject = 'New Whiteboard activity is waiting for you';
    }
  }

  return subject;
};

/* Activity aggregation */

/**
 * Get the relevant activities for a user
 *
 * @param  {Object}       data    The relevant course data
 * @param  {User}         user    The user for which to get the activities
 * @return {Activity[]}           A set of activities for which the user can be notified
 * @api private
 */
var getActivitiesForUser = function(data, user) {
  // This variable will contain all activities that can be emailed to the user
  var emailActivities = [];

  // Asset comments
  _.each(data.assets, function(asset) {
    // Whether the user owns the asset
    var isOwner = asset.users[user.id];

    // All top comments made by other users
    var topOtherComments = _.filter(asset.comments, function(comment) {
      return (!comment.parent && comment.user_id !== user.id);
    });

    // All replies made to the current user
    var replies = _.filter(asset.comments, function(comment) {
      return (comment.parent && comment.parent.user_id === user.id);
    });

    // All replies made to the current user by other users
    var otherReplies = _.filter(replies, function(reply) {
      return (reply.user_id !== user.id);
    });

    // If we own the asset, we want all the new comments (that weren't made by ourselves)
    if (isOwner && !_.isEmpty(topOtherComments)) {
      emailActivities.push(new AssetActivity(asset, 'asset_comment'));
    }

    // If there's a reply on a comment of ours we only want those replies
    else if (!_.isEmpty(replies) && !_.isEmpty(otherReplies)) {
      emailActivities.push(new AssetActivity(asset, 'asset_comment_reply', replies));
    }
  });

  // Add whiteboards that have new chat messages and the user is a member of
  _.each(data.whiteboards, function(whiteboard) {
    var otherChatMessages = _.filter(whiteboard.chats, function(chat) {
      return (chat.user_id !== user.id);
    });

    if (_.find(whiteboard.users, {'id': user.id}) && !_.isEmpty(otherChatMessages)) {
      emailActivities.push(new WhiteboardActivity(whiteboard))
    }
  });

  return _.chain(emailActivities)
    .orderBy(['lastActivity'], ['desc'])
    .value();

};

/**
 * An Asset activity
 *
 * @param  {Asset}        asset       The asset on which there's some activity
 * @param  {String}       type        One of `asset_comment` or `asset_comment_reply`
 * @param  {Comment[]}    [replies]   In case it's an `asset_comment_reply` activity, this should be the set of comments that are replies to a comment of the current user
 */
var AssetActivity = function(asset, type, replies) {
  // Take a copy of the asset
  asset = _.extend({}, asset);

  if (type === 'asset_comment_reply') {
    asset.comments = replies;
  }

  // Retain the number of comments or replies that were made
  var newComments = asset.comments.length;

  // Create a flat list of copied comment objects. It's important that
  // the comments are copied as the next step will add properties to them
  // which might be different for other user's their activities
  var comments = asset.comments;
  var commentsById = {};
  _.each(comments, function(comment) {
    commentsById[comment.id] = _.extend({}, comment);
    if (comment.parent) {
      commentsById[comment.parent.id] = _.extend({}, comment.parent);
    }
  });
  comments = _.values(commentsById);

  // Order the comments from newest to oldest
  comments.sort(function(a, b) {
    return b.id - a.id;
  });

  // Extract the top-level comments
  var commentsTree = [];
  for (var i = 0; i < comments.length; i++) {
    var comment = comments[i];
    if (!comment.parent_id) {
      comment.level = 0;
      commentsTree.unshift(comment);

      // Find all replies for the current comment
      for (var r = 0; r < comments.length; r++) {
        var reply = comments[r];
        if (reply.parent_id === comment.id) {
          reply.level = 1;
          commentsTree.splice(1, 0, reply);
        }
      }
    }
  }

  asset.comments = commentsTree;

  var that = {
    'type':  type,
    'actors': _.map(asset.comments, 'user'),
    'lastActivity': comments[0].created_at,
    'asset': asset,
    'newComments': newComments
  };

  return that;
};

/**
 * A whiteboard activity
 *
 * @param  {Whiteboard}   whiteboard    The whiteboard for which there's an activity
 */
var WhiteboardActivity = function(whiteboard) {
  var that = {
    'type': 'whiteboard_chat',
    'actors': _.map(whiteboard.chats, 'user'),
    'lastActivity': _.chain(whiteboard.chats).sortBy('created_at').last().value().created_at,
    'whiteboard': whiteboard
  };

  return that;
};

/**
 * Given a set of users and the current user, get a string representation for those users.
 *
 * For example,
 *   - [Jack]                   results in: "Jack"
 *   - [Jack, Jill]             results in: "Jack and Jill"
 *   - [Jack, Jill, John]       results in: "Jack, Jill and 1 other"
 *   - [Jack, Jill, John, Dave] results in: "Jack, Jill and 2 others"
 *
 * @param  {User[]}   users         A set of users
 * @param  {User}     currentUser   The current user
 * @return {String}                 A string representation of the set of users
 * @api private
 */
var getSummaryActors = function(users, currentUser) {
  var actors = _.chain(users)
    .uniq('id')
    .filter(function(user) {
      return (user.id !== currentUser.id);
    })
    .value()

  if (actors.length === 1) {
    return actors[0].canvas_full_name
  } else if (actors.length === 2) {
    return actors[0].canvas_full_name + ' and ' + actors[1].canvas_full_name
  } else if (actors.length === 3) {
    return actors[0].canvas_full_name + ', ' + actors[1].canvas_full_name + ' and 1 other'
  } else {
    var nOthers = actors.length - 2;
    return actors[0].canvas_full_name + ', ' + actors[1].canvas_full_name + ' and ' + nOthers + ' others';
  }
};


/* Data retrieval */


/**
 * Get the course data that had any activity in the last day. This is limited to:
 *  - assets that were commented on
 *  - assets where a comment was placed on a reply
 *  - whiteboards that received chat messages
 *
 * @param  {Context}    course                        The course for which to get the course data
 * @param  {Function}   callback                      Standard callback
 * @param  {Object}     callback.err                  An error object, if any
 * @param  {Object}     callback.data                 The relevant daily data in the course
 * @param  {Object}     callback.data.users           All the users in the course (including those that weren't active)
 * @param  {Object}     callback.data.assets          Assets with their recent comments and replies
 * @param  {Object}     callback.data.whiteboards     Whiteboards with their recent chat messages
 * @api private
 */
var getCourseData = function(course, callback) {
  var ctx = {
    'course': course,

    // Fake an admin user. At this point we can't reliably retrieve an admin from
    // the database as there might not be any yet
    'user': {
      'is_admin': true
    }
  };

  // 1. Get all the users in this course. We need to retrieve all users as we might need to display
  // a user's name in the email even if they weren't active. (For example, the parent comment of a
  // recent reply)
  var options = {
    'enrollmentStates': _.values(CollabosphereConstants.ENROLLMENT_STATE),
    'includeEmail': true
  };
  UsersAPI.getAllUsers(ctx, options, function(err, users) {
    if (err) {
      log.error({'err': err, 'course': ctx.course.id}, 'Failed to retrieve the users for a course');
      return callback({'code': 500, 'msg': 'Failed to retrieve the users for a course'});
    }

    // Index the users by their id. This allows for quicker lookups later on
    users = _.chain(users)
      .map(function(user) {
        return user.toJSON();
      })
      .keyBy('id')
      .value();

    var hour = config.get('email.dailyHour');
    // As the amount of courses grows, processing daily emails might
    // take a bit longer. Ensure that we're always selecting activities
    // that happened between 8 o'clock yesterday and today, regardless of
    // what the time is now.
    // Format the date in a way postgresql can use it in its filters
    var dateRange = {
      'start': moment()
        .subtract(1, 'day')
        .hours(hour).minutes(0).seconds(0)
        .toDate(),
      'end': moment()
        .hours(hour).minutes(0).seconds(0)
        .toDate()
    };

    // 2. Get all the assets and comments that are involved in the activities
    getCourseAssetData(ctx, users, dateRange, function(err, assets) {
      if (err) {
        return callback(err);
      }

      // 3. Get the whiteboards
      getCourseWhiteboardData(ctx, users, dateRange, function(err, whiteboards) {
        if (err) {
          return callback(err);
        }

        var data = {
          'users': users,
          'assets': assets,
          'whiteboards': whiteboards
        };
        return callback(null, data);
      });
    });
  });

};

/**
 * Get the assets which were commented on recently
 *
 * @param  {Context}    ctx                 Standard context containing the current user and the current course
 * @param  {Object}     users               The users in the course (keyed by their user id)
 * @param  {Object}     dateRange           The date range in which comments have to take place
 * @param  {Date}       dateRange.start     The timestamp after which the comments have to take place
 * @param  {Date}       dateRange.end       The timestamp before which the comments have to take place
 * @param  {Function}   callback            Standard callback function
 * @param  {Object}     callback.err        An error object, if any
 * @param  {Object}     callback.assets     Assets that were recently commented on
 * @api private
 */
var getCourseAssetData = function(ctx, users, dateRange, callback) {
  var options = {
    'where': {
      'course_id': ctx.course.id,
      'visible': true
    },
    'include': [
      // Ideally, we'd just get the IDs and look up the objects in the `users` array ourselves
      // to reduce data serialization. Unfortunately, Sequelize doesn't like this very much,
      // so we simply get the basic user profiles
      {
        'model': DB.User,
        'as': 'users',
        'required': true,
        'attributes': UserConstants.BASIC_USER_FIELDS
      },
      // Get category visibility information to avoid surfacing hidden assets
      {
        'model': DB.Category,
        'attributes': ['visible']
      },
      // The comments
      {
        'model': DB.Comment,
        'required': true,
        'where': {
          'created_at': {
            '$gt': dateRange.start,
            '$lt': dateRange.end
          }
        },
        'include': [{
          'model': DB.Comment,
          'required': false,
          'as': 'parent'
        }]
      }
    ],
    'limit': null,
    'subQuery': false
  };
  DB.Asset.findAll(options).complete(function(err, assets) {
    if (err) {
      log.error({'err': err, 'course': ctx.course.id}, 'Unable to get the assets with recent comments for a course');
      return callback(err);
    }

    var jsonAssets = [];

    _.forEach(assets, function(asset) {
      if (AssetsAPI.isDeletedOrHidden(asset)) {
        return;
      }

      jsonAsset = asset.toJSON();

      // Index the asset owners by their ID for quick lookups
      jsonAsset.users = _.keyBy(jsonAsset.users, 'id');

      // Add the user objects for the commenters
      jsonAsset.comments = _.map(jsonAsset.comments, function(comment) {
        comment = comment.toJSON();

        comment.user = users[comment.user_id];
        if (comment.parent) {
          comment.parent.user = users[comment.parent.user_id];
        }

        return comment;
      });

      jsonAssets.push(jsonAsset);
    });

    return callback(null, jsonAssets);
  });
};

/**
 * Get the assets with recent chat messages
 *
 * @param  {Context}    ctx                     Standard context containing the current user and the current course
 * @param  {Object}     users                   The users in the course (keyed by their user id)
 * @param  {Object}     dateRange               The date range in which chat messages have to take place
 * @param  {Date}       dateRange.start         The timestamp after which the chat messages have to take place
 * @param  {Date}       dateRange.end           The timestamp before which the chat messages have to take place
 * @param  {Function}   callback                Standard callback function
 * @param  {Object}     callback.err            An error object, if any
 * @param  {Object}     callback.whiteboards    Whiteboards with recent chat messages
 * @api private
 */
var getCourseWhiteboardData = function(ctx, users, dateRange, callback) {
  var queryOptions = {
    'where': {
      'course_id': ctx.course.id
    },
    'include': [
      {
        'model': DB.User
      },
      {
        'model': DB.Chat,
        'where': {
          'created_at': {
            '$gt': dateRange.start,
            '$lt': dateRange.end
          }
        }
      }
    ],
    'order': [
      ['id', 'DESC'],
      [DB.Chat, 'id', 'ASC']
    ]
  };
  DB.Whiteboard.findAll(queryOptions).complete(function(err, whiteboards) {
    if (err) {
      log.error({'err': err, 'course': ctx.course.id}, 'Unable to get the whiteboards with recent chat messages for a course');
      return callback(err);
    }

    // Add the user object of the chatter to each chat message
    whiteboards = _.map(whiteboards, function(whiteboard) {
      whiteboard = whiteboard.toJSON();

      whiteboard.chats = _.chain(whiteboard.chats)
        .map(function(chat) {
          chat.user = users[chat.user_id];
          return chat;
        })
        .value();

      return whiteboard;
    });

    return callback(null, whiteboards || []);
  });
};
