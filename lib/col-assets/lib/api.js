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
var fs = require('fs');
var Joi = require('joi');
var Sequelize = require('sequelize');
var util = require('util');

var ActivitiesAPI = require('col-activities');
var AssetsUtil = require('./util');
var CategoriesAPI = require('col-categories');
var Collabosphere = require('col-core');
var CollabosphereConstants = require('col-core/lib/constants');
var CollabosphereUtil = require('col-core/lib/util');
var DB = require('col-core/lib/db');
var log = require('col-core/lib/logger')('col-assets');
var Storage = require('col-core/lib/storage');
var UserConstants = require('col-users/lib/constants');

/**
 * Get a full asset profile. Next to the basic asset profile, this will return:
 *  - the whiteboard elements in a form that Fabric.js can understand;
 *  - any exported whiteboards that use this asset;
 *  - a flag indicating whether the current user is able to delete this asset.
 *
 * @param  {Context}        ctx                     Standard context containing the current user and the current course
 * @param  {Number}         id                      The id of the asset
 * @param  {Boolean}        incrementViews          Whether the total number of views for the asset should be incremented by 1
 * @param  {Function}       callback                Standard callback function
 * @param  {Object}         callback.err            An error that occurred, if any
 * @param  {Asset}          callback.asset          The requested asset profile
 */
var getAssetProfile = module.exports.getAssetProfile = function(ctx, id, incrementViews, callback) {
  var opts = {
    'incrementViews': incrementViews,
    'includeWhiteboardElements': true,
    'includeWhiteboardUsages': true
  };
  getAsset(ctx, id, opts, function(err, asset) {
    if (err) {
      log.error({
        'err': err,
        'asset': id,
        'course': ctx.course
      }, 'Failed to get asset by id');
      return callback(err);
    }

    // Check for badge eligibility before JSONification suppresses the impact score.
    getBadgeCutoffForCourse(ctx.course, function(err, cutoffScore) {
      if (err) {
        log.error({'err': err, 'course': ctx.course}, 'Could not get badge cutoff score for course');
        return callback({'code': 500, 'msg': err.message});
      }

      // Award a badge if the asset is associated with no instructors and its impact score equals or exceeds
      // the cutoff score.
      if (cutoffScore && asset.impact_score >= cutoffScore && !_.find(asset.users, 'is_admin')) {
        asset.badged = true;
      }

      asset = asset.toJSON();
      asset.whiteboard_elements = _.map(asset.whiteboard_elements, function(element) {
        return Storage.signWhiteboardElementSrc(element.element);
      });
      asset.exported_whiteboards = _.map(asset.exported_whiteboards, function(whiteboard) {
        return _.pick(whiteboard, ['id', 'title']);
      });

      asset.can_delete = AssetsUtil.canDeleteAsset(ctx.user, asset);

      // Do not return usage in active whiteboards (which are private) as part of the asset profile
      delete asset.whiteboard_usages;

      return callback(null, asset);
    });
  });
};

/**
 * Get a basic asset profile
 *
 * @param  {Context}        ctx                                     Standard context containing the current user and the current course
 * @param  {Number}         id                                      The id of the asset
 * @param  {Object}         [opts]                                  A set of options that determine what data will be retrieved
 * @param  {Boolean}        [opts.incrementViews]                   Whether the total number of views for the asset should be incremented by 1
 * @param  {Boolean}        [opts.includeWhiteboardElements]        Whether the asset whiteboard elements should be included
 * @param  {Boolean}        [opts.includeWhiteboardUsages]          Whether the asset's whiteboard usages should be included
 * @param  {Function}       callback                                Standard callback function
 * @param  {Object}         callback.err                            An error that occurred, if any
 * @param  {Asset}          callback.asset                          The requested asset
 */
var getAsset = module.exports.getAsset = function(ctx, id, opts, callback) {
  opts = opts || {};

  // Parameter validation
  var validationSchema = Joi.object().keys({
    'id': Joi.number().required(),
    'opts': Joi.object().keys({
      'incrementViews': Joi.boolean().optional(),
      'includeWhiteboardElements': Joi.boolean().optional(),
      'includeWhiteboardUsages': Joi.boolean().optional(),
    })
  });

  var validationResult = Joi.validate({
    'id': id,
    'opts': opts
  }, validationSchema);

  if (validationResult.error) {
    var msg = validationResult.error.details[0].message;
    log.error({
      'err': msg,
      'asset': id
    }, 'Validation error in getAsset');
    return callback({'code': 400, 'msg': msg});
  }

  // Get the asset from the DB
  var options = {
    'where': {
      'id': id,
      'course_id': ctx.course.id
    },
    'include': [
      {
        'model': DB.Activity,
        'attributes': ['type'],
        'required': false,
        'where': {
          'course_id': ctx.course.id,
          'user_id': ctx.user.id,
          'type': ['like', 'dislike'],
          'asset_id': id,
          'object_type': 'asset'
        }
      },
      {
        'model': DB.User,
        'as': 'users',
        'attributes': UserConstants.BASIC_USER_FIELDS
      },
      {
        'model': DB.Category
      },
      {
        'model': DB.Comment,
        'include': [{
          'model': DB.User,
          'attributes': UserConstants.BASIC_USER_FIELDS
        }]
      },
      {
        'model': DB.Pin,
        'as': 'pins'
      }
    ]
  };
  if (opts.includeWhiteboardUsages) {
    options.include.push({
      'model': DB.WhiteboardElement,
      'attributes': ['whiteboard_id'],
      'as': 'whiteboard_usages',
      'required': false
    });
    options.include.push({
      'model': DB.Asset,
      'attributes': ['title', 'id'],
      'as': 'exported_whiteboards',
      'required': false
    });
  }
  DB.Asset.findOne(options).complete(function(err, asset) {
    if (err) {
      log.error({'err': err, 'asset': id}, 'Failed to find asset by id');
      return callback({'code': 500, 'msg': err.message});
    } else if (!asset) {
      log.debug({'err': err, 'id': id}, 'An asset with the specified id could not be found');
      return callback({'code': 404, 'msg': 'An asset with the specified id could not be found'});
    }

    // Explicitly sort the comments so newest comments are at the bottom
    asset.comments.sort(function(a, b) {
      return (a.id - b.id);
    });

    if (opts.includeWhiteboardElements) {
      // Fetch whiteboard elements in a separate query so that the number of returned rows doesn't balloon for
      // assets with many included associations (elements, comments, users).
      DB.AssetWhiteboardElement.findAll({'where': {'asset_id': id}}).complete(function(err, whiteboardElements) {
        if (err) {
          log.error({'err': err, 'asset': id}, 'Failed to retrieve whiteboard elements for asset');
          return callback({'code': 500, 'msg': err.message});
        }
        asset.setDataValue('whiteboard_elements', whiteboardElements);
        return AssetsUtil.incrementViewsIfRequired(ctx, asset, opts.incrementViews, callback);
      });
    } else {
      return AssetsUtil.incrementViewsIfRequired(ctx, asset, opts.incrementViews, callback);
    }
  });
};

/**
 * Add a user to an existing asset
 *
 * @param  {Asset}        asset               The asset to which the user should be added
 * @param  {Asset}        userId              The id of the user to add
 * @param  {Function}     callback            Standard callback function
 * @param  {Object}       callback.err        An error that occurred, if any
 */
var addUserToAsset = module.exports.addUserToAsset = function(asset, userId, callback) {
  asset.getUsers({'attributes': ['id']}).complete(function(err, users) {
    if (err) {
      log.error({'err': err, 'asset': asset, 'user': userId}, 'Failed to add user to asset');
      return callback(err);
    }

    var userIds = _.map(users, 'id');
    userIds.push(userId);
    asset.setUsers(userIds).complete(function(err) {
      if (err) {
        return callback(err);
      }

      return callback();
    });
  });
};

/**
 * Get the assets for the current course
 *
 * @param  {Context}        ctx                             Standard context containing the current user and the current course
 * @param  {Object}         [filters]                       A set of options to filter the results by
 * @param  {String}         [filters.keywords]              A string to filter the assets by
 * @param  {Number}         [filters.category]              The id of the category to filter the assets by
 * @param  {Number}         [filters.user]                  The id of the user who created the assets
 * @param  {String}         [filters.section]               The name of section (i.e., subset of users) to filter assets by
 * @param  {String[]}       [filters.types]                 The type of assets. One or more of `CollabosphereConstants.ASSET.ASSET_TYPES`
 * @param  {Number}         [filters.assignment]            The id of the assignment to which the assets should belong
 * @param  {Boolean}        [filters.hasComments]           If true then exclude zero comment_count; if false then zero comment_count only; if null do nothing
 * @param  {Boolean}        [filters.hasImpact]             If true then exclude zero impact; if false then zero impact only; if null do nothing
 * @param  {Boolean}        [filters.hasLikes]              If true then exclude zero likes; if false then zero likes only; if null do nothing
 * @param  {Boolean}        [filters.hasPins]               If true then exclude assets with zero pins; if false then zero pins only; if null do nothing
 * @param  {Boolean}        [filters.hasTrending]           If true then exclude zero trending score; if false then zero trending score only; if null do nothing
 * @param  {Boolean}        [filters.hasViews]              If true then exclude zero views; if false then zero views only; if null do nothing
 * @param  {Number}         [sort]                          A criterion to sort by. Defaults to 'recent' (id descending).
 * @param  {Number}         [limit]                         The maximum number of results to retrieve. Defaults to 10
 * @param  {Number}         [offset]                        The number to start paging from. Defaults to 0
 * @param  {Function}       callback                        Standard callback function
 * @param  {Object}         callback.err                    An error that occurred, if any
 * @param  {Object}         callback.assets                 The retrieved assets
 * @param  {Number}         callback.assets.offset          The number the assets are paged from
 * @param  {Number}         callback.assets.total           The total number of assets in the current course matching the filters
 * @param  {Asset[]}        callback.assets.results         The paged assets in the current course
 */
