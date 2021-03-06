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
var http = require('http');
var util = require('util');

var AnalyticsAPI = require('col-analytics');
var AssetsAPI = require('./api');
var Collabosphere = require('col-core');
var CollabosphereConstants = require('col-core/lib/constants');
var CollabosphereUtil = require('col-core/lib/util');
var MigrateAssetsAPI = require('./migrate');
var Storage = require('col-core/lib/storage');

/*!
 * Get an asset
 */
Collabosphere.apiRouter.get('/assets/:assetId', function(req, res) {
  // Always increment the views when getting an asset, unless this is
  // explicitly disabled
  var incrementViews = true;
  if (CollabosphereUtil.getBooleanParam(req.query.incrementViews) === false) {
    incrementViews = false;
  }

  AssetsAPI.getAssetProfile(req.ctx, req.params.assetId, incrementViews, function(err, asset) {
    if (err) {
      return res.status(err.code).send(err.msg);
    }
    if (!!asset.deleted_at) {
      return res.status(404).send("The requested asset has been removed");
    }
    AssetsAPI.canUserView(req.ctx.user, asset, function(userCanView) {
      if (!userCanView) {
        return res.status(403).send("Sorry, you are not authorized to view the requested asset.");
      }

      // Track the asset view
      if (incrementViews !== false) {
        AnalyticsAPI.track(req.ctx.user, 'View asset', AnalyticsAPI.getAssetProperties(asset), asset);
      }

      return res.status(200).send(asset);
    });
  });
});

/*!
 * Get the assets in the current course
 */
Collabosphere.apiRouter.get('/assets', function(req, res) {
  var filters = {
    'keywords': req.query.keywords,
    'user': req.query.user,
    'section': req.query.section,
    'category': req.query.category,
    'types': CollabosphereUtil.toArray(req.query.type),
    'hasComments': req.query.hasComments,
    'hasImpact': req.query.hasImpact,
    'hasLikes': req.query.hasLikes,
    'hasPins': req.query.hasPins,
    'hasTrending': req.query.hasTrending,
    'hasViews': req.query.hasViews
  };
  var sort = req.query.sort;

  // Always track the asset listing or search, unless this is explicitly disabled
  var track = true;
  if (CollabosphereUtil.getBooleanParam(req.query.track) === false) {
    track = false;
  }

  AssetsAPI.getAssets(req.ctx, filters, sort, req.query.limit, req.query.offset, function(err, assets) {
    if (err) {
      return res.status(err.code).send(err.msg);
    }

    if (track !== false) {
      // Track the asset search
      if (filters.keywords || filters.user || filters.section || filters.category || filters.types.length) {
        AnalyticsAPI.track(req.ctx.user, 'Search assets', {
          'offset': assets.offset,
          'total': assets.total,
          'asset_search_keywords': filters.keywords,
          'asset_search_user': filters.user,
          'asset_search_section': filters.section,
          'asset_search_category': filters.category,
          'asset_search_types': filters.types,
          'asset_search_location': req.query.searchContext
        });
      // Track the asset listing
      } else {
        AnalyticsAPI.track(req.ctx.user, 'List assets', {
          'offset': assets.offset,
          'total': assets.total
        });
      }
    }

    return res.status(200).send(assets);
  });
});

/*!
 * Create a new asset
 */
Collabosphere.apiRouter.post('/assets', function(req, res) {
  var categories = CollabosphereUtil.toArray(req.body.categories);
  var visible = CollabosphereUtil.getBooleanParam(req.body.visible, true);
  var opts = {
    'categories': categories,
    'description': req.body.description,
    'source': req.body.source,
    'visible': visible
  };

  // Create a new link asset
  if (req.body.type === 'link') {
    AssetsAPI.createLink(req.ctx, req.body.title, req.body.url, opts, function(err, createdLink) {
      if (err) {
        return res.status(err.code).send(err.msg);
      }

      // Track the link asset creation
      var eventProperties = _.extend(AnalyticsAPI.getAssetProperties(createdLink), {
        'bookmarklet': req.headers['x-collabosphere-token'] ? true : false
      });
      AnalyticsAPI.track(req.ctx.user, 'Create link asset', eventProperties, createdLink);

      return res.status(201).send(createdLink);
    });

  // Create a new file asset
  } else if (req.body.type === 'file') {
    AssetsAPI.createFile(req.ctx, req.body.title, req.files.file, opts, function(err, createdFile) {
      if (err) {
        return res.status(err.code).send(err.msg);
      }

      // Track the file asset creation
      AnalyticsAPI.track(req.ctx.user, 'Create file asset', AnalyticsAPI.getAssetProperties(createdFile), createdFile);

      return res.status(201).send(createdFile);
    });

  // Unrecognized asset type
  } else {
    return res.status(400).send('Unrecognized asset type');
  }
});

