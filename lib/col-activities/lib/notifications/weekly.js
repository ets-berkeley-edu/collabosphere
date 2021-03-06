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

var AssetsAPI = require('col-assets');
var CollabosphereConstants = require('col-core/lib/constants');
var CourseAPI = require('col-course');
var DB = require('col-core/lib/db');
var EmailUtil = require('col-core/lib/email');
var log = require('col-core/lib/logger')('col-activities/notifications');
var UsersAPI = require('col-users');
var UserConstants = require('col-users/lib/constants');

var ActivitiesAPI = require('col-activities');

/**
 * Send weekly notification emails for all courses.
 *
 * @param  {Function}     callback    Standard callback function
 */
var collect = module.exports.collect = function(callback) {
  var start = Date.now();

  // Get all active courses.
  CourseAPI.getCourses(null, null, function(err, courses) {
    if (err) {
      log.error({'err': err}, 'Unable to retrieve courses for weekly notifications.');
      return callback();
    }

    // Iterate through all courses.
    async.eachSeries(courses, collectCourse, function() {
      log.info({'duration': (Date.now() - start)}, 'Sent weekly notifications for all courses.');
      return callback();
    });
  });
};

/**
 * Manually trigger weekly notification emails for a given course. This method is made publicly available for testing and
 * administrative purposes only; it should not be used for regular scheduling of emails.
 *
 * @param  {Context}          ctx                               Standard context containing the current user and the current course
 * @param  {Function}         callback                          Standard callback function
 * @param  {Object}           callback.err                      An error that occurred, if any
 */
var sendWeeklyNotificationsForCourse = module.exports.sendWeeklyNotificationsForCourse = function(ctx, callback) {
  // Only admins can manually trigger the weekly email.
  if (!ctx.user.is_admin) {
    log.error({'id': ctx.user.id, 'course': ctx.course.id}, 'Unauthorized to send weekly notifications for course');
    return callback({'code': 401, 'msg': 'Unauthorized to send weekly notifications for a course'});
  }

  return collectCourse(ctx.course, callback);
};

/**
 * Send weekly notification emails for a given course.
 *
 * @param  {Course}         course          The course for which to send weekly notifications
 * @param  {Function}       callback        Standard callback function
 * @api private
 */
var collectCourse = function(course, callback) {
  // Do not send the email unless asset library and engagement index are both enabled
  if (!course.assetlibrary_url || !course.engagementindex_url) {
    log.info({'course': course}, 'Skipping weekly notification email for course without enabled tools');
    return callback();
  }

  // Do not send the email unless weekly notifications are enabled
  if (!course.enable_weekly_notifications) {
    log.info({'course': course}, 'Skipping email for course with weekly notifications disabled');
    return callback();
  }

  var start = Date.now();

  // 1. Get users and activity data for the course.
  getCourseData(course, function(err, courseData) {
    // If a course throws an error, log it and continue to the next course.
    if (err) {
      log.error({'course': course, 'err': err}, 'Unable to collect course data for weekly notification email.');
      return callback();
    }

    // Return early if no activity data was found for the course.
    if (!courseData) {
      log.info({'course': course}, 'No course data found for weekly notification email.');
      return callback();
    }

    // 2. Iterate through users in the course and send notifications to each.
    var userIterator = handleUser.bind(null, course, courseData.activitySummary);
    async.eachSeries(courseData.users, userIterator, function() {
      log.info({
        'course': course.id,
        'duration': (Date.now() - start)
      }, 'Sent weekly notifications for course.');

      return callback();
    });
  });
};

/**
 * Send notifications for a user in a course.
 *
 * Note that this function does not pass up errors.
 *
 * @param  {Course}     course              The course for which to send notifications
 * @param  {Object}     activitySummary     Weekly activity data for the course
 * @param  {User}       user                The user to notify
 * @param  {Function}   callback            Standard callback function
 * @api private
 */
var handleUser = function(course, activitySummary, user, callback) {
  // Ignore users without an email address.
  if (!user.canvas_email) {
    return callback();
  }

  // Parse out activity data specific to this user.
  var userData = activitySummary.users[user.id] || {};
  if (!_.isEmpty(userData)) {
    // Find the user's most popular asset for the last week. We define asset 'popularity' as a weighted
    // sum of views, likes and comments.
    var topAsset = sampleMaximum(userData.assets, function(asset) {
      // Deleted and hidden assets are included in query results since they contribute to point totals,
      // but we don't want them included here.
      if (AssetsAPI.isDeletedOrHidden(asset)) {
        return 0;
      } else {
        return asset.weeklyTotals.views + (2 * asset.weeklyTotals.likes) + (5 * asset.weeklyTotals.comments);
      }
    });
    if (topAsset) {
      userData.topAsset = userData.assets[topAsset.id];
    }
  }

  var subject = 'This week\'s activity in ' + (course.name || 'The Asset Library and Whiteboards');
  var emailData = {
    'weekly': {
      'course': activitySummary.course,
      'user': userData
    }
  };

  EmailUtil.sendEmail(subject, user, course, emailData, 'weekly', function(err) {
    // Errors are logged in the sendEmail implementation. Ignore them here, and continue to the next user.
    return callback();
  });
};