var getAssets = module.exports.getAssets = function(ctx, filters, sort, limit, offset, callback) {
  // Default some parameters
  filters = filters || {};
  sort = sort || 'recent';
  limit = CollabosphereUtil.getNumberParam(limit, 10, 1, 25);
  offset = CollabosphereUtil.getNumberParam(offset, 0, 0);

  // Ensure the category, user id and assignment id are numbers
  filters.category = CollabosphereUtil.getNumberParam(filters.category);
  filters.user = CollabosphereUtil.getNumberParam(filters.user);
  filters.assignment = CollabosphereUtil.getNumberParam(filters.assignment);

  // Parameter validation
  var validationSchema = Joi.object().keys({
    'filters': Joi.object().keys({
      'keywords': Joi.string().optional(),
      'category': Joi.number().optional(),
      'user': Joi.number().optional(),
      'section': Joi.string().optional(),
      'types': Joi.array().items(Joi.string().valid(CollabosphereConstants.ASSET.ASSET_TYPES)).optional(),
      'assignment': Joi.number().optional(),
      'hasComments': Joi.string().optional(),
      'hasImpact': Joi.string().optional(),
      'hasLikes': Joi.string().optional(),
      'hasPins': Joi.string().optional(),
      'hasTrending': Joi.string().optional(),
      'hasViews': Joi.string().optional()
    }),
    'sort': Joi.string().valid(['comments', 'impact', 'likes', 'pins', 'recent', 'trending', 'views']).required(),
    'limit': Joi.number().required(),
    'offset': Joi.number().required()
  });
  var validationResult = Joi.validate({
    'filters': filters,
    'sort': sort,
    'limit': limit,
    'offset': offset
  }, validationSchema);
  if (validationResult.error) {
    return callback({'code': 400, 'msg': validationResult.error.details[0].message});
  }

  // Get the assets from the DB. Because of the large number of (optional) includes,
  // Sequelize doesn't appear to provide a way in which to combine this all, other
  // than through a raw SQL query
  var params = {
    'course_id': ctx.course.id,
    'user_id': ctx.user.id,
    'types': filters.types,
    'assignment': filters.assignment,
    'category': filters.category,
    'user': filters.user,
    'pinning_user_sort': filters.user || ctx.user.id,
    'section': filters.section,
    'limit': limit,
    'offset': offset
  };

  var fromClause = ` FROM assets a
      LEFT JOIN assets_categories ac ON a.id = ac.asset_id
      LEFT JOIN categories c ON c.id = ac.category_id
      LEFT JOIN asset_users au ON a.id = au.asset_id
      LEFT JOIN users u ON au.user_id = u.id
      LEFT JOIN activities act ON a.id = act.asset_id
       AND act.course_id = :course_id
       AND act.user_id = :user_id
       AND act.object_type = 'asset'
       AND act.type IN('like', 'dislike')
  `;

  var whereClause = ` WHERE
     a.deleted_at IS NULL
     AND a.course_id = :course_id
     AND a.visible = TRUE
     AND (c.visible = TRUE OR c.visible IS NULL)
  `;

  if (filters.keywords) {
    whereClause += ' AND (a.title ILIKE :keywords OR a.description ILIKE :keywords)';
    // Replace spaces with wildcards so basic multi-term matching can happen
    params['keywords'] = '%' + filters.keywords.trim().replace(/ /g, '%') + '%'
  }

  if (!_.isEmpty(filters.types)) {
    whereClause += ' AND a.type IN(:types)';
  }

  if (filters.assignment) {
    whereClause += ' AND a.canvas_assignment_id = :assignment';
  }

  if (filters.category) {
    whereClause += ' AND c.id = :category';
  }

  var hasPins = CollabosphereUtil.getBooleanParam(filters.hasPins, null);
  if (hasPins != null) {
    // Who is the target user? For example, "filter by user" in Adv Search or "My Pinned" on profile page.
    var existsOrNot = hasPins ? ' AND EXISTS' : ' AND NOT EXISTS';
    whereClause += existsOrNot + ' (SELECT 1 FROM pinned_user_assets WHERE asset_id = a.id AND user_id = :pinning_user_sort LIMIT 1)';
  }

  // If hasPins is present then we do NOT want to limit results with the condition below.
  // Instead, we use `filters.user` against `pinned_user_assets` with condition above.
  if (hasPins === null && filters.user) {
    whereClause += ' AND au.user_id = :user';
  }

  if (filters.section) {
    whereClause += ' AND (array_position(u.canvas_course_sections, :section) > 0)';
  }

  var hasComments = CollabosphereUtil.getBooleanParam(filters.hasComments, null);
  if (hasComments !== null) {
    whereClause += hasComments ? ' AND a.comment_count > 0' : ' AND a.comment_count = 0';
  }

  var hasImpact = CollabosphereUtil.getBooleanParam(filters.hasImpact, null);
  if (hasImpact !== null) {
    whereClause += hasImpact ? ' AND a.impact_score > 0' : ' AND a.impact_score = 0';
  }

  var hasLikes = CollabosphereUtil.getBooleanParam(filters.hasLikes, null);
  if (hasLikes !== null) {
    whereClause += hasLikes ? ' AND a.likes > 0' : ' AND a.likes = 0';
  }

  var hasTrending = CollabosphereUtil.getBooleanParam(filters.hasTrending, null);
  if (hasTrending !== null) {
    whereClause += hasTrending ? ' AND a.trending_score > 0' : ' AND a.trending_score = 0';
  }

  var hasViews = CollabosphereUtil.getBooleanParam(filters.hasViews, null);
  if (hasViews !== null) {
    whereClause += hasViews ? ' AND a.views > 0' : ' AND a.views = 0';
  }

  // Query that will be used to get the actual assets
  var selectClause = 'SELECT';

  if (sort === 'pins') {
    selectClause += `
      DISTINCT ON (a.id, a.likes, a.views, a.comment_count, a.impact_score, a.trending_score, pinned_by_me_date)
      a.*,
      act.type AS activity_type,
      (SELECT created_at FROM pinned_user_assets WHERE asset_id = a.id AND user_id = :pinning_user_sort LIMIT 1) as pinned_by_me_date
    `;
  } else {
    selectClause += `
      DISTINCT ON (a.id, a.likes, a.views, a.comment_count, a.impact_score, a.trending_score)
      a.*,
      act.type AS activity_type
    `;
  }

  var query = selectClause + ' ' + fromClause + ' ' + whereClause;

  if (sort === 'recent') {
    query += ' ORDER BY a.id DESC';
  } else if (sort === 'likes') {
    query += ' ORDER BY a.likes DESC, a.id DESC';
  } else if (sort === 'views') {
    query += ' ORDER BY a.views DESC, a.id DESC';
  } else if (sort === 'comments') {
    query += ' ORDER BY a.comment_count DESC, a.id DESC';
  } else if (sort === 'impact') {
    query += ' ORDER BY a.impact_score DESC, a.id DESC';
  } else if (sort === 'trending') {
    query += ' ORDER BY a.trending_score DESC, a.id DESC';
  } else if (sort === 'pins') {
    query += ' ORDER BY pinned_by_me_date DESC, a.id DESC';
  }

  query += ' LIMIT :limit OFFSET :offset';

  DB.getSequelize().query(query, {
    'model': DB.Asset,
    'replacements': params
  }).complete(function(err, assets) {
    if (err) {
      log.error({'err': err, 'course': ctx.course}, 'Failed to get the assets in the current course');
      return callback({'code': 500, 'msg': err.message});
    }

    // Query that will be used to get the total count
    var countQuery = 'SELECT COUNT(DISTINCT(a.id))::int AS count ' + fromClause + ' ' + whereClause;

    DB.getSequelize().query(countQuery, {'replacements': params}).complete(function(err, countResult) {
      if (err) {
        log.error({'err': err, 'course': ctx.course}, 'Failed to get the count of assets in the current course');
        return callback({'code': 500, 'msg': err.message});
      }

      // Extract the total count from the result
      var count = countResult[0][0].count;

      // Get cutoff score for purposes of awarding badges.
      getBadgeCutoffForCourse(ctx.course, function(err, cutoffScore) {
        if (err) {
          log.error({'err': err, 'course': ctx.course}, 'Could not get badge cutoff score for course');
          return callback({'code': 500, 'msg': err.message});
        }

        // Construct the data to return
        var data = {
          'offset': offset,
          'total': count,
          'results': _.map(assets, function(asset) {
            // Award any badges before JSONification suppresses the impact scores. Note that because we don't
            // yet have the associated users, instructor-associated assets get their badges suppressed below.
            if (cutoffScore && asset.impact_score >= cutoffScore) {
              asset.badged = true;
            }
            return asset.toJSON();
          })
        };

        var assetIds = _.map(assets, 'id');

        // Get all the users that are associated to each of the assets. We do this in a separate query so
        // each assets always has all collaborators associated to it, even when we're filtering the assets
        // by a specific user
        var userOptions = {
          'attributes': UserConstants.BASIC_USER_FIELDS,
          'include': [{
            'model': DB.Asset,
            'attributes': ['id'],
            'as': 'assets',
            'where': {
              'id': assetIds
            }
          }]
        };
        DB.User.findAll(userOptions).complete(function(err, users) {
          if (err) {
            log.error({'err': err, 'course': ctx.course}, 'Failed to get the users for the assets in the current course');
            return callback({'code': 500, 'msg': err.message});
          }

          _.each(data.results, function(asset) {
            asset.users = _.filter(users, function(user) {
              return _.find(user.assets, {'id': asset.id});
            });
          });

          _.each(data.results, function(asset) {
            asset.users = _.map(asset.users, function(user) {
              user = user.toJSON();
              delete user.assets;

              // Suppress any badges for instructor assets.
              if (user.is_admin) {
                delete asset.badged;
              }

              return user;
            });
          });

          var options = {
            'where': {
              'asset_id': assetIds
            }
          };
          DB.Pin.findAll(options).complete(function(err, pins) {
            if (err) {
              log.error({'err': err, 'course': ctx.course}, 'Failed to get asset pins in current course');
              return callback({'code': 500, 'msg': err.message});
            }

            _.each(data.results, function(asset) {
              asset.pins = _.filter(pins, function(pin) {
                return pin.asset_id === asset.id;
              });
            });

            return callback(null, data);
          });
        });
      });
    });
  });
};

