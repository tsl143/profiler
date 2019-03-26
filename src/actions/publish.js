/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// @flow
import { compress } from '../utils/gz';
import { uploadBinaryProfileData } from '../profile-logic/profile-store';
import { serializeProfile } from '../profile-logic/process-profile';
import { sendAnalytics } from '../utils/analytics';
import { getProfile } from '../selectors/profile';
import { getUrlState } from '../selectors/url-state';
import {
  getAbortFunction,
  getUploadPhase,
  getUploadGeneration,
} from '../selectors/publish';
import { urlFromState } from '../app-logic/url-handling';
import { profilePublished } from './app';
import urlStateReducer from '../reducers/url-state';

import type { Action, ThunkAction } from '../types/store';
import type { UploadState } from '../types/state';
import type { CheckedSharingOptions } from '../types/actions';

export const toggleCheckedSharingOptions = (
  slug: $Keys<CheckedSharingOptions>
): Action => ({
  type: 'TOGGLE_CHECKED_SHARING_OPTION',
  slug,
});

export const changeUploadState = (changes: $Shape<UploadState>): Action => ({
  type: 'CHANGE_UPLOAD_STATE',
  changes,
});

/**
 * This function starts the profile sharing process. Takes an optional argument that
 * indicates if the share attempt is being made for the second time. We have two share
 * buttons, one for sharing for the first time, and one for sharing after the initial
 * share depending on the previous URL share status. People can decide to remove the
 * URLs from the profile after sharing with URLs or they can decide to add the URLs after
 * sharing without them. We check the current state before attempting to share depending
 * on that flag.
 */
export const attemptToPublish = (): ThunkAction<Promise<void>> => async (
  dispatch,
  getState
) => {
  try {
    const { abortFunction, startUpload } = uploadBinaryProfileData();
    dispatch(
      changeUploadState({
        phase: 'uploading',
        uploadProgress: 0,
        abortFunction,
      })
    );
    const uploadGeneration = getUploadGeneration(getState());

    sendAnalytics({
      hitType: 'event',
      eventCategory: 'profile upload',
      eventAction: 'start',
    });

    const profile = getProfile(getState());
    const jsonString = serializeProfile(profile);
    const typedArray = new TextEncoder().encode(jsonString);
    const gzipData: Uint8Array = await compress(typedArray.slice(0));

    if (
      getUploadPhase(getState()) !== 'uploading' ||
      uploadGeneration !== getUploadGeneration(getState())
    ) {
      // The upload could have been aborted while we were compressing the data.
      return;
    }

    // Upload the profile, and notify it with the amount of data that has been
    // uploaded.
    const hash = await startUpload(gzipData, uploadProgress => {
      dispatch(changeUploadState({ uploadProgress }));
    });

    // Generate a url, and completely drop any of the existing URL state. In
    // a future patch, we should handle this gracefully.
    const url =
      'https://profiler.firefox.com' +
      urlFromState(
        urlStateReducer(getUrlState(getState()), profilePublished(hash))
      );

    dispatch(
      changeUploadState({
        phase: 'uploaded',
        url,
      })
    );

    sendAnalytics({
      hitType: 'event',
      eventCategory: 'profile upload',
      eventAction: 'succeeded',
    });

    window.open(url, '_blank');
  } catch (error) {
    dispatch(
      changeUploadState({
        phase: 'error',
        error,
      })
    );
    sendAnalytics({
      hitType: 'event',
      eventCategory: 'profile upload',
      eventAction: 'failed',
    });
  }
};

/**
 * Abort the attempt to publish.
 */
export const abortUpload = (): ThunkAction<Promise<void>> => async (
  dispatch,
  getState
) => {
  const abort = getAbortFunction(getState());
  abort();
  dispatch(changeUploadState({ phase: 'local', uploadProgress: 0 }));

  sendAnalytics({
    hitType: 'event',
    eventCategory: 'profile upload',
    eventAction: 'aborted',
  });
};

export const resetUploadState = (): Action =>
  changeUploadState({
    phase: 'local',
  });
