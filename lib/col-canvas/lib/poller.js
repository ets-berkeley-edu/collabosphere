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
var async = require('async');
var fs = require('fs');
var moment = require('moment-timezone');
var os = require('os');
var path = require('path');
var request = require('request');
var util = require('util');

var ActivitiesAPI = require('col-activities');
var AssetsAPI = require('col-assets');
var CanvasAPI = require('./api');
var CategoriesAPI = require('col-categories');
var CollabosphereConstants = require('col-core/lib/constants');
var CourseAPI = require('col-course');
var DB = require('col-core/lib/db');
var log = require('col-core/lib/logger')('col-canvas/poller');
var Storage = require('col-core/lib/storage');
var UsersAPI = require('col-users');

// The delay between two consecutive runs
var pollingDelay = null;

// The last time we polled a course
var lastCoursePoll = Date.now();

// The number of days a course may remain inactive before being removed from the poller's cycle
var deactivationThreshold = null;

// The number of milliseconds there should be between processing two courses. This alleviates
// some of the throttling restrictions that Canvas imposes on their API
var MINIMUM_INTERVAL_BETWEEN_COURSES = 5000;

// The maximum allowed file size for an assignment submission
var MAXIMUM_ASSIGNMENT_SUBMISSION_SIZE = 1000000000;

/**
 * Getter function for the last time we polled a course
 */
var getLastCoursePoll = module.exports.getLastCoursePoll = function() {
  return lastCoursePoll;
};

/**
 * Enable the Canvas poller
 *
 * @param  {Number}   delay    The number of seconds to wait between two consecutive polling operations
 */
var enable = module.exports.enable = function(delay, threshold) {
  log.info('Enabling Canvas poller, running every %d seconds, deactivating courses after %d days without activity', delay, threshold);
  pollingDelay = delay * 1000;
  setDeactivationThreshold(threshold);

  // Start a new poller
  poll();
};

/**
 * Setter function for the deactivation threshold
 *
 * @param  {Number}  threshold  The number of days without activity after which a course should be removed from the poller's cycle
 */
 var setDeactivationThreshold = module.exports.setDeactivationThreshold = function(threshold) {
   deactivationThreshold = threshold;
 };

/**
 * Poll the Canvas REST API synchronizing users and activities
 *
 * @api private
 */
var poll = function() {
  runOnce(function(err) {
    if (err) {
      log.error({'err': err}, 'Encountered an error when polling the Canvas courses');
    }

    setTimeout(poll, pollingDelay);
  });
};

/**
 * Run the poller against all courses once
 *
 * @param  {Function}     callback    Invoked when the courses have been polled
 */
var runOnce = module.exports.runOnce = function(callback) {
  log.debug('Polling the Canvas REST API for all courses');
  var start = Date.now();

  // Get all the active courses that need to be polled
  CourseAPI.getCourses(null, null, function(err, courses) {
    if (err) {
      log.error({'err': err}, 'Failed to get all the courses, aborting poller');
      return callback(err);
    }

    // Canvas enforces a strict throttling scheme that forces us to not send more
    // than 1 request at a time. (see https://canvas.instructure.com/doc/api/file.throttling.html)
    // We achieve this by polling resources sequentially and imposing a minimum
    // delay between 2 courses
    async.eachSeries(courses, delayedHandleCourse, function(err) {
      log.info('Polling completed for %d courses, took %d ms', courses.length, (Date.now() - start));

      // Ensure that lastCoursePoll updates even if no courses are active
      lastCoursePoll = Date.now();

      return callback(err);
    });
  });
};

/**
 * Ensures that there's always at least `MINIMUM_INTERVAL_BETWEEN_COURSES`
 * milliseconds between handling 2 courses
 *
 * @param  {Course}       course        The course to handle
 * @param  {Function}     callback      Invoked when the course has been polled
 */
var delayedHandleCourse = function(course, callback) {
  // Figure out how many milliseconds we should wait before
  // handling the course
  var timeout = MINIMUM_INTERVAL_BETWEEN_COURSES - (Date.now() - lastCoursePoll);

  // Set the timeout to 0 if the previous course took longer than
  // `MINIMUM_INTERVAL_BETWEEN_COURSES` milliseconds. The course
  // will be handled in the next tick in that case
  if (timeout < 0) {
    timeout = 0
  }
  lastCoursePoll = Date.now();

  log.info({'course': course.id}, 'Will poll course in %d ms', timeout);
  setTimeout(handleCourse, timeout, course, null, callback);
};

/**
 * Poll the Canvas REST API for a specific course. Activities will be created
 * for all new assignments, discussion topics and/or discussion entries.
 *
 * Note that this function will not pass on any errors it encounters
 *
 * @param  {Course}       course                                The course to poll
 * @param  {Object}       [opts]                                Optional polling options
 * @param  {Boolean}      [opts.enableAssignmentCategories]     Whether assignments should be enabled as categories by default. Defaults to `false`
 * @param  {Function}     callback                              Invoked when the course has been polled
 */
