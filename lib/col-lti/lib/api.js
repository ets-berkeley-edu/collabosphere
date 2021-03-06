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
var Joi = require('joi');
var lti = require('ims-lti');

var AnalyticsAPI = require('col-analytics');
var CanvasAPI = require('col-canvas');
var CollabosphereConstants = require('col-core/lib/constants');
var CourseAPI = require('col-course');
var DB = require('col-core/lib/db');
var log = require('col-core/lib/logger')('col-lti');
var UsersAPI = require('col-users');

// A cached Joi validation schema that can be used to validate incoming LTI launch requests
var launchSchema = Joi.object().keys({
  // Parameters that Collabospehere needs
  'custom_canvas_api_domain': Joi.string().required(),
  'custom_canvas_course_id': Joi.number().required(),
  'custom_canvas_user_id': Joi.number().required(),
  'roles': Joi.string().required(),
  'lis_person_name_full': Joi.string().required(),

  // Parameters that should be present as part of the OAuth handshake
  'oauth_consumer_key': Joi.string().alphanum().length(32).required(),
  'oauth_nonce': Joi.string().alphanum().required(),
  'oauth_signature_method': Joi.string().required(),
  'oauth_timestamp': Joi.number().required(),
  'oauth_version': Joi.string().required(),
  'oauth_signature': Joi.string().required()

}).unknown(); // Add .unknown() so Canvas can send more parameters

/**
 * Launch a user into SuiteC over LTI. This function will:
 *  - ensure the request is a proper LTI request
 *  - ensure the request is properly signed though OAuth 1.0
 *  - create new courses on the fly
 *  - create new users on the fly
 *
 * @param  {Request}      req                 The incoming HTTP request
 * @param  {String}       toolId              The id of the tool that is being launched
 * @param  {Function}     callback            Standard callback function
 * @param  {Object}       callback.err        An error object, if any
 * @param  {Object}       callback.body       The validated parameters that were passed along in the request
 * @param  {User}         callback.user       The user that is associated with this LTI launch
 */
var launch = module.exports.launch = function(req, toolId, callback) {
  // Validate the request body
  var validationResult = Joi.validate(req.body, launchSchema);
  if (validationResult.error) {
    return callback({'code': 400, 'msg': validationResult.error.details[0].message});
  }


  var consumer_key = req.body.oauth_consumer_key;
  var canvas_api_domain = req.body.custom_canvas_api_domain;
  var canvas_course_id = req.body.custom_canvas_course_id;
  var canvas_enrollment_state = req.body.custom_canvas_enrollment_state;
  var canvas_user_id = req.body.custom_canvas_user_id;
  var canvas_full_name = req.body.lis_person_name_full;
  var canvas_course_role = req.body.roles;
  var canvas_image = req.body.user_image;
  var canvas_email = req.body.lis_person_contact_email_primary;

  // During an LTI launch, the tool should be able to get its own URL either from the HTTP referer or from  a custom
  // Canvas LTI variable. Depending on tool configuration, Canvas code, and sunspots, we may get good values
  // from both sources, one source, or neither.

  var referer = req.headers.referer;
  var customExternalToolUrl = req.body.custom_external_tool_url && req.body.custom_external_tool_url.replace('api/v1/', '');
  var externalToolUrl = null;

  if (referer && referer.match(CollabosphereConstants.TOOL_URL_FORMAT)) {
    externalToolUrl = referer;
  } else {
      log.warn({'canvas': canvas_api_domain,
                'canvasCourseId': canvas_course_id,
                'toolId': toolId,
                'value': referer},
                'Could not derive external tool URL from LTI launch referer, will fall back to custom LTI param');
    if (customExternalToolUrl && customExternalToolUrl.match(CollabosphereConstants.TOOL_URL_FORMAT)) {
      externalToolUrl = customExternalToolUrl;
    } else {
      log.warn({'canvas': canvas_api_domain,
                'canvasCourseId': canvas_course_id,
                'toolId': toolId,
                'value': customExternalToolUrl},
                'Could not derive external tool URL from custom LTI param, will not persist URL');
    }
  }

  // Get the secret key that matches the given consumer key
  CanvasAPI.getCanvas(canvas_api_domain, consumer_key, function(err, canvas) {
    if (err) {
      return callback(err);
    }

    // Validate the LTI keys
    var provider = new lti.Provider(consumer_key, canvas.lti_secret);
    provider.valid_request(req, function(err, isValid) {
      if (err) {
        if (err.message === 'Invalid Signature') {
          return callback({'code': 401, 'msg': 'Invalid Signature'});
        }

        log.error({'err': err}, 'An LTI launch resulted in an error');
        return callback({'code': 400, 'msg': err.message});
      } else if (!isValid) {
        log.warn('An LTI launch was invalid');
        return callback({'code': 400, 'msg': 'Failed validation'});
      }

      // Create the course on the fly
      var courseInfo = {
        'name': req.body.context_title
      };
      if (externalToolUrl) {
        if (toolId === 'assetlibrary') {
          courseInfo.assetlibrary_url = externalToolUrl;
        } else if (toolId === 'dashboard') {
          courseInfo.dashboard_url = externalToolUrl;
        } else if (toolId === 'engagementindex') {
          courseInfo.engagementindex_url = externalToolUrl;
        } else if (toolId === 'whiteboards') {
          courseInfo.whiteboards_url = externalToolUrl;
        }
      }
      CourseAPI.getOrCreateCourse(canvas_course_id, canvas, courseInfo, function(err, course) {
        if (err) {
          return callback(err);
        }

        // If the LTI launch did not provide a recognized Canvas enrollment state, mark the user inactive to
        // keep them from surfacing as a course site member.
        if (!_.includes(_.values(CollabosphereConstants.ENROLLMENT_STATE), canvas_enrollment_state)) {
          canvas_enrollment_state = 'inactive';
        }

        // Site admins are likewise considered inactive.
        if (_.includes(CollabosphereConstants.ADMIN_ROLES, canvas_course_role)) {
          canvas_enrollment_state = 'inactive';
        }

        // Create the user on the fly
        var defaults = {
          'canvas_course_role': canvas_course_role,
          'canvas_full_name': canvas_full_name,
          'canvas_image': canvas_image,
          'canvas_email': canvas_email,
          'canvas_enrollment_state': canvas_enrollment_state
        };
        UsersAPI.getOrCreateUser(canvas_user_id, course, defaults, function(err, user) {
          if (err) {
            return callback(err);
          }

          // Store or update the user's analytics properties
          AnalyticsAPI.identifyUser(user);

          // Keep track of the URL that is performing the LTI launch
          provider.body.tool_url = externalToolUrl;

          // Keep track of whether this Canvas instance supports custom cross-window messaging
          provider.body.supports_custom_messaging = canvas.supports_custom_messaging;

          return callback(null, provider.body, user);
        });
      });
    });
  });
};

