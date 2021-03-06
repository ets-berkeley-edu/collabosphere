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

var config = require('config');
var moment = require('moment-timezone');
var util = require('util');

var ActivitiesAPI = require('./api');
var AnalyticsAPI = require('col-analytics');
var Collabosphere = require('col-core');
var CollabosphereUtil = require('col-core/lib/util');
var DailyNotifications = require('./notifications/daily');
var WeeklyNotifications = require('./notifications/weekly');

/*!
 * Export the activities for a course as a CSV file
 */
Collabosphere.apiRouter.get('/activities.csv', function(req, res) {
  ActivitiesAPI.exportActivities(req.ctx, function(err, activities) {
    if (err) {
      return res.status(err.code).send(err.msg);
    }

    // TODO: This date should be dependent on where the course is being given. Canvas doesn't give
    // us this information however so we default it to app timezone
    var timezone = config.get('timezone');
    var date = moment().tz(timezone).format('YYYY_MM_DD_HH_mm');
    var filename = util.format('engagement_index_activities_%d_%s.csv', req.ctx.course.canvas_course_id, date);
    var dispositionHeader = util.format('attachment; filename="%s"', filename);
    res.set('Content-Disposition', dispositionHeader);
    res.set('Content-Type', 'text/csv');
    return res.status(200).send(activities);
  });
});

/*!
 * Get all activities for a given user id
 */
Collabosphere.apiRouter.get('/activities/user/:userId', function(req, res) {
  ActivitiesAPI.getActivitiesForUserId(req.ctx, req.params.userId, function(err, activities) {
    if (err) {
      return res.status(err.code).send(err.msg);
    }

    return res.status(200).send(activities);
  });
});

/*!
 * Get all activities for a given asset id
 */
Collabosphere.apiRouter.get('/activities/asset/:assetId', function(req, res) {
  ActivitiesAPI.getActivitiesForAssetId(req.ctx, req.params.assetId, function(err, activities) {
    if (err) {
      return res.status(err.code).send(err.msg);
    }

    return res.status(200).send(activities);
  });
});

/*!
 * Get interaction data for a course, grouped by user id, actor id and activity type
 */
Collabosphere.apiRouter.get('/activities/interactions', function(req, res) {
  ActivitiesAPI.getInteractions(req.ctx, function(err, interactions) {
    if (err) {
      return res.status(err.code).send(err.msg);
    }

    return res.status(200).send(interactions);
  });
});

/*!
 * Get the activity type configuration for a course
 */
Collabosphere.apiRouter.get('/activities/configuration', function(req, res) {
  ActivitiesAPI.getActivityTypeConfiguration(req.ctx.course.id, function(err, configuration) {
    if (err) {
      return res.status(err.code).send(err.msg);
    }

    // Track the points configuration listing
    AnalyticsAPI.track(req.ctx.user, 'Get points configuration', {
      'ei_points': req.ctx.user.points,
      'ei_share': req.ctx.user.share_points,
      'ei_last_activity': req.ctx.user.last_activity
    });

    return res.status(200).send(configuration);
  });
});

/*!
 * Edit the activity type configuration for a course
 */
Collabosphere.apiRouter.post('/activities/configuration', function(req, res) {
  ActivitiesAPI.editActivityTypeConfiguration(req.ctx, req.body, function(err) {
    if (err) {
      return res.status(err.code).send(err.msg);
    }

    return res.sendStatus(200);
  });
});

/*!
 * Manually trigger the weekly email notification for a course. We use a GET request since this is an admin-only
 * endpoint entered into the browser.
 */
Collabosphere.apiRouter.get('/activities/notifications/send_weekly', function(req, res) {
  WeeklyNotifications.sendWeeklyNotificationsForCourse(req.ctx, function(err) {
    if (err) {
      return res.status(err.code).send(err.msg);
    }

    return res.status(200).send({'sending': true});
  });
});

/*!
 * Manually trigger the daily email notification for a course. We use a GET request since this is an admin-only
 * endpoint entered into the browser.
 */
Collabosphere.apiRouter.get('/activities/notifications/send_daily', function(req, res) {
  DailyNotifications.sendDailyNotificationsForCourse(req.ctx, function(err) {
    if (err) {
      return res.status(err.code).send(err.msg);
    }

    return res.status(200).send({'sending': true});
  });
});
