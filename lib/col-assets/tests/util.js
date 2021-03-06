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
var assert = require('assert');
var config = require('config');
var fs = require('fs');
var Joi = require('joi');
var moment = require('moment-timezone');
var path = require('path');

var AssetsAPI = require('col-assets');
var CanvasTestsUtil = require('col-canvas/tests/util');
var CategoriesTestUtil = require('col-categories/tests/util');
var CollabosphereConstants = require('col-core/lib/constants');
var CourseTestUtil = require('col-course/tests/util');
var DB = require('col-core/lib/db');
var MigrateAssetsAPI = require('col-assets/lib/migrate');
var TestsUtil = require('col-tests');
var UsersTestsUtil = require('col-users/tests/util');
var WhiteboardsTestsUtil = require('col-whiteboards/tests/util');

/**
 * Assert that an asset has all expected properties
 *
 * @param  {Asset}              asset                                 The asset to assert the properties for
 * @param  {Object}             [opts]                                Optional parameters to verify the asset with
 * @param  {Asset}              [opts.expectedAsset]                  The asset to which the provided asset should be compared
 * @param  {Number}             [opts.expectedCommentCount]           The total number of comments that are expected on the asset
 * @param  {Boolean}            [opts.expectComments]                 Whether the comments on the asset are expected to be included
 * @param  {Boolean}            [opts.expectCategories]               Whether the categories on the asset are expected to be included
 * @param  {Boolean}            [opts.expectThumbnail]                Whether the asset is expected to have a thumbnail
 * @param  {Boolean}            [opts.expectWhiteboardElements]       Whether the whiteboard elements on the asset are expected to be included
 * @param  {Boolean}            [opts.incrementViews]                 Whether the total number of views for the asset was increased when retrieving the asset
 * @param  {Boolean}            [opts.expectVisible]                  Whether the asset is expected to be visible in the assets library list
 * @param  {Boolean}            [opts.allowTimestampDiscrepancy]      Whether timestamps are permitted to diverge
 * @throws {AssertionError}                                           Error thrown when an assertion failed
 */
var assertAsset = module.exports.assertAsset = function(asset, opts) {
  opts = opts || {};

  // Ensure that all expected properties are present
  assert.ok(asset);
  assert.ok(asset.id);
  assert.ok(asset.type);
  assert(CollabosphereConstants.ASSET.ASSET_TYPES.indexOf(asset.type) !== -1);
  assert.ok(asset.course_id);
  assert.ok(asset.title);
  assert.ok(asset.created_at);
  assert.ok(asset.updated_at);
  assert.ok(_.isFinite(asset.likes));
  assert.ok(_.isFinite(asset.dislikes));
  assert.ok(_.isFinite(asset.views));
  assert.ok(_.isFinite(asset.comment_count));
  assert.ok(!_.isUndefined(asset.liked));
  assert.ok(_.isBoolean(asset.visible));

  // Ensure that 'impact' and 'trending' properties are suppressed
  assert.ok(_.isUndefined(asset.impact_percentile));
  assert.ok(_.isUndefined(asset.impact_score));
  assert.ok(_.isUndefined(asset.trending_percentile));
  assert.ok(_.isUndefined(asset.trending_score));

  assert.ok(_.isArray(asset.users));
  assert.ok(!_.isEmpty(asset.users));
  _.each(asset.users, function(user) {
    UsersTestsUtil.assertUser(user, {'expectPoints': false, 'expectEmail': false});
  });

  // Ensure that valid categories are present
  if (opts.expectCategories) {
    assert.ok(_.isArray(asset.categories));
    _.each(asset.categories, function(category) {
      CategoriesTestUtil.assertCategory(category);
    });
  }

  // Ensure that a thumbnail is present
  if (opts.expectThumbnail) {
    assert.ok(asset.thumbnail_url);
  }

  // Ensure that the comment count is correct
  if (_.isFinite(opts.expectedCommentCount)) {
    assert.strictEqual(asset.comment_count, opts.expectedCommentCount);
  }

  // Ensure that all expected comments are present
  if (opts.expectComments) {
    assert.ok(_.isArray(asset.comments));
    assert.strictEqual(asset.comments.length, asset.comment_count);
    _.each(asset.comments, function(comment) {
      assertComment(comment);
    });
  } else {
    assert.ok(_.isUndefined(asset.comments));
  }

  // Ensure that the expected visibility setting is present
  if (!_.isUndefined(opts.expectVisible)) {
    assert.strictEqual(asset.visible, opts.expectVisible);
  }

  // Ensure that all the asset properties are the same as the ones for
  // the expected asset
  if (opts.expectedAsset) {
    assert.strictEqual(asset.id, opts.expectedAsset.id);
    assert.strictEqual(asset.type, opts.expectedAsset.type);
    assert.strictEqual(asset.course_id, opts.expectedAsset.course_id);
    assert.strictEqual(asset.title, opts.expectedAsset.title);
    assert.strictEqual(asset.created_at, opts.expectedAsset.created_at);
    assert.strictEqual(asset.likes, opts.expectedAsset.likes);
    assert.strictEqual(asset.dislikes, opts.expectedAsset.dislikes);
    assert.strictEqual(asset.liked, opts.expectedAsset.liked);
    assert.strictEqual(asset.visible, opts.expectedAsset.visible);

    // Ensure that the expected asset creators are present
    asset.users = _.sortBy(asset.users, 'id');
    opts.expectedAsset.users = _.sortBy(opts.expectedAsset.users, 'id');
    assert.deepEqual(asset.users, opts.expectedAsset.users);

    // Ensure that views do not increment if incrementViews is set to false.
    if (!opts.incrementViews) {
      assert.strictEqual(asset.views, opts.expectedAsset.views);
      if (!opts.allowTimestampDiscrepancy) {
        assert.strictEqual(asset.updated_at, opts.expectedAsset.updated_at);
      }
    }

    // Ensure that the expected categories are present
    if (opts.expectCategories) {
      assert.strictEqual(asset.categories.length, opts.expectedAsset.categories.length);
      _.each(asset.categories, function(category) {
        var correspondingCategory = _.find(opts.expectedAsset.categories, {'id': category.id});
        CategoriesTestUtil.assertCategory(correspondingCategory);
        CategoriesTestUtil.assertCategory(category, {'expectedCategory': correspondingCategory});
      });
    }

    // Ensure that all optional properties are the same as the ones for the
    // expected asset
    if (asset.canvas_assignment_id || opts.expectedAsset.canvas_assignment_id) {
      assert.strictEqual(asset.canvas_assignment_id, opts.expectedAsset.canvas_assignment_id);
    }
    if (asset.description || opts.expectedAsset.description) {
      assert.strictEqual(asset.description, opts.expectedAsset.description);
    }
    if (asset.thumbnail_url || opts.expectedAsset.thumbnail_url) {
      assert.strictEqual(asset.thumbnail_url, opts.expectedAsset.thumbnail_url);
    }
    if (asset.large_url || opts.expectedAsset.large_url) {
      assert.strictEqual(asset.large_url, opts.expectedAsset.large_url);
    }
    if (asset.mime || opts.expectedAsset.mime) {
      assert.strictEqual(asset.mime, opts.expectedAsset.mime);
    }
    if (asset.source || opts.expectedAsset.source) {
      assert.strictEqual(asset.source, opts.expectedAsset.source);
    }
  }

  // Ensure that all link specific properties are present
  if (asset.type === 'link') {
    assert.ok(asset.url);
    if (opts.expectedAsset) {
      assert.strictEqual(asset.url, opts.expectedAsset.url);
    }
  }

  // Ensure that all file specific properties are present
  if (asset.type === 'file') {
    assert.ok(asset.mime);

    // Ensure a correct download URL has been provided
    if (asset.download_url) {
      var validationResult = Joi.validate(asset.download_url, Joi.string().required());
      assert.ok(!validationResult.error);
    }

    if (opts.expectedAsset) {
      assert.strictEqual(asset.download_url, opts.expectedAsset.download_url);
      assert.strictEqual(asset.mime, opts.expectedAsset.mime);
    }
  }

  // Ensure that all whiteboard specific properties are present
  if (asset.type === 'whiteboard' && opts.expectWhiteboardElements) {
    assert.ok(_.isArray(asset.whiteboard_elements));
  }
};