/* Data retrieval */


/**
 * Get activity and user data for a given course in the past week.
 *
 * @param  {Context}       course                                                               The course for which to get activity data
 * @param  {Function}      callback                                                             Standard callback
 * @param  {Object}        callback.err                                                         An error object, if any
 * @param  {Object}        callback.courseData                                                  Course data for the weekly email
 * @param  {Object}        callback.courseData.activitySummary                                  Summary of the past week's activity in the course
 * @param  {Object}        callback.courseData.activitySummary.assets                           Object containing assets with activity this week, keyed by id
 * @param  {Object}        callback.courseData.activitySummary.course                           Course-wide weekly data
 * @param  {Object}        callback.courseData.activitySummary.course.averages                  Course-wide activity and point averages for the week
 * @param  {Object}        callback.courseData.activitySummary.course.topAssets                 Highest-scoring assets for the week
 * @param  {Asset}         callback.courseData.activitySummary.course.topAssets.comments        The asset with the most comments for the week
 * @param  {Asset}         callback.courseData.activitySummary.course.topAssets.likes           The asset with the most likes for the week
 * @param  {Asset}         callback.courseData.activitySummary.course.topAssets.views           The asset with the most views for the week
 * @param  {Object}        callback.courseData.activitySummary.course.topUsers                  Highest-scoring users for the week
 * @param  {Object}        callback.courseData.activitySummary.course.topUsers.pointsGenerated  The user that generated the most points for the week
 * @param  {Object}        callback.courseData.activitySummary.course.topUsers.pointsReceived   The user that received the most points for the week
 * @param  {CourseTotals}  callback.courseData.activitySummary.course.totals                    Course-wide activity and point totals for the week
 * @param  {Object}        callback.courseData.activitySummary.users                            Object containing user activity and point totals, keyed by id
 * @param  {Object}        callback.data.users                                                  Object containing all active users in the course, keyed by id
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

  // 1. Get all active users in the course and their total points.
  var options = {
    'enrollmentStates': CollabosphereConstants.ENROLLMENT_STATE.ACTIVE,
    'includeEmail': true
  };
  UsersAPI.getLeaderboard(ctx, options, function(err, users) {
    if (err) {
      log.error({'err': err, 'course': ctx.course.id}, 'Failed to retrieve the users for a course');
      return callback(err);
    }

    // Calculate user ranks. Users are returned in descending order of score, so rank can be derived from array index. Rank
    // is defined as the number of users with a higher score, plus one; e.g., scores [200, 100, 50, 50, 25] map to ranks
    // [1, 2, 3, 3, 5].
    // TODO: Store this week's ranks and retrieve last week's ranks.
    var pointsCutoff = null;
    var rank = 1;
    users = _.map(users, function(user, index) {
      if (user.points !== pointsCutoff) {
        rank = index + 1;
        pointsCutoff = user.points;
      }
      return _.extend(user.toJSON(), {
        'rank': {
          'thisWeek': rank
        }
      });
    });

    // Index users by id for quick lookup.
    users = _.keyBy(users, 'id');

    // 2. Get the points configuration for the course.
    ActivitiesAPI.getActivityTypeConfiguration(ctx.course.id, function(err, activityTypeConfiguration) {
      if (err) {
        log.error({'err': err, 'course': ctx.course.id}, 'Failed to retrieve the points configuration for a course');
        return callback(err);
      }

      // 3. Get all activities from the past week. We use a constant time cutoff for the date range so that we're
      // not affected by processing time during this job.
      var hour = config.get('email.weeklyHour');
      var dateRange = {
        'start': moment()
          .subtract(7, 'day')
          .hours(hour).minutes(0).seconds(0)
          .toDate(),
        'end': moment()
          .hours(hour).minutes(0).seconds(0)
          .toDate()
      };

      getActivitiesForDateRange(ctx, dateRange, function(err, activities) {
        if (err) {
          log.error({'err': err, 'course': ctx.course.id}, 'Failed to retrieve activities for the past week');
          return callback(err);
        }

        // Return early if no activities were found.
        if (_.isEmpty(activities)) {
          return callback();
        }

        // 4. Calculate summary data for the week.
        var activitySummary = summarizeActivities(activities, activityTypeConfiguration, users);
        var courseData = {
          'activitySummary': activitySummary,
          'users': users
        };

        return callback(null, courseData);
      });
    });
  });
};

/**
 * Get recent activity data for a course.
 *
 * @param  {Context}    ctx                  Standard context containing the current user and the current course
 * @param  {Object}     dateRange            Timestamp range for activity creation
 * @param  {Date}       dateRange.start      Lower bound for activity creation timestamp
 * @param  {Date}       dateRange.end        Upper bound for activity creation timestamp
 * @param  {Function}   callback             Standard callback function
 * @param  {Object}     callback.err         An error object, if any
 * @param  {Activity[]} callback.activities  Activity data for the current course within the date range
 * @api private
 */
