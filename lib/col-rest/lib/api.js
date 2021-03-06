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

var RestUtil = require('./util');

/**
 * Create a client that can talk to the REST APIs
 *
 * @param  {Object}     options                             The options that specify where the client should connect to and how
 * @param  {String}     options.protocol                    The protocol over which to connect. One of `http` or `https`
 * @param  {String}     options.host                        The host to which to connect (including the port)
 * @param  {Boolean}    [options.strictSSL]                 Whether or not SSL should be strictly enforced. This can be useful to
 *                                                          connect to QA servers which have a self-signed certificate. Defaults to `false`
 * @param  {String}     [options.authenticationStrategy]    The authentication strategy for the user. If left blank, all requests will be made anonymously. Options are `local`
 * @param  {String}     [options.hostHeader]                The host header that should be sent to the server. If left blank, `options.host` will be sent
 * @param  {String}     [options.referer]                   The referer header that should be sent to the server
 * @return {Client}                                         The client to connect with
 */
var createClient = module.exports.createClient = function(options) {
  options = options || {};
  options.protocol = options.protocol || 'http';
  options.strictSSL = options.strictSSL || false;
  options.hostHeader = options.hostHeader || options.host;

  // Create an anonymous client
  return createAnonymousClient(options);
};

/**
 * Create an anonymous REST client
 *
 * @param  {Object}         options     The options that specify where the client should connect to and how
 * @return {RestClient}                 An anonymous REST client
 * @see createClient for more information about the `options`
 * @api private
 */
var createAnonymousClient = function(options) {
  var client = {
    'options': options
  };

  // Expose some logic to make raw requests
  RestUtil.setup(client);

  // Add all the REST api logic
  require('./rest/activities')(client);
  require('./rest/assets')(client);
  require('./rest/categories')(client);
  require('./rest/config')(client);
  require('./rest/core')(client);
  require('./rest/course')(client);
  require('./rest/events')(client);
  require('./rest/lti')(client);
  require('./rest/users')(client);
  require('./rest/whiteboards')(client);

  return client;
};