/**
 * Assert that an assets query result matches an ordered set of expected assets
 *
 * @param  {Object}            assets                       The result of the asset query
 * @param  {Asset[]}           assets.results               The returned asset objects
 * @param  {Number}            assets.total                 The total asset count including any subsequent pages
 * @param  {Asset[]}           expectedAssets               The expected asset results in order
 * @param  {Number}            expectedCount                The expected total asset count
 * @param  {Object}            [opts]                       Assertion options
 * @throws {AssertionError}                                 Error thrown when an assertion failed
 */
var assertAssets = module.exports.assertAssets = function(assets, expectedAssets, expectedCount, opts) {
  opts = opts || {};

  // The 'total' value should always equal the total count of expected assets
  expectedCount = expectedCount || expectedAssets.length;
  assert.strictEqual(assets.total, expectedCount);

  // If there are more than 10 expected assets, only the first 10 should be included in
  // paged results
  if (expectedAssets.length < 10) {
    assert.strictEqual(assets.results.length, expectedAssets.length);
  } else {
    assert.strictEqual(assets.results.length, 10);
  }

  _.each(assets.results, function(asset, i) {
    opts.expectedAsset = expectedAssets[i];
    assertAsset(asset, opts);
  });
};

/**
 * Assert that a comment has all expected properties
 *
 * @param  {Comment}            comment                       The asset to assert the properties for
 * @param  {Object}             [opts]                        Optional parameters to verify the comment with
 * @param  {Comment}            [opts.expectedComment]        The comment to which the provided comment should be compared
 * @throws {AssertionError}                                   Error thrown when an assertion failed
 */
var assertComment = module.exports.assertComment = function(comment, opts) {
  opts = opts || {};

  // Ensure that all expected properties are present
  assert.ok(comment);
  assert.ok(comment.id);
  assert.ok(comment.user_id);
  assert.ok(comment.asset_id);
  assert.ok(comment.body);

  assert.ok(comment.user);
  assert.ok(comment.user.id);
  assert.strictEqual(comment.user_id, comment.user.id);
  assert.ok(comment.user.canvas_course_role);
  assert.ok(comment.user.canvas_full_name);
  assert.ok(!comment.user.bookmarklet_token);
  assert.ok(!comment.user.points);
  assert.ok(!comment.user.share_points);

  // Ensure that all the comment properties are the same as the ones for
  // the expected comment
  if (opts.expectedComment) {
    assert.strictEqual(comment.id, opts.expectedComment.id);
    assert.strictEqual(comment.user_id, opts.expectedComment.user_id);
    assert.strictEqual(comment.asset_id, opts.expectedComment.asset_id);
    assert.strictEqual(comment.body, opts.expectedComment.body);

    assert.strictEqual(comment.user.id, opts.expectedComment.user.id);
    assert.strictEqual(comment.user.canvas_course_role, opts.expectedComment.user.canvas_course_role);
    assert.strictEqual(comment.user.canvas_full_name, opts.expectedComment.user.canvas_full_name);

    // Ensure that all optional properties are the same as the ones for the
    // expected comment
    if (comment.parent_id || opts.expectedComment.parent_id) {
      assert.strictEqual(comment.parent_id, opts.expectedComment.parent_id);
    }
    if (comment.user.canvas_image || opts.expectedComment.user.canvas_image) {
      assert.strictEqual(comment.user.canvas_image, opts.expectedComment.user.canvas_image);
    }
  }
};

/**
 * Assert that a new link asset can be created
 *
 * @param  {RestClient}         client                          The REST client to make the request with
 * @param  {Course}             course                          The Canvas course in which the user is interacting with the API
 * @param  {String}             title                           The title of the link
 * @param  {String}             url                             The url of the link
 * @param  {Object}             [opts]                          A set of optional parameters
 * @param  {Number[]}           [opts.categories]               The ids of the categories to which the link should be associated
 * @param  {String}             [opts.description]              The description of the link
 * @param  {String}             [opts.source]                   The source of the link
 * @param  {String}             [opts.visible]                  Whether the link will be visible in the assets library list
 * @param  {String}             [opts.comment]                  Comment to make on the asset
 * @param  {Function}           callback                        Standard callback function
 * @param  {Asset}              callback.asset                  The created link asset
 * @throws {AssertionError}                                     Error thrown when an assertion failed
 */
var assertCreateLink = module.exports.assertCreateLink = function(client, course, title, url, opts, callback) {
  opts = opts || {};

  client.assets.createLink(course, title, url, opts, function(err, asset) {
    assert.ifError(err);
    assert.ok(asset);
    assertAsset(asset, {
      'expectedCommentCount': 0,
      'expectComments': true,
      'expectCategories': true,
      'expectVisible': opts.visible !== false
    });
    assert.strictEqual(asset.type, 'link');
    assert.strictEqual(asset.url, url);
    if (title) {
      assert.strictEqual(asset.title, title);
    } else {
      assert.strictEqual(asset.title, url);
    }

    if (opts.categories) {
      var categories = _.isArray(opts.categories) ? opts.categories : [opts.categories];
      assert.strictEqual(asset.categories.length, categories.length);
      _.each(asset.categories, function(category) {
        assert.ok(_.includes(categories, category.id));
      });
    }

    if (opts.description) {
      assert.strictEqual(asset.description, opts.description);
    }
    if (opts.source) {
      assert.strictEqual(asset.source, opts.source);
    }
    if (opts.comment) {
      client.assets.createComment(course, asset.id, opts.comment, function(err, comment, asset) {
        assert.ifError(err);
        assert.ok(asset.comments);

        return callback(asset);
      });
    }
    return callback(asset);
  });
};

/**
 * Assert that a new link asset can not be created
 *
 * @param  {RestClient}         client                          The REST client to make the request with
 * @param  {Course}             course                          The Canvas course in which the user is interacting with the API
 * @param  {String}             title                           The title of the link
 * @param  {String}             url                             The url of the link
 * @param  {Object}             [opts]                          A set of optional parameters
 * @param  {String}             [opts.description]              The description of the link
 * @param  {String}             [opts.source]                   The source of the link
 * @param  {String}             [opts.visible]                  Whether the link will be visible in the assets library list
 * @param  {Number}             code                            The expected HTTP error code
 * @param  {Function}           callback                        Standard callback function
 * @throws {AssertionError}                                     Error thrown when an assertion failed
 */
var assertCreateLinkFails = module.exports.assertCreateLinkFails = function(client, course, title, url, opts, code, callback) {
  client.assets.createLink(course, title, url, opts, function(err, asset) {
    assert.ok(err);
    assert.strictEqual(err.code, code);
    assert.ok(!asset);

    return callback();
  });
};

/**
 * Assert that a new link asset can be created through the Bookmarklet
 *
 * @param  {RestClient}         client                          The REST client to make the request with
 * @param  {Course}             course                          The Canvas course in which the user is interacting with the API
 * @param  {String}             userId                          The id of the user creating the link
 * @param  {String}             bookmarkletToken                The bookmarklet access token for the user
 * @param  {String}             title                           The title of the link
 * @param  {String}             url                             The url of the link
 * @param  {Object}             [opts]                          A set of optional parameters
 * @param  {Number[]}           [opts.categories]               The ids of the categories to which the link should be associated
 * @param  {String}             [opts.description]              The description of the link
 * @param  {String}             [opts.source]                   The source of the link
 * @param  {Function}           callback                        Standard callback function
 * @param  {Asset}              callback.asset                  The created link asset
 * @throws {AssertionError}                                     Error thrown when an assertion failed
 */
var assertCreateLinkBookmarklet = module.exports.assertCreateLinkBookmarklet = function(client, course, userId, bookmarkletToken, title, url, opts, callback) {
  opts = opts || {};

  client.assets.bookmarklet.createLink(course, userId, bookmarkletToken, title, url, opts, function(err, asset) {
    assert.ifError(err);
    assert.ok(asset);
    assertAsset(asset, {'expectedCommentCount': 0, 'expectComments': true, 'expectCategories': true});
    assert.strictEqual(asset.type, 'link');
    assert.strictEqual(asset.users[0].id, userId);
    assert.strictEqual(asset.url, url);
    if (title) {
      assert.strictEqual(asset.title, title);
    } else {
      assert.strictEqual(asset.title, url);
    }

    if (opts.categories) {
      var categories = _.isArray(opts.categories) ? opts.categories : [opts.categories];
      assert.strictEqual(asset.categories.length, categories.length);
      _.each(asset.categories, function(category) {
        assert.ok(_.includes(categories, category.id));
      });
    }

    if (opts.description) {
      assert.strictEqual(asset.description, opts.description);
    }
    if (opts.source) {
      assert.strictEqual(asset.source, opts.source);
    }

    return callback(asset);
  });
};