var getActivitiesForDateRange = function(ctx, dateRange, callback) {
  var options = {
    'where': {
      'course_id': ctx.course.id,
      'created_at': {'$gt': dateRange.start, '$lt': dateRange.end}
    },
    'include': [{
      'model': DB.Asset,
      // Non-paranoid mode will include deleted assets in the query, since they also contribute to point totals.
      'paranoid': false,
      'include': [
        // All we need is the IDs of associated users, but Sequelize forces us to grab some user fields as well.
        // Get basic fields only.
        {
          'model': DB.User,
          'as': 'users',
          'required': true,
          'attributes': UserConstants.BASIC_USER_FIELDS
        },
        // Get new comments for this week only, for purposes of counting keywords.
        {
          'model': DB.Comment,
          'required': false,
          'where': {
            'created_at': {'$gt': dateRange.start, '$lt': dateRange.end}
          }
        },
        // Get category visibility information to avoid surfacing hidden assets
        {
          'model': DB.Category,
          'attributes': ['visible']
        }
      ]
    }],
    'limit': null,
    'subQuery': false
  };
  DB.Activity.findAll(options).complete(function(err, activities) {
    if (err) {
      log.error({'err': err, 'course': ctx.course.id}, 'Unable to get recent activities for a course.');
      return callback(err);
    }
    return callback(null, activities);
  });
};


/* Summary data calculation */


/**
 * Calculate summary data from a list of activities.
 *
 * @param  {Activity[]}   activities                   Activities within a date range for a given course
 * @param  {Object}       activityTypeConfiguration    Activity type configuration for the course
 * @param  {Object}       users                        All active users in the course indexed by id
 * @return {Object}                                    Calculated summary data
 * @api private
 */
var summarizeActivities = function(activities, activityTypeConfiguration, users) {
  var courseTotals = new CourseTotals();
  var summary = {
    'course': {
      'totals': courseTotals
    },
    'assets': {},
    'users': {},
  };

  var activityConfigurationByType = _.keyBy(activityTypeConfiguration, 'type');

  // 1. Increment activities and points in all categories.
  _.forEach(activities, function(activity) {
    var type = activity.type;

    if (activityConfigurationByType[type].enabled) {
      var assetTotals = getAssetTotals(activity.asset, summary);
      var userTotals = getUserTotals(activity.user_id, summary);

      // Before assigning points, increment activity counts for the associated user and asset.
      assetTotals.incrementActivities(type);
      userTotals.incrementActivities(type);

      // Get the point value.
      var points = activityConfigurationByType[type].points;

      // Increment points for the associated user and course under activity type.
      userTotals.incrementPoints(type, points);
      courseTotals.incrementPoints(type, points);

      // Increment points for the associated user and course under generic totals.
      userTotals.incrementPoints('collected', points);
      courseTotals.incrementPoints('generated', points);

      if (activity.actor_id && (activity.actor_id !== activity.user_id)) {
        // The actor and recipient are different users. Count points generated for the actor, and points
        // received for the recipient and course.
        var actorTotals = getUserTotals(activity.actor_id, summary);
        actorTotals.incrementPoints('generated', points);
        userTotals.incrementPoints('received', points);
        courseTotals.incrementPoints('received', points);
      } else {
        // There is no recipient separate from the actor. Count points generated only.
        userTotals.incrementPoints('generated', points);
      }
    }
  });

  // 2. Divide course totals by the user count to get averages.
  var userCount = _.keys(users).length;
  summary.course.averages = _.mapValues(summary.course.totals, function(courseTotal) {
    return _.round(courseTotal / userCount);
  });

  // 3. Find the top asset in each category.
  summary.course.topAssets = {};
  _.forEach(['comments', 'likes', 'views'], function(key) {
    var topAsset = sampleMaximum(summary.assets, function(asset) {
      // Deleted and hidden assets are included in query results since they contribute to point totals,
      // but we don't want them surfacing as top assets.
      if (AssetsAPI.isDeletedOrHidden(asset)) {
        return 0;
      // Assets associated only with admins should be excluded from consideration as course-wide top assets.
      } else if (!_.find(asset.users, function(user) { return !user.is_admin; })) {
        return 0;
      } else {
        return _.get(asset, 'weeklyTotals.' + key);
      }
    });
    if (topAsset) {
      summary.course.topAssets[key] = summary.assets[topAsset.id];
    }
  });

  // 4. Find the top user in each category.
  summary.course.topUsers = {};
  _.forEach(['pointsGenerated', 'pointsReceived'], function(key) {
    var topUser = sampleMaximum(summary.users, _.property(key));
    if (topUser) {
      var total = topUser.value;
      var user = users[topUser.id];
      // If a user is inactive or has not opted into the engagement index, do not pass on identifying information.
      if (!user || !user.share_points) {
        user = {};
      }

      summary.course.topUsers[key] = {
        'total': total,
        'user': user
      };
    }
  });

  // TODO: Iterate through assets to get keyword frequencies from titles and descriptions (if created this
  // week), and from comments.

  return summary;
};

