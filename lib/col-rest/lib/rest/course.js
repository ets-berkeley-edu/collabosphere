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
  client.course = {};

  /**
   * Get course-wide properties for the current course
   *
   * @param  {Course}         course                          The Canvas course in which the user is interacting with the API
   * @param  {Function}       callback                        Standard callback function
   * @param  {Object}         callback.err                    An error that occurred, if any
   * @param  {Object}         callback.body                   The JSON response from the REST API
   * @param  {Response}       callback.response               The response object as returned by requestjs
   * @see col-course/lib/rest.js for more information
   */
  client.course.getCourse = function(course, callback) {
    var requestUrl = client.util.apiPrefix(course) + '/course';
    client.request(requestUrl, 'GET', null, null, callback);
  };

  /**
   * Get active courses associated with the current user's Canvas account
   *
   * @param  {Course}         course                          The Canvas course in which the user is interacting with the API
   * @param  {Object}         [opts]                          A set of options to filter the results by
   * @param  {Boolean}        [opts.admin]                    Whether to only return courses in which the user is an admin
   * @param  {Boolean}        [opts.assetLibrary]             Whether to only return courses in which the asset library is enabled
   * @param  {Boolean}        [opts.excludeCurrent]           Whether to exclude the current course
   * @param  {Function}       callback                        Standard callback function
   * @param  {Object}         callback.err                    An error that occurred, if any
   * @param  {Object}         callback.body                   The JSON response from the REST API
   * @param  {Response}       callback.response               The response object as returned by requestjs
   * @see col-course/lib/rest.js for more information
   */
  client.course.getUserCourses = function(course, opts, callback) {
    var requestUrl = client.util.apiPrefix(course) + '/courses';
    client.request(requestUrl, 'GET', opts, null, callback);
  };

  /**
   * Mark the current course as active
   *
   * @param  {Course}         course                          The Canvas course in which the user is interacting with the API
   * @param  {Function}       callback                        Standard callback function
   * @param  {Object}         callback.err                    An error that occurred, if any
   * @param  {Object}         callback.body                   The JSON response from the REST API
   * @param  {Response}       callback.response               The response object as returned by requestjs
   * @see col-course/lib/rest.js for more information
   */
  client.course.activateCourse = function(course, callback) {
    var requestUrl = client.util.apiPrefix(course) + '/course/activate';
    client.request(requestUrl, 'POST', null, null, callback);
  };

  /**
   * Update daily notification settings for the current course
   *
   * @param  {Course}         course                          The Canvas course in which the user is interacting with the API
   * @param  {Boolean}        enabled                         Whether daily notifications should be enabled
   * @param  {Function}       callback                        Standard callback function
   * @param  {Object}         callback.err                    An error that occurred, if any
   * @param  {Object}         callback.body                   The JSON response from the REST API
   * @param  {Response}       callback.response               The response object as returned by requestjs
   * @see col-course/lib/rest.js for more information
   */
  client.course.updateDailyNotifications = function(course, enabled, callback) {
    var requestUrl = client.util.apiPrefix(course) + '/course/daily_notifications';
    var data = {
      'enabled': enabled
    };
    client.request(requestUrl, 'POST', data, null, callback);
  };

  /**
   * Update weekly notification settings for the current course
   *
   * @param  {Course}         course                          The Canvas course in which the user is interacting with the API
   * @param  {Boolean}        enabled                         Whether weekly notifications should be enabled
   * @param  {Function}       callback                        Standard callback function
   * @param  {Object}         callback.err                    An error that occurred, if any
   * @param  {Object}         callback.body                   The JSON response from the REST API
   * @param  {Response}       callback.response               The response object as returned by requestjs
   * @see col-course/lib/rest.js for more information
   */
  client.course.updateWeeklyNotifications = function(course, enabled, callback) {
    var requestUrl = client.util.apiPrefix(course) + '/course/weekly_notifications';
    var data = {
      'enabled': enabled
    };
    client.request(requestUrl, 'POST', data, null, callback);
  };
};