var handleCourse = module.exports.handleCourse = function(course, opts, callback) {
  log.info({'course': course.id}, 'Polling a canvas course');

  opts = opts || {};

  var ctx = {
    'course': course,

    // Fake an admin user. At this point we can't reliably retrieve an admin from
    // the database as there might not be any yet
    'user': {
      'is_admin': true
    }
  };

  pollTabConfiguration(ctx, function(err) {
    if (err) {
      log.error({'err': err, 'course': course.id}, 'Unable to poll tab configuration, skipping further syncing for this course and moving on to the next course');

      // Swallow the error as the next course should always be attempted
      return callback();
    }

    // The course might have been inactivated after polling tab configuration.
    if (!course.active) {
      log.info('Skipping further syncing for inactive course.')
      return callback();
    }

    getAllUsers(ctx, function(err, users) {
      if (err) {
        log.error({'err': err, 'course': course.id}, 'Unable to get the users of a course, skipping further syncing for this course and moving on to the next course');

        // Swallow the error as the next course should always be attempted
        return callback();
      }

      pollAssignments(ctx, users, opts, function(err) {
        if (err) {
          log.error({'err': err, 'course': course.id}, 'Unable to poll the assignments for a course, skipping further syncing for this course and moving on to the next course');

          // Swallow the error as the next course should always be attempted
          return callback();
        }

        pollDiscussions(ctx, users, function(err) {
          if (err) {
            log.error({'err': err, 'course': course.id}, 'Unable to poll the discussions for a course, skipping further syncing for this course and moving on to the next course');

            // Swallow the error as the next course should always be attempted
            return callback();
          }

          ActivitiesAPI.getLastActivityForCourse(course.id, function(err, lastActivity) {
            if (err) {
              log.error({'err': err, 'course': course.id}, 'Unable to get last activity for a course, moving on to the next course');

              // Swallow the error as the next course should always be attempted
              return callback();
            }

            if (!deactivationThreshold) {
              return callback();
            }

            // If the course has activity and that activity is in the distant past, we continue to the deactivation step; otherwise return.
            var lastActivityTime = moment(lastActivity, 'YYYY-MM-DD HH:mm:ss.SSSSZ');
            var shouldDeactivate = lastActivityTime.isValid() && moment().diff(lastActivityTime, 'days') >= deactivationThreshold;
            if (!shouldDeactivate) {
              return callback();
            }

            log.warn({'course': course.id, 'lastActivityAt': lastActivity.updated_at}, 'Deactivating course with no recent activity');
            CourseAPI.deactivateCourse(course.id, function(err) {
              if (err) {
                // Swallow the error as the next course should always be attempted
                log.error({'err': err, 'course': course.id}, 'Could not deactivate course, moving on to the next course');
              }

              return callback();
            });
          });
        });
      });
    });
  });
};

/* Tab configuration */

/**
 * Poll tab configuration and update course data as necessary
 *
 * @param  {Context}    ctx                     Standard context containing the current user and the current course
 * @param  {Function}   callback                Standard callback function
 * @param  {Object}     callback.err            An error that occurred, if any
 * @api private
 */
var pollTabConfiguration = function(ctx, callback) {
  CanvasAPI.getCourseTabs(ctx.course, function(err, tabs) {
    if (err) {
      return callback(err);
    }

    // Keep track of any updates needed to course data.
    var courseUpdates = {};
    // Keep track of whether any SuiteC tools are currently active.
    var hasActiveTools = false;

    _.each(['assetlibrary_url', 'dashboard_url', 'engagementindex_url', 'whiteboards_url'], function(urlProperty) {
      var url = ctx.course[urlProperty];
      if (url) {
        var tabForUrl = _.find(tabs, function(tab) {
          return (tab && tab.html_url && _.endsWith(url, tab.html_url));
        });
        if (!tabForUrl || tabForUrl.hidden) {
          // This tool is either hidden or absent; remove it from the database.
          log.info({'course': ctx.course.id, 'tool': urlProperty}, 'No active tab found for tool, will remove URL from database');
          courseUpdates[urlProperty] = null;
        } else {
          // At last one SuiteC tool is active.
          hasActiveTools = true;
        }
      }
    });

    if (!hasActiveTools) {
      log.info({'course': ctx.course.id}, 'No active tab found for any SuiteC tools, will mark course as inactive');
      courseUpdates.active = false;
    };

    // Return if we have nothing to update.
    if (_.isEmpty(courseUpdates)) {
      return callback();
    }

    ctx.course.update(courseUpdates).complete(function(err, course) {
      if (err) {
        log.error({'err': err, 'course': ctx.course.id, 'updates': courseUpdates}, 'Failed to update course attributes');
        return callback({'code': 500, 'msg': err.message});
      }

      return callback();
    });
  });
}

/* Users */

/**
 * Get all the users for a course
 *
 * @param  {Context}    ctx                     Standard context containing the current user and the current course
 * @param  {Function}   callback                Standard callback function
 * @param  {Object}     callback.err            An error that occurred, if any
 * @param  {Object}     callback.users          The users in the course indexed by their `canvas_user_id` attribute. Only the `id` and `canvas_user_id` attributes are available
 * @api private
 */
var getAllUsers = function(ctx, callback) {
  // Get all the users in the course that have been persisted already
  var options = {
    'enrollmentStates': _.values(CollabosphereConstants.ENROLLMENT_STATE),
    'includeEmail': true
  };
  UsersAPI.getAllUsers(ctx, options, function(err, users) {
    if (err) {
      log.error({'err': err, 'course': ctx.course.id}, 'Failed to retrieve users of a course');
      return callback({'code': 500, 'msg': 'Failed to retrieve users of a course'});
    }

    // Index the users by their Canvas user id. This allows for quicker lookups later on
    users = _.keyBy(users, 'canvas_user_id');

    // Some students might enroll in the course later on, so we have to fetch the full set
    // of users in the course each time
    return pollUsers(ctx, users, callback);
  });
};

/**
 * Get all the enrolled users from the Canvas REST API and ensure there are corresponding
 * user objects in the database
 *
 * @param  {Context}    ctx                     Standard context containing the current user and the current course
 * @param  {Object}     users                   The previously synchronized users in the course indexed by their `canvas_user_id` attribute
 * @param  {Function}   callback                Standard callback function
 * @param  {Object}     callback.err            An error that occurred, if any
 * @param  {Object}     callback.users          The users in the course indexed by their `canvas_user_id` attribute. Only the `id` and `canvas_user_id` attributes are available
 * @api private
 */