/**
 * Return or instantiate running totals for an asset.
 *
 * @param  {Number}        asset                  The asset to get totals for
 * @param  {Object}        summary                The weekly activities summary
 * @param  {Object}        summary.assets         Assets with activity this week, indexed by id
 * @param  {Object}        summary.course         Course-wide weekly data
 * @param  {CourseTotals}  summary.course.totals  Course-wide activity and point totals for the week
 * @param  {Object}        summary.users          User activity and point totals, indexed by id
 * @return {AssetTotals}                          Running totals for the given asset
 * @api private
 *
 */
var getAssetTotals = function(asset, summary) {
  if (!asset) {
    return null;
  }
  if (!summary.assets[asset.id]) {
    // Assets, unlike users, need their full property set stored in the summary as the email template will
    // make use of them. Add asset properties to the summary, including a new AssetTotals property for the
    // week.
    asset = asset.toJSON();
    asset.weeklyTotals = new AssetTotals();
    summary.assets[asset.id] = asset;

    // Each asset added to the summary also needs to be accessible from per-user totals, for purposes of
    // calculating most popular asset per user.
    _.each(asset.users, function(assetUser) {
      var assetUserTotals = getUserTotals(assetUser.id, summary);
      assetUserTotals.assets[asset.id] = asset;
    });
  }

  return summary.assets[asset.id].weeklyTotals;
};

/**
 * Return or instantiate running totals for a user.
 *
 * @param  {Number}        userId                 The user id to get totals for
 * @param  {Object}        summary                The activities summary
 * @param  {Object}        summary.course         Course-wide weekly data
 * @param  {CourseTotals}  summary.course.totals  Course-wide activity and point totals for the week
 * @param  {Object}        summary.users          User activity and point totals, indexed by id
 * @return {UserTotals}                           Running totals for the given user
 * @api private
 *
 */
var getUserTotals = function(userId, summary) {
  if (!_.has(summary.users, userId)) {
    summary.users[userId] = new UserTotals();
  }
  return summary.users[userId];
};

/**
 * Running totals for activities per asset.
 */
var AssetTotals = function() {
  var that = {
    'comments': 0,
    'likes': 0,
    'views': 0
  };

  // Define a method to increment activity counts.
  var activitiesDictionary = {
    'asset_comment': 'comments',
    'like': 'likes',
    'view_asset': 'views'
  };

  that.incrementActivities = getActivitiesIncrementer(that, activitiesDictionary);

  return that;
};

/**
 * Running totals for points per course.
 */
var CourseTotals = function() {
  var that = {
    'pointsFromAssetsUploaded': 0,
    'pointsFromComments': 0,
    'pointsFromLikes': 0,
    'pointsFromWhiteboards': 0,
    'pointsGenerated': 0,
    'pointsReceived': 0
  };

  // Define a method to increment point totals.
  var pointsDictionary = {
    // Properties for activity types stored in the database.
    'add_asset': 'pointsFromAssetsUploaded',
    'asset_comment': 'pointsFromComments',
    'export_whiteboard': 'pointsFromAssetsUploaded',
    'like': 'pointsFromLikes',
    // TODO: These activity types for whiteboards are not yet implemented.
    'whiteboard_add_asset': 'pointsFromWhiteboards',
    'whiteboard_chat': 'pointsFromWhiteboards',
    // Generic activity types used for summary totals.
    'generated': 'pointsGenerated',
    'received': 'pointsReceived'
  };

  that.incrementPoints = getPointsIncrementer(that, pointsDictionary);

  return that;
};

