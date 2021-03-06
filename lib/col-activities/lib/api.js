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
var csv = require('fast-csv');
var Joi = require('joi');
var moment = require('moment-timezone');
var Sequelize = require('sequelize');

var ActivitiesDefaults = require('./default');
var ActivitiesUtil = require('./util');
var CollabosphereConstants = require('col-core/lib/constants');
var DB = require('col-core/lib/db');
var log = require('col-core/lib/logger')('col-activities');
var UserConstants = require('col-users/lib/constants');

/* Notifications */

/**
 * Public interface to schedule recurrent jobs, wrapped in a function call so that notifications are not
 * scheduled when scripts require this file.
 */
var scheduleRecurrentJobs = module.exports.scheduleRecurrentJobs = function() {
  ActivitiesUtil.scheduleDailyNotifications();
  ActivitiesUtil.scheduleWeeklyNotifications();
  ActivitiesUtil.scheduleRecalculateTrendingScores();
};

/* Activities */

/**
 * Get the activities for a course that contributed points to the engagement index
 *
 * @param  {Context}            ctx                               Standard context containing the current user and the current course
 * @param  {String|String[]}    [type]                            The activity type(s) to retrieve. One of `ActivitiesDefaults`
 * @param  {Number}             [objectId]                        The id of the object on which the activity is taking place (e.g., the asset id, the comment id, etc.)
 * @param  {String}             [objectType]                      The type of the object on which the activity is taking place. One of `CollabosphereConstants.ACTIVITY.OBJECT_TYPES`
 * @param  {Function}           callback                          Standard callback function
 * @param  {Object}             callback.err                      An error that occurred, if any
 * @param  {Activity[]}         callback.activities               The activities for the course
 */
var getActivities = module.exports.getActivities = function(ctx, type, objectId, objectType, callback) {
  var options = {
    'where': {
      'course_id': ctx.course.id
    },
    'include': {
      'model': DB.User,
      'attributes': UserConstants.BASIC_USER_FIELDS
    },
    'order': [ ['id', 'ASC'] ]
  };
  if (type) {
    options.where.type = type;
  }
  if (objectId) {
    options.where.object_id = objectId;
  }
  if (objectType) {
    options.where.object_type = objectType;
  }
  DB.Activity.findAll(options).complete(function(err, activities) {
    if (err) {
      log.error({'err': err, 'options': options}, 'Failed to get the activities');
      return callback(err);
    }

    return callback(null, activities);
  });
};

/**
 * Export the activities for a course as a CSV file.
 *
 * The activities will be sorted by activity date. Each activity will also include a running total
 * of points for the user that was involved in that activity (including points for the current activity)
 *
 * @param  {Context}          ctx                               Standard context containing the current user and the current course
 * @param  {Function}         callback                          Standard callback function
 * @param  {Object}           callback.err                      An error that occurred, if any
 * @param  {String}           callback.activities               A CSV export of the activities for the course
 */
var exportActivities = module.exports.exportActivities = function(ctx, callback) {
  // Only instructors are able to get the activities for a course
  if (!ctx.user.is_admin) {
    log.error({'id': ctx.user.id}, 'Unauthorized to get the activities');
    return callback({'code': 401, 'msg': 'Unauthorized to get the activities'});
  }

  // Get the activity type configuration for the course
  getActivityTypeConfiguration(ctx.course.id, function(err, configuration) {
    if (err) {
      return callback(err);
    }

    // Index the activity configurations by type so we can more easily access them when iterating
    // through the activities
    var activityConfigurationByType = _.keyBy(configuration, 'type');

    // Get the activities for the course
    getActivities(ctx, null, null, null, function(err, activities) {
      if (err) {
        return callback(err);
      }

      // Format the activities into a CSV file
      var formattedActivities = [];
      var totalScores = {};
      var timezone = config.get('timezone');

      _.each(activities, function(activity) {
        if (activityConfigurationByType[activity.type].enabled) {
          var formattedActivity = {
            'user_id': activity.user_id,
            'user_name': activity.user.canvas_full_name,
            'action': activity.type,
            'date': moment.tz(activity.created_at, timezone).format()
          };
          formattedActivity.score = activityConfigurationByType[activity.type].points;
          // Add the running score for the user
          totalScores[activity.user_id] = (totalScores[activity.user_id] || 0) + formattedActivity.score;
          formattedActivity.running_total = totalScores[activity.user_id];
          formattedActivities.push(formattedActivity);
        }
      });

      csv.writeToString(formattedActivities, {'headers': true}, callback);
    });
  });
};

/**
 * Get activities for a given user id
 *
 * @param  {Context}            ctx                               Standard context containing the current user and the current course
 * @param  {Number}             userId                            The user id for which activities should be returned
 * @param  {Function}           callback                          Standard callback function
 * @param  {Object}             callback.err                      An error that occurred, if any
 * @param  {Object}             callback.activities               The activities for the user, grouped by type
 */