var pollUsers = function(ctx, users, callback) {
  var options = {
    'enrollment_state': [
      CollabosphereConstants.ENROLLMENT_STATE.ACTIVE,
      CollabosphereConstants.ENROLLMENT_STATE.COMPLETED
      // TODO: Add invited users?
    ]
  };

  log.info({'course': ctx.course.id}, 'Polling Canvas users');

  CanvasAPI.getCourseUsers(ctx.course, options, function(err, canvasUsers) {
    if (err) {
      return callback(err);
    }

    log.info({'course': ctx.course.id}, 'Got ' + _.size(canvasUsers) + ' users from Canvas');

    CanvasAPI.getCourseSections(ctx.course, function(err, sections) {
      if (err) {
        return callback(err);
      }

      log.info({'course': ctx.course.id}, 'Course has ' + _.size(sections) + ' sections in Canvas');

      // Each course section, from Canvas API, contains a set of canvas_user_ids
      var userSections = {};
      _.each(sections, function(section) {
        _.each(section.students, function(user) {
          var existing = userSections[user.id];

          // Array of section names will be used for db update
          userSections[user.id] = existing ? _.concat(existing, section.name) : [section.name];
        });
      });

      // Attach sections to canvasUser
      _.each(canvasUsers, function(canvasUser) {
        canvasUser.course_sections = userSections[canvasUser.id];
      });

      // Ensure that we have a record for each Canvas user
      var userIterator = handleUser.bind(null, ctx, users);
      async.eachSeries(canvasUsers, userIterator, function(err) {
        if (err) {
          return callback(err);
        }

        // Mark the users that have been removed from the Canvas course as inactive
        var unseenUserIds = _.chain(users)
          .values()
          .filter(function(user) {
            return (user.canvas_enrollment_state !== 'inactive' && !user.seen);
          })
          .map('id')
          .value();

        if (_.isEmpty(unseenUserIds)) {
          return callback(null, users);
        }

        log.debug({
          'users': unseenUserIds,
          'course': ctx.course.id
        }, 'Marking one or more users as inactive');
        UsersAPI.updateUsers(unseenUserIds, {'canvas_enrollment_state': 'inactive'}, function(err) {
          if (err) {
            return callback(err);
          }

          return callback(null, users);
        });
      });
    });
  });
};

/**
 * Create a user account for an enrolled user if they don't have one yet
 *
 * @param  {Context}    ctx                     Standard context containing the current user and the current course
 * @param  {Object}     users                   The users in the course indexed by their `canvas_user_id` attribute. Any new users will be auto-inserted
 * @param  {Object}     canvasUser              The Canvas user object to synchronize
 * @param  {Function}   callback                Standard callback function
 * @param  {Object}     callback.err            An error that occurred, if any
 * @api private
 */
var handleUser = function(ctx, users, canvasUser, callback) {
  var enrollment = _.find(canvasUser.enrollments, {'course_id': ctx.course.canvas_course_id});

  // Default the enrollment state to "active"
  var enrollmentState = CollabosphereConstants.ENROLLMENT_STATE.ACTIVE;

  // Default the course role to "Student"
  var courseRole = 'Student';

  // If Canvas did not provided an enrollment state, it means the user completed the course
  if (!enrollment) {
    enrollmentState = CollabosphereConstants.ENROLLMENT_STATE.COMPLETED;

  } else if (enrollment) {
    // Use the enrollment state from Canvas if one was provided and matches a known state
    if (_.includes(_.values(CollabosphereConstants.ENROLLMENT_STATE), enrollment.enrollment_state)) {
      enrollmentState = enrollment.enrollment_state;
    }

    // Map anything with a Canvas `Teacher` enrollment role to the `Instructor` LTI role
    if (_.includes(CollabosphereConstants.TEACHER_ENROLLMENTS, enrollment.role)) {
      courseRole = 'urn:lti:role:ims/lis/Instructor';
    }
  }

  var image = null;
  if (canvasUser.avatar_url) {
    image = canvasUser.avatar_url;
  }

  var email = null;
  if (canvasUser.email) {
    email = canvasUser.email;
  }

  // If we've already synced the user and their information hasn't changed, we can return early
  var user = users[canvasUser.id];
  if (user &&
      user.canvas_course_role === courseRole &&
      user.canvas_course_sections === canvasUser.course_sections &&
      user.canvas_enrollment_state === enrollmentState &&
      user.canvas_full_name === canvasUser.name &&
      user.canvas_image === image &&
      user.canvas_email === email) {
    // Mark the user as seen. This allows a second pass to remove any user that wasn't seen
    users[canvasUser.id].seen = true;
    return callback();
  }

  // Otherwise we create or update a record for the user
  var defaults = {
    'canvas_course_role': courseRole,
    'canvas_course_sections': canvasUser.course_sections,
    'canvas_enrollment_state': enrollmentState,
    'canvas_full_name': canvasUser.name
  };
  if (image) {
    defaults.canvas_image = image;
  }
  if (email) {
    defaults.canvas_email = email;
  }
  UsersAPI.getOrCreateUser(canvasUser.id, ctx.course, defaults, function(err, user) {
    if (err) {
      return callback(err);
    }

    // Add the new user into the set of synchronized course users so it can be used later on
    users[canvasUser.id] = user;

    // Mark the user as seen. This allows a second pass to remove any user that wasn't seen
    users[canvasUser.id].seen = true;
    return callback();
  });
};

/* Assignments */

/**
 * Get the assignments in a course and create activities for any submissions that were made
 *
 * @param  {Context}    ctx                                   Standard context containing the current user and the current course
 * @param  {Object}     users                                 The users in the course indexed by their `canvas_user_id` attribute
 * @param  {Object}     [opts]                                Optional polling options
 * @param  {Boolean}    [opts.enableAssignmentCategories]     Whether assignments should be enabled as categories by default. Defaults to `false`
 * @param  {Function}   callback                              Standard callback function
 * @param  {Object}     callback.err                          An error that occurred, if any
 * @api private
 */
var pollAssignments = function(ctx, users, opts, callback) {

  log.info({'course': ctx.course.id}, 'Polling Canvas assignments');

  CanvasAPI.getAssignments(ctx.course, function(err, assignments) {
    if (err) {
      return callback(err);
    }

    log.info({'course': ctx.course.id}, 'Got ' + _.size(assignments) + ' assignments from Canvas');

    // Get the categories in the course
    CategoriesAPI.getCategories(ctx, true, true, function(err, categories) {
      if (err) {
        return callback(err);
      }

      // Handle submissions for each assignment
      var assignmentIterator = handleAssignment.bind(null, ctx, users, categories, opts);
      async.eachSeries(assignments, assignmentIterator, function() {

        // Re-fetch categories
        CategoriesAPI.getCategories(ctx, true, true, function(err, categories) {
          if (err) {
            return callback(err);
          }

          // Remove any empty categories no longer corresponding to an active assignment. (The usual paranoid-mode delete isn't sufficient
          // because that will prevent the category from being recreated if the assignment is later restored.)
          var categoriesToDelete = _.filter(categories, function(c) {
            return (c.canvas_assignment_id && (c.dataValues.asset_count === 0) && !_.find(assignments, {'id': c.canvas_assignment_id}))
          });

          async.eachSeries(categoriesToDelete, function(category, done) {
            CategoriesAPI.deleteCategory(ctx, category.id, {'force': true}, function(err) {
              if (err) {
                log.error({'category': category.id, 'err': err}, 'Failed to delete a category');
              }
              return done();
            });
          }, callback);
        });
      });
    });
  });
};

