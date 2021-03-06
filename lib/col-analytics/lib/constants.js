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

var EventTypes = module.exports = {
  asset: {
    createFile: 'Create file asset',
    createLink: 'Create link asset',
    deepLink: 'Deep link asset',
    dislike: 'Dislike asset',
    download: 'Download asset',
    edit: 'Edit asset',
    like: 'Like asset',
    openFromWhiteboard: 'Open asset from whiteboard',
    pin: 'Asset pinned on asset detail page',
    pinInList: 'Asset pinned in \'list\' view of Asset Library',
    pinOnUserProfile: 'Asset pinned on user profile page',
    unlike: 'Unlike asset',
    view: 'View asset'
  },
  assetComment: {
    create: 'Create asset comment',
    delete: 'Delete asset comment',
    edit: 'Edit asset comment'
  },
  assets: {
    deepLinkLibrary: 'Deep link Asset Library search',
    list: 'List assets',
    search: 'Search assets'
  },
  bookmarklet: {
    install: 'Install bookmarklet',
    installInstructions: 'Install bookmarklet instructions'
  },
  engagementIndex: {
    index: 'Get engagement index',
    linkTo: 'Link to Engagement Index',
    points: 'Get points configuration',
    search: 'Search engagement index',
    sort: 'Sort engagement index',
    updateShare: 'Update engagement index share'
  },
  ltiLaunch: {
    assetLibrary: 'Launch Asset Library',
    engagementIndex: 'Launch Engagement Index',
    impactStudio: 'Launch Impact Studio',
    whiteboards: 'Launch Whiteboards'
  },
  profile: {
    browseAnotherWithPagination: 'Browse another user profile using pagination feature',
    communityAssetsFilter: 'Change profile page community assets filter',
    search: 'Search for user profile',
    totalActivitiesFilter: 'Change profile page total activities filter',
    userAssetsFilter: 'Change profile page user assets filter',
    view: 'View user profile',
    zoomActivityTimeline: 'Zoom activity timeline'
  },
  whiteboard: {
    changeLayerOrder: 'Change whiteboard layer order',
    copy: 'Whiteboard copy',
    create: 'Create whiteboard',
    deepLink: 'Deep link whiteboard',
    exportAsAsset: 'Export whiteboard as asset',
    exportAsImage: 'Export whiteboard as image',
    paste: 'Whiteboard paste',
    settings: 'Edit whiteboard settings',
    view: 'Open whiteboard',
    zoom: 'Zoom whiteboard'
  },
  whiteboardChat: {
    create: 'Create whiteboard chat message',
    view: 'Get whiteboard chat messages'
  },
  whiteboardElement: {
    create: 'Add whiteboard element',
    delete: 'Delete whiteboard element',
    select: 'Select whiteboard elements',
    update: 'Update whiteboard element'
  },
  whiteboards: {
    list: 'List whiteboards',
    search: 'Search whiteboards'
  }
};