/**
 * Create a new link asset
 *
 * @param  {Context}        ctx                             Standard context containing the current user and the current course
 * @param  {String}         title                           The title of the link
 * @param  {String}         url                             The url of the link
 * @param  {Object}         [opts]                          A set of optional parameters
 * @param  {Number}         [opts.assignment]               The id of the assignment the asset is part of, if any
 * @param  {Number[]}       [opts.categories]               The ids of the categories to which the link should be associated
 * @param  {String}         [opts.description]              The description of the link
 * @param  {String}         [opts.source]                   The source of the link
 * @param  {String}         [opts.thumbnail_url]            The thumbnail url of the link
 * @param  {String}         [opts.image_url]                The large url of the link
 * @param  {String}         [opts.embed_id]                 The id of the link preview
 * @param  {String}         [opts.embed_key]                The id that can be used to embed the link preview in the browser
 * @param  {String}         [opts.embed_code]               The HTML embed code that can be used to embed the link preview in the browser
 * @param  {Boolean}        [opts.skipCreateActivity]       Whether creating an `add_asset` activity should be skipped. By default, the activity will be created
 * @param  {Boolean}        [opts.visible]                  Whether the link will be visible in the assets library list. By default, the link will be listed in the asset library
 * @param  {Function}       callback                        Standard callback function
 * @param  {Object}         callback.err                    An error that occurred, if any
 * @param  {Asset}          callback.asset                  The created link asset
 */
var createLink = module.exports.createLink = function(ctx, title, url, opts, callback) {
  // Default the title to the provided url
  title = title || url;

  // Default the optional values
  opts = opts || {};
  opts.categories = opts.categories || [];

  // Do not create an add_asset activity if the asset will not be visible.
  if (opts.visible === false) {
    opts.skipCreateActivity = true;
  }

  // Parameter validation
  var validationSchema = Joi.object().keys({
    'title': Joi.string().max(255).required(),
    'url': Joi.string().uri().max(255).required(),
    'opts': Joi.object().keys({
      'assignment': Joi.number().optional(),
      'categories': Joi.array().unique().items(Joi.number()).optional(),
      'description': Joi.string().allow('').optional(),
      'source': Joi.string().uri().optional(),
      'thumbnail_url': Joi.string().uri().optional(),
      'image_url': Joi.string().uri().optional(),
      'embed_id': Joi.number().optional(),
      'embed_key': Joi.string().optional(),
      'embed_code': Joi.string().optional(),
      'skipCreateActivity': Joi.boolean().optional(),
      'visible': Joi.boolean().optional()
    })
  });

  var validationResult = Joi.validate({
    'title': title,
    'url': url,
    'opts': opts
  }, validationSchema);

  if (validationResult.error) {
    var msg = validationResult.error.details[0].message;
    log.error({
      'err': msg,
      'title': title,
      'url': url
    }, 'Validation error in createLink()');
    return callback({'code': 400, 'msg': msg});
  }

  // Create the link asset in the DB
  var asset = DB.Asset.build({
    'course_id': ctx.course.id,
    'user_id': ctx.user.id,
    'type': 'link',
    'title': title,
    'url': url,
    'description': opts.description,
    'canvas_assignment_id': opts.assignment,
    'source': opts.source,
    'thumbnail_url': opts.thumbnail_url,
    'image_url': opts.image_url,
    'embed_id': opts.embed_id,
    'embed_key': opts.embed_key,
    'embed_code': opts.embed_code,
    'visible': opts.visible
  });

  return createAsset(ctx, asset, opts, callback);
};

/**
 * Create a new file asset
 *
 * @param  {Context}        ctx                             Standard context containing the current user and the current course
 * @param  {String}         title                           The title of the file
 * @param  {Object}         file                            The file to create
 * @param  {Object}         [opts]                          A set of optional parameters
 * @param  {Number}         [opts.assignment]               The id of the assignment the asset is part of, if any
 * @param  {Number[]}       [opts.categories]               The ids of the categories to which the file should be associated
 * @param  {String}         [opts.description]              The description of the file
 * @param  {String}         [opts.thumbnail_url]            The thumbnail url of the file
 * @param  {String}         [opts.image_url]                The large url of the file
 * @param  {String}         [opts.embed_id]                 The id of the file preview
 * @param  {String}         [opts.embed_key]                The id that can be used to embed the file preview in the browser
 * @param  {String}         [opts.embed_code]               The HTML embed code that can be used to embed the file preview in the browser
 * @param  {Boolean}        [opts.skipCreateActivity]       Whether creating an `add_asset` activity should be skipped. By default, the activity will be created
 * @param  {Boolean}        [opts.visible]                  Whether the file will be visible in the assets library list. By default, the file will be listed in the asset library
 * @param  {Function}       callback                        Standard callback function
 * @param  {Object}         callback.err                    An error that occurred, if any
 * @param  {Asset}          callback.asset                  The created file asset
 */
var createFile = module.exports.createFile = function(ctx, title, file, opts, callback) {
  file = file || {};
  // Default the title to the provided filename
  title = title || file.filename;

  // Default the optional values
  opts = opts || {};
  opts.categories = opts.categories || [];

  // Do not create an add_asset activity if the asset will not be visible.
  if (opts.visible === false) {
    opts.skipCreateActivity = true;
  }

  // Parameter validation
  var validationSchema = Joi.object().keys({
    'title': Joi.string().required(),
    'file': Joi.object().required().keys({
      'field': Joi.any().valid('file').optional(),
      'encoding': Joi.string().optional(),
      'mimetype': Joi.string().required(),
      'truncated': Joi.boolean().valid(false).optional(),
      'done': Joi.boolean().valid(true).optional(),
      'uuid': Joi.string().guid().optional(),
      'file': Joi.string().required(),
      'filename': Joi.string().required()
    }),
    'opts': Joi.object().keys({
      'assignment': Joi.number().optional(),
      'categories': Joi.array().unique().items(Joi.number()).optional(),
      'description': Joi.string().allow('').optional(),
      'source': Joi.string().uri().optional(),
      'thumbnail_url': Joi.string().uri().optional(),
      'image_url': Joi.string().uri().optional(),
      'embed_id': Joi.number().optional(),
      'embed_key': Joi.string().optional(),
      'embed_code': Joi.string().optional(),
      'skipCreateActivity': Joi.boolean().optional(),
      'visible': Joi.boolean().optional()
    })
  });

  var validationResult = Joi.validate({
    'title': title,
    'file': file,
    'opts': opts
  }, validationSchema);

  if (validationResult.error) {
    var msg = validationResult.error.details[0].message;
    log.error({
      'err': msg,
      'title': title,
      'file': file
    }, 'Validation error in createLink()');
    return callback({'code': 400, 'msg': msg});
  }

  // Prepare to register file asset in the DB
  var assetProperties = {
    'course_id': ctx.course.id,
    'user_id': ctx.user.id,
    'type': 'file',
    'title': title,
    'description': opts.description,
    'canvas_assignment_id': opts.assignment,
    'source': opts.source,
    'thumbnail_url': opts.thumbnail_url,
    'image_url': opts.image_url,
    'embed_id': opts.embed_id,
    'embed_key': opts.embed_key,
    'embed_code': opts.embed_code,
    'visible': opts.visible
  };

  // Upload the file to Amazon S3
  Storage.storeAsset(ctx.course.id, file.file, function(err, s3Uri, contentType) {
    if (err) {
      log.error({
        'err': err,
        'course': ctx.course.id,
        'user': ctx.user.id,
        'title': title
      }, 'Failed to store asset file');
      return callback(err);
    }

    var asset = DB.Asset.build(_.merge(assetProperties, {
      'download_url': s3Uri,
      'mime': contentType
    }));

    createAsset(ctx, asset, opts, function(err, asset) {
      if (err) {
        log.error({'err': err, 'course': ctx.course.id, 'file': file.file}, 'Failed to create asset');
        return callback(err);
      }

      // Clean up temp space
      fs.unlink(file.file, function(err) {
        if (err) {
          log.warn({'err': err, 'file': file.file, 'asset': asset.id}, 'Failed to remove file from temp space');
        }

        return callback(err, asset);
      });
    });
  });
};

