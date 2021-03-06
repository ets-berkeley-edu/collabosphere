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
var request = require('request');
var Stream = require('stream');
var util = require('util');

var log = require('col-core/lib/logger')('col-rest');

/**
 * Set up a client with some basic functionality such as
 * the ability to make HTTP requests
 *
 * @param  {RestClient}     client      The REST client to set up
 */
var setup = module.exports.setup = function(client) {

  // Instantiate a new cookie jar for this client
  client.cookieJar = request.jar();

  // Contains the utility functions
  client.util = {};

  /**
   * Make an HTTP request to the REST API
   *
   * @param  {String}     url                     The URL to make the request to
   * @param  {String}     method                  The HTTP method to perform
   * @param  {Object}     [data]                  Any data that should be sent
   * @param  {Object}     [headers]               Any headers that should be sent, the `host` and `referer` headers will be added when they're not present
   * @param  {Function}   callback                Standard callback function
   * @param  {Object}     callback.err            An error that occurred, if any
   * @param  {String}     callback.body           The response body
   * @param  {Response}   callback.response       The full response object
   * @api private
   */
  client.request = function(url, method, data, headers, callback) {
    data = data || {};

    var requestData = {
      'method': method
    };

    // Sanitize the parameters to not include null / unspecified values
    _.each(data, function(value, key) {
      if (value === null || value === undefined) {
        delete data[key];
      } else if (_.isArray(value)) {
        // Filter out unspecified items from the parameter array, and remove it if it is empty
        value = _.compact(value);
        if (_.isEmpty(value)) {
          delete data[key];
        } else {
          data[key] = value;
        }
      }
    });

    if (!_.isEmpty(data)) {
      if (requestData.method === 'GET') {
        requestData.qs = data;
      } else {

        // Depending on the data that we have, we can either submit a URL-encoded form
        // or use multipart form uploads. We will only use the latter if there's a stream
        // or buffer present in the provided data.
        var useMultipartForms = _.some(data, function(val, key) {
          return (val instanceof Stream || Buffer.isBuffer(val));
        });

        if (useMultipartForms) {
          // requestjs is using the `form-data` library which only accepts strings,
          // streams and buffers. To avoid errors when passing in numbers or booleans,
          // we stringify everything that's not a stream or buffer
          requestData.formData = {};
          _.each(data, function(val, key) {
            if (val instanceof Stream || Buffer.isBuffer(val)) {
              requestData.formData[key] = val;
            } else {
              requestData.formData[key] = '' + val;
            }
          });
        } else {
          // Do a simple urlencoded POST
          requestData.form = data;
        }
      }
    }

    client.makeRequest(url, requestData, headers, callback);
  };

  /**
   * Make an HTTP application/json POST request to the REST API
   *
   * @param  {String}               url                     The URL to make the request to
   * @param  {Object|Object[]}      [data]                  Any data that should be sent
   * @param  {Object}               [headers]               Any headers that should be sent, the `host` and `referer` headers will be added when they're not present
   * @param  {Function}             callback                Standard callback function
   * @param  {Object}               callback.err            An error that occurred, if any
   * @param  {String}               callback.body           The response body
   * @param  {Response}             callback.response       The full response object
   * @api private
   */
  client.jsonPost = function(url, data, headers, callback) {
    data = data || {};
    headers = headers || {};
    callback = callback || function() {};

    // If no host header was specified, we set it to the configured host
    if (!headers.host) {
      headers.host = client.options.hostHeader;
    }

    // If no referer header was specified, we set it to the configured host
    if (!headers.referer) {
      if (!_.isUndefined(client.options.referer)) {
        headers.referer = client.options.referer;
      } else {
        headers.referer = util.format('%s://%s/', client.options.protocol, client.options.hostHeader);
      }
    }

    var requestData = {
      'method': 'POST',
      'json': data
    };
    client.makeRequest(url, requestData, headers, callback);
  };

  /**
   * Make an HTTP request to the REST API
   *
   * @param  {String}     url                     The URL to make the request to
   * @param  {Object}     requestData             The object that should be passed on to requestjs. The `url`, `jar`, `strictSSL`, `followRedirect` and `headers` will be set by this function. All other properties should be defined by the caller
   * @param  {Object}     [headers]               Any headers that should be sent, the `host` and `referer` headers will be added when they're not present
   * @param  {Function}   callback                Standard callback function
   * @param  {Object}     callback.err            An error that occurred, if any
   * @param  {String}     callback.body           The response body
   * @param  {Response}   callback.response       The full response object
   * @api private
   */
  client.makeRequest = function(url, requestData, headers, callback) {
    headers = headers || {};
    callback = callback || function() {};

    // If no host header was specified, we set it to the configured host
    if (!headers.host) {
      headers.host = client.options.hostHeader;
    }

    // If no referer header was specified, we set it to the configured host
    if (!headers.referer) {
      if (!_.isUndefined(client.options.referer)) {
        headers.referer = client.options.referer;
      } else {
        headers.referer = util.format('%s://%s/', client.options.protocol, client.options.hostHeader);
      }
    }

    requestData = _.extend({}, requestData, {
      'url': util.format('%s://%s%s', client.options.protocol, client.options.host, url),
      'jar': client.cookieJar,
      'strictSSL': client.options.strictSSL,
      'followRedirect': client.options.followRedirect || false,
      'headers': headers
    });

    request(requestData, function(err, response, body) {
      if (err) {
        log.error({'err': err}, 'Something went wrong trying to contact the server');
        return callback({'code': 500, 'msg': util.format('Something went wrong trying to contact the server:\n%s\n%s', err.message, err.stack)});
      } else if (response.statusCode >= 400) {
        err = {'code': response.statusCode, 'msg': body};
        log.error({'err': err}, 'Something went wrong trying to contact the server');
        return callback(err);
      }

      // Check if the response body is JSON
      try {
        body = JSON.parse(body);
      } catch (ex) {
        /* This can be ignored, response is not a JSON object */
      }

      return callback(null, body, response);
    });
  };

  /**
   * Utility wrapper around the native JS encodeURIComponent function to ensure that
   * encoding null doesn't return "null". In tests, null will often be passed in to validate
   * validation, and there's no need to catch the "null" string everywhere
   *
   * @param  {String}     uriComponent        The URL part to encode and make URL safe
   * @return {String}                         The encoded URL part. When null was passed in, this will return ''
   */
  client.util.encodeURIComponent = function(uriComponent) {
    return (uriComponent === null) ? '' : encodeURIComponent(uriComponent);
  };

  /**
   * Utility function to get the general URL prefix for each API endpoint
   *
   * @param  {Course}     course              The Canvas course in which the API request takes place
   * @return {String}                         The URL prefix to reach API endpoints on for the given Canvas course
   */
  client.util.apiPrefix = function(course) {
    return '/api/' + client.util.encodeURIComponent(course.canvas.canvas_api_domain) + '/' + client.util.encodeURIComponent(course.id);
  };
};
