import { executeProxyRequest } from '../src/proxy';
import { SecretCache } from '../src/secrets';

jest.mock('../src/secrets');

describe('Proxy Module - executeProxyRequest', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('authenticates echarr request with X-Api-Key from SecretCache', async () => {
    (SecretCache.get as jest.Mock).mockImplementation((key: string) => {
      if (key === 'NODE_ECHARR_URL') return 'http://127.0.0.1:8788';
      if (key === 'NODE_ECHARR_API_KEY') return 'test-echarr-api-key';
      return undefined;
    });

    const mockFetch = jest.fn().mockResolvedValue({
      text: jest.fn().mockResolvedValue(JSON.stringify({ ok: true }))
    });
    global.fetch = mockFetch as any;

    const result = await executeProxyRequest({
      application: 'echarr',
      host: 'node',
      method: 'GET',
      endpoint: '/health'
    });

    expect(mockFetch).toHaveBeenCalledWith('http://127.0.0.1:8788/health', {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Api-Key': 'test-echarr-api-key'
      },
      body: undefined
    });
    expect(result).toEqual({ ok: true });
  });

  it('authenticates echarr-dev request strictly with NODE_ECHARR_DEV_* secrets', async () => {
    (SecretCache.get as jest.Mock).mockImplementation((key: string) => {
      if (key === 'NODE_ECHARR_DEV_URL') return 'http://192.168.7.107:8788';
      if (key === 'NODE_ECHARR_DEV_API_KEY') return 'test-dev-key';
      return undefined;
    });

    const mockFetch = jest.fn().mockResolvedValue({
      text: jest.fn().mockResolvedValue(JSON.stringify({ ok: true }))
    });
    global.fetch = mockFetch as any;

    const result = await executeProxyRequest({
      application: 'echarr-dev',
      host: 'node',
      method: 'GET',
      endpoint: '/health'
    });

    expect(mockFetch).toHaveBeenCalledWith('http://192.168.7.107:8788/health', {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Api-Key': 'test-dev-key'
      },
      body: undefined
    });
    expect(result).toEqual({ ok: true });
  });

  it('does NOT fall back to echarr when echarr-dev URL is missing', async () => {
    (SecretCache.get as jest.Mock).mockImplementation((key: string) => {
      if (key === 'NODE_ECHARR_URL') return 'http://127.0.0.1:8788';
      if (key === 'NODE_ECHARR_API_KEY') return 'test-prod-key';
      return undefined;
    });

    await expect(
      executeProxyRequest({
        application: 'echarr-dev',
        host: 'node',
        method: 'GET',
        endpoint: '/health'
      })
    ).rejects.toThrow('expected NODE_ECHARR_DEV_URL');
  });

  it('does NOT fall back to echarr-dev when echarr URL is missing', async () => {
    (SecretCache.get as jest.Mock).mockImplementation((key: string) => {
      if (key === 'NODE_ECHARR_DEV_URL') return 'http://192.168.7.107:8788';
      if (key === 'NODE_ECHARR_DEV_API_KEY') return 'test-dev-key';
      return undefined;
    });

    await expect(
      executeProxyRequest({
        application: 'echarr',
        host: 'node',
        method: 'GET',
        endpoint: '/health'
      })
    ).rejects.toThrow('expected NODE_ECHARR_URL');
  });

  it('throws error when API key is missing for echarr', async () => {
    (SecretCache.get as jest.Mock).mockImplementation((key: string) => {
      if (key === 'NODE_ECHARR_URL') return 'http://127.0.0.1:8788';
      return undefined;
    });

    await expect(
      executeProxyRequest({
        application: 'echarr',
        host: 'node',
        method: 'GET',
        endpoint: '/health'
      })
    ).rejects.toThrow('Missing NODE_ECHARR_API_KEY');
  });

  it('applies select field projection to returned JSON', async () => {
    (SecretCache.get as jest.Mock).mockImplementation((key: string) => {
      if (key === 'NODE_ECHARR_URL') return 'http://127.0.0.1:8788';
      if (key === 'NODE_ECHARR_API_KEY') return 'test-echarr-api-key';
      return undefined;
    });

    const mockFetch = jest.fn().mockResolvedValue({
      text: jest.fn().mockResolvedValue(JSON.stringify([
        { id: '1', title: 'Book 1', author: 'Author 1', extra: 'huge payload' },
        { id: '2', title: 'Book 2', author: 'Author 2', extra: 'huge payload' }
      ]))
    });
    global.fetch = mockFetch as any;

    const result = await executeProxyRequest({
      application: 'echarr',
      host: 'node',
      method: 'GET',
      endpoint: '/api/series',
      select: ['id', 'title']
    });

    expect(result).toEqual([
      { id: '1', title: 'Book 1' },
      { id: '2', title: 'Book 2' }
    ]);
  });
});