/**
 * Handle an assignment
 *
 * @param  {Context}          ctx                                   Standard context containing the current user and the current course
 * @param  {Object}           users                                 The users in the course indexed by their `canvas_user_id` attribute
 * @param  {Categories[]}     categories                            The categories in the course
 * @param  {Object}           [opts]                                Optional polling options
 * @param  {Boolean}          [opts.enableAssignmentCategories]     Whether assignments should be enabled as categories by default. Defaults to `false`
 * @param  {Object}           assignment                            The assignment to handle
 * @param  {Function}         callback                              Standard callback function
 * @param  {Object}           callback.err                          An error that occurred, if any
 * @api private
 */
var handleAssignment = function(ctx, users, categories, opts, assignment, callback) {
  // Ignore unpublished assignments
  if (!assignment.published) {
    return callback();

  // Don't create submission activities for assigned discussions
  } else if (!_.isEmpty(assignment.submission_types) && assignment.submission_types[0] === 'discussion_topic') {
    return callback();
  }

  handleAssignmentCategory(ctx, users, categories, assignment, opts, function(err, handleSubmissions) {
    if (err) {
      return callback(err);
    }

    if (handleSubmissions) {
      return handleAssignmentSubmissions(ctx, users, assignment, callback);
    } else {
      return callback();
    }
  });
};

/**
 * Handle the category synchronisation for an assignment, creating a new category if necessary
 *
 * @param  {Context}          ctx                                   Standard context containing the current user and the current course
 * @param  {Object}           users                                 The users in the course indexed by their `canvas_user_id` attribute
 * @param  {Categories[]}     categories                            The categories in the course
 * @param  {Object}           assignment                            The assignment to handle
 * @param  {Object}           [opts]                                Optional polling options
 * @param  {Boolean}          [opts.enableAssignmentCategories]     Whether assignments should be enabled as categories by default. Defaults to `false`
 * @param  {Function}         callback                              Standard callback function
 * @param  {Object}           callback.err                          An error that occurred, if any
 * @param  {Boolean}          callback.handleSubmissions            Whether to handle submissions for this assignment
 * @api private
 */
var handleAssignmentCategory = function(ctx, users, categories, assignment, opts, callback) {
  var category = _.find(categories, {'canvas_assignment_id': assignment.id});

  // An assignment is syncable only if it accepts submission types that are handled by SuiteC.
  var syncable = _.includes(assignment.submission_types, 'online_url') || _.includes(assignment.submission_types, 'online_upload');

  // If the assignment is not syncable and no associated category has been created, skip it.
  if (!syncable && !category) {
    log.debug({'course': ctx.course.id, 'assignment': assignment.id}, 'Skipping non-syncable assignment with no associated category');
    return callback(null, false);
  }

  // If the assignment is not syncable and the associated category exists but has no assets, forcibly remove it from the
  // database. (The usual paranoid-mode delete isn't sufficient because that will prevent the category from being recreated
  // if the assignment later becomes syncable.)
  if (!syncable && category.dataValues.asset_count === 0) {
    log.info({'course': ctx.course.id, 'category': category.id}, 'Removing a non-syncable assignment category with no assets');
    return CategoriesAPI.deleteCategory(ctx, category.id, {'force': true}, function(err) {
      if (err) {
        return callback(err);
      }

      return callback(null, false);
    });
  }

  // If the category already exists, move on to processing submissions.
  if (category && category.canvas_assignment_name === assignment.name) {
    assignment.category = category;
    return callback(null, true);

  // Update the title of the category if the name of the assignment has changed and the title is
  // still set to the assignment's old name
  } else if (category && category.canvas_assignment_name !== assignment.name) {
    var title = category.title;
    if (category.title === category.canvas_assignment_name) {
      title = assignment.name;
    }
    CategoriesAPI.editCategory(ctx, category.id, title, category.visible, assignment.name, function(err, updatedCategory) {
      if (err) {
        return callback(err);
      }

      var i = _.indexOf(categories, {'canvas_assignment_id': assignment.id});
      categories[i] = updatedCategory;
      assignment.category = updatedCategory;
      return callback(null, true);
    });

  // Create a category for an assignment if it doesn't exist yet.
  // By default, the category will be marked as not visible
  } else {
    var enableAssignmentCategories = opts.enableAssignmentCategories || false;
    CategoriesAPI.createCategory(ctx, assignment.name, enableAssignmentCategories, assignment.id, assignment.name, function(err, newCategory) {
      if (err) {
        return callback(err);
      }

      categories.push(newCategory);
      assignment.category = newCategory;
      return callback(null, true);
    });
  }
};

/**
 * Handle the submissions for an assignment
 *
 * @param  {Context}          ctx                     Standard context containing the current user and the current course
 * @param  {Object}           users                   The users in the course indexed by their `canvas_user_id` attribute
 * @param  {Object}           assignment              The assignment to handle
 * @param  {Function}         callback                Standard callback function
 * @param  {Object}           callback.err            An error that occurred, if any
 * @api private
 */
