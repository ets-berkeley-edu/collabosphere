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
  client.lti = {};

  /**
   * Get the cartridge for the Asset Library
   *
   * @param  {Function}       callback                        Standard callback function
   * @param  {Object}         callback.err                    An error that occurred, if any
   * @param  {Object}         callback.body                   The JSON response from the REST API
   * @param  {Response}       callback.response               The response object as returned by requestjs
   * @see col-lti/lib/rest.js for more information
   */
  client.lti.assetLibraryCartridge = function(callback) {
    client.request('/lti/assetlibrary.xml', 'GET', null, null, callback);
  };

  /**
   * Launch the Asset Library
   *
   * @param  {Course}         course                          The course in which the user is launching the LTI tool
   * @param  {Object}         data                            The data to launch the asset library
   * @param  {Function}       callback                        Standard callback function
   * @param  {Object}         callback.err                    An error that occurred, if any
   * @param  {Object}         callback.body                   The JSON response from the REST API
   * @param  {Response}       callback.response               The response object as returned by requestjs
   * @see col-lti/lib/rest.js for more information
   */
  client.lti.assetLibraryLaunch = function(course, data, callback) {
    client.request('/lti/assetlibrary', 'POST', data, null, callback);
  };

  /**
   * Get the cartridge for Dashboard
   *
   * @param  {Function}       callback                        Standard callback function
   * @param  {Object}         callback.err                    An error that occurred, if any
   * @param  {Object}         callback.body                   The JSON response from the REST API
   * @param  {Response}       callback.response               The response object as returned by requestjs
   * @see col-lti/lib/rest.js for more information
   */
  client.lti.dashboardCartridge = function(callback) {
    client.request('/lti/dashboard.xml', 'GET', null, null, callback);
  };

  /**
   * Launch the Impact Studio
   *
   * @param  {Course}         course                          The course in which the user is launching the LTI tool
   * @param  {Object}         data                            The data for Impact Studio
   * @param  {Function}       callback                        Standard callback function
   * @param  {Object}         callback.err                    An error that occurred, if any
   * @param  {Object}         callback.body                   The JSON response from the REST API
   * @param  {Response}       callback.response               The response object as returned by requestjs
   * @see col-lti/lib/rest.js for more information
   */
  client.lti.dashboardLaunch = function(course, data, callback) {
    client.request('/lti/dashboard', 'POST', data, null, callback);
  };

  /**
   * Get the cartridge for the Engagement Index
   *
   * @param  {Function}       callback                        Standard callback function
   * @param  {Object}         callback.err                    An error that occurred, if any
   * @param  {Object}         callback.body                   The JSON response from the REST API
   * @param  {Response}       callback.response               The response object as returned by requestjs
   * @see col-lti/lib/rest.js for more information
   */
  client.lti.engagementIndexCartridge = function(callback) {
    client.request('/lti/engagementindex.xml', 'GET', null, null, callback);
  };

  /**
   * Launch the Engagement Index
   *
   * @param  {Course}         course                          The course in which the user is launching the LTI tool
   * @param  {Object}         data                            The data to launch the engagement index
   * @param  {Function}       callback                        Standard callback function
   * @param  {Object}         callback.err                    An error that occurred, if any
   * @param  {Object}         callback.body                   The JSON response from the REST API
   * @param  {Response}       callback.response               The response object as returned by requestjs
   * @see col-lti/lib/rest.js for more information
   */
  client.lti.engagementIndexLaunch = function(course, data, callback) {
    client.request('/lti/engagementindex', 'POST', data, null, callback);
  };

  /**
   * Get the cartridge for the Whiteboards
   *
   * @param  {Function}       callback                        Standard callback function
   * @param  {Object}         callback.err                    An error that occurred, if any
   * @param  {Object}         callback.body                   The JSON response from the REST API
   * @param  {Response}       callback.response               The response object as returned by requestjs
   * @see col-lti/lib/rest.js for more information
   */
  client.lti.whiteboardsCartridge = function(callback) {
    client.request('/lti/whiteboards.xml', 'GET', null, null, callback);
  };

  /**
   * Launch the Whiteboards
   *
   * @param  {Course}         course                          The course in which the user is launching the LTI tool
   * @param  {Object}         data                            The data to launch the whiteboards
   * @param  {Function}       callback                        Standard callback function
   * @param  {Object}         callback.err                    An error that occurred, if any
   * @param  {Object}         callback.body                   The JSON response from the REST API
   * @param  {Response}       callback.response               The response object as returned by requestjs
   * @see col-lti/lib/rest.js for more information
   */
  client.lti.whiteboardsLaunch = function(course, data, callback) {
    client.request('/lti/whiteboards', 'POST', data, null, callback);
  };
};