/**
 * Running totals for activities and points per user.
 */
var UserTotals = function() {
  var that = {
    'assets': {},
    'commentsReceived': 0,
    'likesReceived': 0,
    'pointsFromAssetsUploaded': 0,
    'pointsFromComments': 0,
    'pointsFromLikes': 0,
    'pointsFromWhiteboards': 0,
    'pointsFromCommentsReceived': 0,
    'pointsFromLikesReceived': 0,
    'pointsCollected': 0,
    'pointsGenerated': 0,
    'pointsReceived': 0
  };

  // Define a method to increment activity counts.
  var activitiesDictionary = {
    'get_asset_comment': 'commentsReceived',
    'get_asset_comment_reply': 'commentsReceived',
    'get_like': 'likesReceived'
  };

  that.incrementActivities = getActivitiesIncrementer(that, activitiesDictionary);

  // Define a method to increment point totals.
  var pointsDictionary = {
    // Properties for activity types stored in the database.
    'add_asset': 'pointsFromAssetsUploaded',
    'asset_comment': 'pointsFromComments',
    'export_whiteboard': 'pointsFromAssetsUploaded',
    'get_asset_comment': 'pointsFromCommentsReceived',
    'get_asset_comment_reply': 'pointsFromCommentsReceived',
    'get_like': 'pointsFromLikesReceived',
    'like': 'pointsFromLikes',
    // TODO: These activity types for whiteboards are not yet implemented.
    'whiteboard_add_asset': 'pointsFromWhiteboards',
    'whiteboard_chat': 'pointsFromWhiteboards',
    // Generic activity types used for summary totals.
    'collected': 'pointsCollected',
    'generated': 'pointsGenerated',
    'received': 'pointsReceived'
  };

  that.incrementPoints = getPointsIncrementer(that, pointsDictionary);

  return that;
};

/**
 * Define a method to increment activity counts on a running-totals object.
 *
 * @param  {Object}    totals       The running-totals object on which to increment activity counts
 * @param  {Object}    dictionary   Translation dictionary from activity type to property
 * @return {Function}               Activities-incrementing method
 * @api private
 */
var getActivitiesIncrementer = function(totals, dictionary) {
  /**
   * Given an activity type, find the appropriate running-total property and increment by one.
   *
   * @param  {String}    activityType     The activity type to be translated
   */
  return function(activityType) {
    // Translate activity type to property name.
    var property = dictionary[activityType];

    // Increment the appropriate property if a translation was found.
    if (_.has(totals, property)) {
      totals[property]++;
    }
  };
};

/**
 * Define a method to increment points on a running-totals object.
 *
 * @param  {Object}    totals       The running-totals object on which to increment points
 * @param  {Object}    dictionary   Translation dictionary from activity type to property
 * @return {Function}               Points-incrementing method
 * @api private
 *
 */
var getPointsIncrementer = function(totals, dictionary) {
  /**
   * Given an activity type and points, find the appropriate running-total property and add points.
   *
   * @param  {String}    activityType     The activity type to be translated
   * @param  {Number}    points           The number of points
   */
  return function(activityType, points) {
    // Translate activity type to property name.
    var property = dictionary[activityType];

    // Increment the appropriate property by the given number of points if a translation was found.
    if (_.has(totals, property)) {
      totals[property] += points;
    }
  };
};


/* Utilities */


/**
 * Iterate over an object, subjecting each element to a transformation, and return the maximum transformed
 * value and one associated key (choosing the key at random in the case of a tie). If no transformation
 * yields a positive number, return null.
 *
 * @param  {Object}    object           The object to be iterated
 * @param  {Function}  transformation   The transformation to be applied
 * @return {Object}                     The maximum transformed value and one associated key
 * @api private
 */
var sampleMaximum = function(object, transformation) {
  var ids = [];
  var maximumValue = 0;
  _.forEach(object, function(value, key) {
    var transformedValue = transformation(value);
    if (transformedValue >= maximumValue) {
      if (transformedValue > maximumValue) {
        ids = [];
        maximumValue = transformedValue;
      }
      if (maximumValue > 0) {
        ids.push(key);
      }
    }
  });
  if (!ids.length) {
    return null;
  }
  return {
    'id': _.sample(ids),
    'value': maximumValue
  }
};