/**
 * Create a new whiteboard asset
 *
 * @param  {Context}        ctx                             Standard context containing the current user and the current course
 * @param  {Whiteboard}     whiteboard                      The whiteboard this asset is based on
 * @param  {String}         [title]                         The title of the whiteboard asset. Defaults to the whiteboard's title
 * @param  {Object}         [opts]                          A set of optional parameters
 * @param  {Number[]}       [opts.categories]               The ids of the categories to which the whiteboard asset should be associated
 * @param  {String}         [opts.description]              The description of the whiteboard asset
 * @param  {Function}       callback                        Standard callback function
 * @param  {Object}         callback.err                    An error that occurred, if any
 * @param  {Asset}          callback.asset                  The created whiteboard asset
 */
var createWhiteboard = module.exports.createWhiteboard = function(ctx, whiteboard, title, opts, callback) {
  // Default the optional values
  opts = opts || {};
  opts.categories = opts.categories || [];

  if (!title && whiteboard) {
    title = whiteboard.title;
  }

  // Parameter validation. If no title is provided, we'll default it to the whiteboard title
  var validationSchema = Joi.object().keys({
    'whiteboard': Joi.object().required(),
    'title': Joi.string().max(255).required(),
    'opts': Joi.object().keys({
      'categories': Joi.array().unique().items(Joi.number()).optional(),
      'description': Joi.string().allow('').optional()
    })
  });

  var validationResult = Joi.validate({
    'whiteboard': whiteboard,
    'title': title,
    'opts': opts
  }, validationSchema);

  if (validationResult.error) {
    return callback({'code': 400, 'msg': validationResult.error.details[0].message});
  }

  // Create the whiteboard asset in the DB
  var asset = DB.Asset.build({
    'course_id': ctx.course.id,
    'type': 'whiteboard',
    'title': title,
    'description': opts.description,
    'source': whiteboard.id.toString(),
    // These are temporary URL values, replaced after creation with updated values from the preview service.
    'download_url': whiteboard.image_url,
    'image_url': whiteboard.image_url,
    'thumbnail_url': whiteboard.thumbnail_url,
  });

  opts.users = whiteboard.members;

  createAsset(ctx, asset, opts, function(err, asset) {
    if (err) {
      log.error({
        'err': err,
        'course': ctx.course.id,
        'whiteboard': whiteboard.id,
        'user': ctx.user.id,
        'title': title
      }, 'Failed to create asset in createWhiteboard()');
      return callback(err);
    }

    // Take a snapshot of the whiteboard by copying its elements into a separate table and linking
    // them to the new whiteboard asset
    var bulkWhiteboardelements = _.map(whiteboard.whiteboardElements, function(element) {
      return {
        // Prepend the current date to the `uid` as the same board can be exported multiple times
        'uid': util.format('%d-%s', Date.now(), element.uid),
        'element': element.element,
        'asset_id': asset.id,
        'element_asset_id': element.asset_id
      };
    });
    DB.AssetWhiteboardElement.bulkCreate(bulkWhiteboardelements).complete(function(err) {
      if (err) {
        log.error({
          'err': err,
          'asset': asset.id,
          'whiteboard': whiteboard.id
        }, 'Unable to copy the whiteboard elements over to the asset whiteboard elements');
        return callback(err);
      }

      return getAssetProfile(ctx, asset.id, false, callback);
    });
  });
};

/**
 * Create a new asset
 *
 * @param  {Context}        ctx                             Standard context containing the current user and the current course
 * @param  {Asset}          asset                           The asset to create
 * @param  {Object}         [opts]                          A set of optional parameters
 * @param  {User[]}         [opts.users]                    The user(s) who created the asset, defaults to the current user
 * @param  {Number}         [opts.assignment]               The id of the assignment the asset is part of, if any
 * @param  {Number[]}       [opts.categories]               The ids of the categories to which the asset should be associated
 * @param  {Boolean}        [opts.skipCreateActivity]       Whether creating an `add_asset` activity should be skipped. By default, the activity will be created
 * @param  {Function}       callback                        Standard callback function
 * @param  {Object}         callback.err                    An error that occurred, if any
 * @param  {Asset}          callback.asset                  The persisted asset
 * @api private
 */
var createAsset = function(ctx, asset, opts, callback) {
  opts = opts || {};
  if (_.isEmpty(opts.users)) {
    opts.users = [ctx.user];
  }

  // Ensure that all provided categories exist
  CategoriesAPI.getCategoriesById(ctx, opts.categories, function(err, categories) {
    if (err) {
      log.error({
        'err': err,
        'course': ctx.course.id,
        'user': ctx.user.id,
        'categories': opts.categories
      }, 'Failed to get categories in createAsset()');
      return callback(err);
    }

    asset.save().complete(function(err, asset) {
      if (err) {
        log.error({'err': err, 'asset': asset}, 'Failed to create a new asset');
        return callback({'code': 500, 'msg': err.message});
      }

      // Add the associated categories to the asset
      asset.setCategories(opts.categories).complete(function(err) {
        if (err) {
          log.error({'err': err, 'asset': asset.id}, 'Failed to associate categories to a new asset');
          return callback({'code': 500, 'msg': err.message});
        }

        asset.setUsers(_.map(opts.users, 'id')).complete(function(err) {
          if (err) {
            log.error({'err': err, 'asset': asset.id}, 'Failed to associate the users to a new asset');
            return callback({'code': 500, 'msg': err.message});
          }

          // Generate the previews for the asset
          generatePreviews(asset);

          // Get the asset including the categories
          getAsset(ctx, asset.id, {'incrementViews': false}, function(err, asset) {
            if (err) {
              log.error({'err': err, 'asset': asset.id}, 'Failed to retrieve newly created asset');
              return callback(err);
            } else if (opts.skipCreateActivity) {
              return callback(null, asset);
            }

            var errorCallback = _.once(callback);
            var done = _.after(opts.users.length, function() {
              // Retrieve the created asset, including the associated users and categories
              return getAssetProfile(ctx, asset.id, false, callback);
            });

            var activityType = 'add_asset';
            if (asset.type === 'whiteboard') {
              activityType = 'export_whiteboard';
            }

            // Give each user points for adding a new asset
            _.each(opts.users, function(user) {
              ActivitiesAPI.createActivity(ctx.course, user, activityType, asset.id, CollabosphereConstants.ACTIVITY.OBJECT_TYPES.ASSET, null, null, function(err) {
                if (err) {
                  log.error({
                    'err': err,
                    'user': user,
                    'asset': asset.id
                  }, 'Failed to create an activity for a user');
                  return errorCallback(err);
                }

                done();
              });
            });
          });
        });
      });
    });
  });
};

/**
 * Edit an asset
 *
 * @param  {Context}        ctx                             Standard context containing the current user and the current course
 * @param  {Number}         id                              The id of the asset that is being edited
 * @param  {String}         title                           The updated title of the asset
 * @param  {Object}         [opts]                          A set of optional parameters
 * @param  {Number[]}       [opts.categories]               The updated ids of the categories to which the asset should be associated. If no categories are provided, any existing associated categories will be removed from the asset
 * @param  {String}         [opts.description]              The updated description of the asset
 * @param  {Function}       callback                        Standard callback function
 * @param  {Object}         callback.err                    An error that occurred, if any
 * @param  {Asset}          callback.asset                  The updated asset
 */
