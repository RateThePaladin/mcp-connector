import * as echarr from '../src/tools/echarr';
import { executeProxyRequest } from '../src/proxy';
import { waitForCondition } from '../src/utils/polling';

jest.mock('../src/proxy');
jest.mock('../src/utils/polling');

describe('Echarr Domain Tools', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('resolveEcharrApp', () => {
    it('defaults to echarr in production', () => {
      expect(echarr.resolveEcharrApp()).toBe('echarr');
      expect(echarr.resolveEcharrApp(undefined, false)).toBe('echarr');
    });

    it('resolves to echarr-dev when isDev is true', () => {
      expect(echarr.resolveEcharrApp(undefined, true)).toBe('echarr-dev');
    });

    it('preserves explicitly provided app name', () => {
      expect(echarr.resolveEcharrApp('echarr-dev')).toBe('echarr-dev');
      expect(echarr.resolveEcharrApp('ECHARR')).toBe('echarr');
    });
  });

  describe('searchSeries', () => {
    it('constructs correct query parameters and targets production by default', async () => {
      (executeProxyRequest as jest.Mock).mockResolvedValue([{ id: 's1', title: 'Test Series' }]);

      const result = await echarr.searchSeries({
        query: 'Project Hail Mary',
        limit: 5,
        select: ['id', 'title']
      });

      expect(executeProxyRequest).toHaveBeenCalledWith({
        application: 'echarr',
        host: 'node',
        method: 'GET',
        endpoint: '/api/series?q=Project+Hail+Mary&limit=5',
        select: ['id', 'title']
      });
      expect(result).toEqual([{ id: 's1', title: 'Test Series' }]);
    });

    it('targets echarr-dev when isDev is true', async () => {
      (executeProxyRequest as jest.Mock).mockResolvedValue([]);

      await echarr.searchSeries({
        query: 'Andy Weir',
        isDev: true
      });

      expect(executeProxyRequest).toHaveBeenCalledWith({
        application: 'echarr-dev',
        host: 'node',
        method: 'GET',
        endpoint: '/api/series?q=Andy+Weir',
        select: undefined
      });
    });
  });

  describe('getBookStatus', () => {
    it('calls /api/books/:id/download-status with URL-encoded bookId', async () => {
      (executeProxyRequest as jest.Mock).mockResolvedValue({ id: 'b1', isImported: true });

      const result = await echarr.getBookStatus({
        bookId: 'cmv1d64hv00s7mn07vmcwrg8n',
        isDev: true,
        select: ['book.id', 'isImported']
      });

      expect(executeProxyRequest).toHaveBeenCalledWith({
        application: 'echarr-dev',
        host: 'node',
        method: 'GET',
        endpoint: '/api/books/cmv1d64hv00s7mn07vmcwrg8n/download-status',
        select: ['book.id', 'isImported']
      });
      expect(result).toEqual({ id: 'b1', isImported: true });
    });
  });

  describe('requestBook', () => {
    it('calls POST /api/books/request with goodreadsUrl and autoGrab defaults', async () => {
      (executeProxyRequest as jest.Mock).mockResolvedValue({ ok: true });

      await echarr.requestBook({
        goodreadsUrl: 'https://www.goodreads.com/book/show/54493401',
        isDev: true
      });

      expect(executeProxyRequest).toHaveBeenCalledWith({
        application: 'echarr-dev',
        host: 'node',
        method: 'POST',
        endpoint: '/api/books/request',
        body: {
          goodreadsUrl: 'https://www.goodreads.com/book/show/54493401',
          autoGrab: true,
          monitored: true
        }
      });
    });

    it('supports title, author, and seriesTitle', async () => {
      (executeProxyRequest as jest.Mock).mockResolvedValue({ ok: true });

      await echarr.requestBook({
        title: 'Project Hail Mary',
        author: 'Andy Weir',
        seriesTitle: 'Standalone',
        autoGrab: false
      });

      expect(executeProxyRequest).toHaveBeenCalledWith({
        application: 'echarr',
        host: 'node',
        method: 'POST',
        endpoint: '/api/books/request',
        body: {
          title: 'Project Hail Mary',
          author: 'Andy Weir',
          seriesTitle: 'Standalone',
          autoGrab: false,
          monitored: true
        }
      });
    });
  });

  describe('autoGrabBook', () => {
    it('calls POST /api/books/:id/auto-grab when seriesId is not provided', async () => {
      (executeProxyRequest as jest.Mock).mockResolvedValue({ attempted: true, outcome: 'GRABBED' });

      await echarr.autoGrabBook({
        bookId: 'book-123',
        isDev: true
      });

      expect(executeProxyRequest).toHaveBeenCalledWith({
        application: 'echarr-dev',
        host: 'node',
        method: 'POST',
        endpoint: '/api/books/book-123/auto-grab',
        body: {}
      });
    });

    it('calls POST /api/series/:seriesId/books/:id/auto-grab when seriesId is provided', async () => {
      (executeProxyRequest as jest.Mock).mockResolvedValue({ attempted: true, outcome: 'GRABBED' });

      await echarr.autoGrabBook({
        bookId: 'book-123',
        seriesId: 'series-456'
      });

      expect(executeProxyRequest).toHaveBeenCalledWith({
        application: 'echarr',
        host: 'node',
        method: 'POST',
        endpoint: '/api/series/series-456/books/book-123/auto-grab',
        body: {}
      });
    });
  });

  describe('syncSeries', () => {
    it('calls POST /api/series/:id/sync-all with default boolean flags', async () => {
      (executeProxyRequest as jest.Mock).mockResolvedValue({ ok: true, plexRefreshed: true });

      await echarr.syncSeries({
        seriesId: 's1',
        isDev: true
      });

      expect(executeProxyRequest).toHaveBeenCalledWith({
        application: 'echarr-dev',
        host: 'node',
        method: 'POST',
        endpoint: '/api/series/s1/sync-all',
        body: {
          syncAudioTags: true,
          refreshPlex: true,
          syncPlaylist: true
        }
      });
    });
  });

  describe('waitForBookImport', () => {
    it('delegates to waitForCondition targeting isImported: true', async () => {
      (waitForCondition as jest.Mock).mockResolvedValue({ conditionMet: true });

      await echarr.waitForBookImport({
        bookId: 'b1',
        isDev: true,
        timeoutSeconds: 45
      });

      expect(waitForCondition).toHaveBeenCalledWith({
        application: 'echarr-dev',
        host: 'node',
        endpoint: '/api/books/b1/download-status',
        targetField: 'isImported',
        expectedValue: true,
        timeoutSeconds: 45,
        intervalMs: 1000,
        select: undefined
      });
    });
  });
});