var handleAssignmentSubmissions = function(ctx, users, assignment, callback) {
  // Check submissions
  if (!assignment.has_submitted_submissions) {
    log.debug({
      'assignment': {
        'id': assignment.id,
        'name': assignment.name
      },
      'course': ctx.course.id
    }, 'Ignoring assignment as it has no submissions yet');
    return callback();
  }

  // Reduce database querying by getting all the activities
  // related to this assignment
  var objectType = CollabosphereConstants.ACTIVITY.OBJECT_TYPES.CANVAS_SUBMISSION;
  getActivities(ctx, 'submit_assignment', assignment.id, objectType, function(err, activities) {
    if (err) {
      return callback(err);
    }

    // Get all the submissions for the assignment
    CanvasAPI.getSubmissions(ctx.course, assignment, function(err, submissions) {
      if (err) {
        return callback(err);
      }

      var activeSubmissions = _.reject(submissions, function(s) {
        var pending_states = ['unsubmitted', 'pending_upload'];
        var is_pending = _.includes(pending_states, s.workflow_state);
        if (!is_pending && s.submission_type === 'online_upload' && _.size(s.attachments)) {
          // Submission is ready (ie, active) if and only if its file attachments are ready
          _.each(s.attachments, function(a) {
            if (_.includes(pending_states, a.workflow_state)) {
              is_pending = true;
              return false;
            }
          });
        }
        return is_pending;
      });
      log.info(
        {'course': ctx.course.id, 'assignment': assignment.id},
        'Got ' + _.size(submissions) + ' submissions from Canvas, will process ' + _.size(activeSubmissions) + ' active submissions'
      );

      // Keep track of newly created submission assets in order to properly handle duplicates
      var submissionAssets = {
        'byAttachmentId': {},
        'byUrl': {}
      };

      // Handle each submission
      var submissionIterator = handleSubmission.bind(null, ctx, users, assignment, activities, submissionAssets);
      async.eachSeries(activeSubmissions, submissionIterator, callback);
    });
  });
};

/**
 * Handle an assignment submission
 *
 * If we haven't seen this submission yet, we will:
 *  - Create an asset for each file/link in the submission
 *  - Create a `submit_assignment` activity for the user who made the submission
 *
 * If this is a re-submission which we haven't seen, we will:
 *  - Update the activity with the latest submission id, attempt number and the ids of the attachments
 *  - Remove assets we created in the previous submission
 *  - Create assets for the new submission
 *
 * @param  {Context}    ctx                               Standard context containing the current user and the current course
 * @param  {Object}     users                             All the users in the course, indexed by their canvas user id
 * @param  {Object}     assignment                        The assignment that the submission is for
 * @param  {Object}     activities                        All the activities for the assignment
 * @param  {Object}     submissionAssets                  Newly created submission assets for this assignment
 * @param  {Object}     submissionAssets.byAttachmentId   Newly created file assets, tracked by Canvas attachment id
 * @param  {Object}     submissionAssets.byUrl            Newly created link assets, tracked by URL
 * @param  {Object}     submission                        The submission to handle
 * @param  {Function}   callback                          Standard callback function
 * @param  {Object}     callback.err                      An error that occurred, if any
 * @api private
 */
var handleSubmission = function(ctx, users, assignment, activities, submissionAssets, submission, callback) {
  // Ignore the submission if we don't have a user object for the submitter. This can happen when
  // a user has been removed from a course after they submitted the assignment
  if (!users[submission.user_id]) {
    return callback();
  }

  var activity = {
    'type': 'submit_assignment',
    'objectId': assignment.id,
    'objectType': CollabosphereConstants.ACTIVITY.OBJECT_TYPES.CANVAS_SUBMISSION,
    'metadata': {
      'submission_id': submission.id,
      'attempt': submission.attempt,
      'file_sync_enabled': assignment.category.visible
    },
    'user': submission.user_id
  };
  getOrCreateActivity(ctx, activities, users, activity, function(err, retrievedActivity, created) {
    if (err) {
      return callback(err);

    // We've already seen this submission attempt and there's been no change in visibility settings, so we can skip processing the attachments.
    } else if (!created &&
      (retrievedActivity && retrievedActivity.metadata &&
       retrievedActivity.metadata.attempt === submission.attempt &&
       retrievedActivity.metadata.file_sync_enabled === assignment.category.visible)) {
      return callback();
    }

    // If we haven't seen this submission attempt or visibility settings have changed, mark the change in the database right away. In a failure
    // scenario, it's better to mark the change and then fail to process attachments than it would be to process attachments and then fail to mark
    // the change. The latter scenario would result in repeated attachment processing, and would keep deleting and recreating the same assets
    // in the event of a persistent failure.
    updateActivityIfNecessary(retrievedActivity, submission, assignment.category.visible, function(err) {
      if (err) {
        return callback(err);
      }

      var submissionUser = users[submission.user_id];
      var submissionUserId = _.get(submissionUser, 'id');

      // Create a context for the submitting user, to be used in activity creation.
      ctx = {
        'course': ctx.course,
        'user': submissionUser
      };

      // Retrieve any existing assets for this user and assignment ID. Hit the database directly rather than going
      // through AssetsAPI so that hidden assets will be included.
      var queryOptions = {
        'where': {
          'canvas_assignment_id': assignment.id
        },
        'attributes': ['id', 'download_url'],
        'include': {
          'model': DB.User,
          'as': 'users',
          'attributes': ['id'],
          'required': true,
          'where': {
            'id': submissionUserId
          }
        }
      };
      DB.Asset.findAll(queryOptions).complete(function(err, previousSubmissionAssets) {
        if (err) {
          return callback(err);
        }

        if (previousSubmissionAssets.length) {
          log.debug(
            {'user': submissionUserId, 'assignment': assignment.id},
            previousSubmissionAssets.length + ' previous submission assets for this user and assignment will be removed.');
        }

        // Delete any assets the user previously submitted for this assignment from the asset library.
        // Note that this won't actually delete the records from the database as we need to retain
        // activities such as liking, adding comments, etc.
        var assetIds = _.map(previousSubmissionAssets, 'id');
        AssetsAPI.deleteAssets(ctx, assetIds, function(err) {
          if (err) {
            log.error({
              'assets': assetIds,
              'err': err
            }, 'Failed to delete a set of assets from the SuiteC database');
            return callback(err);
          }

          // If sync is not enabled for this assignment, return without pulling down any new attachments.
          if (!assignment.category.visible) {
            return callback();
          }

          if (submission.submission_type === 'online_url') {
            var existingAsset = submissionAssets.byUrl[submission.url];
            if (existingAsset) {
              // If we've already seen this URL, add a new user to the existing asset
              return AssetsAPI.addUserToAsset(existingAsset, ctx.user.id, callback);

            } else {
              // If we haven't yet seen this URL, create a link asset
              log.info({'course': ctx.course.id, 'assignment': assignment.id, 'submission': submission.id}, 'Will create link asset for submission');

              var opts = {
                'assignment': assignment.id,
                'categories': [assignment.category.id],
                'skipCreateActivity': true
              };
              AssetsAPI.createLink(ctx, null, submission.url, opts, function(err, linkAsset) {
                if (linkAsset) {
                  // Track the newly created asset in case the same URL shows up again
                  submissionAssets.byUrl[submission.url] = linkAsset;
                }
                return callback(err, linkAsset);
              });
            }

          // Create a file asset for each attachment on an "upload" submission
          } else if (submission.submission_type === 'online_upload') {
            log.info({'course': ctx.course.id, 'assignment': assignment.id, 'submission': submission.id}, 'Will create file assets for submission attachments');

            var handleFilesSubmissionAttachmentIterator = handleFilesSubmissionAttachment.bind(null, ctx, assignment, submissionAssets);
            return async.eachSeries(submission.attachments, handleFilesSubmissionAttachmentIterator, callback);

          // Ignore all other types of submissions
          } else {
            return callback();
          }
        });
      });
    });
  });
};