var editAsset = module.exports.editAsset = function(ctx, id, title, opts, callback) {
  opts = opts || {};
  opts.categories = opts.categories || [];
  opts.description = opts.description || '';

  // Parameter validation
  var validationSchema = Joi.object().keys({
    'id': Joi.number().required(),
    'title': Joi.string().max(255).required(),
    'opts': Joi.object().keys({
      'categories': Joi.array().unique().items(Joi.number()).optional(),
      'description': Joi.string().allow('').optional()
    })
  });

  var validationResult = Joi.validate({
    'id': id,
    'title': title,
    'opts': opts
  }, validationSchema);

  if (validationResult.error) {
    return callback({'code': 400, 'msg': validationResult.error.details[0].message});
  }

  // Ensure that the provided asset exists
  getAsset(ctx, id, {'incrementViews': false}, function(err, asset) {
    if (err) {
      log.error({'err': err, 'asset': id}, 'Failed to asset during editAsset()');
      return callback(err);
    }

    // Only course administrators and the user that has created the asset are allowed
    // to edit it
    if (!ctx.user.is_admin && !_.find(asset.users, {'id': ctx.user.id})) {
      log.error({'course': ctx.course, 'user': ctx.user.id}, 'Unauthorized to edit an asset');
      return callback({'code': 401, 'msg': 'Unauthorized to edit an asset'});
    }

    // Ensure that all provided categories exist
    CategoriesAPI.getCategoriesById(ctx, opts.categories, function(err, categories) {
      if (err) {
        log.error({
          'err': err,
          'asset': id,
          'categories': opts.categories
        }, 'Failed to get requested categories in editAsset()');
        return callback(err);
      }

      // Update the asset in the DB
      var update = {
        'title': title,
        'description': opts.description
      };
      asset.update(update).complete(function(err, asset) {
        if (err) {
          log.error({'err': err, 'id': id}, 'Failed to update an asset');
          return callback({'code': 500, 'msg': err.message});
        }

        // Update the associated categories to the asset
        asset.setCategories(opts.categories).complete(function(err) {
          if (err) {
            log.error({'err': err}, 'Failed to update the categories of an asset');
            return callback({'code': 500, 'msg': err.message});
          }

          // Retrieve the created asset, including the associated user and
          // associated categories
          return getAssetProfile(ctx, asset.id, false, callback);
        });
      });
    });
  });
};

/**
 * Delete an asset
 *
 * @param  {Context}        ctx                             Standard context containing the current user and the current course
 * @param  {Number}         id                              The id of the asset that is being deleted
 * @param  {Function}       callback                        Standard callback function
 * @param  {Object}         callback.err                    An error that occurred, if any
 */
var deleteAsset = module.exports.deleteAsset = function(ctx, id, callback) {
  // Parameter validation
  var validationSchema = Joi.object().keys({
    'id': Joi.number().required()
  });

  var validationResult = Joi.validate({
    'id': id
  }, validationSchema);

  if (validationResult.error) {
    return callback({'code': 400, 'msg': validationResult.error.details[0].message});
  }

  // Retrieve the asset that is being deleted
  var opts = {
    'includeWhiteboardUsages': true
  };
  getAsset(ctx, id, opts, function(err, asset) {
    if (err) {
      log.error({'err': err, 'asset': id}, 'Failed to retrieve an asset in deleteAsset()');
      return callback(err);
    }

    if (!AssetsUtil.canDeleteAsset(ctx.user, asset)) {
      log.error({'id': id}, 'Unauthorized to delete an asset because the asset has associated interactions');
      return callback({'code': 401, 'msg': 'Unauthorized to delete an asset'});
    }

    // Delete the asset from the DB
    asset.destroy().complete(function(err) {
      if (err) {
        log.error({'err': err, 'category': category.id}, 'Failed to delete an asset');
        return callback({'code': 500, 'msg': err.message});
      }

      return callback();
    });
  });
};

/**
 * Delete a set of assets. Note that this function does not perform any access checks.
 *
 * @param  {Context}      ctx               Standard context containing the current user and the current course
 * @param  {Number[]}     assetIds          The ids of the assets to delete
 * @param  {Function}     callback          Standard callback function
 * @param  {Object}       callback.err      An error that occurred, if any
 */
var deleteAssets = module.exports.deleteAssets = function(ctx, assetIds, callback) {
  if (_.isEmpty(assetIds)) {
    return callback();
  }

  // Parameter validation
  var validationSchema = Joi.object().keys({
    'assetIds': Joi.array().unique().items(Joi.number()).min(1)
  });

  var validationResult = Joi.validate({
    'assetIds': assetIds
  }, validationSchema);

  if (validationResult.error) {
    return callback({'code': 400, 'msg': validationResult.error.details[0].message});
  }

  // Before we destroy any assets, we fetch the activities that were related to them. That allows
  // the points for the users that interacted with these assets to be recalculated
  var activityOptions = {
    'where': {
      'asset_id': assetIds,
      'type': 'add_asset'
    }
  };
  DB.Activity.findAll(activityOptions).complete(function(err, activities) {
    if (err) {
      log.error({'err': err, 'assets': assetIds}, 'Failed to get activities associated with assets');
      return callback({'code': 500, 'msg': 'Failed to get the activities that are associated to a set of assets'});
    }

    // "Destroy" the assets. Because the `Asset` model is in paranoid mode, records won't actually
    // be removed but flagged. That allows the activities to be linked to (now outdated) assets
    var assetOptions = {
      'where': {
        'id': assetIds
      }
    };
    DB.Asset.destroy(assetOptions).complete(function(err) {
      if (err) {
        log.error({'err': err, 'assets': assetIds}, 'Failed to delete a set of assets');
        return callback({'code': 500, 'msg': 'Failed to delete a set of assets'});
      }

      // Recalculate the points for the users who were involved with these assets
      var userIds = _.chain(activities).map('user_id').uniq().value();
      return ActivitiesAPI.recalculatePoints(ctx.course, userIds, callback);
    });
  });
};

/**
 * @param   {Category[]}    categories       The categories to review
 * @return  {boolean}                        True if empty or at least one category is visible
 */
var isEmptyOrHasVisible = function(categories) {
  return _.isEmpty(categories) || _.find(categories, 'visible');
};

/**
 * Returns true if the asset is hidden, deleted, or associated with only hidden categories.
 *
 * @param   {Asset}        asset             The asset to check for deleted or hidden status
 * @return  {boolean}                        True if deleted or hidden
 */
var isDeletedOrHidden = module.exports.isDeletedOrHidden = function(asset) {
  return !asset.visible || !!asset.deleted_at || !isEmptyOrHasVisible(asset.categories);
};

/**
 * Returns true user is authorized to view the specified asset.
 *
 * @param  {User}         user              The user viewing the event
 * @param  {Asset}        asset             The asset to check for hidden status
 * @return {boolean}                        True if not deleted or not hidden from this particular user
 */
var canUserView = module.exports.canUserView = function(user, asset, callback) {
  if (asset.deleted_at) {
    return callback(false);

  } else if (user.is_admin || _.find(asset.users, {'id': user.id}) || (asset.visible && isEmptyOrHasVisible(asset.categories))) {
    return callback(true);

  } else {
    var params = {
      'user_id': user.id,
      'asset_id': asset.id
    }
    var whiteboardMembershipQuery = `SELECT count(*)
      FROM whiteboard_members m
      JOIN whiteboard_elements e ON e.whiteboard_id = m.whiteboard_id
      WHERE m.user_id = :user_id AND e.asset_id = :asset_id`;

    DB.getSequelize().query(whiteboardMembershipQuery, {'replacements': params}).complete(function(err, results) {
      if (err) {
        log.error({'err': err, 'user': user.id, 'asset': asset.id}, 'Error retrieving whiteboards associated with asset');
      }
      var count = results[0][0].count;

      return callback(count > 0);
    });
  }
};

/* BADGES */

/**
 * Return the impact score which assets in a given course must equal or exceed to receive a badge. If badges
 * are not enabled in the course, return null.
 *
 * @param   {Course}        course                     The course for which to query the badge cutoff score
 * @param   {Function}      [callback]                 Standard callback function
 * @param   {Object}        [callback.err]             An error object, if any
 * @param   {Number}        [callback.cutoffScore]     The badge cutoff score, or null if badges are not enabled
 * @api private
 */
var getBadgeCutoffForCourse = module.exports.getBadgeCutoffForCourse = function(course, callback) {
  // If the Impact Studio is not enabled, no more are badges.
  if (!course.dashboard_url) {
    return callback();
  }

  // Query for badge-eligible assets, meaning assets that are visible and not associated with an
  // instructor. (The easiest way to verify the second criterion is in raw SQL: left join assets to users
  // in instructor roles, then group by asset id and filter out rows where user id is present.) Count
  // results and calculate a 90th-percentile impact score, which assets must equal or exceed to receive a badge.
  var params = {
    'course_id': course.id,
    'admin_roles': _.union(CollabosphereConstants.ADMIN_ROLES, CollabosphereConstants.TEACHER_ROLES)
  }

  var badgeEligibleAssetsQuery = `SELECT COUNT(*)::int, PERCENTILE_DISC(.90) WITHIN GROUP (ORDER BY asset_impact_score)
    FROM (SELECT a.id, a.impact_score as asset_impact_score
      FROM assets a
      JOIN asset_users au ON
        a.id = au.asset_id
        AND a.course_id = :course_id
        AND a.visible = true
        AND a.deleted_at IS NULL
      LEFT JOIN users u ON
        u.id = au.user_id
        AND u.canvas_course_role IN (:admin_roles)
      GROUP BY a.id
      HAVING MAX(u.id) IS NULL) badge_eligible_assets`;

  DB.getSequelize().query(badgeEligibleAssetsQuery, {'replacements': params}).complete(function(err, results) {
    if (err) {
      log.error({'err': err, 'course': params.course_id}, 'Error retrieving badge-eligible assets for course');
    }

    var count = results[0][0].count;
    var cutoffScore = results[0][0].percentile_disc;

    // We hand out no badges if there are fewer than ten badge-eligible assets in the course.
    if (count < 10) {
      return callback();
    }

    return callback(null, cutoffScore);
  });
};