/**
 * Assert that a new link asset can not be created through the Bookmarklet
 *
 * @param  {RestClient}         client                          The REST client to make the request with
 * @param  {Course}             course                          The Canvas course in which the user is interacting with the API
 * @param  {String}             userId                          The id of the user creating the link
 * @param  {String}             bookmarkletToken                The bookmarklet access token for the user
 * @param  {String}             title                           The title of the link
 * @param  {String}             url                             The url of the link
 * @param  {Object}             [opts]                          A set of optional parameters
 * @param  {String}             [opts.description]              The description of the link
 * @param  {String}             [opts.source]                   The source of the link
 * @param  {Number}             code                            The expected HTTP error code
 * @param  {Function}           callback                        Standard callback function
 * @throws {AssertionError}                                     Error thrown when an assertion failed
 */
var assertCreateLinkBookmarkletFails = module.exports.assertCreateLinkBookmarkletFails = function(client, course, userId, bookmarkletToken, title, url, opts, code, callback) {
  client.assets.bookmarklet.createLink(course, userId, bookmarkletToken, title, url, opts, function(err, asset) {
    assert.ok(err);
    assert.strictEqual(err.code, code);
    assert.ok(!asset);

    return callback();
  });
};

/**
 * Assert that a new file asset can be created
 *
 * @param  {RestClient}         client                          The REST client to make the request with
 * @param  {Course}             course                          The Canvas course in which the user is interacting with the API
 * @param  {String}             title                           The title of the file
 * @param  {Stream}             file                            The file to upload
 * @param  {Object}             [opts]                          A set of optional parameters
 * @param  {Number[]}           [opts.categories]               The ids of the categories to which the file should be associated
 * @param  {String}             [opts.description]              The description of the file
 * @param  {String}             [opts.source]                   The source of the file
 * @param  {String}             [opts.visible]                  Whether the file will be visible in the assets library list
 * @param  {String}             [opts.comment]                  Comment made upon asset
 * @param  {Function}           callback                        Standard callback function
 * @param  {Asset}              callback.asset                  The created file asset
 * @throws {AssertionError}                                     Error thrown when an assertion failed
 */
var assertCreateFile = module.exports.assertCreateFile = function(client, course, title, file, opts, callback) {
  opts = opts || {};

  client.assets.createFile(course, title, file, opts, function(err, asset, response) {
    assert.ifError(err);
    assert.ok(asset);
    assertAsset(asset, {
      'expectedCommentCount': 0,
      'expectComments': true,
      'expectCategories': true,
      'expectVisible': opts.visible !== false
    });
    assert.strictEqual(asset.type, 'file');

    // If no title was provided, it should default to the file name
    if (title) {
      assert.strictEqual(asset.title, title);
    } else {
      assert.strictEqual(asset.title, path.basename(file.path));
    }

    if (opts.categories) {
      var categories = _.isArray(opts.categories) ? opts.categories : [opts.categories];
      assert.strictEqual(asset.categories.length, categories.length);
      _.each(asset.categories, function(category) {
        assert.ok(_.includes(categories, category.id));
      });
    }

    if (opts.description) {
      assert.strictEqual(asset.description, opts.description);
    }
    if (opts.source) {
      assert.strictEqual(asset.source, opts.source);
    }
    if (opts.comment) {
      client.assets.createComment(course, asset.id, opts.comment, function(err, comment, asset) {
        assert.ifError(err);
        assert.ok(asset.comments);

        return callback(asset);
      });
    }
    return callback(asset);
  });
};

/**
 * Assert that a new file asset can not be created
 *
 * @param  {RestClient}         client                          The REST client to make the request with
 * @param  {Course}             course                          The Canvas course in which the user is interacting with the API
 * @param  {String}             title                           The title of the file
 * @param  {Stream}             file                            The file to upload
 * @param  {Object}             [opts]                          A set of optional parameters
 * @param  {String}             [opts.description]              The description of the file
 * @param  {String}             [opts.source]                   The source of the file
 * @param  {String}             [opts.visible]                  Whether the file will be visible in the assets library list
 * @param  {Number}             code                            The expected HTTP error code
 * @param  {Function}           callback                        Standard callback function
 * @throws {AssertionError}                                     Error thrown when an assertion failed
 */
var assertCreateFileFails = module.exports.assertCreateFileFails = function(client, course, title, file, opts, code, callback) {
  client.assets.createFile(course, title, file, opts, function(err, asset, response) {
    assert.ok(err);
    assert.strictEqual(err.code, code);
    assert.ok(!asset);

    return callback();
  });
};

/**
 * Assert that an asset can be retrieved
 *
 * @param  {RestClient}         client                          The REST client to make the request with
 * @param  {Course}             course                          The Canvas course in which the user is interacting with the API
 * @param  {Number}             id                              The id of the asset
 * @param  {Asset}              [expectedAsset]                 The expected asset to be retrieved
 * @param  {Number}             [expectedCommentCount]          The total number of comments that are expected on the asset
 * @param  {Function}           callback                        Standard callback function
 * @param  {Asset}              callback.asset                  The retrieved asset
 * @throws {AssertionError}                                     Error thrown when an assertion failed
 */
var assertGetAsset = module.exports.assertGetAsset = function(client, course, id, expectedAsset, expectedCommentCount, callback) {
  client.assets.getAsset(course, id, null, function(err, asset) {
    assert.ifError(err);
    assert.ok(asset);
    assert.strictEqual(asset.id, id);
    var expectations = {
      'expectedAsset': expectedAsset,
      'expectedCommentCount': expectedCommentCount,
      'expectComments': true,
      'expectCategories': true,
      'incrementViews': true
    };

    if (asset.type === 'whiteboard') {
      expectations.expectWhiteboardElements = true;
    }

    assertAsset(asset, expectations);

    return callback(asset);
  });
};

/**
 * Assert that an asset can not be retrieved
 *
 * @param  {RestClient}         client                          The REST client to make the request with
 * @param  {Course}             course                          The Canvas course in which the user is interacting with the API
 * @param  {Number}             id                              The id of the asset
 * @param  {Number}             code                            The expected HTTP error code
 * @param  {Function}           callback                        Standard callback function
 * @throws {AssertionError}                                     Error thrown when an assertion failed
 */
var assertGetAssetFails = module.exports.assertGetAssetFails = function(client, course, id, code, callback) {
  client.assets.getAsset(course, id, null, function(err, asset) {
    assert.ok(err);
    assert.strictEqual(err.code, code);
    assert.ok(!asset);

    return callback();
  });
};

/**
 * Assert that the assets for a course can be retrieved
 *
 * @param  {RestClient}         client                          The REST client to make the request with
 * @param  {Course}             course                          The Canvas course in which the user is interacting with the API
 * @param  {Object}             [filters]                       A set of options to filter the results by
 * @param  {String}             [filters.keywords]              A string to filter the assets by
 * @param  {Number}             [filters.category]              The id of the category to filter the assets by
 * @param  {Number}             [filters.user]                  The id of the user who created the assets
 * @param  {String}             [filters.section]               Section of the course
 * @param  {String[]}           [filters.types]                 The type of assets. One or more of `CollabosphereConstants.ASSET.ASSET_TYPES`
 * @param  {Boolean}            [filters.hasComments]           If true then exclude zero comment_count; if false then zero comment_count only; if null do nothing
 * @param  {Boolean}            [filters.hasImpact]             If true then exclude zero impact; if false then zero impact only; if null do nothing
 * @param  {Boolean}            [filters.hasLikes]              If true then exclude zero likes; if false then zero likes only; if null do nothing
 * @param  {Boolean}            [filters.hasPins]               If true then exclude assets with zero pins; if false then zero pins only; if null do nothing
 * @param  {Boolean}            [filters.hasTrending]           If true then exclude zero trending; if false then zero trending only; if null do nothing
 * @param  {Boolean}            [filters.hasViews]              If true then exclude zero views; if false then zero views only; if null do nothing
 * @param  {String}             [sort]                          An optional criterion to sort by. Defaults to id descending
 * @param  {Number}             [limit]                         The maximum number of results to retrieve. Defaults to 10
 * @param  {Number}             [offset]                        The number to start paging from. Defaults to 0
 * @param  {Number}             [expectedTotal]                 The expected total number of assets in the current course
 * @param  {Function}           callback                        Standard callback function
 * @param  {Object}             callback.assets                 The retrieved assets
 * @param  {Number}             callback.assets.offset          The number the assets are paged from
 * @param  {Number}             callback.assets.total           The total number of assets in the current course
 * @param  {Asset[]}            callback.assets.results         The paged assets in the current course
 * @throws {AssertionError}                                     Error thrown when an assertion failed
 */