var getActivitiesForUserId = module.exports.getActivitiesForUserId = function(ctx, userId, callback) {
  // Parameter validation
  var validationSchema = Joi.object().keys({
    'userId': Joi.number().required()
  });

  var validationResult = Joi.validate({
    'userId': userId,
  }, validationSchema);

  if (validationResult.error) {
    return callback({'code': 400, 'msg': validationResult.error.details[0].message});
  }

  var options = {
    'where': {
      'id': userId,
      'course_id': ctx.course.id
    },
    'attributes': ['id', 'canvas_full_name', 'canvas_image'],
    'include': {
      'model': DB.Activity,
      'attributes': ['id', 'type', 'actor_id', 'created_at'],
      'include': [
        // Get any associated asset object. We include deleted assets so that we can suppress
        // the entire activity in processing below.
        {
          'model': DB.Asset,
          'attributes': ['id', 'title', 'thumbnail_url', 'deleted_at'],
          'paranoid': false
        },
        // Get any associated comment object.
        {
          'model': DB.Comment,
          'on': {
            '$activities.object_type$': 'comment',
            '$activities.comment.id$': {$col: 'activities.object_id'}
          }
        },
        // For activities where the user was a recipient, get the user who performed the action.
        {
          'model': DB.User,
          'as': 'actor',
          'attributes': ['id', 'canvas_full_name', 'canvas_image', 'canvas_course_role', 'canvas_enrollment_state']
        }
      ]
    },
    'order': [
      [DB.Activity, 'created_at', 'ASC']
    ]
  };

  // Get activity details for the user
  DB.User.findOne(options).complete(function(err, user) {
    if (err) {
      log.error({'err': err, 'user': userId, 'course': ctx.course.id}, 'Failed to get activities for user');
      return callback({'code': 500, 'msg': err.message});
    } else if (!user) {
      log.debug({'err': err, 'user': userId, 'course': ctx.course.id}, 'A user with the specified id was not found in the course');
      return callback({'code': 404, 'msg': 'A user with the specified id was not found in the course'});
    }

    var activitiesByType = {
      'actions': {
        'engagements': [],
        'interactions': [],
        'creations': [],
        'counts': {
          'user': {},
          'course': {}
        },
        'totals': {
          'user': 0,
          'course': 0
        }
      },
      'impacts': {
        'engagements': [],
        'interactions': [],
        'creations': [],
        'counts': {
          'user': {},
          'course': {}
        },
        'totals': {
          'user': 0,
          'course': 0
        }
      }
    };

    // Collect user activity details.
    _.each(user.activities, function(activity) {
      // Omit activities associated with deleted assets.
      if (activity.asset && activity.asset.deleted_at) {
        return;
      }

      // Omit activities performed by administrators not active in the course.
      if (activity.actor &&
          activity.actor.canvas_enrollment_state === 'inactive' &&
          _.includes(CollabosphereConstants.ADMIN_ROLES, activity.actor.canvas_course_role)) {
        return;
      }

      var activityJSON = ActivitiesUtil.buildActivityJSON(activity, user);
      var activityGroup = null;

      switch(activity.type) {
        case 'view_asset':
        case 'like':
          activityGroup = activitiesByType.actions;
          activityGroup.engagements.push(activityJSON);
          break;
        case 'asset_comment':
        case 'discussion_topic':
        case 'discussion_entry':
        case 'pin_asset':
        case 'repin_asset':
          activityGroup = activitiesByType.actions;
          activityGroup.interactions.push(activityJSON);
          break;
        case 'add_asset':
        case 'whiteboard_add_asset':
        case 'export_whiteboard':
        case 'remix_whiteboard':
          activityGroup = activitiesByType.actions;
          activityGroup.creations.push(activityJSON);
          break;
        case 'get_view_asset':
        case 'get_like':
          activityGroup = activitiesByType.impacts;
          activityGroup.engagements.push(activityJSON);
          break;
        case 'get_asset_comment':
        case 'get_asset_comment_reply':
        case 'get_discussion_entry_reply':
        case 'get_pin_asset':
        case 'get_repin_asset':
          activityGroup = activitiesByType.impacts;
          activityGroup.interactions.push(activityJSON);
          break;
        case 'get_whiteboard_add_asset':
        case 'get_remix_whiteboard':
          activityGroup = activitiesByType.impacts;
          activityGroup.creations.push(activityJSON);
          break;
      }

      if (activityGroup) {
        activityGroup.counts.user[activity.type] = (activityGroup.counts.user[activity.type] || 0) + 1;
        activityGroup.totals.user += 1;
      }
    });

    // Get activity counts by type for the entire course. We use raw SQL to:
    //   - exclude activities associated with deleted assets (but include activities with no associated asset);
    //   - exclude activities associated with inactive-administrator actors (but include activities with no associated actor).
    //
    // TODO: This logic might be best merged into the "getActivityCountsForCourseId" method below.
    var sequelize = DB.getSequelize();

    var courseActivityQuery = `SELECT activities.type AS type, COUNT(activities.type) AS count
        FROM activities
          LEFT JOIN assets ON activities.asset_id = assets.id
          LEFT JOIN users ON activities.actor_id = users.id
        WHERE activities.course_id = :course_id
          AND assets.deleted_at IS NULL
          AND (users.canvas_enrollment_state IS NULL OR users.canvas_enrollment_state != 'inactive' OR users.canvas_course_role NOT IN (:admin_roles))
        GROUP BY activities.type`;

    var courseActivityQueryOptions = {
      'type': sequelize.QueryTypes.SELECT,
      'replacements': {
        'admin_roles': CollabosphereConstants.ADMIN_ROLES,
        'course_id': ctx.course.id
      }
    };

    sequelize.query(courseActivityQuery, courseActivityQueryOptions).then(function(activityCounts) {
      // Collect course-wide activity counts.
      _.each(activityCounts, function(activityCount) {
        var count = parseInt(activityCount.count, 10);
        activityGroup = (activityCount.type.startsWith('get')) ? activitiesByType.impacts : activitiesByType.actions;

        activityGroup.counts.course[activityCount.type] = count;
        activityGroup.totals.course += count;
      });

      return callback(null, activitiesByType);
    });
  });
};