/* PREVIEWS */

/**
 * Generate previews for an asset
 *
 * @param  {Asset}        asset             The asset for which previews are generated
 * @param  {Function}     [callback]        Standard callback function
 * @param  {Object}       [callback.err]    An error object, if any
 */
var generatePreviews = module.exports.generatePreviews = function(asset, callback) {
  callback = callback || function(err) {
    if (err) {
      log.error({'err': err, 'asset': asset.id}, 'Unable to contact the preview service');
    }
  };

  var assetUrl = null;
  if (asset.type === 'file' || asset.type === 'whiteboard') {
    assetUrl = asset.download_url;
  } else if (asset.type === 'link') {
    assetUrl = asset.url;
  }

  if (!assetUrl) {
    return callback();
  }

  Collabosphere.generatePreviews(asset.id, assetUrl, '/api/assets-callback', function(err) {
    // Immediately mark the asset's preview status as errored
    // if the preview service could not be reached
    if (err) {
      log.error({'err': err, 'asset': asset.id}, 'Failed to generate asset preview');
      updateAssetPreview(asset, {'previewStatus': 'error'}, function() {
        return callback(err);
      });
    } else {
      return callback();
    }
  });
};

/**
 * Handle a callback from the previews service
 *
 * @param  {Context}      authorizationHeader     The `authorization` header that was used to trigger the HTTP request
 * @param  {Object}       opts                    The passed in data from the previews service
 * @param  {Number}       opts.id                 The asset id
 * @param  {String}       opts.status             The status of the preview process
 * @param  {String}       opts.metadata           Extra preview metadata (`youtubeId`, `httpEmbeddable`, `httpsEmbeddable`, `image_width`, ..)
 * @param  {String}       [opts.thumbnail]        The URL of the asset thumbnail
 * @param  {String}       [opts.image]            The URL of the asset image
 * @param  {String}       [opts.pdf]              The URL of the asset pdf
 * @param  {Function}     callback                Standard callback function
 * @param  {Object}       callback.err            An error object, if any
 */
var handlePreviewsCallback = module.exports.handlePreviewsCallback = function(authorizationHeader, opts, callback) {
  // Do authentication early
  if (!Collabosphere.verifyPreviewsAuthorization(authorizationHeader)) {
    return callback({'code': 401, 'msg': 'Missing or invalid authorization header'});
  }

  // Parameter validation
  var validationSchema = Joi.object().keys({
    'id': Joi.number().required(),
    'status': Joi.string().required(),
    'metadata': Joi.string().required(),
    'thumbnail': Joi.string().optional(),
    'image': Joi.string().optional(),
    'pdf': Joi.string().optional()
  });
  var validationResult = Joi.validate(opts, validationSchema);
  if (validationResult.error) {
    return callback({'code': 400, 'msg': validationResult.error.details[0].message});
  }

  try {
    var metadata = JSON.parse(opts.metadata);
  } catch (err) {
    log.error({'err': err, 'metadata': opts.metadata}, 'Failed parse metadata in previews callback');
    return callback({'code': 400, 'msg': 'Expected valid JSON data for the metadata field'});
  }

  // Get the asset
  DB.Asset.findByPk(opts.id).complete(function(err, asset) {
    if (err) {
      log.error({'err': err, 'id': opts.id}, 'Failed to retrieve the asset');
      return callback({'code': 500, 'msg': err.message});
    } else if (!asset) {
      log.error({'err': err, 'id': opts.id}, 'Failed to retrieve the asset');
      return callback({'code': 404, 'msg': 'Failed to retrieve the asset'});
    }

    // Update the preview data
    var update = {
      'previewStatus': opts.status,
      'thumbnailUrl': opts.thumbnail,
      'imageUrl': opts.image,
      'pdfUrl': opts.pdf,
      'metadata': metadata
    };
    updateAssetPreview(asset, update, callback);
  });
};

/**
 * Update the preview data for an asset
 *
 * @param  {Asset}          asset                           The asset for which the preview metadata is being updated
 * @param  {Object}         opts                            The preview metadata updates that need to be applied
 * @param  {String}         [opts.previewStatus]            The status of the previews of the asset
 * @param  {String}         [opts.s3ObjectKey]              Amazon S3 Object Key of file
 * @param  {String}         [opts.downloadUrl]              The updated download URL of the asset
 * @param  {String}         [opts.thumbnailUrl]             The updated thumbnail URL of the asset
 * @param  {String}         [opts.imageUrl]                 The updated large image URL of the asset
 * @param  {String}         [opts.pdfUrl]                   The updated pdf URL of the asset
 * @param  {Object}         [opts.metadata]                 The updated preview metadata of the asset
 * @param  {Function}       callback                        Standard callback function
 */
var updateAssetPreview = module.exports.updateAssetPreview = function(asset, opts, callback) {
  // Parameter validation
  var validationSchema = Joi.object().keys({
    'previewStatus': Joi.string().optional(),
    's3ObjectKey': Joi.string().optional(),
    'downloadUrl': Joi.string().optional(),
    'thumbnailUrl': Joi.string().optional(),
    'imageUrl': Joi.string().optional(),
    'pdfUrl': Joi.string().optional(),
    'metadata': Joi.object().optional()
  });

  var validationResult = Joi.validate(opts, validationSchema);

  if (validationResult.error) {
    return log.error({'err': validationResult.error.details[0].message, 'asset': asset.id, 'update': opts}, 'Validation error when updating the preview metadata for an asset');
  }

  // Update the asset preview metadata in the DB
  var update = {};
  if (opts.previewStatus) {
    update.preview_status = opts.previewStatus;
  }
  if (opts.downloadUrl) {
    update.download_url = opts.downloadUrl;
  }
  if (opts.thumbnailUrl) {
    update.thumbnail_url = opts.thumbnailUrl;
  }
  if (opts.imageUrl) {
    update.image_url = opts.imageUrl;
  }
  if (opts.pdfUrl) {
    update.pdf_url = opts.pdfUrl;
  }
  if (opts.metadata) {
    update.preview_metadata = opts.metadata;
  }

  asset.update(update).complete(function(err) {
    if (err) {
      log.error({'err': err, 'asset': asset.id, 'update': update}, 'Failed to update the preview metadata for an asset');
      return callback(err);
    }

    // Notify the whiteboards that an image was generated for the asset.
    // This allows embedded assets to use the image url rather than the download URL
    if (opts.previewStatus === 'done' && opts.imageUrl && opts.metadata.image_width) {
      // We require the Whiteboards API here rather than up top because that code expects a running server when loaded.
      var WhiteboardsAPI = require('col-whiteboards');
      WhiteboardsAPI.updateAssetPreview(asset.id, opts.imageUrl, opts.metadata.image_width, function(err) {
        if (err) {
          log.error({'err': err, 'asset': asset.id, 'update': update}, 'Failed to update the preview metadata for an asset');
          return callback(err);
        } else {
          log.trace({'asset': asset.id, 'update': update}, 'Successfully updated the preview metadata for an asset');
          return callback();
        }
      });
    } else {
      log.trace({'asset': asset.id, 'opts': opts}, 'Updated preview metadata for an asset but could not update whiteboards');
      return callback();
    }
  });
};

/* COMMENTS */

/**
 * Create a new comment on an asset
 *
 * @param  {Context}        ctx                             Standard context containing the current user and the current course
 * @param  {Number}         assetId                         The id of the asset to which the comment is added
 * @param  {String}         body                            The body of the comment
 * @param  {Number}         [parent]                        The id of the comment to which the comment is a reply
 * @param  {Function}       callback                        Standard callback function
 * @param  {Object}         callback.err                    An error that occurred, if any
 * @param  {Comment}        callback.comment                The created comment
 * @param  {User}           callback.comment.user           The user that created the comment
 * @param  {Asset}          callback.asset                  The asset to which the comment was added
 */
