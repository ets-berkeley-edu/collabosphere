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

/**
 * Mock a Canvas User object
 *
 * @param  {String}   name                The name of the user
 * @param  {Number}   courseId            The id of the canvas course the user is enrolled in
 * @param  {String}   [enrollmentState]   The state of the user's enrollment. One of @{link CollabosphereConstants.ENROLLMENT_STATE}, defaults to CollabosphereConstants.ENROLLMENT_STATE.ACTIVE
 * @param  {String}   [role]              The role of the user in the course, defaults to `StudentEnrollment`
 * @param  {String}   [email]             The email of the user
 */
var CanvasUser = module.exports.CanvasUser = function(name, courseId, enrollmentState, role, email) {
  enrollmentState = enrollmentState || 'active';
  role = role || 'StudentEnrollment';
  var id = _.random(10000000);
  var that = {
    'id': id,
    'name': name,
    'sortable_name': name,
    'short_name': name.split(' ')[0],
    'email': email
  };

  // Canvas doesn't return an array of enrollment states for `complete` enrollments
  if (enrollmentState !== 'completed') {
    that.enrollments = [{
      'associated_user_id': null,
      'course_id': courseId,
      'course_section_id': 1,
      'created_at': '2014-12-22T21:58:16Z',
      'end_at': null,
      'id': _.random(1000),
      'limit_privileges_to_course_section': false,
      'root_account_id': 1,
      'start_at': null,
      'type': role,
      'updated_at': '2015-01-19T11:32:35Z',
      'user_id': id,
      'enrollment_state': enrollmentState,
      'role': role,
      'role_id': 4,
      'last_activity_at': '2015-06-17T21:19:47Z',
      'total_activity_time': 333158,
      'sis_import_id': null,
      'sis_course_id': null,
      'course_integration_id': null,
      'sis_section_id': null,
      'section_integration_id': null,
      'html_url': 'http://localhost:3000/courses/1/users/' + id
    }];
  }
  return that;
};

/**
 * Given a canvas user, get a Mocked Canvas User object as it will be returned from the Canvas REST API
 *
 * @param  {User}         user      The user for which to get a mocked Canvas user object
 * @param  {Course}       course    The course in which the user is active
 * @return {CanvasUser}             The mocked Canvas user
 */
var getCanvasUser = module.exports.getCanvasUser = function(user, course) {
  var canvasUser = new CanvasUser(user.fullName, course.id, 'active', user.roles);
  canvasUser.id = user.id;
  return canvasUser;
};

/**
 * Mock a Canvas assignment object
 *
 * @param  {Number}               courseId              The id of the Canvas course the assignment belongs to
 * @param  {CanvasSubmission[]}   submissions           The submissions that have been made for this assignment
 * @param  {String}               [name]                The name of the Canvas assignment, defaults to a randomized value
 * @param  {Boolean}              [published]           Whether the assignment is published, defaults to `true`
 * @param  {String[]}             [submissionTypes]     The types of allowed submissions, defaults to `['online_text_entry', 'online_url', 'online_upload']`
 * @return {Object}                                     A mocked Canvas assignment object
 */
var CanvasAssignment = module.exports.CanvasAssignment = function(courseId, submissions, name, published, submissionTypes) {
  submissionTypes = submissionTypes || ['online_text_entry', 'online_url', 'online_upload'];
  var id = _.random(100000000);
  if (!name) {
    name = 'Assignment ' + id;
  }
  if (published !== false) {
    published = true;
  }
  return {
    'id': id,
    'assignment_group_id': 1,
    'automatic_peer_reviews': false,
    'created_at': '2015-05-22T13:19:16Z',
    'description': '',
    'due_at': null,
    'grade_group_students_individually': false,
    'grading_standard_id': null,
    'grading_type': 'points',
    'group_category_id': null,
    'lock_at': null,
    'peer_reviews': false,
    'points_possible': 5,
    'position': 9,
    'post_to_sis': null,
    'unlock_at': null,
    'updated_at': '2015-05-22T13:19:16Z',
    'course_id': courseId,
    'name': name,
    'submission_types': submissionTypes,
    'has_submitted_submissions': !_.isEmpty(submissions),
    'muted': false,
    'html_url': 'http://localhost:3000/courses/1/assignments/10',
    'needs_grading_count': 0,
    'integration_id': null,
    'integration_data': {},
    'published': published,
    'unpublishable': true,
    'locked_for_user': false,

    // This is the only property that deviates from a regular Canvas Assignment object,
    // but it makes passing data around and mocking REST calls a bit easier if we know
    // how many submissions there are ahead of time
    'submissions': submissions
  };
};