/**
 * Get interaction data for a given course id, grouped by user id, actor id and activity type
 *
 * @param  {Context}            ctx                               Standard context containing the current user and the current course
 * @param  {Function}           callback                          Standard callback function
 * @param  {Object}             callback.err                      An error that occurred, if any
 * @param  {Object}             callback.interactions             Interaction data for the course
 */
var getInteractions = module.exports.getInteractions = function(ctx, callback) {
  var sequelize = DB.getSequelize();

  var interactionsQuery = `SELECT a.type AS type, a.actor_id as source, a.user_id as target, COUNT(a.type)::int AS count
    FROM activities a
      LEFT JOIN assets ON a.asset_id = assets.id
      JOIN users AS u ON (a.user_id = u.id AND u.canvas_course_role IN (:student_roles) AND u.canvas_enrollment_state != 'inactive')
      JOIN users AS act ON (a.actor_id = act.id AND act.canvas_course_role IN (:student_roles) AND act.canvas_enrollment_state != 'inactive')
    WHERE a.course_id = :course_id
      AND a.reciprocal_id IS NOT NULL
      AND assets.deleted_at IS NULL
    GROUP BY a.type, a.user_id, a.actor_id`;

  // Co-creation of whiteboards is a special "activity" type, not captured in the activities table but extractable
  // from the assets table.
  var whiteboardCoCreationQuery = `SELECT 'co_create_whiteboard' AS type, au1.user_id AS source, au2.user_id AS target, count(*)::int AS count
    FROM assets a
      JOIN (asset_users au1 JOIN users u1 ON au1.user_id = u1.id AND u1.canvas_course_role IN (:student_roles) AND u1.canvas_enrollment_state != 'inactive')
        ON a.id = au1.asset_id
      JOIN (asset_users au2 JOIN users u2 ON au2.user_id = u2.id AND u2.canvas_course_role IN (:student_roles) AND u2.canvas_enrollment_state != 'inactive')
        ON a.id = au2.asset_id AND au1.user_id < au2.user_id
    WHERE a.course_id = :course_id
    AND a.type = 'whiteboard'
    GROUP BY au1.user_id, au2.user_id`;

  var queryOptions = {
    'type': sequelize.QueryTypes.SELECT,
    'replacements': {
      'course_id': ctx.course.id,
      'student_roles': CollabosphereConstants.STUDENT_ROLES
    }
  };

  sequelize.query(interactionsQuery, queryOptions).complete(function(err, interactions) {
    if (err) {
      log.error({'err': err, 'course': ctx.course}, 'Failed to get grouped activity counts for course');
      return callback({'code': 500, 'msg': err.message});
    }

    sequelize.query(whiteboardCoCreationQuery, queryOptions).complete(function(err, coCreations) {
      if (err) {
        log.error({'err': err, 'course': ctx.course}, 'Failed to get whiteboard co-creations for course');
        return callback({'code': 500, 'msg': err.message});
      }

      interactions = interactions.concat(coCreations);

      return callback(null, interactions);
    });
  });
};

/**
 * Get activities for a given asset id
 *
 * @param  {Context}            ctx                               Standard context containing the current user and the current course
 * @param  {Number}             assetId                           The asset id for which activities should be returned
 * @param  {Function}           callback                          Standard callback function
 * @param  {Object}             callback.err                      An error that occurred, if any
 * @param  {Object}             callback.activities               The activities for the asset, grouped by type
 */