var createComment = module.exports.createComment = function(ctx, assetId, body, parent, callback) {
  // Parameter validation
  var validationSchema = Joi.object().keys({
    'assetId': Joi.number().required(),
    'body': Joi.string().required(),
    'parent': Joi.number().optional()
  });

  var validationResult = Joi.validate({
    'assetId': assetId,
    'body': body,
    'parent': parent
  }, validationSchema);

  if (validationResult.error) {
    var msg = validationResult.error.details[0].message;
    log.error({'err': msg, 'asset': assetId}, 'Failed to create comment on asset');
    return callback({'code': 400, 'msg': msg});
  }

  // Get the asset to which the comment is being added
  getAsset(ctx, assetId, {'incrementViews': false}, function(err, asset) {
    if (err) {
      log.error({'err': err, 'asset': assetId}, 'Failed to retrieve asset during createComment()');
      return callback(err);
    }

    // Check that the comment to which this comment is a reply exists
    if (parent) {
      // Ensure the parent id is a number
      parent = CollabosphereUtil.getNumberParam(parent);
      var parentComment = _.find(asset.toJSON().comments, {'id': parent});
      if (!parentComment) {
        log.error({'err': err, 'parent': parent}, 'Failed to find the comment to which a reply is being made');
        return callback({'code': 400, 'msg': 'Failed to find the comment to which a reply is being made'});
      }
    }

    // Create the link asset in the database
    var comment = {
      'asset_id': assetId,
      'user_id': ctx.user.id,
      'parent_id': parent,
      'body': body
    };

    DB.Comment.create(comment).complete(function(err, comment) {
      if (err) {
        log.error({'err': err, 'asset': assetId}, 'Failed to create a new comment');
        return callback({'code': 500, 'msg': err.message});
      }

      // Increase the comment count
      asset.increment('comment_count').complete(function(err, asset) {
        if (err) {
          log.error({
            'err': err,
            'asset': asset.id
          }, 'Failed to increment the comment count of an asset');
          return callback({'code': 500, 'msg': err.message});
        }

        // Create the necessary comment activities
        AssetsUtil.createCommentActivities(ctx, asset, comment, parentComment, function(err) {
          if (err) {
            log.error({'err': err, 'asset': assetId}, 'Failed to create comment activity for asset');
            return callback(err);
          }

          // Retrieve the created comment, including the associated user
          AssetsUtil.getComment(comment.id, function(err, comment) {
            if (err) {
              log.error({
                'err': err,
                'comment': comment.id,
                'asset': assetId
              }, 'Failed to retrieve comment by id, for asset');
              return callback(err);
            }

            return callback(null, comment, asset);
          });
        });
      });
    });
  });
};

/**
 * Edit a comment on an asset
 *
 * @param  {Context}        ctx                             Standard context containing the current user and the current course
 * @param  {Number}         assetId                         The id of the asset to which the comment belongs
 * @param  {Number}         id                              The id of the comment that is being edited
 * @param  {String}         body                            The updated comment body
 * @param  {Function}       callback                        Standard callback function
 * @param  {Object}         callback.err                    An error that occurred, if any
 * @param  {Comment}        callback.comment                The updated comment
 * @param  {User}           callback.comment.user           The user that created the comment
 * @param  {Asset}          callback.asset                  The asset to which the comment belongs
 */
var editComment = module.exports.editComment = function(ctx, assetId, id, body, callback) {
  // Ensure the asset id is a number
  assetId = CollabosphereUtil.getNumberParam(assetId);

  // Parameter validation
  var validationSchema = Joi.object().keys({
    'assetId': Joi.number().required(),
    'id': Joi.number().required(),
    'body': Joi.string().required()
  });

  var validationResult = Joi.validate({
    'assetId': assetId,
    'id': id,
    'body': body
  }, validationSchema);

  if (validationResult.error) {
    return callback({'code': 400, 'msg': validationResult.error.details[0].message});
  }

  // Get the comment that is being edited
  AssetsUtil.getComment(id, function(err, comment) {
    if (err) {
      log.error({'err': err, 'comment': id}, 'Failed to retrieve comment during editComment()');
      return callback(err);
    } else if (comment.asset_id !== assetId) {
      log.warn({'err': err, 'id': id, 'assetId': assetId}, 'Unauthorized to edit the comment');
      return callback({'code': 401, 'msg': 'Unauthorized to edit the comment'});
    }

    // Get the asset to which the comment belongs
    getAsset(ctx, comment.asset_id, null, function(err, asset) {
      if (err) {
        log.error({
          'err': err,
          'asset': comment.asset_id,
          'comment': id
        }, 'Failed to retrieve asset during editComment()');
        return callback(err);
      }

      // Verify that the user is allowed to edit the comment. A user is
      // only able to edit a comment when the user manages the course or
      // the comment is their own
      if ((!ctx.user.is_admin || asset.course_id !== ctx.course.id) && comment.user_id !== ctx.user.id) {
        log.error({'assetId': assetId, 'id': id}, 'Unauthorized to edit the comment');
        return callback({'code': 401, 'msg': 'Unauthorized to edit the comment'});
      }

      // Update the comment
      var update = {
        'body': body
      };

      comment.update(update).complete(function(err, comment) {
        if (err) {
          log.error({
            'err': err,
            'asset': assetId,
            'comment': comment.id
          }, 'Failed to update comment attributes during editComment()');
          return callback({'code': 500, 'msg': err.message});
        }

        // Retrieve the updated comment, including the associated user
        AssetsUtil.getComment(comment.id, function(err, comment) {
          if (err) {
            log.error({
              'err': err,
              'asset': assetId,
              'comment': comment.id
            }, 'Failed to retrieve comment after updated in editComment()');
            return callback(err);
          }

          return callback(null, comment, asset);
        });
      });
    });
  });
};

/**
 * Delete a comment on an asset
 *
 * @param  {Context}        ctx                             Standard context containing the current user and the current course
 * @param  {Number}         assetId                         The id of the asset to which the comment belongs
 * @param  {Number}         id                              The id of the comment that is being deleted
 * @param  {Function}       callback                        Standard callback function
 * @param  {Object}         callback.err                    An error that occurred, if any
 * @param  {Comment}        callback.comment                The deleted comment
 * @param  {Asset}          callback.asset                  The asset to which the comment belonged
 */
var deleteComment = module.exports.deleteComment = function(ctx, assetId, id, callback) {
  // Ensure the asset id is a number
  assetId = CollabosphereUtil.getNumberParam(assetId);

  // Parameter validation
  var validationSchema = Joi.object().keys({
    'assetId': Joi.number().required(),
    'id': Joi.number().required()
  });

  var validationResult = Joi.validate({
    'assetId': assetId,
    'id': id
  }, validationSchema);

  if (validationResult.error) {
    return callback({'code': 400, 'msg': validationResult.error.details[0].message});
  }

  // Get the comment that is being deleted
  AssetsUtil.getComment(id, function(err, comment) {
    if (err) {
      return callback(err);
    } else if (comment.asset_id !== assetId) {
      log.debug({'err': err, 'id': id, 'assetId': assetId}, 'Unauthorized to delete the comment');
      return callback({'code': 401, 'msg': 'Unauthorized to delete the comment'});
    }

    // Get the asset to which the comment belongs
    getAsset(ctx, comment.asset_id, null, function(err, asset) {
      if (err) {
        return callback(err);
      }

      // Verify that the user is allowed to delete the comment. A user is
      // only able to delete a comment when the user manages the course or
      // the comment is their own
      if ((!ctx.user.is_admin || asset.course_id !== ctx.course.id) && comment.user_id !== ctx.user.id) {
        log.error({'assetId': assetId, 'id': id}, 'Unauthorized to delete the comment');
        return callback({'code': 401, 'msg': 'Unauthorized to delete the comment'});
      }

      // Verify that the comment doesn't have any replies. A comment can not
      // be removed if it has any existing replies
      options = {
        'where': {
          'parent_id': id,
          'asset_id': assetId
        }
      };

      DB.Comment.findAll(options).complete(function(err, comments) {
        if (err) {
          log.error({'err': err, 'id': id, 'assetId': assetId}, 'Failed to retrieve the replies of the comment to delete');
          return callback({'code': 500, 'msg': err.message});
        }

        // The comment can not be deleted if it has any replies
        if (comments.length > 0) {
          log.error({'assetId': assetId, 'id': id}, 'The comment can not be deleted as it has replies');
          return callback({'code': 400, 'msg': 'The comment can not be deleted as it has replies'});
        }

        comment.destroy().complete(function(err) {
          if (err) {
            log.error({'err': err, 'category': category.id}, 'Failed to delete a comment');
            return callback({'code': 500, 'msg': err.message});
          }

          // Decrease the comment count
          asset.decrement('comment_count').complete(function(err, asset) {
            if (err) {
              log.error({'err': err, 'asset': asset.id}, 'Failed to decrement the comment count of an asset');
              return callback({'code': 500, 'msg': err.message});
            }

            // Delete the comment activity for the user who created the comment
            AssetsUtil.deleteAssetCommentActivity(ctx, comment, function(err) {
              if (err) {
                return callback(err);
              }

              // Delete the get_asset_comment activity for the asset owners
              AssetsUtil.deleteGetAssetCommentActivities(ctx, comment, asset, function(err) {
                if (err) {
                  return callback(err);
                }

                return AssetsUtil.deleteGetAssetCommentReplyActivity(ctx, comment, function(err) {
                  if (err) {
                    return callback(err);
                  }

                  return callback(null, comment, asset);
                });
              });
            });
          });
        });
      });
    });
  });
};

/* (DIS)LIKING */

