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
var AWS = require('./aws-sdk-factory');
var config = require('config');
var fs = require('fs');
var log = require('./logger')('col-core/storage');
var mime = require('mime');
var moment = require('moment-timezone');
var path = require('path');
var timezone = config.get('timezone');
var url = require('url');
var util = require('util');

var s3 = AWS.S3();

/**
 * Store file in Amazon S3 and record Object Key
 *
 * @param  {Context}    courseId                The id of the current course
 * @param  {String}     filePath                The path of the file that should be uploaded
 * @param  {Function}   callback                Standard callback function
 * @param  {Object}     callback.err            An error object, if any
 * @param  {String}     callback.key            S3 Object Key of newly uploaded file
 * @param  {String}     callback.contentType    Mime-type assigned to the uploaded file
 */
var storeAsset = module.exports.storeAsset = function(courseId, filePath, callback) {
  // S3 key begins with reversed course id (padded for readability). Performance implications in URL above.
  var key = util.format('%s/%s/%s', reverseAndPad(courseId, 7), 'assets', filenameForS3(filePath, true));

  putObjectToS3(key, filePath, function(err, bucket, objectKey, contentType) {
    if (err) {
      log.error({'err': err, 'course': courseId, 'filePath': filePath}, 'Failed to upload asset (file) to AWS S3');
      return callback(err);
    }

    return callback(null, buildS3Uri(bucket, objectKey), contentType);
  });
};

/**
 * Store whiteboard image file in Amazon S3 and record Object Key
 *
 * @param  {Context}    whiteboard              The whiteboard of which image belongs
 * @param  {String}     imagePath               The path of the image that should be uploaded
 * @param  {Function}   callback                Standard callback function
 * @param  {Object}     callback.err            An error object, if any
 * @param  {String}     callback.key            S3 Object Key of newly uploaded file
 * @param  {String}     callback.contentType    Mime-type assigned to the uploaded file
 */
var storeWhiteboardImage = module.exports.storeWhiteboardImage = function(whiteboard, imagePath, callback) {
  // S3 key begins with reversed course id (padded for readability). Performance implications in URL above.
  var key = util.format('%s/%s/%d/%s', reverseAndPad(whiteboard.course_id, 7), 'whiteboard', whiteboard.id, filenameForS3(imagePath, false));

  putObjectToS3(key, imagePath, function(err, bucket, objectKey, contentType) {
    if (err) {
      log.error({'err': err, 'whiteboard': whiteboard.id, 'imagePath': imagePath}, 'Failed to upload whiteboard image file to AWS S3');
      return callback(err);
    }

    return callback(null, buildS3Uri(bucket, objectKey), contentType);
  });
};

/**
 * Get object from Amazon S3
 *
 * @param  {String}     s3Uri                       S3 address (e.g., s3://my-bucket/my-object-key)
 * @param  {Function}   callback                    Standard callback function
 * @param  {Object}     callback.data               Data returned from Amazon S3
 * @return {Object}                                 Callback return
 */
var getObject = module.exports.getObject = function(s3Uri, callback) {
  var params = getS3Params(s3Uri);

  return callback(s3.getObject(params));
};

/**
 * Get object metadata from Amazon S3
 *
 * @param  {String}     s3Uri                       S3 address (e.g., s3://my-bucket/my-object-key)
 * @param  {Function}   callback                    Standard callback function
 * @param  {Object}     callback.err                An error object, if any
 * @param  {Object}     callback.data               Metadata returned from Amazon S3
 */
var getObjectMetadata = module.exports.getObjectMetadata = function(s3Uri, callback) {
  s3.headObject(getS3Params(s3Uri), function(err, metadata) {
    if (err) {
      return callback(err);
    }

    return callback(null, metadata);
   });
};

/**
 * @param  {String}     uri         S3 address or other
 * @return {Boolean}                True URI matches s3://my-bucket/my-object-key
 */
var isS3Uri = module.exports.isS3Uri = function(uri) {
  return _.startsWith(uri, 's3://');
};

/**
 * @param  {String}     bucket              S3 bucket name
 * @param  {String}     s3ObjectKey         S3 Object Key
 * @return {String}                         S3 address (e.g., s3://my-bucket/my-object-key)
 */
var buildS3Uri = module.exports.buildS3Uri = function(bucket, s3ObjectKey) {
  return 's3://' + bucket + '/' + s3ObjectKey;
};

/**
 * @param  {String}     s3Uri          URI of object in S3 (e.g., s3://my-bucket/my-object-key)
 * @return {Object}                    Query parameters as needed by AWS S3 module
 */