var assertGetAssets = module.exports.assertGetAssets = function(client, course, filters, sort, limit, offset, expectedTotal, callback) {
  filters = filters || {};
  client.assets.getAssets(course, filters, sort, limit, offset, function(err, assets) {
    assert.ifError(err);
    assert.ok(assets);
    assert.ok(_.isNumber(assets.offset));
    if (_.isNumber(offset)) {
      assert.strictEqual(assets.offset, offset);
    }
    assert.ok(assets.results);
    assert.ok(assets.results.length <= assets.total);
    if (_.isNumber(expectedTotal)) {
      assert.strictEqual(assets.total, expectedTotal);
    }
    _.each(assets.results, function(asset) {
      assertAsset(asset);

      // Only visible assets should be returned when listing the assets
      assert.strictEqual(asset.visible, true);

      if (filters.keywords) {
        var keywords = filters.keywords.toLowerCase().split(' ');
        _.each(keywords, function(keyword) {
          var titleContainsKeyword = (asset.title.toLowerCase().indexOf(keyword) !== -1);
          var descriptionContainsKeyword = false;
          if (asset.description) {
            descriptionContainsKeyword = asset.description.toLowerCase().indexOf(keyword) !== -1;
          }
          assert.ok(titleContainsKeyword || descriptionContainsKeyword);
        });
      }
      if (filters.types) {
        assert.ok(_.includes(filters.types, asset.type));
      }
    });

    return callback(assets);
  });
};

/**
 * Assert that the assets for a course can not be retrieved
 *
 * @param  {RestClient}         client                          The REST client to make the request with
 * @param  {Course}             course                          The Canvas course in which the user is interacting with the API
 * @param  {Object}             [filters]                       A set of options to filter the results by
 * @param  {String}             [filters.keywords]              A string to filter the assets by
 * @param  {Number}             [filters.category]              The id of the category to filter the assets by
 * @param  {Number}             [filters.user]                  The id of the user who created the assets
 * @param  {String[]}           [filters.types]                 The type of assets. One or more of `CollabosphereConstants.ASSET.ASSET_TYPES`
 * @param  {String}             [sort]                          An optional criterion to sort by. Defaults to id descending
 * @param  {Number}             [limit]                         The maximum number of results to retrieve. Defaults to 10
 * @param  {Number}             [offset]                        The number to start paging from. Defaults to 0
 * @param  {Number}             code                            The expected HTTP error code
 * @param  {Function}           callback                        Standard callback function
 * @throws {AssertionError}                                     Error thrown when an assertion failed
 */
var assertGetAssetsFails = module.exports.assertGetAssetsFails = function(client, course, filters, sort, limit, offset, code, callback) {
  client.assets.getAssets(course, filters, sort, limit, offset, function(err, assets) {
    assert.ok(err);
    assert.strictEqual(err.code, code);
    assert.ok(!assets);

    return callback();
  });
};

/**
 * Assert that an asset can be edited
 *
 * @param  {RestClient}         client                          The REST client to make the request with
 * @param  {Course}             course                          The Canvas course in which the user is interacting with the API
 * @param  {Number}             id                              The id of the asset that is being edited
 * @param  {String}             title                           The updated title of the asset
 * @param  {Object}             [opts]                          A set of optional parameters
 * @param  {Number[]}           [opts.categories]               The updated ids of the categories to which the asset should be associated
 * @param  {String}             [opts.description]              The updated description of the asset
 * @param  {Function}           callback                        Standard callback function
 * @param  {Asset}              callback.asset                  The updated asset
 * @throws {AssertionError}                                     Error thrown when an assertion failed
 */
var assertEditAsset = module.exports.assertEditAsset = function(client, course, id, title, opts, callback) {
  opts = opts || {};

  client.assets.editAsset(course, id, title, opts, function(err, asset) {
    assert.ifError(err);
    assert.ok(asset);
    assertAsset(asset, {'expectComments': true, 'expectCategories': true});
    assert.strictEqual(asset.title, title);

    opts.categories = opts.categories || [];
    opts.categories = _.isArray(opts.categories) ? opts.categories : [opts.categories];
    assert.strictEqual(asset.categories.length, opts.categories.length);
    _.each(asset.categories, function(category) {
      assert.ok(_.includes(opts.categories, category.id));
    });

    if (opts.description) {
      assert.strictEqual(asset.description, opts.description);
    } else {
      assert.ok(!asset.description);
    }

    return callback(asset);
  });
};

/**
 * Assert that an asset can not be edited
 *
 * @param  {RestClient}         client                          The REST client to make the request with
 * @param  {Course}             course                          The Canvas course in which the user is interacting with the API
 * @param  {Number}             id                              The id of the asset that is being edited
 * @param  {String}             title                           The updated title of the asset
 * @param  {Object}             [opts]                          A set of optional parameters
 * @param  {Number[]}           [opts.categories]               The updated ids of the categories to which the asset should be associated
 * @param  {String}             [opts.description]              The updated description of the asset
 * @param  {Number}             code                            The expected HTTP error code
 * @param  {Function}           callback                        Standard callback function
 * @param  {Asset}              callback.asset                  The updated asset
 * @throws {AssertionError}                                     Error thrown when an assertion failed
 */
var assertEditAssetFails = module.exports.assertEditAssetFails = function(client, course, id, title, opts, code, callback) {
  client.assets.editAsset(course, id, title, opts, function(err, asset) {
    assert.ok(err);
    assert.strictEqual(err.code, code);
    assert.ok(!asset);

    return callback();
  });
};

/**
 * Assert that an asset can be deleted
 *
 * @param  {RestClient}         client                          The REST client to make the request with
 * @param  {Course}             course                          The Canvas course in which the user is interacting with the API
 * @param  {Number}             id                              The id of the asset that is being deleted
 * @param  {Function}           callback                        Standard callback function
 * @throws {AssertionError}                                     Error thrown when an assertion failed
 */
var assertDeleteAsset = module.exports.assertDeleteAsset = function(client, course, id, callback) {
  client.assets.deleteAsset(course, id, function(err) {
    assert.ifError(err);

    // Verify that the asset no longer exists
    client.assets.getAsset(course, id, null, function(err, asset) {
      assert.ok(err);
      assert.strictEqual(err.code, 404);
      assert.ok(!asset);

      return callback();
    });
  });
};

/**
 * Assert that an asset can not be deleted
 *
 * @param  {RestClient}         client                          The REST client to make the request with
 * @param  {Course}             course                          The Canvas course in which the user is interacting with the API
 * @param  {Number}             id                              The id of the asset that is being deleted
 * @param  {Number}             code                            The expected HTTP error code
 * @param  {Function}           callback                        Standard callback function
 * @throws {AssertionError}                                     Error thrown when an assertion failed
 */
var assertDeleteAssetFails = module.exports.assertDeleteAssetFails = function(client, course, id, code, callback) {
  client.assets.deleteAsset(course, id, function(err) {
    assert.ok(err);
    assert.strictEqual(err.code, code);

    return callback();
  });
};

/**
 * Assert that a new comment can be created
 *
 * @param  {RestClient}         client                          The REST client to make the request with
 * @param  {Course}             course                          The Canvas course in which the user is interacting with the API
 * @param  {Number}             assetId                         The id of the asset to which the comment is added
 * @param  {String}             body                            The body of the comment
 * @param  {Number}             [parent]                        The id of the comment to which the comment is a reply
 * @param  {Function}           callback                        Standard callback function
 * @param  {Comment}            callback.comment                The created comment
 * @param  {User}               callback.comment.user           The user that created the comment
 * @throws {AssertionError}                                     Error thrown when an assertion failed
 */