/**
 * Update the given activity with the submission's data
 *
 * @param  {Activity}   activity             The activity to update
 * @param  {Object}     submission           The submission whose data should be persisted
 * @param  {Boolean}    fileSyncEnabled      Whether file attachments will be synced to the asset library
 * @param  {Function}   callback             Standard callback function
 * @param  {Object}     callback.err         An error that occurred, if any
 * @api private
 */
var updateActivityIfNecessary = function(activity, submission, fileSyncEnabled, callback) {
  // Update the activity with most recent attempt and sync status
  if (activity.metadata.attempt !== submission.attempt || activity.metadata.file_sync_enabled !== fileSyncEnabled) {
    var metadata = {
      'submission_id': submission.id,
      'attempt': submission.attempt,
      'file_sync_enabled': fileSyncEnabled
    };
    return ActivitiesAPI.updateActivity(activity, {'metadata': metadata}, callback);
  } else {
    return callback();
  }
};

/**
 * Download a submission's file attachment and create a file asset for it in the asset library
 *
 * @param  {Context}    ctx                               Standard context containing the current user and the current course
 * @param  {Object}     assignment                        The assignment the submission belongs to
 * @param  {Object}     submissionAssets                  Newly created submission assets for this assignment
 * @param  {Object}     submissionAssets.byAttachmentId   Newly created file assets, tracked by Canvas attachment id
 * @param  {Object}     attachment                        The attachment to create a file asset for
 * @param  {Function}   callback                          Standard callback function
 * @param  {Object}     callback.err                      An error that occurred, if any
 */
var handleFilesSubmissionAttachment = function(ctx, assignment, submissionAssets, attachment, callback) {
  // Ignore the submission if it is larger than the maximum allowed assignment submission file size
  if (attachment.size > MAXIMUM_ASSIGNMENT_SUBMISSION_SIZE) {
    return callback();
  }

  var existingAsset = submissionAssets.byAttachmentId[attachment.id];
  if (existingAsset) {
    // If we've already seen this attachment, add a new user to the existing asset and return
    return AssetsAPI.addUserToAsset(existingAsset, ctx.user.id, callback);
  }

  // Download the attachment
  var filePath = path.join(os.tmpdir(), util.format('suitec_' + attachment.id + '_' + attachment.filename));
  var fileStream = fs.createWriteStream(filePath);
  request(attachment.url).pipe(fileStream);

  fileStream.on('error', function(err) {
    log.error({'attachment': attachment}, 'Failed to download a file');

    // If a download error occurs, clean up any partial data
    fs.unlink(filePath, function(unlinkErr) {
      if (unlinkErr) {
        log.error({
          'assignment': assignment.id,
          'attachment': attachment.id,
          'err': unlinkErr
        }, 'Unable to remove the downloaded file attachment');
      }

      // Pass control back up, including the error
      return callback(err);
    });
  });

  fileStream.on('finish', function() {
    var file = {
      'file': filePath,
      'filename': path.basename(filePath),
      'mimetype': attachment['content-type']
    };
    var opts = {
      'assignment': assignment.id,
      'categories': [assignment.category.id],
      'skipCreateActivity': true
    };

    // Temporary file cleanup happens inside the createFile call and isn't needed here
    AssetsAPI.createFile(ctx, attachment.display_name, file, opts, function(err, asset) {
      if (err) {
        log.error({
          'assignment': assignment.id,
          'attachment': attachment.id,
          'err': err
        }, 'Unable to create a file asset');
      }

      if (asset) {
        // Track the newly created asset in case the same URL shows up again
        submissionAssets.byAttachmentId[attachment.id] = asset;
      }

      return callback(err);
    });
  });
};

/* Discussions */

/**
 * Create activities for any discussion activities in the Canvas course
 *
 * @param  {Context}    ctx                     Standard context containing the current user and the current course
 * @param  {Object}     users                   The users in the course indexed by their `canvas_user_id` attribute
 * @param  {Function}   callback                Standard callback function
 * @param  {Object}     callback.err            An error that occurred, if any
 * @api private
 */
var pollDiscussions = function(ctx, users, callback) {

  log.info({'course': ctx.course.id}, 'Polling Canvas discussions');

  CanvasAPI.getDiscussions(ctx.course, function(err, discussions) {
    if (err) {
      return callback(err);
    }

    log.info({'course': ctx.course.id}, 'Got ' + _.size(discussions) + ' discussions from Canvas');

    if (_.isEmpty(discussions)) {
      return callback();
    }

    // Get all the discussion activities in this course
    var types = ['discussion_topic', 'discussion_entry', 'get_discussion_entry_reply'];
    getActivities(ctx, types, null, null, function(err, activities) {
      if (err) {
        return callback(err);
      }

      // Get the comments for each discussion
      var discussionIterator = handleDiscussion.bind(null, ctx, activities, users);
      async.eachSeries(discussions, discussionIterator, callback);
    });
  });
};

