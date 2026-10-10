import { waitForCondition } from '../src/utils/polling';
import { executeProxyRequest } from '../src/proxy';

jest.mock('../src/proxy');

describe('Polling Utility - waitForCondition', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('resolves immediately when condition is met on the first attempt', async () => {
    (executeProxyRequest as jest.Mock).mockResolvedValue({
      id: 'book-1',
      isImported: true
    });

    const result = await waitForCondition({
      application: 'echarr',
      endpoint: '/api/books/book-1/download-status',
      targetField: 'isImported',
      expectedValue: true,
      intervalMs: 10
    });

    expect(result.conditionMet).toBe(true);
    expect(result.attempts).toBe(1);
    expect(result.currentValue).toBe(true);
    expect(result.data).toEqual({ id: 'book-1', isImported: true });
  });

  it('polls multiple times until condition is satisfied', async () => {
    (executeProxyRequest as jest.Mock)
      .mockResolvedValueOnce({
        activeDownload: { state: 'downloading' }
      })
      .mockResolvedValueOnce({
        activeDownload: { state: 'completed' }
      });

    const result = await waitForCondition({
      application: 'echarr',
      endpoint: '/api/books/book-1/download-status',
      targetField: 'activeDownload.state',
      expectedValue: 'completed',
      intervalMs: 50,
      timeoutSeconds: 2
    });

    expect(result.conditionMet).toBe(true);
    expect(result.attempts).toBe(2);
    expect(result.currentValue).toBe('completed');
  });

  it('evaluates truthy matching when expectedValue is omitted', async () => {
    (executeProxyRequest as jest.Mock)
      .mockResolvedValueOnce({ latestImport: null })
      .mockResolvedValueOnce({ latestImport: { id: 'imp-1' } });

    const result = await waitForCondition({
      application: 'echarr',
      endpoint: '/api/books/book-1/download-status',
      targetField: 'latestImport',
      intervalMs: 50,
      timeoutSeconds: 2
    });

    expect(result.conditionMet).toBe(true);
    expect(result.attempts).toBe(2);
    expect(result.currentValue).toEqual({ id: 'imp-1' });
  });

  it('times out gracefully when condition is never met', async () => {
    (executeProxyRequest as jest.Mock).mockResolvedValue({
      isImported: false
    });

    const result = await waitForCondition({
      application: 'echarr',
      endpoint: '/api/books/book-1/download-status',
      targetField: 'isImported',
      expectedValue: true,
      intervalMs: 50,
      timeoutSeconds: 0.1
    });

    expect(result.conditionMet).toBe(false);
    expect(result.attempts).toBeGreaterThanOrEqual(1);
    expect(result.currentValue).toBe(false);
  });

  it('applies projection to the returned data on match', async () => {
    (executeProxyRequest as jest.Mock).mockResolvedValue({
      id: 'book-1',
      title: 'Project Hail Mary',
      extraLarge: 'blob',
      isImported: true
    });

    const result = await waitForCondition({
      application: 'echarr',
      endpoint: '/api/books/book-1/download-status',
      targetField: 'isImported',
      expectedValue: true,
      select: ['id', 'isImported']
    });

    expect(result.conditionMet).toBe(true);
    expect(result.data).toEqual({ id: 'book-1', isImported: true });
  });
});