/**
 * Mock a Canvas submission object
 *
 * @param  {Number}                   userId                The id of the Canvas user who submitted the assignment
 * @param  {String}                   type                  The submission type, one of `online_url`, `online_text_entry`, `online_upload` or `discussion_topic`
 * @param  {String|CanvasFile[]}      submissionValue       The URL, file(s), text or discussion entries of the submission
 * @param  {String}                   [workflowState]       The submission workflow state, either `submitted` or `unsubmitted`. Defaults to `submitted`
 * @return {Object}                                         A mocked Canvas submission object
 */
var CanvasSubmission = module.exports.CanvasSubmission = function(userId, type, submissionValue, workflowState) {
  workflowState = workflowState || 'submitted';

  var that = {
    'assignment_id': 9,
    'attempt': 1,
    'body': null,
    'grade': null,
    'grade_matches_current_submission': true,
    'graded_at': null,
    'grader_id': null,
    'id': 19,
    'score': null,
    'submission_type': type,
    'submitted_at': '2015-02-20T22:50:01Z',
    'user_id': userId,
    'workflow_state': workflowState,
    'late': false,
    'preview_url': 'http://localhost:3000/courses/1/assignments/9/submissions/6?preview=1'
  };

  if (type === 'online_url') {
    that.url = submissionValue;
  } else if (type === 'online_text_entry') {
    that.body = submissionValue;
  } else if (type === 'online_upload') {
    that.attachments = submissionValue;
  } else if (type === 'discussion_topic') {
    that.discussion_entries = submissionValue;
  }
  return that;
};

/**
 * Mock a Canvas file object
 *
 * @param  {String}     contentType         The mime type of the file
 * @param  {String}     displayName         A name for the file as provided by the uploader
 * @param  {String}     filename            The file name
 * @param  {Boolean}    expectProcessing    Whether this file is expected to be down- and uploaded, defaults to `true`. If `true` the necessary mocked requests will be added by the test utilities
 * @return {Object}                         A mocked Canvas file object
 */
var CanvasFile = module.exports.CanvasFile = function(contentType, displayName, filename, expectProcessing, workflowState) {
  var id = _.random(1000000);
  expectProcessing = expectProcessing || true;
  workflowState = workflowState || 'submitted';
  return {
    'id': id,
    'content-type': contentType,
    'display_name': displayName,
    'filename': filename,
    'url': 'http://localhost:3001/files/' + id + '/download?download_frd=1&verifier=5s8rxxD8BVmVXgD188QZIaEWRxoamEopJtNOC9Sw',
    'size': _.random(100000),
    'created_at': '2015-06-09T18:00:10Z',
    'updated_at': '2015-06-09T18:00:10Z',
    'unlock_at': null,
    'locked': false,
    'hidden': false,
    'lock_at': null,
    'hidden_for_user': false,
    'thumbnail_url': 'http://localhost:3000/images/thumbnails/show/' + id,
    'locked_for_user': false,
    'preview_url': null,
    'expectProcessing': expectProcessing,
    'workflow_state': workflowState
  };
};

/**
 * Mock a Canvas discussion object
 *
 * @param  {CanvasUser}                 user            The user who created the discussion
 * @param  {CanvasDiscussionEntry[]}    entries         The entries on the discussion
 * @param  {CanvasAssignment}           [assignment]    The assignment in case the discussion is an assigned discussion
 * @return {Object}                                     A mocked Canvas discussion object
 */
