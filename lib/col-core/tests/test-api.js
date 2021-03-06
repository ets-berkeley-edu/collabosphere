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

var TestsUtil = require('col-tests');
var UsersTestsUtil = require('col-users/tests/util');

var DB = require('col-core/lib/db');

describe('API authorization', function() {

  /**
   * Test that verifies that only clients that are launched through LTI are allowed
   */
  it('should only allow clients that are launched through LTI', function(callback) {
    // Get an anonymous client
    var anonymousClient = TestsUtil.getAnonymousClient();

    // Get a client that is launched into the Asset Library
    TestsUtil.getAssetLibraryClient(null, null, null, function(client, course, user) {

      // When a client hasn't gone through LTI and tries the APIs directly, a 401 should be returned
      UsersTestsUtil.assertGetMeFails(anonymousClient, course, 401, function() {

        // Clients having gone through LTI are OK
        UsersTestsUtil.assertGetMe(client, course, null, function(me) {
          return callback();
        });
      });
    });
  });
});