/**
 * Like or dislike an asset
 *
 * @param  {Context}        ctx                             Standard context containing the current user and the current course
 * @param  {Number}         assetId                         The id of the asset that is liked or disliked
 * @param  {Boolean}        [like]                          `true` when the asset should be liked, `false` when the asset should be disliked. When `null` is provided, the previous like or dislike will be undone
 * @param  {Function}       callback                        Standard callback function
 * @param  {Object}         callback.err                    An error that occurred, if any
 * @param  {Asset}          callback.asset                  The asset that has been liked or disliked
 */
var like = module.exports.like = function(ctx, assetId, like, callback) {
  // Parameter validation
  var validationSchema = Joi.object().keys({
    'assetId': Joi.number().required(),
    'like': Joi.boolean().optional()
  });

  var validationResult = Joi.validate({
    'assetId': assetId,
    'like': like
  }, validationSchema);

  if (validationResult.error) {
    return callback({'code': 400, 'msg': validationResult.error.details[0].message});
  }

  // Get the asset that is being liked or disliked
  getAsset(ctx, assetId, {'incrementViews': false}, function(err, asset) {
    if (err) {
      return callback(err);
    }

    // Users are not able to like or dislike their own assets
    if (_.find(asset.users, {'id': ctx.user.id})) {
      return callback({'code': 401, 'msg': 'You can not like or dislike your own assets'});
    }

    // Remove the previous like or dislike
    ActivitiesAPI.deleteActivity(ctx.course, ctx.user, ['like', 'dislike'], asset.id, CollabosphereConstants.ACTIVITY.OBJECT_TYPES.ASSET, null, function(err, deletedLike) {
      if (err) {
        return callback(err);
      }

      // Remove the previous get like or get dislike activities
      AssetsUtil.deleteGetLikeActivities(ctx, asset, function(err) {
        if (err) {
          return callback(err);
        }

        // Update the like and dislike count on the asset
        AssetsUtil.updateAssetLikeCount(asset, like, deletedLike, function(err, asset) {
          if (err) {
            return callback(err);
          }

          asset.liked = like;

          // If a like or dislike is being undone, no further actions are required
          if (!_.isBoolean(like)) {
            return callback(null, asset);
          }

          // Add the like / dislike activity
          var type = like ? 'like' : 'dislike';

          ActivitiesAPI.createActivity(ctx.course, ctx.user, type, asset.id, CollabosphereConstants.ACTIVITY.OBJECT_TYPES.ASSET, null, null, function(err, likeActivity) {
            if (err) {
              return callback(err);
            }
            if (!likeActivity) {
              log.error({'user': ctx.user, 'assetId': asset.id}, 'Failed to retrieve newly created like/dislike activity');
              return callback({'code': 500, 'msg': 'Failed to retrieve newly created like/dislike activity'});
            }

            // Add the get like / get dislike activities
            var receiveType = like ? 'get_like' : 'get_dislike';

            AssetsUtil.createGetLikeActivities(ctx, asset, receiveType, likeActivity.id, function(err) {
              if (err) {
                return callback(err);
              }

              return callback(null, asset);
            });
          });
        });
      });
    });
  });
};

/* (UN)PINNING */

/**
 * (Un)pin an asset
 *
 * @param  {Context}        ctx                             Standard context containing the current user and the current course
 * @param  {Number}         assetId                         The id of the asset that is pinned or unpinned
 * @param  {Boolean}        pin                             `true` when the asset should be pinned, `false` when the asset should be unpinned
 * @param  {Function}       callback                        Standard callback function
 * @param  {Object}         callback.err                    An error that occurred, if any
 * @param  {Asset}          callback.asset                  The asset that has been liked or disliked
 */
var pin = module.exports.pin = function(ctx, assetId, pin, callback) {
  // Parameter validation
  var validationSchema = Joi.object().keys({
    'assetId': Joi.number().required(),
    'pin': Joi.boolean().required()
  });

  var validationResult = Joi.validate({
    'assetId': assetId,
    'pin': pin
  }, validationSchema);

  if (validationResult.error) {
    return callback({'code': 400, 'msg': validationResult.error.details[0].message});
  }

  // Get the asset that is being (un)pinned
  getAsset(ctx, assetId, {'incrementViews': false}, function(err, asset) {
    if (err) {
      log.error({'user': ctx.user, 'asset': assetId, 'err': err}, 'Failed to retrieve asset');

      return callback(err);
    } else if (!asset) {
      log.error({'user': ctx.user}, 'Asset not found');

      return callback({'code': 404, 'msg': 'Asset not found'});
    }
    var wasPinned = !!_.find(asset.pins, function(p) { return p.user_id === ctx.user.id; });

    if (wasPinned === pin) {
      var msg = '\'pin\' must be the opposite of \'wasPinned\'';

      log.error({'user': ctx.user.id, 'asset': asset.id, 'pin': pin}, msg);
      return callback({'code': 400, 'msg': msg}, asset);
    }

    var func = pin ? AssetsUtil.addPinToAsset : AssetsUtil.unPinAsset;

    func(asset.id, ctx.user.id, function(err) {
      if (err) {
        var msg = 'Failed to ' + (pin ? 'pin' : 'unpin') + ' asset';
        log.error({'user': ctx.user.id, 'asset': asset.id, 'pin': pin}, msg);
        return callback(err, msg);
      } else if (!pin) {
        // If action is 'unpin' then we are done
        return callback(null, asset);
      }

      // We need up-to-date asset metadata
      getAsset(ctx, asset.id, {'incrementViews': false}, function(err, asset) {
        if (err) {
          return callback(err);
        }
        ActivitiesAPI.createPinActivity(ctx, asset, function(err, pinActivity) {
          if (err) {
            return callback(err);
          }

          var reciprocalId = pinActivity ? pinActivity.id : null;

          ActivitiesAPI.createGetPinActivity(ctx, asset, reciprocalId, function(err) {
            if (err) {
              return callback(err);
            }

            return callback(null, asset);
          });
        });
      });
    });
  });
};

/**
 * Create a new whiteboard (aka 'remix') from an exported whiteboard asset
 *
 * @param  {Context}        ctx                             Standard context containing the current user and the current course
 * @param  {Number}         id                              The id of the exported whiteboard asset
 * @param  {Function}       callback                        Standard callback function
 * @param  {Object}         callback.err                    An error that occurred, if any
 * @param  {Whiteboard}     callback.whiteboard             The whiteboard that was created from the asset
 */
var createWhiteboardFromAsset = module.exports.createWhiteboardFromAsset = function(ctx, id, callback) {
  // Parameter validation
  var validationSchema = Joi.object().keys({
    'id': Joi.number().required()
  });
  var validationResult = Joi.validate({
    'id': id
  }, validationSchema);
  if (validationResult.error) {
    return callback({'code': 400, 'msg': validationResult.error.details[0].message});
  }

  // Get the asset including whiteboard elements
  getAsset(ctx, id, {'includeWhiteboardElements': true}, function(err, asset) {
    if (err) {
      log.error({
        'err': err,
        'asset': id
      }, 'Failed to get asset during createWhiteboardFromAsset()');

      return callback(err);
    } else if (asset.type !== 'whiteboard') {
      return callback({'code': 400, 'msg': 'Asset is not an exported whiteboard'});
    } else if (_.isEmpty(asset.getDataValue('whiteboard_elements'))) {
      return callback({'code': 400, 'msg': 'Could not retrieve whiteboard elements for asset'});
    }

    // We require the Whiteboards API here rather than up top because that code expects a running server when loaded.
    var WhiteboardsAPI = require('col-whiteboards');
    WhiteboardsAPI.createWhiteboardFromExport(ctx, asset, function(err, whiteboard) {
      if (err) {
        log.error({
          'err': err,
          'asset': id
        }, 'Failed to create whiteboard from export');

        return callback(err);
      }

      var metadata = {'whiteboard_id': whiteboard.id};

      // If the user is remixing their own whiteboard, do not assign points or create activities.
      var isAssetOwner = _.find(asset.users, {'id': ctx.user.id});
      if (isAssetOwner) {
        return callback(null, whiteboard);
      }

      ActivitiesAPI.createActivity(ctx.course, ctx.user, 'remix_whiteboard', asset.id, CollabosphereConstants.ACTIVITY.OBJECT_TYPES.ASSET, metadata, null, function(err, remixWhiteboardActivity) {
        if (err) {
          log.error({'user': ctx.user, 'err': err}, 'Failed to create a remix_whiteboard activity');
          return callback(err);
        }
        if (!remixWhiteboardActivity) {
          log.error({'user': ctx.user, 'assetId': asset.id}, 'Failed to retrieve newly created remix_whiteboard activity');
          return callback({'code': 500, 'msg': 'Failed to retrieve newly created remix_whiteboard activity'});
        }

        metadata.reciprocalId = remixWhiteboardActivity.id;

        AssetsUtil.createGetRemixWhiteboardActivities(ctx, asset, metadata, function(err) {
          if (err) {
            return callback(err);
          }

          return callback(null, whiteboard);
        });
      });
    });
  });
};