var getActivitiesForAssetId = module.exports.getActivitiesForAssetId = function(ctx, assetId, callback) {
  // Parameter validation
  var validationSchema = Joi.object().keys({
    'assetId': Joi.number().required()
  });

  var validationResult = Joi.validate({
    'assetId': assetId,
  }, validationSchema);

  if (validationResult.error) {
    return callback({'code': 400, 'msg': validationResult.error.details[0].message});
  }

  var options = {
    'where': {
      'id': assetId,
      'course_id': ctx.course.id
    },
    'include': {
      'model': DB.Activity,
      'required': false,
      'where': {
        'type': {
          '$in': [
            'asset_comment',
            'get_pin_asset',
            'get_repin_asset',
            'like',
            'pin_asset',
            'remix_whiteboard',
            'repin_asset',
            'view_asset',
            'whiteboard_add_asset'
          ]
        }
      },
      'attributes': ['id', 'type', 'actor_id', 'created_at'],
      'include': [
        // Get any associated comment object.
        {
          'model': DB.Comment,
          'on': {
            '$activities.object_type$': 'comment',
            '$activities.comment.id$': {$col: 'activities.object_id'}
          }
        },
        // Get the user who performed the action.
        {
          'model': DB.User,
          'as': 'user',
          'attributes': ['id', 'canvas_full_name', 'canvas_image', 'canvas_course_role', 'canvas_enrollment_state']
        }
      ]
    },
    'order': [
      [DB.Activity, 'created_at', 'ASC']
    ]
  };

  DB.Asset.findOne(options).complete(function(err, asset) {
    if (err) {
      log.error({'err': err, 'asset': assetId, 'course': ctx.course.id}, 'Failed to get activities for asset');
      return callback({'code': 500, 'msg': err.message});
    } else if (!asset) {
      log.debug({'err': err, 'asset': assetId, 'course': ctx.course.id}, 'An asset with the specified id was not found in the course');
      return callback({'code': 404, 'msg': 'An asset with the specified id was not found in the course'});
    }

    // Group activities by type.
    var activitiesByType = {
      'asset_comment': [],
      'like': [],
      'pin_asset': [],
      'get_pin_asset': [],
      'repin_asset': [],
      'get_repin_asset': [],
      'view_asset': [],
      'whiteboard_add_asset': []
    };

    // Remix activities apply only to exported whiteboard assets.
    if (asset.type === 'whiteboard') {
      activitiesByType.remix_whiteboard = [];
    }

    _.each(asset.activities, function(activity) {
      // Omit activities performed by administrators not active in the course.
      if (activity.user &&
          activity.user.canvas_enrollment_state === 'inactive' &&
          _.includes(CollabosphereConstants.ADMIN_ROLES, activity.user.canvas_course_role)) {
        return;
      }

      var activityJSON = ActivitiesUtil.buildActivityJSON(activity);
      activitiesByType[activity.type].push(activityJSON);
    });

    return callback(null, activitiesByType);
  });
};

/**
 * Create an activity that contributes points to the engagement index
 *
 * @param  {Course}           course                              The course to which the activity should be associated
 * @param  {User}             user                                The user earning activity points for the activity
 * @param  {String}           type                                The type of the activity. One of the types in `col-activities/lib/constants.js`
 * @param  {Number}           objectId                            The id of the object on which the activity is taking place (e.g., the asset id, the comment id, etc.)
 * @param  {String}           objectType                          The type of the object on which the activity is taking place. One of `CollabosphereConstants.ACTIVITY.OBJECT_TYPES`
 * @param  {Object}           [metadata]                          Additional metadata that is associated with the activity. For example, when creating a submission activity it might be useful to store the submission id, the attempt number and the attachment ids
 * @param  {Number}           [metadata.assetId]                  The id of an asset associated with the activity, when different from the object id (e.g., for comments)
 * @param  {User}             [actor]                             The user performing the activity when different than the user earning activity points
 * @param  {Function}         callback                            Standard callback function
 * @param  {Object}           callback.err                        An error that occurred, if any
 * @param  {Activity}         callback.activity                   The created activity
 */
