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

var assert = require('assert');

var TestsUtil = require('col-tests');

describe('Status', function() {

  /**
   * Test that verifies that the SuiteC status is reported
   */
  it('reports SuiteC status', function(callback) {
    var anonymousClient = TestsUtil.getAnonymousClient();
    anonymousClient.core.getStatus(function(err, status, response) {
      assert.ifError(err);
      assert.ok(status);
      assert.strictEqual(status.app, true);
      assert.strictEqual(status.db, true);
      assert.strictEqual(status.poller, true);
      assert.strictEqual(status.tmp, true);
      assert.strictEqual(status.whiteboardThumbnails, true);

      return callback();
    });
  });

  /**
   * Test that verifies that the SuiteC version number is reported
   */
  it('reports SuiteC version number', function(callback) {
    var anonymousClient = TestsUtil.getAnonymousClient();
    anonymousClient.core.getVersion(function(err, version, response) {
      assert.ifError(err);
      assert.ok(version);
      assert.ok(/^\d+\.\d+\.\d+$/.test(version.version));

      return callback();
    });
  });
});
