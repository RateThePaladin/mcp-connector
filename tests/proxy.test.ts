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

  it('falls back to NODE_ECHARR_DEV_URL and NODE_ECHARR_DEV_API_KEY for echarr or echarr-dev', async () => {
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

  it('throws error when URL is missing', async () => {
    (SecretCache.get as jest.Mock).mockReturnValue(undefined);

    await expect(
      executeProxyRequest({
        application: 'echarr',
        host: 'node',
        method: 'GET',
        endpoint: '/health'
      })
    ).rejects.toThrow('missing URL configuration');
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
});