var createActivity = module.exports.createActivity = function(course, user, type, objectId, objectType, metadata, actor, callback) {
  // Copy metadata object so that modifications don't affect any other activities that may use the same metadata.
  metadata = _.extend({}, metadata);

  // Parameter validation
  var validationSchema = Joi.object().keys({
    'type': Joi.any().valid(_.map(ActivitiesDefaults, 'type')).required(),
    'objectId': Joi.number().required(),
    'objectType': Joi.any().valid(_.values(CollabosphereConstants.ACTIVITY.OBJECT_TYPES)).required(),
    'metadata': Joi.object().optional()
  });

  var validationResult = Joi.validate({
    'type': type,
    'objectId': objectId,
    'objectType': objectType,
    'metadata': metadata
  }, validationSchema);

  if (validationResult.error) {
    return callback({'code': 400, 'msg': validationResult.error.details[0].message});
  }

  // Create the activity in the DB
  var activity = {
    'course_id': course.id,
    'user_id': user.id,
    'type': type,
    'object_type': objectType
  };
  if (metadata) {
    activity.metadata = metadata;
  }
  if (objectType === 'asset') {
    activity.asset_id = objectId;
  } else {
    activity.object_id = objectId;
    if (metadata.assetId) {
      activity.asset_id = metadata.assetId;
      delete metadata.assetId;
    }
  }
  if (actor) {
    activity.actor_id = actor.id;
  }
  if (metadata.reciprocalId) {
    activity.reciprocal_id = metadata.reciprocalId;
    delete metadata.reciprocalId;
  }

  // TODO: Wrap this in a transaction
  DB.Activity.create(activity).complete(function(err, activity) {
    if (err) {
      log.error({'err': err}, 'Failed to create a new activity');
      return callback({'code': 500, 'msg': err.message});
    }

    // Retrieve the number of points that should be earned for
    // the current activity in the current course
    getActivityTypeConfiguration(course.id, function(err, configuration) {
      if (err) {
        return callback(err);
      }

      // Update the timestamp at which the last activity took place for the user
      ActivitiesUtil.setUserLastActivity(user, actor, function(err) {
        if (err) {
          return callback(err);
        }

        // Get the activity configuration for this type of activity.
        var activityConfiguration = _.find(configuration, {'type': type});

        // Create a context in order to retrieve any associated asset, and adjust the asset's impact score if applicable.
        var ctx = {'user': user, 'course': course};
        ActivitiesUtil.adjustImpactScore(ctx, activity, activityConfiguration, true, function(err) {
          if (err) {
            return callback(err);
          }

          // If the activity is disabled, the user receives no points.
          if (!activityConfiguration.enabled) {
            return callback(null, activity);
          }

          // Increment the user's points.
          var points = activityConfiguration.points;
          user.increment('points', {'by': points}).complete(function(err) {
            if (err) {
              log.error({'err': err}, 'Failed to increment the points for a user');
              return callback({'code': 500, 'msg': err.message});
            }

            return callback(null, activity);
          });
        });
      });
    });
  });
};

/**
 * Get the most recent activity timestamp for the course. Rather than querying activities directly, perform
 * a more lightweight query against the last_activity attribute for course users.
 *
 * @param  {Number}          courseId                          The id for the requested course
 * @param  {Function}        callback                          Standard callback function
 * @param  {Object}          callback.err                      An error that occurred, if any
 * @param  {String}          callback.lastActivityTimestamp    String timestamp for the most recent activity
 */
var getLastActivityForCourse = module.exports.getLastActivityForCourse = function(courseId, callback) {
  var userActivityOptions = {
    'where': {
      'course_id': courseId,
      'last_activity': {
        $ne: null
      }
    },
    'attributes': ['last_activity'],
    'order': [
      ['last_activity', 'DESC']
    ]
  };

  DB.User.findOne(userActivityOptions).complete(function(err, user) {
    if (err) {
      log.error({'err': err, 'courseId': courseId}, 'Failed to get activity data for a course');
      return callback({'code': 500, 'msg': err.message});
    }
    var lastActivityTimestamp = _.get(user, 'last_activity');

    return callback(null, lastActivityTimestamp);
  });
};

/**
 * Update an activity
 *
 * @param  {Activity}       activity            The activity to update
 * @param  {Object}         update              The updates to persist
 * @param  {Object}         [update.metadata]   The updated metadata object
 * @param  {Function}       callback            Standard callback function
 * @param  {Object}         callback.err        An error that occurred, if any
 */
var updateActivity = module.exports.updateActivity = function(activity, update, callback) {
  // Parameter validation
  var validationSchema = Joi.object().keys({
    'activity': Joi.object().required(),
    'update': Joi.object().min(1).keys({
      'metadata': Joi.object().optional()
    })
  });

  var validationResult = Joi.validate({
    'activity': activity,
    'update': update
  }, validationSchema);

  if (validationResult.error) {
    return callback({'code': 400, 'msg': validationResult.error.details[0].message});
  }

  activity.update(update).complete(function(err, activity) {
    if (err) {
      log.error({'err': err, 'activity': activity.id}, 'Failed to update an activity');
      return callback({'code': 500, 'msg': 'Failed to update an activity'});
    }

    return callback(null, activity);
  });
};

/**
 * Remove an activity and undo the points it contributed to the engagement index
 *
 * @param  {Course}           course                              The course to which the activity to remove is associated
 * @param  {User}             user                                The user that earned activity points for the activity to remove
 * @param  {String|String[]}  type                                The type of the activity to remove. One of the types in `col-activities/lib/constants.js`
 * @param  {Number}           objectId                            The id of the object on which the activity took place (e.g., the asset id, the comment id, etc.)
 * @param  {String}           objectType                          The type of the object on which the activity took place. One of `CollabosphereConstants.ACTIVITY.OBJECT_TYPES`
 * @param  {User}             [actor]                             The user that performed the activity when different than the user earning activity points
 * @param  {Function}         callback                            Standard callback function
 * @param  {Object}           callback.err                        An error that occurred, if any
 * @param  {Activity}         callback.activity                   The deleted activity
 */