var CanvasDiscussion = module.exports.CanvasDiscussion = function(user, entries, assignment) {
  entries = entries || [];

  var data = {
    'assignment_id': null,
    'delayed_post_at': null,
    'discussion_type': 'threaded',
    'id': _.random(1000000),
    'last_reply_at': '2015-06-08T18:51:51Z',
    'lock_at': null,
    'podcast_has_student_posts': false,
    'position': null,
    'posted_at': '2015-06-08T18:51:51Z',
    'root_topic_id': null,
    'title': 'No no',
    'user_name': 'Simon Gaeremynck',
    'discussion_subentry_count': entries.length,
    'permissions': {
      'attach': true,
      'update': true,
      'delete': true
    },
    'message': '',
    'require_initial_post': null,
    'user_can_see_posts': true,
    'podcast_url': null,
    'read_state': 'read',
    'unread_count': 0,
    'subscribed': true,
    'topic_children': [],
    'attachments': [],
    'published': true,
    'can_unpublish': true,
    'locked': false,
    'can_lock': true,
    'author': {
      'id': user.id,
      'display_name': user.fullName,
      'avatar_image_url': 'https://canvas.instructure.com/images/messages/avatar-50.png',
      'html_url': 'http://localhost:3000/courses/3/users/1'
    },
    'html_url': 'http://localhost:3000/courses/3/discussion_topics/6',
    'url': 'http://localhost:3000/courses/3/discussion_topics/6',
    'pinned': false,
    'group_category_id': null,
    'can_group': true,
    'locked_for_user': false,
    'assignment': assignment
  };

  var that = {
    'addEntry': function(entry) {
      data.discussion_subentry_count++;

      if (entry.parent_id) {
        var parentEntry = _.find(entries, function(candidateEntry) {
          if (candidateEntry.id === entry.parent_id) {
            return true;
          } else if (_.find(candidateEntry.recent_replies, {'id': entry.parent_id})) {
            return true;
          }
        });
        if (parentEntry) {
          parentEntry.recent_replies.push(entry);
        }
      } else {
        entries.push(entry);
      }
    },
    'getEntries': function() {
      return entries;
    },
    'json': function() {
      return data;
    }
  };

  return that;
};

/**
 * Mock a Canvas discussion entry
 *
 * @param  {CanvasUser}    user          The user who created the discussion entry
 * @param  {Number}        [parentId]    The id of the parent entry in case this is a reply
 * @return {Object}                     A mocked Canvas discussion entry object
 */
var CanvasDiscussionEntry = module.exports.CanvasDiscussionEntry = function(user, parentId) {
  return {
    'created_at': '2015-06-08T18:38:26Z',
    'id': _.random(100000),
    'parent_id': parentId,
    'updated_at': '2015-06-08T18:38:26Z',
    'user_id': user.id,
    'user_name': user.fullName,
    'message': '<p>bazinga</p>',
    'read_state': 'read',
    'forced_read_state': false,
    'recent_replies': []
  };
};

/**
 * Mock a Canvas section
 *
 * @param  {CanvasUser}    user          The user who created the discussion entry
 * @param  {String}        name          The name of the section
 * @param  {Number}        courseId      The id of course
 * @return {Object}                      A mocked Canvas discussion entry object
 */
var CanvasSection = module.exports.CanvasSection = function(user, name, courseId) {
  return {
    'id': _.random(100000),
    "course_id": courseId,
    "name": name,
    "students": [
      {
        "id": user.id,
        "name": user.fullName,
        "login_id": user.email
      }
    ]
  };
};

/**
 * Mock Canvas tabs
 *
 * @param  {CanvasUser}    user          The user who created the discussion entry
 * @param  {String}        name          The name of the section
 * @param  {Number}        courseId      The id of course
 * @return {Array}                       A mocked Canvas tabs array
 */
var CanvasTabs = module.exports.CanvasTabs = function(course) {
  var baseUrlRegExp = new RegExp('.*' + course.canvas_api_domain);
  var getPartialUrl = function(url) {
    return url && url.replace(baseUrlRegExp, '');
  }
  return [
    {
      'id': 'context_external_tool_1',
      'html_url': getPartialUrl(course.assetlibrary_url),
      'full_url': course.assetlibrary_url,
      'label': 'Asset Library'
    },
    {
      'id': 'context_external_tool_2',
      'html_url': getPartialUrl(course.engagementindex_url),
      'full_url': course.engagementindex_url,
      'label': 'Engagement Index'
    },
    {
      'id': 'context_external_tool_3',
      'html_url': getPartialUrl(course.whiteboards_url),
      'full_url': course.whiteboards_url,
      'label': 'Whiteboards'
    },
    {
      'id': 'context_external_tool_4',
      'html_url': getPartialUrl(course.dashboard_url),
      'full_url': course.dashboard_url,
      'label': 'Impact Studio'
    }
  ];
};