var assertCreateComment = module.exports.assertCreateComment = function(client, course, assetId, body, parent, callback) {
  // Get the asset on which a comment is being made
  client.assets.getAsset(course, assetId, false, function(err, asset) {
    assert.ifError(err);
    assert.ok(asset);

    // Expected value after create
    var previousCommentCount = asset.comment_count + 1;

    // Create the comment
    client.assets.createComment(course, assetId, body, parent, function(err, comment) {
      assert.ifError(err);
      assert.ok(comment);
      assertComment(comment);
      assert.strictEqual(comment.asset_id, assetId);
      assert.strictEqual(comment.body, body);
      if (parent) {
        assert.strictEqual(comment.parent_id, parent);
      }

      // Verify that the comment count has been increased
      client.assets.getAsset(course, assetId, false, function(err, asset) {
        assert.ifError(err);
        assert.ok(asset);
        assert.strictEqual(asset.comment_count, previousCommentCount);

        return callback(comment);
      });
    });
  });
};

/**
 * Assert that an asset can be pinned
 *
 * @param  {RestClient}         client                          The REST client to make the request with
 * @param  {Course}             course                          The Canvas course in which the user is interacting with the API
 * @param  {Number}             assetId                         The id of the asset which will be pinned
 * @param  {Function}           callback                        Standard callback function
 * @throws {AssertionError}                                     Error thrown when an assertion failed
 */
var assertPinAsset = module.exports.assertPinAsset = function(client, course, assetId, callback) {
  client.assets.getAsset(course, assetId, false, function(err, asset) {
    assert.ifError(err);
    assert.ok(asset);

    var previousPinCount = asset.pins.length;

    client.assets.pin(course, asset.id, function(err) {
      assert.ifError(err);

      // Verify that the pin count has been increased
      client.assets.getAsset(course, asset.id, false, function(err, asset) {
        assert.ifError(err);
        assert.ok(asset);
        assert.ok(asset.pins);
        assert.strictEqual(asset.pins.length, previousPinCount + 1);
        return callback(asset);
      });
    });
  });
};

/**
 * Assert that an asset can be unpinned
 *
 * @param  {RestClient}         client                          The REST client to make the request with
 * @param  {Course}             course                          The Canvas course in which the user is interacting with the API
 * @param  {Number}             assetId                         The id of the asset which will be unpinned
 * @param  {Function}           callback                        Standard callback function
 * @throws {AssertionError}                                     Error thrown when an assertion failed
 */
var assertUnpinAsset = module.exports.assertUnpinAsset = function(client, course, assetId, callback) {
  // Get the asset on which a comment is being made
  client.assets.getAsset(course, assetId, false, function(err, asset) {
    assert.ifError(err);
    assert.ok(asset);

    var previousPinCount = asset.pins.length;
    assert.ok(previousPinCount);

    // Create the comment
    client.assets.unpin(course, assetId, function(err) {
      assert.ifError(err);

      // Verify that the pin count has been increased
      client.assets.getAsset(course, assetId, false, function(err, asset) {
        assert.ifError(err);
        assert.ok(asset);
        assert.strictEqual(asset.pins.length, previousPinCount - 1);

        return callback(asset);
      });
    });
  });
};

/**
 * Assert that a new comment can not be created
 *
 * @param  {RestClient}         client                          The REST client to make the request with
 * @param  {Course}             course                          The Canvas course in which the user is interacting with the API
 * @param  {Number}             assetId                         The id of the asset to which the comment is added
 * @param  {String}             body                            The body of the comment
 * @param  {Number}             [parent]                        The id of the comment to which the comment is a reply
 * @param  {Number}             code                            The expected HTTP error code
 * @param  {Function}           callback                        Standard callback function
 * @throws {AssertionError}                                     Error thrown when an assertion failed
 */
var assertCreateCommentFails = module.exports.assertCreateCommentFails = function(client, course, assetId, body, parent, code, callback) {
  client.assets.createComment(course, assetId, body, parent, function(err, comment) {
    assert.ok(err);
    assert.strictEqual(err.code, code);
    assert.ok(!comment);

    return callback();
  });
};

/**
 * Assert that a comment can be edited
 *
 * @param  {RestClient}         client                          The REST client to make the request with
 * @param  {Course}             course                          The Canvas course in which the user is interacting with the API
 * @param  {Number}             assetId                         The id of the asset to which the comment belongs
 * @param  {Number}             id                              The id of the comment that is being edited
 * @param  {String}             body                            The updated comment body
 * @param  {Function}           callback                        Standard callback function
 * @param  {Comment}            callback.comment                The updated comment
 * @param  {User}               callback.comment.user           The user that created the comment
 * @throws {AssertionError}                                     Error thrown when an assertion failed
 */
var assertEditComment = module.exports.assertEditComment = function(client, course, assetId, id, body, callback) {
  client.assets.editComment(course, assetId, id, body, function(err, comment) {
    assert.ifError(err);
    assert.ok(comment);
    assertComment(comment);
    assert.strictEqual(comment.id, id);
    assert.strictEqual(comment.body, body);

    return callback(comment);
  });
};

/**
 * Assert that a comment can not be edited
 *
 * @param  {RestClient}         client                          The REST client to make the request with
 * @param  {Course}             course                          The Canvas course in which the user is interacting with the API
 * @param  {Number}             assetId                         The id of the asset to which the comment belongs
 * @param  {Number}             id                              The id of the comment that is being edited
 * @param  {String}             body                            The updated comment body
 * @param  {Number}             code                            The expected HTTP error code
 * @param  {Function}           callback                        Standard callback function
 * @throws {AssertionError}                                     Error thrown when an assertion failed
 */
var assertEditCommentFails = module.exports.assertEditCommentFails = function(client, course, assetId, id, body, code, callback) {
  client.assets.editComment(course, assetId, id, body, function(err, comment) {
    assert.ok(err);
    assert.strictEqual(err.code, code);
    assert.ok(!comment);

    return callback();
  });
};

/**
 * Assert that a comment can be deleted
 *
 * @param  {RestClient}         client                          The REST client to make the request with
 * @param  {Course}             course                          The Canvas course in which the user is interacting with the API
 * @param  {Number}             assetId                         The id of the asset to which the comment belongs
 * @param  {Number}             id                              The id of the comment that is being deleted
 * @param  {Function}           callback                        Standard callback function
 * @throws {AssertionError}                                     Error thrown when an assertion failed
 */
var assertDeleteComment = module.exports.assertDeleteComment = function(client, course, assetId, id, callback) {
  // Verify the comment is present before it is deleted
  client.assets.getAsset(course, assetId, false, function(err, originalAsset) {
    assert.ifError(err);
    assertComment(_.find(originalAsset.comments, {'id': id}));

    client.assets.deleteComment(course, assetId, id, function(err) {
      assert.ifError(err);

      // Verify the comment is no longer present
      client.assets.getAsset(course, assetId, false, function(err, asset) {
        assert.ifError(err);
        assert.strictEqual(asset.comment_count, originalAsset.comment_count - 1);
        assert.strictEqual(asset.comments.length, originalAsset.comments.length - 1);
        assert.ok(!_.find(asset.comments, {'id': id}));

        return callback();
      });
    });
  });
};

/**
 * Assert that a comment can not be deleted
 *
 * @param  {RestClient}         client                          The REST client to make the request with
 * @param  {Course}             course                          The Canvas course in which the user is interacting with the API
 * @param  {Number}             assetId                         The id of the asset to which the comment belongs
 * @param  {Number}             id                              The id of the comment that is being deleted
 * @param  {Number}             code                            The expected HTTP error code
 * @param  {Function}           callback                        Standard callback function
 * @throws {AssertionError}                                     Error thrown when an assertion failed
 */
var assertDeleteCommentFails = module.exports.assertDeleteCommentFails = function(client, course, assetId, id, code, callback) {
  client.assets.deleteComment(course, assetId, id, function(err) {
    assert.ok(err);
    assert.strictEqual(err.code, code);

    return callback();
  });
};

/**
 * Assert unauthorized download
 *
 * @param  {RestClient}         client                          The REST client to make the request with
 * @param  {Course}             course                          The Canvas course in which the user is interacting with the API
 * @param  {Number}             assetId                         The id of the asset to download
 * @param  {Number}             code                            The expected HTTP error code
 * @param  {Function}           callback                        Standard callback function
 * @throws {AssertionError}                                     Error thrown when an assertion failed
 */
var assertAssetDownloadFails = module.exports.assertAssetDownloadFails = function(client, course, assetId, code, callback) {
  client.assets.downloadAsset(course, assetId, function(err) {
    assert.ok(err);
    assert.strictEqual(err.code, code);

    return callback();
  });
};