/*!
 * Migrate assets. This method returns a success response once migration has started, and finishes
 * the job in the background.
 */
Collabosphere.apiRouter.post('/assets/migrate', function(req, res) {
  var opts = {
    'categories': true,
    'destinationUserId': req.body.destinationUserId,
    'validateUserAccounts': true
  };

  MigrateAssetsAPI.getMigrationContexts(req.ctx, opts, function(err, toCtx, adminCtx) {
    if (err) {
      return res.status(err.code).send(err.msg);
    }

    // Send a success response.
    res.status(200).send();

    // Perform the migration in the background, executing a no-op callback when complete.
    MigrateAssetsAPI.migrate(req.ctx, toCtx, adminCtx, opts, _.noop);
  });
});

/*!
 * Migrate assets synchronously, returning results only after the migration is complete.
 */
Collabosphere.apiRouter.post('/assets/migratesync', function(req, res) {
  var opts = {
    'categories': true,
    'destinationUserId': req.body.destinationUserId,
    'validateUserAccounts': true
  };

  MigrateAssetsAPI.getMigrationContexts(req.ctx, opts, function(err, toCtx, adminCtx) {
    if (err) {
      return res.status(err.code).send(err.msg);
    }

    MigrateAssetsAPI.migrate(req.ctx, toCtx, adminCtx, opts, function(err, results) {
      if (err) {
        return callback(err);
      };

      return res.status(200).send(results);
    });
  });
});

/*!
 * Edit an asset
 */
Collabosphere.apiRouter.post('/assets/:id', function(req, res) {
  var categories = CollabosphereUtil.toArray(req.body.categories);
  var opts = {
    'categories': categories,
    'description': req.body.description
  };

  AssetsAPI.editAsset(req.ctx, req.params.id, req.body.title, opts, function(err, asset) {
    if (err) {
      return res.status(err.code).send(err.msg);
    }

    // Track the asset edit
    AnalyticsAPI.track(req.ctx.user, 'Edit asset', AnalyticsAPI.getAssetProperties(asset), asset);

    return res.status(200).send(asset);
  });
});

/*!
 * Delete an asset
 */
Collabosphere.apiRouter.delete('/assets/:id', function(req, res) {
  AssetsAPI.deleteAsset(req.ctx, req.params.id, function(err) {
    if (err) {
      return res.status(err.code).send(err.msg);
    }

    return res.sendStatus(200);
  });
});

/*!
 * Create a new comment on an asset
 */
Collabosphere.apiRouter.post('/assets/:assetId/comments', function(req, res) {
  AssetsAPI.createComment(req.ctx, req.params.assetId, req.body.body, req.body.parent, function(err, comment, asset) {
    if (err) {
      return res.status(err.code).send(err.msg);
    }

    // Track the asset comment
    AnalyticsAPI.track(req.ctx.user, 'Create asset comment', AnalyticsAPI.getAssetCommentProperties(comment, asset), comment, asset);

    return res.status(201).send(comment);
  });
});

/*!
 * Edit a comment on an asset
 */
Collabosphere.apiRouter.post('/assets/:assetId/comments/:commentId', function(req, res) {
  AssetsAPI.editComment(req.ctx, req.params.assetId, req.params.commentId, req.body.body, function(err, comment, asset) {
    if (err) {
      return res.status(err.code).send(err.msg);
    }

    // Track the asset comment edit
    AnalyticsAPI.track(req.ctx.user, 'Edit asset comment', AnalyticsAPI.getAssetCommentProperties(comment, asset), comment, asset);

    return res.status(200).send(comment);
  });
});

/*!
 * Delete a comment on an asset
 */
Collabosphere.apiRouter.delete('/assets/:assetId/comments/:commentId', function(req, res) {
  AssetsAPI.deleteComment(req.ctx, req.params.assetId, req.params.commentId, function(err, comment, asset) {
    if (err) {
      return res.status(err.code).send(err.msg);
    }

    // Track the asset comment delete
    AnalyticsAPI.track(req.ctx.user, 'Delete asset comment', AnalyticsAPI.getAssetCommentProperties(comment, asset), comment, asset);

    return res.sendStatus(200);
  });
});