/**
 * Construct a Basic LTI cartridge that can be consumed by Canvas. It contains
 * information about how Canvas should interact with the tool and how it can
 * embed it in its own pages
 *
 * @param  {String}     host            The host for which to get the cartridge
 * @param  {String}     toolId          The tool id
 * @param  {String}     title           The title of the tool
 * @param  {String}     description     The description of the tool
 * @return {String}                     The Basic LTI cartridge for the tool
 */
var getBasicLTICartridge = module.exports.getBasicLTICartridge = function(host, toolId, title, description) {
  // The URL where the LTI tool will be launched
  var protocol = config.get('app.https') ? 'https' : 'http';
  var url = protocol + '://' + host + '/lti/' + toolId;

  // Construct the cartridge
  var xml = '<?xml version="1.0" encoding="UTF-8"?>';
  xml += '<cartridge_basiclti_link xmlns="http://www.imsglobal.org/xsd/imslticc_v1p0"';
  xml += '    xmlns:blti = "http://www.imsglobal.org/xsd/imsbasiclti_v1p0"';
  xml += '    xmlns:lticm ="http://www.imsglobal.org/xsd/imslticm_v1p0"';
  xml += '    xmlns:lticp ="http://www.imsglobal.org/xsd/imslticp_v1p0"';
  xml += '    xmlns:xsi = "http://www.w3.org/2001/XMLSchema-instance"';
  xml += '    xsi:schemaLocation = "http://www.imsglobal.org/xsd/imslticc_v1p0 http://www.imsglobal.org/xsd/lti/ltiv1p0/imslticc_v1p0.xsd';
  xml += '    http://www.imsglobal.org/xsd/imsbasiclti_v1p0 http://www.imsglobal.org/xsd/lti/ltiv1p0/imsbasiclti_v1p0.xsd';
  xml += '    http://www.imsglobal.org/xsd/imslticm_v1p0 http://www.imsglobal.org/xsd/lti/ltiv1p0/imslticm_v1p0.xsd';
  xml += '    http://www.imsglobal.org/xsd/imslticp_v1p0 http://www.imsglobal.org/xsd/lti/ltiv1p0/imslticp_v1p0.xsd">';
  xml += '    <blti:title>' + title + '</blti:title>';
  xml += '    <blti:description>' + description + '</blti:description>';
  xml += '    <blti:icon></blti:icon>';
  xml += '    <blti:launch_url>' + url  + '</blti:launch_url>';
  xml += '    <blti:extensions platform="canvas.instructure.com">';
  xml += '      <lticm:property name="tool_id">collabosphere_' + toolId + '</lticm:property>';
  xml += '      <lticm:property name="privacy_level">public</lticm:property>';
  xml += '      <lticm:options name="course_navigation">';
  xml += '        <lticm:property name="url">' + url + '</lticm:property>';
  xml += '        <lticm:property name="text">' + title + '</lticm:property>';
  xml += '        <lticm:property name="visibility">public</lticm:property>';
  xml += '        <lticm:property name="default">disabled</lticm:property>';
  xml += '        <lticm:property name="enabled">false</lticm:property>';
  xml += '        <lticm:options name="custom_fields">';
  xml += '          <lticm:property name="external_tool_url">$Canvas.externalTool.url</lticm:property>';
  xml += '        </lticm:options>';
  xml += '      </lticm:options>';
  xml += '    </blti:extensions>';
  xml += '    <cartridge_bundle identifierref="BLTI001_Bundle"/>';
  xml += '    <cartridge_icon identifierref="BLTI001_Icon"/>';
  xml += '</cartridge_basiclti_link>';

  return xml;
};