/**
 * Authorized download
 *
 * @param  {RestClient}         client                          The REST client to make the request with
 * @param  {Course}             course                          The Canvas course in which the user is interacting with the API
 * @param  {Number}             assetId                         The id of the asset to download
 * @param  {Function}           callback                        Standard callback function
 * @throws {AssertionError}                                     Error thrown when an assertion failed
 */
var assertAssetDownloadSucceeds = module.exports.assertAssetDownloadSucceeds = function(client, course, assetId, callback) {
  client.assets.downloadAsset(course, assetId, function(err) {
    assert.ok(!err);

    return callback();
  });
};

/**
 * Assert that an asset can be liked or disliked
 *
 * @param  {RestClient}         client                          The REST client to make the request with
 * @param  {Course}             course                          The Canvas course in which the user is interacting with the API
 * @param  {Number}             assetId                         The id of the asset that is liked or disliked
 * @param  {Boolean}            [like]                          `true` when the asset should be liked, `false` when the asset should be disliked. When `null` is provided, the previous like or dislike will be undone
 * @param  {Function}           callback                        Standard callback function
 * @throws {AssertionError}                                     Error thrown when an assertion failed
 */
var assertLike = module.exports.assertLike = function(client, course, assetId, like, callback) {
  // Retrieve the asset before the like
  assertGetAsset(client, course, assetId, null, null, function(originalAsset) {

    client.assets.like(course, assetId, like, function(err) {
      assert.ifError(err);

      // Retrieve the asset after the like
      assertGetAsset(client, course, assetId, null, null, function(asset) {
        assert.strictEqual(asset.liked, like);
        // The asset was not liked or disliked before
        if (originalAsset.liked === null) {
          if (like === null) {
            assert.strictEqual(asset.likes, originalAsset.likes);
            assert.strictEqual(asset.dislikes, originalAsset.dislikes);
          } else if (like === true) {
            assert.strictEqual(asset.likes, originalAsset.likes + 1);
            assert.strictEqual(asset.dislikes, originalAsset.dislikes);
          } else if (like === false) {
            assert.strictEqual(asset.likes, originalAsset.likes);
            assert.strictEqual(asset.dislikes, originalAsset.dislikes + 1);
          }
        // The asset was liked before
        } else if (originalAsset.liked === true) {
          if (like === null) {
            assert.strictEqual(asset.likes, originalAsset.likes - 1);
            assert.strictEqual(asset.dislikes, originalAsset.dislikes);
          } else if (like === true) {
            assert.strictEqual(asset.likes, originalAsset.likes);
            assert.strictEqual(asset.dislikes, originalAsset.dislikes);
          } else if (like === false) {
            assert.strictEqual(asset.likes, originalAsset.likes - 1);
            assert.strictEqual(asset.dislikes, originalAsset.dislikes + 1);
          }
        // The asset was disliked before
        } else if (originalAsset.liked === false) {
          if (like === null) {
            assert.strictEqual(asset.likes, originalAsset.likes);
            assert.strictEqual(asset.dislikes, originalAsset.dislikes - 1);
          } else if (like === true) {
            assert.strictEqual(asset.likes, originalAsset.likes + 1);
            assert.strictEqual(asset.dislikes, originalAsset.dislikes - 1);
          } else if (like === false) {
            assert.strictEqual(asset.likes, originalAsset.likes);
            assert.strictEqual(asset.dislikes, originalAsset.dislikes);
          }
        }

        return callback();
      });
    });
  });
};

/**
 * Assert that an asset can not be liked or disliked
 *
 * @param  {RestClient}         client                          The REST client to make the request with
 * @param  {Course}             course                          The Canvas course in which the user is interacting with the API
 * @param  {Number}             assetId                         The id of the asset that is liked or disliked
 * @param  {Boolean}            [like]                          `true` when the asset should be liked, `false` when the asset should be disliked. When `null` is provided, the previous like or dislike will be undone
 * @param  {Number}             code                            The expected HTTP error code
 * @param  {Function}           callback                        Standard callback function
 * @throws {AssertionError}                                     Error thrown when an assertion failed
 */
var assertLikeFails = module.exports.assertLikeFails = function(client, course, assetId, like, code, callback) {
  client.assets.like(course, assetId, like, function(err) {
    assert.ok(err);
    assert.strictEqual(err.code, code);

    return callback();
  });
};

/**
 * Assert that asset migration can be started
 *
 * @param  {RestClient}         client                          The REST client to make the request with
 * @param  {Course}             course                          The Canvas course in which the user is interacting with the API
 * @param  {Number}             destinationUserId               The course-associated SuiteC id of the user with which migrated assets should be associated
 * @param  {Function}           callback                        Standard callback function
 * @throws {AssertionError}                                     Error thrown when an assertion failed
 */
var assertMigrationStarts = module.exports.assertMigrationStarts = function(client, course, destinationUserId, callback) {
  client.assets.migrateAssets(course, destinationUserId, function(err, result) {
    assert.ifError(err);

    return callback();
  });
};

/**
 * Assert that an asset migration fails
 *
 * @param  {RestClient}         client                          The REST client to make the request with
 * @param  {Course}             course                          The Canvas course in which the user is interacting with the API
 * @param  {Number}             destinationUserId               The course-associated SuiteC id of the user with which migrated assets should be associated
 * @param  {Number}             code                            The expected HTTP error code
 * @param  {Function}           callback                        Standard callback function
 * @throws {AssertionError}                                     Error thrown when an assertion failed
 */
var assertMigrationFails = module.exports.assertMigrationFails = function(client, course, destinationUserId, code, callback) {
  client.assets.migrateAssets(course, destinationUserId, function(err, result) {
    assert.ok(err);
    assert.strictEqual(err.code, code);

    return callback();
  });
};

/**
 * Assert that an assets migration completes when called directly on the migration API (as opposed to the REST API, which
 * returns a response as soon as migration starts).
 *
 * @param  {RestClient}         client                          The REST client to make the request with
 * @param  {Course}             course                          The Canvas course in which the user is interacting with the API
 * @param  {Number}             destinationUserId               The course-associated SuiteC id of the user with which migrated assets should be associated
 * @param  {Number}             expectedFileCount               Number of file assets expected to migrate
 * @param  {Number}             expectedLinkCount               Number of link assets expected to migrate
 * @param  {Function}           callback                        Standard callback function
 * @throws {AssertionError}                                     Error thrown when an assertion failed
 */
var assertMigrationCompletes = module.exports.assertMigrationCompletes = function(client, course, destinationUserId, expectedFileCount, expectedLinkCount, callback) {
  UsersTestsUtil.assertGetMe(client, course, null, function(me) {
    var fromCtx = {
      'user': me,
      'course': me.course
    };
    var opts = {
      'categories': true,
      'destinationUserId': destinationUserId,
      'validateUserAccounts': true
    };

    MigrateAssetsAPI.getMigrationContexts(fromCtx, opts, function(err, toCtx, adminCtx) {
      assert.ifError(err);
      assert.ok(toCtx);
      assert.ok(adminCtx);

      MigrateAssetsAPI.migrate(fromCtx, toCtx, adminCtx, opts, function(err, result) {
        assert.ifError(err);
        assert.ok(result);

        if (expectedFileCount) {
          assert.strictEqual(result.file.success, expectedFileCount);
          assert.strictEqual(result.file.error, 0);
        }

        if (expectedLinkCount) {
          assert.strictEqual(result.link.success, expectedLinkCount);
          assert.strictEqual(result.link.error, 0);
        }

        return callback();
      });
    });
  });
};

/**
 * Assert that a migrated asset can be retrieved
 *
 * @param  {RestClient}         client                          The REST client to make the request with
 * @param  {Course}             course                          The Canvas course in which the user is interacting with the API
 * @param  {Number}             assetId                         The id for the migrated asset
 * @param  {Function}           callback                        Standard callback function
 * @throws {AssertionError}                                     Error thrown when an assertion failed
 */
var assertGetMigratedAsset = module.exports.assertGetMigratedAsset = function(client, course, assetId, categoryTitles, callback) {
  assertGetAsset(client, course, assetId, null, 0, function(migratedAsset) {
    assertAsset(migratedAsset, {'expectComments': true, 'expectedCommentCount': 0});
    assert.deepEqual(_.map(migratedAsset.categories, 'title'), categoryTitles);

    return callback();
  });
};

