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
  client.users = {};

  /**
   * Get the me feed for the current client within a course
   *
   * @param  {Course}         course                          The Canvas course in which the user is interacting with the API
   * @param  {Function}       callback                        Standard callback function
   * @param  {Object}         callback.err                    An error that occurred, if any
   * @param  {Object}         callback.body                   The JSON response from the REST API
   * @param  {Response}       callback.response               The response object as returned by requestjs
   * @see col-users/lib/rest.js for more information
   */
  client.users.getMe = function(course, callback) {
    var requestUrl = client.util.apiPrefix(course) + '/users/me';
    client.request(requestUrl, 'GET', null, null, callback);
  };

  /**
   * Get the user within course
   *
   * @param  {Course}         course                          The Canvas course in which the user is interacting with the API
   * @param  {Number}         userId                          Id of requested user
   * @param  {Function}       callback                        Standard callback function
   * @param  {Object}         callback.err                    An error that occurred, if any
   * @param  {Object}         callback.body                   The JSON response from the REST API
   * @param  {Response}       callback.response               The response object as returned by requestjs
   * @see col-users/lib/rest.js for more information
   */
  client.users.getUser = function(course, userId, callback) {
    var requestUrl = client.util.apiPrefix(course) + '/users/id/' + userId;
    client.request(requestUrl, 'GET', null, null, callback);
  };

  /**
   * Get all users in the current course
   *
   * @param  {Course}         course                          The Canvas course in which the user is interacting with the API
   * @param  {Function}       callback                        Standard callback function
   * @param  {Object}         callback.err                    An error that occurred, if any
   * @param  {Object}         callback.body                   The JSON response from the REST API
   * @param  {Response}       callback.response               The response object as returned by requestjs
   * @see col-users/lib/rest.js for more information
   */
  client.users.getAllUsers = function(course, callback) {
    var requestUrl = client.util.apiPrefix(course) + '/users';
    client.request(requestUrl, 'GET', null, null, callback);
  };

  /**
   * Get the users in the current course and their points
   *
   * @param  {Course}         course                          The Canvas course in which the user is interacting with the API
   * @param  {Function}       callback                        Standard callback function
   * @param  {Object}         callback.err                    An error that occurred, if any
   * @param  {Object}         callback.body                   The JSON response from the REST API
   * @param  {Response}       callback.response               The response object as returned by requestjs
   * @see col-users/lib/rest.js for more information
   */
  client.users.getLeaderboard = function(course, callback) {
    var requestUrl = client.util.apiPrefix(course) + '/users/leaderboard';
    client.request(requestUrl, 'GET', null, null, callback);
  };

  /**
   * Update user's personal description
   *
   * @param  {Course}         course                          The Canvas course in which the user is interacting with the API
   * @param  {String}         personalBio                     User's personal description
   * @param  {Function}       callback                        Standard callback function
   * @param  {Object}         callback.err                    An error that occurred, if any
   * @param  {Object}         callback.body                   The JSON response from the REST API
   * @param  {Response}       callback.response               The response object as returned by requestjs
   * @see col-users/lib/rest.js for more information
   */
  client.users.updatePersonalBio = function(course, personalBio, callback) {
    var requestUrl = client.util.apiPrefix(course) + '/users/me/personal_bio';
    var data = {
      'personalBio': personalBio
    };
    client.request(requestUrl, 'POST', data, null, callback);
  };

  /**
   * Update the points share status for a user
   *
   * @param  {Course}         course                          The Canvas course in which the user is interacting with the API
   * @param  {Boolean}        share                           Whether the user's points should be shared with the course
   * @param  {Function}       callback                        Standard callback function
   * @param  {Object}         callback.err                    An error that occurred, if any
   * @param  {Object}         callback.body                   The JSON response from the REST API
   * @param  {Response}       callback.response               The response object as returned by requestjs
   * @see col-users/lib/rest.js for more information
   */
  client.users.updateSharePoints = function(course, share, callback) {
    var requestUrl = client.util.apiPrefix(course) + '/users/me/share/';
    var data = {
      'share': share
    };
    client.request(requestUrl, 'POST', data, null, callback);
  };

  /**
   * Update the current user's looking-for-collaborators status
   *
   * @param  {Course}         course                          The Canvas course in which the user is interacting with the API
   * @param  {Boolean}        looking                         Whether the user is looking for collaborators
   * @param  {Function}       callback                        Standard callback function
   * @param  {Object}         callback.err                    An error that occurred, if any
   * @param  {Object}         callback.body                   The JSON response from the REST API
   * @param  {Response}       callback.response               The response object as returned by requestjs
   * @see col-users/lib/rest.js for more information
   */
  client.users.updateLookingForCollaborators = function(course, looking, callback) {
    var requestUrl = client.util.apiPrefix(course) + '/users/me/looking_for_collaborators';
    var data = {
      'looking': looking
    };
    client.request(requestUrl, 'POST', data, null, callback);
  };
};
