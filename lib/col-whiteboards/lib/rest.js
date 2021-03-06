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
var moment = require('moment-timezone');
var util = require('util');

var AnalyticsAPI = require('col-analytics');
var Collabosphere = require('col-core');
var CollabosphereUtil = require('col-core/lib/util');

var WhiteboardsAPI = require('./api');

/*!
 * Get a whiteboard
 */
Collabosphere.apiRouter.get('/whiteboards/:id', function(req, res) {
  WhiteboardsAPI.getWhiteboardProfile(req.ctx, req.params.id, function(err, whiteboard) {
    if (err) {
      return res.status(err.code).send(err.msg);
    }

    if (CollabosphereUtil.getBooleanParam(req.query.track) !== false) {
      // Track the whiteboard retrieval
      AnalyticsAPI.track(req.ctx.user, 'Open whiteboard', AnalyticsAPI.getWhiteboardProperties(whiteboard), whiteboard);
    }

    return res.status(200).send(whiteboard);
  });
});

/*!
 * Get the whiteboards to which the current user has access in the current course
 */
Collabosphere.apiRouter.get('/whiteboards', function(req, res) {
  var filters = {
    'include_deleted': req.query.includeDeleted,
    'keywords': req.query.keywords,
    'user': req.query.user
  };
  WhiteboardsAPI.getWhiteboards(req.ctx, filters, req.query.limit, req.query.offset, function(err, whiteboards) {
    if (err) {
      return res.status(err.code).send(err.msg);
    }

    // Track the whiteboard search
    if (filters.keywords || filters.user) {
      AnalyticsAPI.track(req.ctx.user, 'Search whiteboards', {
        'offset': whiteboards.offset,
        'total': whiteboards.total,
        'whiteboards_search_keywords': filters.keywords,
        'whiteboards_search_user': filters.user
      });
    // Track the whiteboard listing
    } else {
      AnalyticsAPI.track(req.ctx.user, 'List whiteboards', {
        'offset': whiteboards.offset,
        'total': whiteboards.total
      });
    }

    return res.status(200).send(whiteboards);
  });
});

/*!
 * Create a new whiteboard
 */
Collabosphere.apiRouter.post('/whiteboards', function(req, res) {
  var members = CollabosphereUtil.toArray(req.body.members);
  // Ensure that all member ids are proper numbers
  members = _.map(members, function(member) {
    return parseInt(member, 10);
  });

  var opts = {'title': req.body.title};
  WhiteboardsAPI.createWhiteboard(req.ctx, members, opts, function(err, createdWhiteboard) {
    if (err) {
      return res.status(err.code).send(err.msg);
    }

    // Track the whiteboard creation
    AnalyticsAPI.track(req.ctx.user, 'Create whiteboard', AnalyticsAPI.getWhiteboardProperties(createdWhiteboard), createdWhiteboard);

    return res.status(201).send(createdWhiteboard);
  });
});

/*!
 * Edit a whiteboard
 */
Collabosphere.apiRouter.post('/whiteboards/:id', function(req, res) {
  var members = CollabosphereUtil.toArray(req.body.members);
  // Ensure that all member ids are proper numbers
  members = _.map(members, function(member) {
    return parseInt(member, 10);
  });

  WhiteboardsAPI.editWhiteboard(req.ctx, req.params.id, req.body.title, members, function(err, updatedWhiteboard) {
    if (err) {
      return res.status(err.code).send(err.msg);
    }

    // Track the whiteboard edit
    AnalyticsAPI.track(req.ctx.user, 'Edit whiteboard settings', AnalyticsAPI.getWhiteboardProperties(updatedWhiteboard), updatedWhiteboard);

    return res.status(200).send(updatedWhiteboard);
  });
});

/*!
 * Delete a whiteboard
 */
Collabosphere.apiRouter.delete('/whiteboards/:id', function(req, res) {
  WhiteboardsAPI.deleteWhiteboard(req.ctx, req.params.id, function(err) {
    if (err) {
      return res.status(err.code).send(err.msg);
    }

    return res.sendStatus(200);
  });
});