var deleteActivity = module.exports.deleteActivity = function(course, user, type, objectId, objectType, actor, callback) {
  // Verify if the user has already performed the activity
  var options = {
    'where': {
      'course_id': course.id,
      'user_id': user.id,
      'type': type,
      'object_type': objectType
    }
  };
  if (objectType === 'asset') {
    options.where.asset_id = objectId;
  } else {
    options.where.object_id = objectId;
  }
  if (actor) {
    options.where.actor_id = actor.id;
  }
  DB.Activity.findOne(options).complete(function(err, activity) {
    if (err) {
      log.error({'err': err}, 'Failed to retrieve the previous activity');
      return callback({'code': 500, 'msg': err.message});
    }

    // Return immediately if no matching activity is found
    if (!activity) {
      return callback();
    }

    // Retrieve the number of points that should be deducted to undo the provided activity
    getActivityTypeConfiguration(activity.course_id, function(err, configuration) {
      if (err) {
        return callback(err);
      }

      // Get the configuration for this activity type.
      var activityConfiguration = _.find(configuration, {'type': activity.type});

      // Create a context in order to retrieve any associated asset, and decrement impact score if applicable.
      var ctx = {'user': user, 'course': course};

      ActivitiesUtil.adjustImpactScore(ctx, activity, activityConfiguration, false, function(err) {
        if (err) {
          return callback(err);
        }

        // Decrease the points of the user
        // TODO: Wrap this in a transaction
        user.decrement('points', {'by': activityConfiguration.points}).complete(function(err) {
          if (err) {
            log.error({'err': err}, 'Failed to decrement the points for a user');
            return callback({'code': 500, 'msg': err.message});
          }

          // Remove the activity
          var activityToDelete = activity.toJSON();
          activity.destroy().complete(function(err) {
            if (err) {
              log.error({'err': err, 'activity': activity}, 'Failed to delete an activity');
              return callback({'code': 500, 'msg': err.message});
            }

            return callback(null, activityToDelete);
          });
        });
      });
    });
  });
};

/**
 * Recalculate the points for a set of users in a course. This will go through the persisted
 * activities and calculate an accurate total for each user. If no activities could be found
 * for a user, their total will be reset to 0
 *
 * @param  {Course}         course              The course for which the user points should be recalculated
 * @param  {Number[]}       [userIds]           The ids of the users to recalculate the points for. Defaults to all the users in the course
 * @param  {Function}       callback            Standard callback function
 * @param  {Object}         callback.err        An error that occurred, if any
 */
var recalculatePoints = module.exports.recalculatePoints = function(course, userIds, callback) {
  // Get the points configuration for this course
  getActivityTypeConfiguration(course.id, function(err, configuration) {
    if (err) {
      return callback(err);
    }

    // Get all the activities for the given set of users
    var options = {
      'where': {
        'course_id': course.id
      }
    };
    if (userIds) {
      options.where.user_id = userIds;
    }
    DB.Activity.findAll(options).complete(function(err, activities) {
      if (err) {
        log.error({'err': err}, 'Failed to get the activities for a set of users');
        return callback({'code': 500, 'msg': err.message});
      }

      // Index the activity configurations by type so we can more easily access them when iterating
      // through the activities
      var activityConfigurationByType = _.keyBy(configuration, 'type');

      // Run through the activities and keep track of how much each user should earn
      var pointsPerUser = {};
      _.each(activities, function(activity) {
        var userId = activity.user_id;
        pointsPerUser[userId] = pointsPerUser[userId] || 0;

        if (activityConfigurationByType[activity.type].enabled) {
          var points = activityConfigurationByType[activity.type].points;
          pointsPerUser[userId] += points;
        }
      });

      // Update the user records
      async.forEachOfSeries(pointsPerUser, ActivitiesUtil.setUserPoints, function(err) {
        if (err) {
          log.error({
            'err': err,
            'course': course.id
          }, 'The points could only be updated for some of the users. The leaderboard might be out of sync');
        }

        return callback(err);
      });
    });
  });
};

/**
 * Recalculate the impact scores for assets in one or all courses. This will go through all persisted
 * activities in the course[s] and calculate an accurate total for each asset. If no impactful
 * activities can be found for an asset, its score will be set to zero.
 *
 * @param  {Course}         [course]            The course for which the user points should be recalculated. If null,
                                                recalculate for all courses.
 * @param  {Function}       callback            Standard callback function
 * @param  {Object}         callback.err        An error that occurred, if any
 */
