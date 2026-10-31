import test from 'node:test';
import assert from 'node:assert/strict';

import {
  APP_BOOTSTRAP_VIEWER_ERROR_MESSAGE,
  deriveAppBootstrapViewerState,
  type AppBootstrapData,
} from '../lib/app/bootstrap';

const LOADED_BOOTSTRAP: AppBootstrapData = {
  viewerLoaded: true,
  viewerSummary: null,
  viewerErrorMessage: null,
  billing: null,
  featureToggles: {},
  featureTogglesLoaded: true,
  featureTogglesErrorMessage: null,
  unreadCount: 3,
  unreadCountLoaded: true,
};

test('deriveAppBootstrapViewerState resolves anonymous users immediately', () => {
  assert.deepEqual(
    deriveAppBootstrapViewerState({
      hasUser: false,
      hasBootstrapData: false,
      data: null,
    }),
    {
      loaded: true,
      resolved: true,
      error: null,
    },
  );
});

test('deriveAppBootstrapViewerState keeps valid cached viewer data authoritative during refetch errors', () => {
  const state = deriveAppBootstrapViewerState({
    hasUser: true,
    hasBootstrapData: true,
    data: LOADED_BOOTSTRAP,
    requestError: new Error('网络异常'),
  });

  assert.equal(state.loaded, true);
  assert.equal(state.resolved, true);
  assert.equal(state.error, null);
});

test('deriveAppBootstrapViewerState surfaces explicit viewer-state failures once bootstrap data settles', () => {
  const state = deriveAppBootstrapViewerState({
    hasUser: true,
    hasBootstrapData: true,
    data: {
      ...LOADED_BOOTSTRAP,
      viewerLoaded: false,
      viewerErrorMessage: APP_BOOTSTRAP_VIEWER_ERROR_MESSAGE,
    },
  });

  assert.equal(state.loaded, false);
  assert.equal(state.resolved, true);
  assert.equal(state.error?.message, APP_BOOTSTRAP_VIEWER_ERROR_MESSAGE);
});

test('deriveAppBootstrapViewerState preserves hard request failures when no viewer data is available', () => {
  const state = deriveAppBootstrapViewerState({
    hasUser: true,
    hasBootstrapData: false,
    data: null,
    requestError: new Error('请求失败'),
  });

  assert.equal(state.loaded, false);
  assert.equal(state.resolved, true);
  assert.equal(state.error?.message, '请求失败');
});