/*!
 * Download an asset
 */
Collabosphere.apiRouter.get('/assets/:assetId/download', function(req, res) {
  if (req.ctx.user.canvas_enrollment_state !== 'active' && !_.includes(CollabosphereConstants.ADMIN_ROLES, req.ctx.user.canvas_course_role)) {
    return res.status(401).send('You are not authorized to download this asset');
  }

  AssetsAPI.getAssetProfile(req.ctx, req.params.assetId, false, function(err, asset) {
    if (err) {
      return res.status(err.code).send(err.msg);
    }
    if (!!asset.deleted_at) {
      return res.status(404).send("The requested asset has been removed");
    }

    AssetsAPI.canUserView(req.ctx.user, asset, function(userCanView) {
      if (!userCanView) {
        return res.status(403).send("Sorry, you are not authorized to download the requested asset.");
      }
      if (!asset.download_url) {
        return res.status(404).send("Requested asset has a null or undefined S3 Object Key");
      }
      // Track event unless false is explicit
      if (CollabosphereUtil.getBooleanParam(req.query.track) !== false) {
        AnalyticsAPI.track(req.ctx.user, 'Download asset', AnalyticsAPI.getAssetProperties(asset));
      }

      if (Storage.isS3Uri(asset.download_url)) {
        var s3ObjectKey = asset.download_url;

        Storage.getObjectMetadata(s3ObjectKey, function(err, metadata) {
          if (err) {
            return res.status(err.code).send(err.msg);
          }
          if (metadata.ContentType) {
            res.set('Content-Type', metadata.ContentType);
            res.set('Content-Length', metadata.ContentLength);
            res.set('Last-Modified', metadata.LastModified);
          }

          Storage.getObject(s3ObjectKey, function(data) {
            var filename = _.split(s3ObjectKey, '/').pop();

            res.set('Content-Disposition', util.format('attachment; filename="%s"', encodeURIComponent(filename)));
            data.createReadStream().pipe(res);

            return res.status(200);
          });
        });

      } else {
        res.writeHead(302, { 'Location': asset.download_url });
        res.end();
      }
    });
  });
});

/*!
 * Like or dislike an asset
 */
Collabosphere.apiRouter.post('/assets/:assetId/like', function(req, res) {
  var like = CollabosphereUtil.getBooleanParam(req.body.like);
  AssetsAPI.like(req.ctx, req.params.assetId, like, function(err, asset) {
    if (err) {
      return res.status(err.code).send(err.msg);
    }

    // Track the asset like
    var event = null;
    if (like === true) {
      event = 'Like asset';
      // Track the asset dislike
    } else if (like === false) {
      event = 'Dislike asset';
    // Track the asset unlike
    } else {
      event = 'Unlike asset';
    }
    AnalyticsAPI.track(req.ctx.user, event, AnalyticsAPI.getAssetProperties(asset), asset);

    return res.sendStatus(200);
  });
});


/*!
 * Pin an asset
 */
Collabosphere.apiRouter.post('/assets/:assetId/pin', function(req, res) {
  AssetsAPI.pin(req.ctx, req.params.assetId, true, function(err, asset) {
    if (err) {
      return res.status(err.code).send(err.msg);
    }

    return res.sendStatus(200);
  });
});

/*!
 * Unpin an asset
 */
Collabosphere.apiRouter.post('/assets/:assetId/unpin', function(req, res) {
  AssetsAPI.pin(req.ctx, req.params.assetId, false, function(err, asset) {
    if (err) {
      return res.status(err.code).send(err.msg);
    }

    return res.sendStatus(200);
  });
});

/*!
 * Create a new whiteboard from an exported whiteboard asset
 */
Collabosphere.apiRouter.post('/assets/:id/whiteboard', function(req, res) {
  AssetsAPI.createWhiteboardFromAsset(req.ctx, req.params.id, function(err, whiteboard) {
    if (err) {
      return res.status(err.code).send(err.msg);
    }

    res.status(201).send(whiteboard);
  });
});

/*!
 * Handle preview results
 */
Collabosphere.appServer.post('/api/assets-callback', function(req, res) {
  AssetsAPI.handlePreviewsCallback(req.headers.authorization, req.body, function(err) {
    if (err) {
      return res.status(err.code).send(err.msg);
    }

    return res.sendStatus(200);
  });
})