/*!
 * Restore a whiteboard
 */
Collabosphere.apiRouter.post('/whiteboards/:id/restore', function(req, res) {
  WhiteboardsAPI.restoreWhiteboard(req.ctx, req.params.id, function(err) {
    if (err) {
      return res.status(err.code).send(err.msg);
    }

    return res.sendStatus(200);
  });
});

/*!
 * Get the most recent chat messages for a whiteboard
 */
Collabosphere.apiRouter.get('/whiteboards/:id/chat', function(req, res) {
  WhiteboardsAPI.getChatMessages(req.ctx, req.params.id, req.query.before, req.query.limit, function(err, chatMessages, whiteboard) {
    if (err) {
      return res.status(err.code).send(err.msg);
    }

    // Track the whiteboard chat messages listing
    var chatMetadata = _.extend(AnalyticsAPI.getWhiteboardProperties(whiteboard), {
      'before': chatMessages.before,
      'total': chatMessages.total
    });
    AnalyticsAPI.track(req.ctx.user, 'Get whiteboard chat messages', chatMetadata, whiteboard);

    return res.status(200).send(chatMessages);
  });
});

/*!
 * Export a whiteboard to an asset
 */
Collabosphere.apiRouter.post('/whiteboards/:id/export/asset', function(req, res) {
  var categories = CollabosphereUtil.toArray(req.body.categories);
  var opts = {
    'categories': categories,
    'description': req.body.description
  };
  WhiteboardsAPI.exportWhiteboardToAsset(req.ctx, req.params.id, req.body.title, opts, function(err, asset, whiteboard) {
    if (err) {
      return res.status(err.code).send(err.msg);
    }

    // Track the whiteboard export as asset
    var exportMetadata = _.extend(AnalyticsAPI.getWhiteboardProperties(whiteboard), AnalyticsAPI.getAssetProperties(asset));
    AnalyticsAPI.track(req.ctx.user, 'Export whiteboard as asset', exportMetadata, whiteboard, asset);

    res.status(201).send(asset);
  });
});

/*!
 * Export a whiteboard to a PNG image
 */
Collabosphere.apiRouter.get('/whiteboards/:id/export/png', function(req, res) {
  WhiteboardsAPI.exportWhiteboardToPng(req.ctx, req.params.id, function(err, whiteboard, data) {
    if (err) {
      return res.status(err.code).send(err.msg);
    }

    // Track the whiteboard export as PNG
    AnalyticsAPI.track(req.ctx.user, 'Export whiteboard as image', AnalyticsAPI.getWhiteboardProperties(whiteboard), whiteboard);

    // The filename is a concatenation of the whiteboard's title and the current timestamp. Only
    // alphanumerical characters will be used
    var timezone = config.get('timezone');
    var date = moment().tz(timezone).format('YYYY_MM_DD_HH_mm');
    var filename = whiteboard.title + '-' + date;
    filename = filename.replace(/[^A-Za-z0-9-]/g, '-');
    res.set('Content-Disposition', util.format('attachment; filename="%s.png"', filename));
    res.set('Content-Type', 'image/png');

    // If a downloadId parameter was provided, we set a cookie with it. This allows the UI to detect
    // when the whiteboard download is ready
    var downloadId = req.query.downloadId;
    if (downloadId) {
      var cookieName = util.format('whiteboard.%s.png', downloadId);
      res.cookie(cookieName, 'true', {'expires': 0, 'sameSite': 'None', 'secure': true});
    }

    // Write the PNG data to the response
    res.status(200).send(data);
  });
});

/*!
 * Handle preview results
 */
Collabosphere.appServer.post('/api/whiteboards-callback', function(req, res) {
  WhiteboardsAPI.handlePreviewsCallback(req.headers.authorization, req.body, function(err) {
    if (err) {
      return res.status(err.code).send(err.msg);
    }

    return res.sendStatus(200);
  });
})