var getS3Params = function(s3Uri) {
  var uriFragments = s3Uri.split('/');

  return {
    'Bucket': uriFragments[2],
    'Key': uriFragments.slice(3).join('/')
  };
};

/**
 * Return a signed URL for a file in S3, valid for the next hour
 *
 * @param  {String}  urlString
 * @return {String}
 */
var getSignedS3Url = module.exports.getSignedS3Url = function(urlString) {
  var parsedUrl = url.parse(urlString, {'parseQueryString': true});
  // If we already have a signed URL with at least an hour of life left, that will do.
  if (parsedUrl.query.Expires && (parseInt(parsedUrl.query.Expires, 10) - Math.floor(Date.now() / 1000)) > 3600) {
    return urlString;
  }
  var bucket = parsedUrl.hostname.replace(/\..*$/, '');
  var key = parsedUrl.pathname.replace(/^\//, '');
  return s3.getSignedUrl('getObject', {
    'Bucket': bucket,
    'Key': key,
    'Expires': 3600,
  });
};

/**
 * Test whether a URL points to a preview-service-generated file in S3
 *
 * @param  {String}  urlString
 * @return {Boolean}
 */
var isS3PreviewUrl = module.exports.isS3PreviewUrl = function(urlString) {
  if (urlString) {
    return !!urlString.match(/^https:\/\/suitec-preview-images-\w+.s3-us-west-2.amazonaws.com/);
  }
};

/**
 * Update signed S3 URL, if any, for an individual whiteboard element
 *
 * @param   {WhiteboardElement}  whiteboardElement
 * @return  {WhiteboardElement}
 */
var signWhiteboardElementSrc = module.exports.signWhiteboardElementSrc = function(element) {
  if (element.src && (isS3PreviewUrl(element.src))) {
    element.src = getSignedS3Url(element.src);
  }
  return element;
};

/**
 * Store file in Amazon S3
 *
 * @param  {String}     key                         Intended to be an Object Key in AWS S3
 * @param  {String}     filePath                    The path of the file that should be uploaded
 * @param  {Function}   callback                    Standard callback function
 * @param  {Object}     callback.err                An error object, if any
 * @param  {String}     callback.key                The new AWS S3 Object Key of asset
 * @param  {String}     callback.contentType        Mime-type assigned to the uploaded file
 * @api private
 */
var putObjectToS3 = function(key, filePath, callback) {
  var contentType = mime.lookup(filePath);
  var bucket = config.get('aws.s3.bucket');

  var params = {
    'Body': fs.createReadStream(filePath),
    'Bucket': bucket,
    'CacheControl': 'max-age=232000000',
    'ContentType': contentType,
    'Key': key
  };

  log.info({'key': key}, 'Put file to AWS S3');
  s3.putObject(params, function(err, data) {
    if (err) {
      log.error({'err': err, 'key': key, 'filePath': filePath}, 'Unable to put file in AWS S3');
      return callback(err);
    }

    return s3.getObject({'Bucket': bucket, 'Key': key}, function(err, url) {
      if (err) {
        var msg = 'Failed to confirm the validity of AWS S3 Object Key';

        log.error({'err': err, 'bucket': bucket, 'key': key}, msg);
        return callback({'code': 500, 'msg': msg});
      }

      return callback(null, bucket, key, contentType);
    });
  });
};

/**
 * Based on S3 best practices, we transform the id in a reproducible way
 *
 * @param  {String}     id                    Course id or similar; an identifier
 * @param  {Number}     padToLength           Desired length of result
 * @return {String}                           Deterministic transformation of id
 * @api private
 */
var reverseAndPad = function(id, padToLength) {
  // S3 key naming best practices: http://docs.aws.amazon.com/AmazonS3/latest/dev/request-rate-perf-considerations.html
  var idReversed = _.toString(id).split('').reverse().join('');
  return _.padStart(idReversed, padToLength, '0');
};

/**
 * Construct key name for Amazon S3
 *
 * @param  {String}     filePath                    The path to file on disk
 * @param  {Boolean}    prependTimestamp            If true then S3 Object Key will get timestamp in name
 * @api private
 */
var filenameForS3 = function(filePath, prependTimestamp) {
  var fileExtension = path.extname(filePath);
  var filename = path.basename(filePath, fileExtension);

  // Truncate file basename if longer than 170 characters; the complete constructed S3 URI must come in under 255.
  filename = _.snakeCase(filename.substring(0, 170)) + fileExtension;
  if (prependTimestamp) {
    var timestamp = moment().tz(timezone).format('YYYY-MM-DD_HHmmss');
    filename = timestamp + '-' + filename;
  }

  return filename;
};