/**
 * Handle a discussion topic by creating activities for the topic and its entries
 *
 * @param  {Context}    ctx                     Standard context containing the current user and the current course
 * @param  {Object}     activities              All the discussion related activities in the course
 * @param  {Object}     users                   All the users in the course indexed by their canvas user id
 * @param  {Object}     discussion              The discussion to handle
 * @param  {Function}   callback                Standard callback function
 * @param  {Object}     callback.err            An error that occurred, if any
 * @api private
 */
var handleDiscussion = function(ctx, activities, users, discussion, callback) {
  // Ignore unpublished discussions
  if (!discussion.published) {
    return callback();
  }

  createDiscussionTopicActivity(ctx, activities, users, discussion, function(err) {
    if (err) {
      return callback(err);

    // If there are no replies, we can return early
    } else if (discussion.discussion_subentry_count === 0) {
      return callback();
    }

    // Get the entries on each discussion
    CanvasAPI.getDiscussionEntries(ctx.course, discussion, function(err, entries) {
      if (err) {
        return callback(err);
      }

      log.info({'course': ctx.course.id, 'discussion': discussion.id}, 'Got ' + _.size(entries) + ' discussion entries from Canvas');

      var discussionEntryIterator = handleDiscussionEntry.bind(null, ctx, activities, users, discussion);
      async.eachSeries(entries, discussionEntryIterator, callback);
    });
  });
};

/**
 * Create an activity for a discussion topic
 *
 * @param  {Context}    ctx                     Standard context containing the current user and the current course
 * @param  {Object}     activities              All the discussion related activities in the course
 * @param  {Object}     users                   All the users in the course indexed by their canvas user id
 * @param  {Object}     discussion              The discussion to create the activity for
 * @param  {Function}   callback                Standard callback function
 * @param  {Object}     callback.err            An error that occurred, if any
 * @api private
 */
var createDiscussionTopicActivity = function(ctx, activities, users, discussion, callback) {
  // Don't create a discussion_topic for an assigned discussion as these are set up by instructors
  if (discussion.assignment) {
    return callback();
  }

  var activity = {
    'type': 'discussion_topic',
    'objectId': discussion.id,
    'objectType': CollabosphereConstants.ACTIVITY.OBJECT_TYPES.CANVAS_DISCUSSION,
    'user': discussion.author.id
  };
  return getOrCreateActivity(ctx, activities, users, activity, callback);
};

/**
 * Handle a discussion entry
 *
 * @param  {Context}    ctx                     Standard context containing the current user and the current course
 * @param  {Object}     activities              All the discussion related activities in the course
 * @param  {Object}     users                   All the users in the course indexed by their canvas user id
 * @param  {Object}     discussion              The discussion to which the entry belongs
 * @param  {Object}     entry                   The discussion entry to handle
 * @param  {Function}   callback                Standard callback function
 * @param  {Object}     callback.err            An error that occurred, if any
 * @api private
 */
var handleDiscussionEntry = function(ctx, activities, users, discussion, entry, callback) {
  createDiscussionEntryActivity(ctx, activities, users, discussion, entry, function(err) {
    if (err) {
      return callback(err);
    }

    // Handle the replies, if any
    entry.recent_replies = entry.recent_replies || [];
    var discussionEntryReplyIterator = handleDiscussionEntryReply.bind(null, ctx, activities, users, discussion, entry);
    async.eachSeries(entry.recent_replies, discussionEntryReplyIterator, callback);
  });
};

/**
 * Create an activity for a discussion entry
 *
 * @param  {Context}    ctx                     Standard context containing the current user and the current course
 * @param  {Object}     activities              All the discussion related activities in the course
 * @param  {Object}     users                   All the users in the course indexed by their canvas user id
 * @param  {Object}     discussion              The discussion to which the entry belongs
 * @param  {Object}     entry                   The discussion entry to handle
 * @param  {Function}   callback                Standard callback function
 * @param  {Object}     callback.err            An error that occurred, if any
 * @api private
 */
var createDiscussionEntryActivity = function(ctx, activities, users, discussion, entry, callback) {
  // Users creating an entry on their own topic don't earn points
  if (discussion.author.id === entry.user_id) {
    return callback();
  }

  // The entry was made on another user's topic, create an activity for it
  var activity = {
    'type': 'discussion_entry',
    'objectId': discussion.id,
    'objectType': CollabosphereConstants.ACTIVITY.OBJECT_TYPES.CANVAS_DISCUSSION,
    'user': entry.user_id,
    'metadata': {
      'entryId': entry.id
    }
  };
  getOrCreateActivity(ctx, activities, users, activity, callback);
};

/**
 * Create an activity for a reply on a discussion entry
 *
 * @param  {Context}    ctx                     Standard context containing the current user and the current course
 * @param  {Object}     activities              All the discussion related activities in the course
 * @param  {Object}     users                   All the users in the course indexed by their canvas user id
 * @param  {Object}     discussion              The discussion to which the entry belongs
 * @param  {Object}     entry                   The discussion entry to which the reply was made
 * @param  {Object}     reply                   The discussion reply to handle
 * @param  {Function}   callback                Standard callback function
 * @param  {Object}     callback.err            An error that occurred, if any
 * @api private
 */
var handleDiscussionEntryReply = function(ctx, activities, users, discussion, entry, reply, callback) {
  // Find parent entry or reply
  var parent = (reply.parent_id === entry.id) ? entry : _.find(entry.recent_replies, {'id': reply.parent_id});
  if (!parent) {
    log.debug({
      'discussionId': discussion.id,
      'entryId': entry.id,
      'reply': {
        'id': reply.id,
        'parentId': reply.parent_id
      }
    }, 'Could not find parent for a discussion reply');
    return callback();
  }

  // Users replying to their own entry or reply don't generate points
  if (reply.user_id === parent.user_id) {
    return callback();
  }

  // Create an activity for replying on a discussion
  var activity = {
    'type': 'discussion_entry',
    'objectId': discussion.id,
    'objectType': CollabosphereConstants.ACTIVITY.OBJECT_TYPES.CANVAS_DISCUSSION,
    'user': reply.user_id,
    'metadata': {
      'entryId': reply.id
    }
  };
  getOrCreateActivity(ctx, activities, users, activity, function(err, entryActivity) {
    if (err) {
      return callback(err);
    }

    // Create an activity for getting a reply
    var replyActivity = {
      'type': 'get_discussion_entry_reply',
      'objectId': discussion.id,
      'objectType': CollabosphereConstants.ACTIVITY.OBJECT_TYPES.CANVAS_DISCUSSION,
      'user': parent.user_id,
      'actor': reply.user_id,
      'metadata': {
        'entryId': reply.id
      }
    };

    if (entryActivity) {
      replyActivity.metadata.reciprocalId = entryActivity.id;
    }

    return getOrCreateActivity(ctx, activities, users, replyActivity, callback);
  });
};

