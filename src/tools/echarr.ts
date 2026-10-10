import { executeProxyRequest } from '../proxy';
import { waitForCondition, PollingResult } from '../utils/polling';

export function resolveEcharrApp(app?: string, isDev?: boolean): string {
  if (app) return app.toLowerCase();
  if (isDev) return 'echarr-dev';
  return 'echarr';
}

export async function searchSeries(params: {
  query?: string;
  title?: string;
  author?: string;
  limit?: number;
  host?: string;
  app?: string;
  isDev?: boolean;
  select?: string[];
}) {
  const app = resolveEcharrApp(params.app, params.isDev);
  const host = params.host || 'node';
  const queryParams = new URLSearchParams();
  if (params.query) queryParams.set('q', params.query);
  if (params.title) queryParams.set('title', params.title);
  if (params.author) queryParams.set('author', params.author);
  if (params.limit) queryParams.set('limit', String(params.limit));

  const queryString = queryParams.toString();
  const endpoint = `/api/series${queryString ? `?${queryString}` : ''}`;
  return executeProxyRequest({
    application: app,
    host,
    method: 'GET',
    endpoint,
    select: params.select
  });
}

export async function getBookStatus(params: {
  bookId: string;
  host?: string;
  app?: string;
  isDev?: boolean;
  select?: string[];
}) {
  const app = resolveEcharrApp(params.app, params.isDev);
  const host = params.host || 'node';
  return executeProxyRequest({
    application: app,
    host,
    method: 'GET',
    endpoint: `/api/books/${encodeURIComponent(params.bookId)}/download-status`,
    select: params.select
  });
}

export async function requestBook(params: {
  goodreadsUrl?: string;
  title?: string;
  author?: string;
  seriesTitle?: string;
  autoGrab?: boolean;
  monitored?: boolean;
  host?: string;
  app?: string;
  isDev?: boolean;
}) {
  const app = resolveEcharrApp(params.app, params.isDev);
  const host = params.host || 'node';
  const body: Record<string, any> = {
    autoGrab: params.autoGrab !== undefined ? params.autoGrab : true,
    monitored: params.monitored !== undefined ? params.monitored : true
  };
  if (params.goodreadsUrl) body.goodreadsUrl = params.goodreadsUrl;
  if (params.title) body.title = params.title;
  if (params.author) body.author = params.author;
  if (params.seriesTitle) body.seriesTitle = params.seriesTitle;

  return executeProxyRequest({
    application: app,
    host,
    method: 'POST',
    endpoint: '/api/books/request',
    body
  });
}

export async function autoGrabBook(params: {
  bookId: string;
  seriesId?: string;
  host?: string;
  app?: string;
  isDev?: boolean;
}) {
  const app = resolveEcharrApp(params.app, params.isDev);
  const host = params.host || 'node';
  const endpoint = params.seriesId
    ? `/api/series/${encodeURIComponent(params.seriesId)}/books/${encodeURIComponent(params.bookId)}/auto-grab`
    : `/api/books/${encodeURIComponent(params.bookId)}/auto-grab`;

  return executeProxyRequest({
    application: app,
    host,
    method: 'POST',
    endpoint,
    body: {}
  });
}

export async function syncSeries(params: {
  seriesId: string;
  syncAudioTags?: boolean;
  refreshPlex?: boolean;
  syncPlaylist?: boolean;
  host?: string;
  app?: string;
  isDev?: boolean;
}) {
  const app = resolveEcharrApp(params.app, params.isDev);
  const host = params.host || 'node';
  const body = {
    syncAudioTags: params.syncAudioTags ?? true,
    refreshPlex: params.refreshPlex ?? true,
    syncPlaylist: params.syncPlaylist ?? true
  };
  return executeProxyRequest({
    application: app,
    host,
    method: 'POST',
    endpoint: `/api/series/${encodeURIComponent(params.seriesId)}/sync-all`,
    body
  });
}

export async function waitForBookImport(params: {
  bookId: string;
  timeoutSeconds?: number;
  intervalMs?: number;
  host?: string;
  app?: string;
  isDev?: boolean;
  select?: string[];
}): Promise<PollingResult> {
  const app = resolveEcharrApp(params.app, params.isDev);
  const host = params.host || 'node';
  return waitForCondition({
    application: app,
    host,
    endpoint: `/api/books/${encodeURIComponent(params.bookId)}/download-status`,
    targetField: 'isImported',
    expectedValue: true,
    timeoutSeconds: params.timeoutSeconds ?? 30,
    intervalMs: params.intervalMs ?? 1000,
    select: params.select
  });
}
