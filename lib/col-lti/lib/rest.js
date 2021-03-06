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

var AnalyticsAPI = require('col-analytics');
var Collabosphere = require('col-core');
var CollabosphereServer = require('col-core/lib/server');

var LtiAPI = require('./api');
var LtiConstants = require('./constants');

// Don't apply CSRF on the /lti/* endpoints as Canvas uses iframed POSTs to launch a tool
CollabosphereServer.addSafePathPrefix('/lti/');

/**
 * Launch a tool
 *
 * @param  {Request}    req         The incoming request
 * @param  {Response}   res         The ExpressJS response
 * @param  {String}     toolId      The id of the tool that is being launched
 */
var launch = function(req, res, toolId) {
  LtiAPI.launch(req, toolId, function(err, body, user) {
    if (err) {
      return res.status(err.code).send(err.msg);
    }

    // Track the tool launch
    var event = null;
    if (toolId === LtiConstants.ASSETLIBRARY.id) {
      event = 'Launch Asset Library';
    } else if (toolId === LtiConstants.DASHBOARD.id) {
      event = 'Launch Impact Studio';
    } else if (toolId === LtiConstants.WHITEBOARDS.id) {
      event = 'Launch Whiteboards';
    } else if (toolId === LtiConstants.ENGAGEMENTINDEX.id) {
      event = 'Launch Engagement Index';
    }
    AnalyticsAPI.track(user, event, {
      toolId: toolId
    });

    // Get the Canvas domain and course the user is launching the tool from
    var api_domain = body.custom_canvas_api_domain;
    var course_id = body.custom_canvas_course_id;

    var secureCookies = config.get('cookie.secure');

    // We store the user id in cookie specific to the canvas api domain and course. This
    // allows the user to open multiple tools (on multiple Canvas instances) concurrently
    var name = encodeURIComponent(api_domain + '_' + course_id);
    res.cookie(name, user.id, {'sameSite': 'None', 'secure': secureCookies, 'signed': true});

    // Store another cookie to let the application know whether this Canvas instance supports customized
    // cross-window messaging.
    var customMessagingCookieName = encodeURIComponent(body.custom_canvas_api_domain + '_supports_custom_messaging');
    var customMessagingCookieValue = encodeURIComponent(body.supports_custom_messaging);
    res.cookie(customMessagingCookieName, customMessagingCookieValue, {'sameSite': 'None', 'secure': secureCookies});

    // Redirect the user to the tool's HTML. We need to include the api_domain
    // and course id so the application can bootstrap itself
    var url = '/' + toolId;
    url += '?api_domain=' + encodeURIComponent(body.custom_canvas_api_domain);
    url += '&course_id=' + encodeURIComponent(body.custom_canvas_course_id);
    url += '&tool_url=' + encodeURIComponent(body.tool_url);
    return res.redirect(url);
  });
};

/*!
 * The launch URL for the Asset Library tool
 */
Collabosphere.ltiRouter.post('/assetlibrary', function(req, res) {
  launch(req, res, LtiConstants.ASSETLIBRARY.id);
});

/*!
 * Describes how the Asset Library tool can be embedded
 */
Collabosphere.ltiRouter.get('/assetlibrary.xml', function(req, res) {
  var xml = LtiAPI.getBasicLTICartridge(req.headers.host, LtiConstants.ASSETLIBRARY.id, LtiConstants.ASSETLIBRARY.title, LtiConstants.ASSETLIBRARY.description);

  // Return the XML cartridge
  res.setHeader('Content-Type', 'application/xml');
  return res.status(200).send(xml);
});

/*!
 * The launch URL for the Impact Studio
 */
Collabosphere.ltiRouter.post('/dashboard', function(req, res) {
  launch(req, res, LtiConstants.DASHBOARD.id);
});

/*!
 * Describes how the Impact Studio can be embedded
 */
Collabosphere.ltiRouter.get('/dashboard.xml', function(req, res) {
  var xml = LtiAPI.getBasicLTICartridge(req.headers.host, LtiConstants.DASHBOARD.id, LtiConstants.DASHBOARD.title, LtiConstants.DASHBOARD.description);

  // Return the XML cartridge
  res.setHeader('Content-Type', 'application/xml');
  return res.status(200).send(xml);
});

/*!
 * The launch URL for the Whiteboards
 */
Collabosphere.ltiRouter.post('/whiteboards', function(req, res) {
  launch(req, res, LtiConstants.WHITEBOARDS.id);
});

/*!
 * Describes how the Whiteboards can be embedded
 */
Collabosphere.ltiRouter.get('/whiteboards.xml', function(req, res) {
  var xml = LtiAPI.getBasicLTICartridge(req.headers.host, LtiConstants.WHITEBOARDS.id, LtiConstants.WHITEBOARDS.title, LtiConstants.WHITEBOARDS.description);

  // Return the XML cartridge
  res.setHeader('Content-Type', 'application/xml');
  return res.status(200).send(xml);
});

/*!
 * Describes how the Engagement Index can be embedded
 */
Collabosphere.ltiRouter.get('/engagementindex.xml', function(req, res) {
  var xml = LtiAPI.getBasicLTICartridge(req.headers.host, LtiConstants.ENGAGEMENTINDEX.id, LtiConstants.ENGAGEMENTINDEX.title, LtiConstants.ENGAGEMENTINDEX.description);

  // Return the XML cartridge
  res.setHeader('Content-Type', 'application/xml');
  return res.status(200).send(xml);
});

/*!
 * The launch URL for the Engagement Index
 */
Collabosphere.ltiRouter.post('/engagementindex', function(req, res) {
  launch(req, res, LtiConstants.ENGAGEMENTINDEX.id);
});