/**
 * Set up a new course, three users and an asset. The asset_users are user1 and user2.
 * The asset has been pinned by user2 and user3.
 *
 * @param  {Function}           callback                        Standard callback function
 * @param  {RestClient}         callback.client1                The REST client for the first user
 * @param  {RestClient}         callback.client2                The REST client for the second user
 * @param  {Course}             callback.course                 The Canvas course in which the users are interacting with the API
 * @param  {User}               callback.user1                  The first user
 * @param  {User}               callback.user2                  The second user
 * @param  {Asset}              callback.pinnedBy1              Asset pinned by user1
 * @param  {Asset}              callback.pinnedBy2              Asset pinned by user2
 * @throws {AssertionError}
 */
var setupPinnedAssets = module.exports.setupPinnedAssets = function(callback) {
  TestsUtil.getAssetLibraryClient(null, null, null, function(client1, course, user1) {
    TestsUtil.getAssetLibraryClient(null, course, null, function(client2, course, user2) {

      // Three assets per user
      TestsUtil.generateTestAssets(client1, course, 3, function(assets1) {
        TestsUtil.generateTestAssets(client2, course, 3, function(assets2) {

          // user1 will pin these assets
          var pinnedBy1 = [assets1[1], assets1[2], assets2[0]];

          assertPinAsset(client1, course, pinnedBy1[0].id, function(asset) {
            pinnedBy1[0] = asset;

            assertPinAsset(client1, course, pinnedBy1[1].id, function(asset) {
              pinnedBy1[1] = asset;

              assertPinAsset(client1, course, pinnedBy1[2].id, function(asset) {
                pinnedBy1[2] = asset;

                // user2 will pin these assets
                var pinnedBy2 = [assets1[0], assets2[1], assets2[2]];

                assertPinAsset(client2, course, pinnedBy2[0].id, function(asset) {
                  pinnedBy2[0] = asset;

                  assertPinAsset(client2, course, pinnedBy2[1].id, function(asset) {
                    pinnedBy2[1] = asset;

                    assertPinAsset(client2, course, pinnedBy2[2].id, function(asset) {
                      pinnedBy2[2] = asset;

                      return callback(client1, client2, course, user1, user2, assets1, assets2, pinnedBy1, pinnedBy2);
                    });
                  });
                });
              });
            });
          });
        });
      });
    });
  });
};

/**
 * Create a course in which Amazon S3 is used for file storage
 *
 * @param  {User}               [user]                    Optional user to be attached to the client generated
 * @param  {Function}           callback                  Standard callback function
 * @throws {AssertionError}
 */
var setUpAmazonS3BackedCourse = module.exports.setUpAmazonS3BackedCourse = function(user, callback) {
  var course = TestsUtil.generateCourse(global.tests.canvas.ucberkeley);
  var user = user || TestsUtil.generateUser(global.tests.canvas.ucberkeley);

  TestsUtil.getAssetLibraryClient(null, course, user, function(client, course, user) {
    // Course created_at date determines Amazon S3 (storage) eligibility
    var values = {
      'created_at': moment("9999-12-31", "YYYY-MM-DD").tz(config.get('timezone'))
    };
    DB.Course.update(values, {'where': {'canvas_course_id': course.id}}).complete(function(err) {
      assert.ifError(err);

      CourseTestUtil.getDbCourse(course.id, function(dbCourse) {
        // Give course the verified created_at date
        course.created_at = dbCourse.created_at;

        callback(client, course, user);
      });
    });
  });
};

/**
 * Create a bunch of impactful assets
 * @param  {Function}           callback                        Standard callback function
 * @throws {AssertionError}
 */
var setupImpactfulAssets = module.exports.setupImpactfulAssets = function(callback) {
  // Generate some users
  TestsUtil.getAssetLibraryClient(null, null, null, function(client1, course, user1) {
    TestsUtil.getAssetLibraryClient(null, course, null, function(client2, course, user2) {
      TestsUtil.getAssetLibraryClient(null, course, null, function(client3, course, user3) {
        TestsUtil.getAssetLibraryClient(null, course, null, function(client4, course, user4) {

          // User 1 creates many test assets
          TestsUtil.generateTestAssets(client1, course, 12, function(assets) {
            // Start with default 'most recent' ordering
            assets = _.sortBy(assets, 'id').reverse();

            // Generate some likes and views (each assertLike adds two views as a side effect)
            assertLike(client2, course, assets[6].id, true, function() {
              assertLike(client2, course, assets[7].id, true, function() {
                assertLike(client2, course, assets[8].id, true, function() {
                  assertLike(client3, course, assets[7].id, true, function() {
                    assertLike(client3, course, assets[8].id, true, function() {
                      assertLike(client3, course, assets[9].id, true, function() {

                        // Generate some additional views
                        assertGetAsset(client2, course, assets[0].id, null, 0, function(asset) {
                          assertGetAsset(client2, course, assets[1].id, null, 0, function(asset) {
                            assertGetAsset(client2, course, assets[2].id, null, 0, function(asset) {
                              assertGetAsset(client3, course, assets[1].id, null, 0, function(asset) {
                                assertGetAsset(client3, course, assets[2].id, null, 0, function(asset) {
                                  assertGetAsset(client4, course, assets[2].id, null, 0, function(asset) {

                                    // Pin some assets
                                    assertPinAsset(client1, course, assets[1].id, function(asset) {
                                      assets[1] = asset;

                                      assertPinAsset(client2, course, assets[2].id, function(asset) {
                                        assets[2] = asset;

                                        assertPinAsset(client3, course, assets[3].id, function(asset) {
                                          assets[3] = asset;

                                          // Generate some comments
                                          assertCreateComment(client2, course, assets[8].id, 'Comment', null, function(comment) {
                                            assertCreateComment(client2, course, assets[9].id, 'Comment', null, function(comment) {
                                              assertCreateComment(client2, course, assets[10].id, 'Comment', null, function(comment) {
                                                assertCreateComment(client3, course, assets[9].id, 'Comment', null, function(comment) {
                                                  assertCreateComment(client3, course, assets[10].id, 'Comment', null, function(comment) {
                                                    assertCreateComment(client3, course, assets[11].id, 'Comment', null, function(comment) {

                                                      // Get all assets unpaged
                                                      assertGetAssets(client1, course, null, 'recent', 12, null, 12, function(assets) {

                                                        // Return assets and client/course/user objects
                                                        return callback(assets.results, client1, client2, client3, client4, course, user1, user2, user3, user4);
                                                      });
                                                    });
                                                  });
                                                });
                                              });
                                            });
                                          });
                                        });
                                      });
                                    });
                                  });
                                });
                              });
                            });
                          });
                        });
                      });
                    });
                  });
                });
              });
            });
          });
        });
      });
    });
  });
};

/**
 * Assert that only specified assets in a given series have badges
 *
 * @param  {Asset[]}           assets                       Assets to check for badges
 * @param  {Number[]}          expectBadgesAtIndexes        Indexes of assets that should be badged (empty array if no badges expected)
 * @throws {AssertionError}
 */
var assertBadges = module.exports.assertBadges = function(assets, expectBadgesAtIndexes) {
  _.forEach(assets.results, function(asset, index) {
    if (_.includes(expectBadgesAtIndexes, index)) {
      assert.ok(asset.badged);
    } else {
      assert.ok(!asset.badged);
    }
  });
};

/**
 * Set up a new course, three users and an asset. The asset_users are user1 and user2.
 * The asset has been pinned by user2 and user3.
 *
 * @param  {Function}           callback                        Standard callback function
 * @param  {RestClient}         callback.client1                The REST client for the first user
 * @param  {RestClient}         callback.client2                The REST client for the second user
 * @param  {RestClient}         callback.client3                The REST client for the third user
 * @param  {Course}             callback.course                 The Canvas course in which the users are interacting with the API
 * @param  {User}               callback.user1                  The first user
 * @param  {User}               callback.user2                  The second user
 * @param  {User}               callback.user3                  The third user
 * @param  {Asset}              callback.asset                  The asset
 */
var createPinningScenario = module.exports.createPinningScenario = function(callback) {
  TestsUtil.getAssetLibraryClient(null, null, null, function(client1, course, user1) {
    TestsUtil.getAssetLibraryClient(null, course, null, function(client2, course, user2) {
      TestsUtil.getAssetLibraryClient(null, course, null, function(client3, course, user3) {

        // Create a whiteboard with two members, add some elements and then export the whiteboard to create asset
        UsersTestsUtil.assertGetMe(client1, course, null, function(me1) {
          UsersTestsUtil.assertGetMe(client2, course, null, function(me2) {
            WhiteboardsTestsUtil.assertCreateWhiteboard(client1, course, 'Export me', [me1.id, me2.id], function(whiteboard) {
              WhiteboardsTestsUtil.addElementsToWhiteboard(client1, course, whiteboard, function() {
                WhiteboardsTestsUtil.assertExportWhiteboardToAsset(client1, course, whiteboard.id, null, null, function(asset) {
                  // Pin it
                  assertPinAsset(client2, course, asset.id, function(asset) {
                    assertPinAsset(client3, course, asset.id, function(asset) {

                      return callback(client1, client2, client3, course, user1, user2, user3, asset);
                    });
                  });
                });
              });
            });
          });
        });
      });
    });
  });
};