var recalculateImpactScores = module.exports.recalculateImpactScores = function(course, callback) {
  // Since impact scores can't be overriden, the default activities configuration suffices. Index by type
  // for quick lookup.
  var activityConfigurationByType = _.keyBy(ActivitiesDefaults, 'type');

  // Get all asset-associated activities for the course[s]
  var options = {
    'where': {
      'asset_id': {'$ne': null}
    }
  };

  if (course) {
    log.info({'course': course.id}, 'Will update impact scores for a single course');
    options.where.course_id = course.id;
  } else {
    log.info('Will update impact scores for all courses');
  }

  DB.Activity.findAll(options).complete(function(err, activities) {
    if (err) {
      log.error({'err': err}, 'Failed to get activities for the course');
      return callback({'code': 500, 'msg': err.message});
    }

    // Iterate through the activities and increment scores for assets
    var scoresPerAsset = {};
    _.each(activities, function(activity) {
      var assetId = activity.asset_id;
      scoresPerAsset[assetId] = scoresPerAsset[assetId] || 0;

      var impact = activityConfigurationByType[activity.type].impact;
      if (impact) {
        scoresPerAsset[assetId] += impact;
      }
    });

    // Update the assets in the database
    async.forEachOfSeries(scoresPerAsset, ActivitiesUtil.setImpactScore, function(err) {
      if (err) {
        log.error({
          'err': err,
          'course': course.id
        }, 'Error updating asset impact scores for the course');
      }

      return callback(err);
    });
  });
};

/* Pins */

/**
 * Record pinning or repinning activity based on user's history with this asset.
 *
 * @param  {Context}        ctx                 Standard context containing the current user
 * @param  {Number}         asset               The asset to be pinned or repinned
 * @param  {Function}       callback            Standard callback function
 * @param  {Object}         callback.err        An error that occurred, if any
 * @param  {Activity}       callback.activity   The created activity
 */
var createPinActivity = module.exports.createPinActivity = function(ctx, asset, callback) {
  var proceed = !_.find(asset.users, {'id': ctx.user.id});

  if (proceed) {
    getActivitiesForAssetId(ctx, asset.id, function(err, activities) {
      if (err) {
        return callback(err);
      }
      var hasPinned = activities.pin_asset && !!_.find(activities.pin_asset, function(p) { return p.user.id === ctx.user.id; });
      var type = hasPinned ? 'repin_asset' : 'pin_asset';

      log.info({'user': ctx.user.id, 'asset': asset.id}, 'Create \'' + type + '\' activity');
      createActivity(ctx.course, ctx.user, type, asset.id, CollabosphereConstants.ACTIVITY.OBJECT_TYPES.ASSET, null, null, function(err, activity) {
        if (err) {
          log.error({'err': err.message, 'user': ctx.user.id, 'asset': asset.id}, 'Failed to create a ' + type + ' activity');

          return callback(err);
        }

        return callback(null, activity);
      });
    });

  } else {
    return callback();
  }
};

/**
 * Record get_pinning or get_repinning activity based on user's history with this asset.
 *
 * @param  {Context}        ctx                 Standard context containing the current user
 * @param  {Number}         asset               The pinned or repinned asset
 * @param  {Number}         reciprocalId        Id of the reciprocal pin_asset or repin_asset activity
 * @param  {Function}       callback            Standard callback function
 * @param  {Object}         callback.err        An error that occurred, if any
 */
var createGetPinActivity = module.exports.createGetPinActivity = function(ctx, asset, reciprocalId, callback) {
  var isNotAssetOwner = !_.find(asset.users, {'id': ctx.user.id});

  if (isNotAssetOwner) {
    getActivitiesForAssetId(ctx, asset.id, function(err, activities) {
      if (err) {
        return callback(err);
      }
      // Consider all asset_users
      var done = _.after(asset.users.length, callback);

      _.each(asset.users, function(user) {
        var hasReceivedPin = activities.get_pin_asset && !!_.find(activities.get_pin_asset, function(activity) {
          return (activity.actor_id === ctx.user.id) && (activity.user.id === user.id);
        });
        var type = hasReceivedPin ? 'get_repin_asset' : 'get_pin_asset';
        var metadata = {'reciprocalId': reciprocalId};

        log.info({'user': user.id, 'asset': asset.id}, 'Create \'' + type + '\' activity');
        createActivity(ctx.course, user, type, asset.id, CollabosphereConstants.ACTIVITY.OBJECT_TYPES.ASSET, metadata, ctx.user, function(err) {
          if (err) {
            log.error({'err': err.message, 'user': user.id, 'asset': asset.id}, 'Failed to create a ' + type + ' activity');

            return callback(err);
          }

          done();
        });
      });
    });
  } else {
    return callback();
  }
};

/* Points configuration */

