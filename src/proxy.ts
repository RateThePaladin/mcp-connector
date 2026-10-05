interface ProxyRequest {
  application: string;
  host: string;
  method: string;
  endpoint: string;
  body?: any;
}

// In-memory cache for temporary session tokens/cookies
const sessionCache = new Map<string, string>();

const getSessionAuth = async (application: string, host: string, baseUrl: string, envPrefix: string): Promise<Record<string, string>> => {
  const cacheKey = `${host}_${application}`;
  
  if (application === 'qbittorrent') {
    if (sessionCache.has(cacheKey)) return { 'Cookie': sessionCache.get(cacheKey)! };
    
    // Perform login
    const username = process.env[`${envPrefix}_USERNAME`];
    const password = process.env[`${envPrefix}_PASSWORD`];
    
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
  const { application, host, method, endpoint, body } = params;
  
  const envPrefix = `${host.toUpperCase()}_${application.toUpperCase()}`;
  const baseUrl = process.env[`${envPrefix}_URL`];

  if (!baseUrl) {
    throw new Error(`Application ${application} on host ${host} missing URL configuration (expected ${envPrefix}_URL).`);
  }

  let headers: Record<string, string> = {
    'Accept': 'application/json',
    'Content-Type': 'application/json'
  };

  // 1. Static API Keys
  if (['sonarr', 'radarr', 'overseerr', 'prowlarr', 'bazarr'].includes(application.toLowerCase())) {
    const apiKey = process.env[`${envPrefix}_API_KEY`];
    if (!apiKey) throw new Error(`Missing ${envPrefix}_API_KEY`);
    headers['X-Api-Key'] = apiKey;
  } else if (application.toLowerCase() === 'plex') {
    const apiKey = process.env[`${envPrefix}_API_KEY`];
    if (!apiKey) throw new Error(`Missing ${envPrefix}_API_KEY`);
    headers['X-Plex-Token'] = apiKey;
  } else if (application.toLowerCase() === 'pihole') {
    // Pi-hole auth is typically sent as an auth parameter in the query string
    // Here we can inject it into the endpoint or handle it manually
  } 
  // 2. Stateful Session Auth
  else {
    const authHeaders = await getSessionAuth(application.toLowerCase(), host, baseUrl, envPrefix);
    headers = { ...headers, ...authHeaders };
  }

  const targetUrl = new URL(`${baseUrl}${endpoint}`);
  
  if (application.toLowerCase() === 'pihole') {
    const apiKey = process.env[`${envPrefix}_API_KEY`];
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
    return JSON.parse(text);
  } catch {
    // Return raw text if not JSON
    return text;
  }
}
