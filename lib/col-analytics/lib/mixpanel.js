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
var config = require('config');

var Mixpanel = require('mixpanel');

var mixpanelClient = null;

/**
 * Initialize Mixpanel client
 *
 * @return {void}
 */
var init = module.exports.init = function() {
  mixpanelClient = Mixpanel.init(config.get('analytics.mixpanel.apiKey'));
};

/**
 * Store or update user data in Mixpanel
 *
 * @param  {User}           user            The user to store or update
 * @return {void}
 */
var identifyUser = module.exports.identifyUser = function(user) {
  if (mixpanelClient) {
    mixpanelClient.people.set(user.id, _.extend({
      '$name': user.canvas_full_name,
      '$created': user.created_at
    }, _.pick(user, [
      'canvas_course_role',
      'canvas_enrollment_state',
      'canvas_image',
      'canvas_user_id',
      'course_id',
      'is_admin',
      'last_activity',
      'points',
      'share_points',
      'updated_at'
    ])));
  }
};

/**
 * Track an event in Mixpanel
 *
 * @param  {User}           user            The user associated with the event
 * @param  {String}         event           A string identifying the event type
 * @param  {Object}         [metadata]      Optional event metadata
 * @return {void}
 */
var track = module.exports.track = function(user, event, metadata) {
  if (mixpanelClient) {
    mixpanelClient.track(event, _.extend({'distinct_id': user.id}, metadata));
  }
};
