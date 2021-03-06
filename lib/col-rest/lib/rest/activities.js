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

module.exports = function(client) {
  client.activities = {};

  /**
   * Export the activities for a course as a CSV file
   *
   * @param  {Course}         course                            The Canvas course in which the user is interacting with the API
   * @param  {Function}       callback                          Standard callback function
   * @param  {Object}         callback.err                      An error that occurred, if any
   * @param  {Object}         callback.body                     The JSON response from the REST API
   * @param  {Response}       callback.response                 The response object as returned by requestjs
   * @see col-activities/lib/rest.js for more information
   */
  client.activities.exportActivities = function(course, callback) {
    var requestUrl = client.util.apiPrefix(course) + '/activities.csv';
    client.request(requestUrl, 'GET', null, null, callback);
  };

  /**
   * Get the activity type configuration for a course
   *
   * @param  {Course}         course                            The Canvas course in which the user is interacting with the API
   * @param  {Function}       callback                          Standard callback function
   * @param  {Object}         callback.err                      An error that occurred, if any
   * @param  {Object}         callback.body                     The JSON response from the REST API
   * @param  {Response}       callback.response                 The response object as returned by requestjs
   * @see col-activities/lib/rest.js for more information
   */
  client.activities.getActivityTypeConfiguration = function(course, callback) {
    var requestUrl = client.util.apiPrefix(course) + '/activities/configuration';
    client.request(requestUrl, 'GET', null, null, callback);
  };

  /**
   * Edit the activity type configration for a course
   *
   * @param  {Course}         course                            The Canvas course in which the user is interacting with the API
   * @param  {Object[]}       activityTypeUpdates               Activity type configuration overrides that should be aplied to the activity type configuration for the course
   * @param  {String}         activityTypeUpdates.type          The type of the activity type configuration override. One of the types in `col-activities/lib/constants.js`
   * @param  {Number}         [activityTypeUpdates.points]      The number of points this activity type should contribute towards a user's points
   * @param  {Boolean}        [activityTypeUpdates.enabled]     Whether activities of this type should contribute towards a user's points
   * @param  {Function}       callback                          Standard callback function
   * @param  {Object}         callback.err                      An error that occurred, if any
   * @param  {Object}         callback.body                     The JSON response from the REST API
   * @param  {Response}       callback.response                 The response object as returned by requestjs
   * @see col-activities/lib/rest.js for more information
   */
  client.activities.editActivityTypeConfiguration = function(course, activityTypeUpdates, callback) {
    var requestUrl = client.util.apiPrefix(course) + '/activities/configuration';
    client.jsonPost(requestUrl, activityTypeUpdates, null, callback);
  };

  /**
   * Get activities for a user ID
   *
   * @param  {Course}         course                            The Canvas course in which the user is interacting with the API
   * @param  {Number}         userId                            The SuiteC id of the user for which activities should be returned
   * @param  {Function}       callback                          Standard callback function
   * @param  {Object}         callback.err                      An error that occurred, if any
   * @param  {Object}         callback.body                     The JSON response from the REST API
   * @param  {Response}       callback.response                 The response object as returned by requestjs
   * @see col-activities/lib/rest.js for more information
   */
  client.activities.getActivitiesForUserId = function(course, userId, callback) {
    var requestUrl = client.util.apiPrefix(course) + '/activities/user/' + client.util.encodeURIComponent(userId);
    client.request(requestUrl, 'GET', null, null, callback);
  };

  /**
   * Get interaction data for a course, grouped by user id, actor id and activity type
   *
   * @param  {Course}         course                            The Canvas course in which the user is interacting with the API
   * @param  {Function}       callback                          Standard callback function
   * @param  {Object}         callback.err                      An error that occurred, if any
   * @param  {Object}         callback.body                     The JSON response from the REST API
   * @param  {Response}       callback.response                 The response object as returned by requestjs
   * @see col-activities/lib/rest.js for more information
   */
  client.activities.getInteractions = function(course, callback) {
    var requestUrl = client.util.apiPrefix(course) + '/activities/interactions';
    client.request(requestUrl, 'GET', null, null, callback);
  };

  /**
   * Get activities for an asset ID
   *
   * @param  {Course}         course                            The Canvas course in which the user is interacting with the API
   * @param  {Number}         assetId                           The id of the asset for which activities should be returned
   * @param  {Function}       callback                          Standard callback function
   * @param  {Object}         callback.err                      An error that occurred, if any
   * @param  {Object}         callback.body                     The JSON response from the REST API
   * @param  {Response}       callback.response                 The response object as returned by requestjs
   * @see col-activities/lib/rest.js for more information
   */
  client.activities.getActivitiesForAssetId = function(course, assetId, callback) {
    var requestUrl = client.util.apiPrefix(course) + '/activities/asset/' + client.util.encodeURIComponent(assetId);
    client.request(requestUrl, 'GET', null, null, callback);
  };

  /*
   * Manually trigger the weekly email notification for a course
   *
   * @param  {Course}         course                            The Canvas course in which the user is interacting with the API
   * @param  {Function}       callback                          Standard callback function
   * @param  {Object}         callback.err                      An error that occurred, if any
   * @param  {Object}         callback.body                     The JSON response from the REST API
   * @param  {Response}       callback.response                 The response object as returned by requestjs
   * @see col-activities/lib/rest.js for more information
   */
  client.activities.sendWeeklyNotificationsForCourse = function(course, callback) {
    var requestUrl = client.util.apiPrefix(course) + '/activities/notifications/send_weekly';
    client.request(requestUrl, 'GET', null, null, callback);
  };

  /*
   * Manually trigger the daily email notification for a course
   *
   * @param  {Course}         course                            The Canvas course in which the user is interacting with the API
   * @param  {Function}       callback                          Standard callback function
   * @param  {Object}         callback.err                      An error that occurred, if any
   * @param  {Object}         callback.body                     The JSON response from the REST API
   * @param  {Response}       callback.response                 The response object as returned by requestjs
   * @see col-activities/lib/rest.js for more information
   */
  client.activities.sendDailyNotificationsForCourse = function(course, callback) {
    var requestUrl = client.util.apiPrefix(course) + '/activities/notifications/send_daily';
    client.request(requestUrl, 'GET', null, null, callback);
  };
};
