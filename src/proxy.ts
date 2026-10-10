import { SecretCache } from './secrets';
import { applyProjection } from './utils/projection';

export interface ProxyRequest {
  application: string;
  host: string;
  method: string;
  endpoint: string;
  body?: any;
  select?: string[];
}

// In-memory cache for temporary session tokens/cookies
const sessionCache = new Map<string, string>();

const getSecret = (key: string): string | undefined => {
  return process.env[key] || SecretCache.get(key);
};

const getSessionAuth = async (application: string, host: string, baseUrl: string, envPrefix: string): Promise<Record<string, string>> => {
  const cacheKey = `${host}_${application}`;
  
  if (application === 'qbittorrent') {
    if (sessionCache.has(cacheKey)) return { 'Cookie': sessionCache.get(cacheKey)! };
    
    // Perform login
    const username = getSecret(`${envPrefix}_USERNAME`);
    const password = getSecret(`${envPrefix}_PASSWORD`);
    
    if (!username || !password) {
      throw new Error(`Missing ${envPrefix}_USERNAME or ${envPrefix}_PASSWORD`);
    }

    const res = await fetch(`${baseUrl}/api/v2/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ username, password } as any)
    });
    
    const cookie = res.headers.get('set-cookie');
    if (cookie) {
      sessionCache.set(cacheKey, cookie);
      return { 'Cookie': cookie };
    }
  }

  // Fallback for other stateful services like Deluge or Nginx (can be implemented later)
  return {};
};

export const executeProxyRequest = async (params: ProxyRequest) => {
  const { application, host, method, endpoint, body, select } = params;
  
  const normalizedApp = application.toLowerCase();
  const envPrefix = `${host.toUpperCase()}_${application.toUpperCase().replace(/-/g, '_')}`;
  
  const baseUrl = getSecret(`${envPrefix}_URL`);

  if (!baseUrl) {
    throw new Error(`Application ${application} on host ${host} missing URL configuration (expected ${envPrefix}_URL).`);
  }

  let headers: Record<string, string> = {
    'Accept': 'application/json',
    'Content-Type': 'application/json'
  };

  // 1. Static API Keys
  if (['sonarr', 'radarr', 'overseerr', 'prowlarr', 'bazarr', 'echarr', 'echarr-dev'].includes(normalizedApp)) {
    const apiKey = getSecret(`${envPrefix}_API_KEY`);
    if (!apiKey) throw new Error(`Missing ${envPrefix}_API_KEY`);
    headers['X-Api-Key'] = apiKey;
  } else if (normalizedApp === 'plex') {
    const apiKey = getSecret(`${envPrefix}_API_KEY`);
    if (!apiKey) throw new Error(`Missing ${envPrefix}_API_KEY`);
    headers['X-Plex-Token'] = apiKey;
  } else if (normalizedApp === 'pihole') {
    // Pi-hole auth is typically sent as an auth parameter in the query string
    // Here we can inject it into the endpoint or handle it manually
  } 
  // 2. Stateful Session Auth
  else {
    const authHeaders = await getSessionAuth(normalizedApp, host, baseUrl, envPrefix);
    headers = { ...headers, ...authHeaders };
  }

  const targetUrl = new URL(`${baseUrl}${endpoint}`);
  
  if (normalizedApp === 'pihole') {
    const apiKey = getSecret(`${envPrefix}_API_KEY`);
    if (apiKey) targetUrl.searchParams.append('auth', apiKey);
  }

  console.log(`[PROXY] Executing ${method} to ${targetUrl.toString()}`);
  
  const response = await fetch(targetUrl.toString(), {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });

  const text = await response.text();
  
  try {
    const parsed = JSON.parse(text);
    if (select && select.length > 0) {
      return applyProjection(parsed, select);
    }
    return parsed;
  } catch {
    // Return raw text if not JSON
    return text;
  }
};