/**
 * Set up a new course and two users; user1 has pinned the asset.
 *
 * @param  {RestClient}         [client1]                       The REST client for the first user, if specified
 * @param  {RestClient}         [client2]                       The REST client for the second user, if specified
 * @param  {Course}             [course]                        The Canvas course in which the users are interacting with the API, if specified
 * @param  {User}               [user1]                         The first user, if specified
 * @param  {User}               [user2]                         The second user, if specified
 * @param  {Function}           callback                        Standard callback function
 * @param  {RestClient}         callback.client1                The REST client for the first user
 * @param  {RestClient}         callback.client2                The REST client for the second user
 * @param  {Course}             callback.course                 The Canvas course in which the users are interacting with the API
 * @param  {User}               callback.user1                  The first user
 * @param  {User}               callback.user2                  The second user
 * @param  {Asset}              callback.exportedAsset          The exported whiteboard asset
 */
var setupExportedWhiteboard = module.exports.setupExportedWhiteboard = function(client1, client2, course, user1, user2, callback) {
  TestsUtil.getAssetLibraryClient(client1, course, user1, function(client1, course, user1) {
    TestsUtil.getAssetLibraryClient(client2, course, user2, function(client2, course, user2) {

      // Create a whiteboard with two members and add some elements
      UsersTestsUtil.assertGetMe(client1, course, null, function(me1) {
        UsersTestsUtil.assertGetMe(client2, course, null, function(me2) {
          WhiteboardsTestsUtil.assertCreateWhiteboard(client1, course, 'Export me', [me1.id, me2.id], function(whiteboard) {

            WhiteboardsTestsUtil.addElementsToWhiteboard(client1, course, whiteboard, function() {

              // Export whiteboard to asset
              WhiteboardsTestsUtil.assertExportWhiteboardToAsset(client1, course, whiteboard.id, null, null, function(exportedAsset) {

                return callback(client1, client2, course, user1, user2, exportedAsset);
              });
            });
          });
        });
      });
    });
  });
};

/**
 * Assert that an exported whiteboard asset can be remixed
 *
 * @param  {RestClient}         client                          The REST client to make the request with
 * @param  {Course}             course                          The Canvas course in which the user is interacting with the API
 * @param  {Asset}              asset                           The exported whiteboard asset
 * @param  {Function}           callback                        Standard callback function
 * @throws {AssertionError}                                     Error thrown when an assertion failed
 */
var assertRemixWhiteboard = module.exports.assertRemixWhiteboard = function(client, course, asset, callback) {
  client.assets.remixWhiteboard(course, asset.id, function(err, whiteboard) {
    assert.ifError(err);

    WhiteboardsTestsUtil.assertWhiteboard(whiteboard, {'expectFullWhiteboard': true});
    assert.strictEqual(whiteboard.title, asset.title);

    // Assert that all elements were copied over without alteration
    assert.strictEqual(asset.whiteboard_elements.length, whiteboard.whiteboard_elements.length);
    _.each(asset.whiteboard_elements, function(element) {
      assert.ok(_.find(whiteboard.whiteboard_elements, element));
    });

    // Assert that the requesting user is the only whiteboard member
    UsersTestsUtil.assertGetMe(client, course, null, function(me) {
      assert.strictEqual(whiteboard.members.length, 1);
      assert.strictEqual(whiteboard.members[0].id, me.id);

      return callback();
    });
  });
};

/**
 * Assert that an exported whiteboard asset cannot be remixed
 *
 * @param  {RestClient}         client                          The REST client to make the request with
 * @param  {Course}             course                          The Canvas course in which the user is interacting with the API
 * @param  {Number}             asset                           The exported whiteboard asset
 * @param  {Function}           callback                        Standard callback function
 * @param  {Number}             code                            The expected HTTP error code
 * @throws {AssertionError}                                     Error thrown when an assertion failed
 */
var assertRemixWhiteboardFails = module.exports.assertRemixWhiteboardFails = function(client, course, asset, code, callback) {
  client.assets.remixWhiteboard(course, asset.id, function(err, whiteboard) {
    assert.ok(err);
    assert.strictEqual(err.code, code);

    return callback();
  });
};

/**
 * Assert that asset (file) can be created and stored (Canvas filesystem or Amazon S3 per course created_at date)
 *
 * @param  {RestClient}         client                          The REST client to make the request with
 * @param  {Course}             course                          The Canvas course in which the user is interacting with the API
 * @param  {Number[]}           [opts.categories]               The ids of the categories to which the file should be associated
 * @param  {Function}           callback                        Standard callback function
 * @throws {AssertionError}                                     Error thrown when an assertion failed
 */
var assertFileCreateAndStorage = module.exports.assertFileCreateAndStorage = function(client, course, opts, callback) {
  var assets = [];
  // Create a file asset with no optional metadata
  assertCreateFile(client, course, 'UC Davis', getFileStream('logo-ucberkeley.png'), opts, function(asset) {
    assets.push(asset);

    // Create a file asset with no title. This should default the title to the name of the file
    assertCreateFile(client, course, null, getFileStream('logo-ucberkeley.png'), opts, function(asset) {
      assert.equal(asset.title, 'logo-ucberkeley.png');
      assets.push(asset);

      // Create a file asset with optional metadata
      var mergedOpts = _.merge(opts, {
        'description': 'University of California, Berkeley logo',
        'source': 'http://www.universityofcalifornia.edu/uc-system'
      });
      assertCreateFile(client, course, 'UC Berkeley', getFileStream('logo-ucberkeley.png'), mergedOpts, function(asset) {
        assets.push(asset);

        return callback(assets);
      });
    });
  });
};

/**
 * Mock preview service behavior by setting asset preview status directly in the database.
 *
 * @param  {Asset}              asset                           The asset to set preview data for
 * @param  {Function}           callback                        Standard callback function
 * @throws {AssertionError}                                     Error thrown when an assertion failed
 */
var mockPreviewData = module.exports.mockPreviewData = function(asset, callback) {
  DB.Asset.findByPk(asset.id).complete(function(err, asset) {
    assert.ifError(err);

    var update = {
      'previewStatus': 'done',
      'thumbnailUrl': '/img/mock.img',
      'imageUrl': '/img/mock.img',
      'metadata': {
        'image_width': 50
      }
    };
    AssetsAPI.updateAssetPreview(asset, update, callback);
  });
};

/**
 * Get a database-backed asset object given an asset id
 *
 * @param  {Number}           assetId             The id of the asset
 * @param  {Function}         callback            Invoked when the asset has been retrieved
 * @param  {Course}           callback.asset      The retrieved asset object
 * @throws {AssertionError}                       Error thrown when an assertion failed
 */
var getDbAsset = module.exports.getDbAsset = function(assetId, callback) {
  var options = {
    'where': {
      'id': assetId
    }
  };
  DB.Asset.findOne(options).complete(function(err, asset) {
    assert.ifError(err);
    assert.ok(asset);
    return callback(asset);
  });
};

/**
 * Get a database-backed user object given an user id
 *
 * @param  {Number}           userId              The id of the user
 * @param  {Function}         callback            Invoked when the user has been retrieved
 * @param  {User}             callback.user       The retrieved user object
 * @throws {AssertionError}                       Error thrown when an assertion failed
 */
var getDbUser = module.exports.getDbUser = function(userId, callback) {
  var options = {
    'where': {
      'canvas_user_id': userId
    }
  };

  DB.User.findOne(options).complete(function(err, dbUser) {
    assert.ifError(err);
    assert.ok(dbUser);

    return callback(dbUser);
  });
};

/**
 * Get a file stream
 *
 * @param  {String}   filename    The name of the file in the `data` directory
 * @return {Stream}               A readable stream to the file on disk
 */
var getFileStream = module.exports.getFileStream = function(filename) {
  return fs.createReadStream(__dirname + '/data/' + filename);
};