/**
 * Get the activity type configration for a course. This will consist of the default activity
 * type configuration overlayed with the activity type configuration overrides for that course
 *
 * @param  {Number}           courseId                            The id of the course for which the activity type configuration should be retrieved
 * @param  {Function}         callback                            Standard callback function
 * @param  {Object}           callback.err                        An error that occurred, if any
 * @param  {ActivityType[]}   callback.configuration              The activity type configuration for the course
 * @param  {String}           callback.configuration.type         The type of the activity type configuration. One of the types in `col-activities/lib/constants.js`
 * @param  {String}           callback.configuration.title        The display name of the activity type
 * @param  {Number}           callback.configuration.points       The number of points this activity type will contribute towards a user's points
 * @param  {Boolean}          callback.configuration.enabled      Whether activities of this type will contribute towards a user's points
 */
var getActivityTypeConfiguration = module.exports.getActivityTypeConfiguration = function(courseId, callback) {
  // Parameter validation
  var validationSchema = Joi.object().keys({
    'courseId': Joi.number()
  });

  var validationResult = Joi.validate({
    'courseId': courseId
  }, validationSchema);

  if (validationResult.error) {
    return callback({'code': 400, 'msg': validationResult.error.details[0].message});
  }

  // Get the activity type configuration overrides from the DB
  ActivitiesUtil.getActivityTypeOverrides(courseId, function(err, activityTypeOverrides) {
    if (err) {
      return callback(err);
    }

    // Overlay the overrides on top of the activity type configuration defaults
    var configuration = _.cloneDeep(ActivitiesDefaults);
    _.each(configuration, function(typeConfiguration) {
      var override = _.find(activityTypeOverrides, {'type': typeConfiguration.type});
      if (override) {
        if (!_.isNull(override.points)) {
          typeConfiguration.points = override.points;
        }
        if (!_.isNull(override.enabled)) {
          typeConfiguration.enabled = override.enabled;
        }
      }
    });

    return callback(null, configuration);
  });
};

/**
 * Edit the activity type configuration for a course. The provided activity type configuration
 * overrides will override the default activity type configuration
 *
 * @param  {Context}          ctx                                 Standard context containing the current user and the current course
 * @param  {Object[]}         activityTypeUpdates                 Activity type configuration overrides that should be aplied to the activity type configuration for the course
 * @param  {String}           activityTypeUpdates.type            The type of the activity type configuration override. One of the types in `col-activities/lib/constants.js`
 * @param  {Number}           [activityTypeUpdates.points]        The number of points this activity type should contribute towards a user's points
 * @param  {Boolean}          [activityTypeUpdates.enabled]       Whether activities of this type should contributed towards a user's points
 * @param  {Function}         callback                            Standard callback function
 * @param  {Object}           callback.err                        An error that occurred, if any
 */
var editActivityTypeConfiguration = module.exports.editActivityTypeConfiguration = function(ctx, activityTypeUpdates, callback) {
  // Only instructors are able to edit the activity type configuration
  if (!ctx.user.is_admin) {
    log.error({'id': ctx.user.id}, 'Unauthorized to edit the activity type configuration');
    return callback({'code': 401, 'msg': 'Unauthorized to edit the activity type configuration'});
  }

  // Parameter validation
  var validationSchema = Joi.array().min(1).items(Joi.object().min(2).keys({
    'type': Joi.any().valid(_.map(ActivitiesDefaults, 'type')).required(),
    'points': Joi.number().optional(),
    'enabled': Joi.boolean().optional()
  }));
  var validationResult = Joi.validate(activityTypeUpdates, validationSchema);
  if (validationResult.error) {
    return callback({'code': 400, 'msg': validationResult.error.details[0].message});
  }

  // Get the current activity type overrides from the database
  ActivitiesUtil.getActivityTypeOverrides(ctx.course.id, function(err, activityTypeOverrides) {
    if (err) {
      return callback(err);
    }

    var upsertError = null;

    // Recalculate the points for each user in the course once each activity type override
    // is persisted
    var done = _.after(activityTypeUpdates.length, function() {
      recalculatePoints(ctx.course, null, function(err) {
        if (err) {
          return callback(err);
        } else if (upsertError) {
          return callback(upsertError);
        }

        return callback();
      });
    });

    _.each(activityTypeUpdates, function(update) {
      // Construct an override object
      var activityTypeOverride = _.pick(update, ['type', 'points', 'enabled']);
      activityTypeOverride.course_id = ctx.course.id;

      // Get the previous override (if any)
      var override = _.find(activityTypeOverrides, {'type': update.type});
      if (override) {
        activityTypeOverride.id = override.id;
      }

      // Create or update the activity type override
      DB.ActivityType.upsert(activityTypeOverride).complete(function(err) {
        if (err) {
          log.error({'type': err}, 'Failed to edit the configuration for an activity type');
          upsertError = {'code': 500, 'msg': err.message};
          // Even if an error occurs, the points have to be recalculated as some activity type
          // overrides might've been persisted
        }

        done();
      });
    });
  });
};