/* Utilities */

/**
 * Get the activities matching a set of criteria
 *
 * @param  {Context}            ctx                         Standard context containing the current user and the current course
 * @param  {String|String[]}    type                        The activity type(s) to retrieve. One of `ActivitiesDefault`
 * @param  {Number}             [objectId]                  The id of the object on which the activity is taking place (e.g., the asset id, the comment id, etc.)
 * @param  {String}             [objectType]                The type of the object on which the activity is taking place. One of `CollabosphereConstants.ACTIVITY.OBJECT_TYPES`
 * @param  {Function}           callback                    Standard callback function
 * @param  {Object}             callback.err                An error that occurred, if any
 * @param  {Object}             callback.activities         The activities matching the criteria indexed by the Canvas user id, activity type and object id
 * @api private
 */
var getActivities = function(ctx, type, objectId, objectType, callback) {
  ActivitiesAPI.getActivities(ctx, type, objectId, objectType, function(err, activities) {
    if (err) {
      return callback(err);
    }

    // Index the activities on their Canvas user id, activity type and activity key. This allows
    // for quickly checking whether an activity has already been tracked
    var indexedActivities = {};
    _.each(activities, function(activity) {
      // Most activities are tracked by object ID; discussion entries are tracked by the combination of object ID and entry ID.
      var activityKey = null;
      if ((activity.type === 'discussion_entry') || (activity.type === 'get_discussion_entry_reply')) {
        activityKey = activity.object_id + '_' + activity.metadata.entryId;
      } else {
        activityKey = activity.object_id;
      }
      var canvasUserId = activity.user.canvas_user_id;
      indexedActivities[canvasUserId] = indexedActivities[canvasUserId] || {};
      indexedActivities[canvasUserId][activity.type] = indexedActivities[canvasUserId][activity.type] || {};
      indexedActivities[canvasUserId][activity.type][activityKey] = activity;
    });

    return callback(null, indexedActivities);
  });
};

/**
 * Create an activity when it hasn't been tracked yet
 *
 * @param  {Context}      ctx                     Standard context containing the current user and the current course
 * @param  {Object}       activities              A set of similar activities in which a lookup can be done to determine whether this activity should be created
 * @param  {Object}       users                   A mapping of canvas user ids to SuiteC users for all the users in the course
 * @param  {Object}       activity                The activity to create
 * @param  {String}       activity.type           The type of the activity
 * @param  {Number}       activity.objectId       The id of the object on which the activity is taking place (e.g., the asset id, the comment id, etc.)
 * @param  {String}       activity.objectType     The type of the object on which the activity is taking place. One of `CollabosphereConstants.ACTIVITY.OBJECT_TYPES`
 * @param  {Object}       activity.metadata       Additional metadata that is associated with the activity
 * @param  {Number}       activity.user           The Canvas id of the user earning activity points for the activity
 * @param  {Number}       [activity.actor]        The Canvas id of the user performing the activity when different than the user earning activity points
 * @param  {Function}     callback                Standard callback function
 * @param  {Object}       callback.err            An error that occurred, if any
 * @param  {Activity}     callback.activity       The created or retrieved activity
 * @param  {Boolean}      callback.created        Whether the activity was created
 * @api private
 */
var getOrCreateActivity = function(ctx, activities, users, activity, callback) {
  // Don't create an activity if we've already done so. Most activities are tracked by object ID; discussion entries are tracked
  // by the combination of object ID and entry ID.
  var activityKey = null;
  if ((activity.type === 'discussion_entry') || (activity.type === 'get_discussion_entry_reply')) {
    activityKey = activity.objectId + '_' + activity.metadata.entryId;
  } else {
    activityKey = activity.objectId;
  }
  var existingActivity = getActivity(activities, activity.user, activity.type, activityKey);
  if (existingActivity) {
    return callback(null, existingActivity, false);
  }

  // All users should map to a canvas user id.
  var user = users[activity.user];
  var actor = null;
  if (activity.actor) {
    actor = users[activity.actor];
  }

  if (!user || (activity.actor && !actor)) {
    var msg = 'A user linked with an activity could not be found. This can happen when a user has made some ' +
              'submissions or discussion entries but was removed from the course before the SuiteC ' +
              'tools were added to the course. No activity will be created!';
    log.debug({
      'activity': activity,
      'course': ctx.course.id,
      'canvas_course_id': ctx.course.canvas_course_id,
      'canvas_api_domain': ctx.course.canvas_api_domain
    }, msg);
    return callback(null, null, false);
  }

  // Create the activity
  log.info({'activity': activity}, 'Creating activity');
  ActivitiesAPI.createActivity(ctx.course, user, activity.type, activity.objectId, activity.objectType, activity.metadata, actor, function(err, activity) {
    if (err) {
      return callback(err);
    }

    return callback(null, activity, true);
  });
};

/**
 * Check whether an activity can be found in a set of indexed activities
 *
 * @param  {Object}       indexedActivities     A set of activities as returned by `getActivities`
 * @param  {Number}       canvasUserId          The Canvas id of the user who triggered the activity
 * @param  {String}       type                  The activity type
 * @param  {String}       activityKey           The key under which the activity is indexed - either the id of the object on which the activity
 *                                              is taking place (e.g., asset id, comment id), or a combination of such ids.
 * @return {Activity}                           The activity if it could be found in the set of indexed activities, `null` otherwise
 * @api private
 */
var getActivity = function(indexedActivities, canvasUserId, type, activityKey) {
  if (indexedActivities[canvasUserId] && indexedActivities[canvasUserId][type] && indexedActivities[canvasUserId][type][activityKey]) {
    return indexedActivities[canvasUserId][type][activityKey];
  } else {
    return null;
  }
};
