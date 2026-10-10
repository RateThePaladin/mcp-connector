import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import fs from 'fs';
import path from 'path';
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { authMiddleware } from './auth';
import { executeOnHost } from './ssh';
import { executeProxyRequest } from './proxy';
import { waitForCondition } from './utils/polling';
import * as echarr from './tools/echarr';
import { OAuth2Client } from 'google-auth-library';
import jwt from 'jsonwebtoken';
import { SecretCache } from './secrets';

const oauthClient = new OAuth2Client();

const app = express();
const PORT = process.env.PORT || 3000;

// Setup MCP Server Factory (Required for multi-client connections)
const createServer = () => {
  const server = new Server(
    {
      name: "mcp-ssh-server",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: "execute_on_host",
          description: "Securely executes an arbitrary command on a remote host via SSH.",
          inputSchema: {
            type: "object",
            properties: {
              host: {
                type: "string",
                description: "The target host identifier (alphanumeric, -, _)",
              },
              command: {
                type: "string",
                description: "The command string to execute",
              }
            },
            required: ["host", "command"],
          },
        },
        {
          name: "application_api_request",
          description: "Securely executes REST API requests against internal applications without exposing API keys. Requires application name, host, HTTP method, and endpoint.",
          inputSchema: {
            type: "object",
            properties: {
              application: { type: "string", description: "Target app (e.g., echarr, echarr-dev, sonarr, nginx)" },
              host: { type: "string", description: "Target host (e.g., node, synology)" },
              method: { type: "string", description: "HTTP method (GET, POST, PUT, DELETE)" },
              endpoint: { type: "string", description: "API path (e.g., /api/v3/system/status)" },
              body: { type: "object", description: "Optional JSON payload" },
              select: {
                type: "array",
                items: { type: "string" },
                description: "Optional list of dot-notation property paths to project/filter in the response"
              }
            },
            required: ["application", "host", "method", "endpoint"]
          }
        },
        {
          name: "wait_for_condition",
          description: "Polls an internal application endpoint repeatedly until a specified JSON field matches an expected value or timeout is reached. Operates directly on the low-latency LAN without LLM turn overhead.",
          inputSchema: {
            type: "object",
            properties: {
              application: { type: "string", description: "Target app (e.g., echarr, echarr-dev, sonarr, qbittorrent)" },
              host: { type: "string", description: "Target host (e.g., node, synology), defaults to 'node'" },
              endpoint: { type: "string", description: "API path to poll (e.g., /api/books/123/download-status)" },
              targetField: { type: "string", description: "Dot-notation field to check (e.g., 'isImported' or 'activeDownload.state')" },
              expectedValue: { description: "Expected value for targetField. If omitted, checks for truthy/non-null." },
              timeoutSeconds: { type: "number", description: "Timeout in seconds (default 30, max 60)" },
              intervalMs: { type: "number", description: "Poll interval in milliseconds (default 1000, min 250)" },
              select: {
                type: "array",
                items: { type: "string" },
                description: "Optional list of dot-notation property paths to project in the returned response"
              }
            },
            required: ["application", "endpoint", "targetField"]
          }
        },
        {
          name: "echarr_search_series",
          description: "Targeted library search for series and books in Echarr. Returns lightweight series summaries with book previews.",
          inputSchema: {
            type: "object",
            properties: {
              query: { type: "string", description: "Search query across series title, author, or book titles" },
              title: { type: "string", description: "Optional filter specifically by series title" },
              author: { type: "string", description: "Optional filter specifically by author" },
              limit: { type: "number", description: "Max series results to return (e.g., 5)" },
              isDev: { type: "boolean", description: "Set to true to target echarr-dev instead of production" },
              app: { type: "string", description: "Explicit application slug ('echarr' or 'echarr-dev')" },
              host: { type: "string", description: "Target host (defaults to 'node')" },
              select: {
                type: "array",
                items: { type: "string" },
                description: "Optional list of dot-notation fields to project in the response"
              }
            }
          }
        },
        {
          name: "echarr_get_book_status",
          description: "Retrieves single-book lifecycle status, active torrent progress/state, latest import record, and isImported indicator from Echarr.",
          inputSchema: {
            type: "object",
            properties: {
              bookId: { type: "string", description: "Echarr book identifier" },
              isDev: { type: "boolean", description: "Set to true to target echarr-dev instead of production" },
              app: { type: "string", description: "Explicit application slug ('echarr' or 'echarr-dev')" },
              host: { type: "string", description: "Target host (defaults to 'node')" },
              select: {
                type: "array",
                items: { type: "string" },
                description: "Optional list of dot-notation fields to project in the response"
              }
            },
            required: ["bookId"]
          }
        },
        {
          name: "echarr_request_book",
          description: "Requests a book in Echarr via Goodreads URL or title/author. Can automatically initiate Prowlarr search and download client grab if autoGrab is true.",
          inputSchema: {
            type: "object",
            properties: {
              goodreadsUrl: { type: "string", description: "Goodreads book URL for auto-resolving metadata" },
              title: { type: "string", description: "Book title (required if goodreadsUrl is not provided)" },
              author: { type: "string", description: "Author name" },
              seriesTitle: { type: "string", description: "Optional series container title" },
              autoGrab: { type: "boolean", description: "Automatically search Prowlarr and send to torrent client (defaults to true)" },
              monitored: { type: "boolean", description: "Monitor for releases (defaults to true)" },
              isDev: { type: "boolean", description: "Set to true to target echarr-dev instead of production" },
              app: { type: "string", description: "Explicit application slug ('echarr' or 'echarr-dev')" },
              host: { type: "string", description: "Target host (defaults to 'node')" }
            }
          }
        },
        {
          name: "echarr_auto_grab_book",
          description: "Triggers an immediate Prowlarr indexer search and download client grab for an existing book in the Echarr library by book ID.",
          inputSchema: {
            type: "object",
            properties: {
              bookId: { type: "string", description: "Echarr book identifier" },
              seriesId: { type: "string", description: "Optional parent series identifier" },
              isDev: { type: "boolean", description: "Set to true to target echarr-dev instead of production" },
              app: { type: "string", description: "Explicit application slug ('echarr' or 'echarr-dev')" },
              host: { type: "string", description: "Target host (defaults to 'node')" }
            },
            required: ["bookId"]
          }
        },
        {
          name: "echarr_sync_series",
          description: "Atomic post-import synchronization for a series in Echarr. Rewrites audio tags, refreshes Plex library section, and syncs Plex playlists in a single atomic call.",
          inputSchema: {
            type: "object",
            properties: {
              seriesId: { type: "string", description: "Echarr series identifier" },
              syncAudioTags: { type: "boolean", description: "Rewrite audio tags (defaults to true)" },
              refreshPlex: { type: "boolean", description: "Refresh Plex library section (defaults to true)" },
              syncPlaylist: { type: "boolean", description: "Synchronize Plex series playlist (defaults to true)" },
              isDev: { type: "boolean", description: "Set to true to target echarr-dev instead of production" },
              app: { type: "string", description: "Explicit application slug ('echarr' or 'echarr-dev')" },
              host: { type: "string", description: "Target host (defaults to 'node')" }
            },
            required: ["seriesId"]
          }
        },
        {
          name: "echarr_wait_for_book",
          description: "Blocks and polls Echarr directly over LAN until a book finishes downloading and importing (isImported: true), or until timeout.",
          inputSchema: {
            type: "object",
            properties: {
              bookId: { type: "string", description: "Echarr book identifier" },
              timeoutSeconds: { type: "number", description: "Timeout in seconds (default 30, max 60)" },
              intervalMs: { type: "number", description: "Poll interval in milliseconds (default 1000, min 250)" },
              isDev: { type: "boolean", description: "Set to true to target echarr-dev instead of production" },
              app: { type: "string", description: "Explicit application slug ('echarr' or 'echarr-dev')" },
              host: { type: "string", description: "Target host (defaults to 'node')" },
              select: {
                type: "array",
                items: { type: "string" },
                description: "Optional list of dot-notation fields to project in the response"
              }
            },
            required: ["bookId"]
          }
        }
      ],
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      if (name === "execute_on_host") {
        const host = String(args?.host);
        const command = String(args?.command);
        const output = await executeOnHost({ host, command });
        return {
          content: [
            {
              type: "text",
              text: output || "Command executed successfully with no output.",
            },
          ],
        };
      }

      if (name === "application_api_request") {
        const application = String(args?.application);
        const host = String(args?.host);
        const method = String(args?.method);
        const endpoint = String(args?.endpoint);
        const body = args?.body;
        const select = Array.isArray(args?.select) ? (args?.select as string[]) : undefined;

        const output = await executeProxyRequest({ application, host, method, endpoint, body, select });
        return {
          content: [
            {
              type: "text",
              text: typeof output === 'string' ? output : JSON.stringify(output, null, 2),
            },
          ],
        };
      }

      if (name === "wait_for_condition") {
        const application = String(args?.application);
        const host = args?.host ? String(args.host) : undefined;
        const endpoint = String(args?.endpoint);
        const targetField = String(args?.targetField);
        const expectedValue = args?.expectedValue;
        const timeoutSeconds = typeof args?.timeoutSeconds === 'number' ? args.timeoutSeconds : undefined;
        const intervalMs = typeof args?.intervalMs === 'number' ? args.intervalMs : undefined;
        const select = Array.isArray(args?.select) ? (args?.select as string[]) : undefined;

        const output = await waitForCondition({
          application,
          host,
          endpoint,
          targetField,
          expectedValue,
          timeoutSeconds,
          intervalMs,
          select
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(output, null, 2),
            },
          ],
        };
      }

      if (name === "echarr_search_series" || name === "echarr_find_series") {
        const output = await echarr.searchSeries({
          query: args?.query ? String(args.query) : undefined,
          title: args?.title ? String(args.title) : undefined,
          author: args?.author ? String(args.author) : undefined,
          limit: typeof args?.limit === 'number' ? args.limit : undefined,
          isDev: typeof args?.isDev === 'boolean' ? args.isDev : undefined,
          app: args?.app ? String(args.app) : undefined,
          host: args?.host ? String(args.host) : undefined,
          select: Array.isArray(args?.select) ? (args?.select as string[]) : undefined,
        });

        return {
          content: [
            {
              type: "text",
              text: typeof output === 'string' ? output : JSON.stringify(output, null, 2),
            },
          ],
        };
      }

      if (name === "echarr_get_book_status") {
        const bookId = String(args?.bookId);
        const output = await echarr.getBookStatus({
          bookId,
          isDev: typeof args?.isDev === 'boolean' ? args.isDev : undefined,
          app: args?.app ? String(args.app) : undefined,
          host: args?.host ? String(args.host) : undefined,
          select: Array.isArray(args?.select) ? (args?.select as string[]) : undefined,
        });

        return {
          content: [
            {
              type: "text",
              text: typeof output === 'string' ? output : JSON.stringify(output, null, 2),
            },
          ],
        };
      }

      if (name === "echarr_request_book" || name === "echarr_grab_book") {
        const output = await echarr.requestBook({
          goodreadsUrl: args?.goodreadsUrl ? String(args.goodreadsUrl) : undefined,
          title: args?.title ? String(args.title) : undefined,
          author: args?.author ? String(args.author) : undefined,
          seriesTitle: args?.seriesTitle ? String(args.seriesTitle) : undefined,
          autoGrab: typeof args?.autoGrab === 'boolean' ? args.autoGrab : undefined,
          monitored: typeof args?.monitored === 'boolean' ? args.monitored : undefined,
          isDev: typeof args?.isDev === 'boolean' ? args.isDev : undefined,
          app: args?.app ? String(args.app) : undefined,
          host: args?.host ? String(args.host) : undefined,
        });

        return {
          content: [
            {
              type: "text",
              text: typeof output === 'string' ? output : JSON.stringify(output, null, 2),
            },
          ],
        };
      }

      if (name === "echarr_auto_grab_book") {
        const bookId = String(args?.bookId);
        const seriesId = args?.seriesId ? String(args.seriesId) : undefined;
        const output = await echarr.autoGrabBook({
          bookId,
          seriesId,
          isDev: typeof args?.isDev === 'boolean' ? args.isDev : undefined,
          app: args?.app ? String(args.app) : undefined,
          host: args?.host ? String(args.host) : undefined,
        });

        return {
          content: [
            {
              type: "text",
              text: typeof output === 'string' ? output : JSON.stringify(output, null, 2),
            },
          ],
        };
      }

      if (name === "echarr_sync_series") {
        const seriesId = String(args?.seriesId);
        const output = await echarr.syncSeries({
          seriesId,
          syncAudioTags: typeof args?.syncAudioTags === 'boolean' ? args.syncAudioTags : undefined,
          refreshPlex: typeof args?.refreshPlex === 'boolean' ? args.refreshPlex : undefined,
          syncPlaylist: typeof args?.syncPlaylist === 'boolean' ? args.syncPlaylist : undefined,
          isDev: typeof args?.isDev === 'boolean' ? args.isDev : undefined,
          app: args?.app ? String(args.app) : undefined,
          host: args?.host ? String(args.host) : undefined,
        });

        return {
          content: [
            {
              type: "text",
              text: typeof output === 'string' ? output : JSON.stringify(output, null, 2),
            },
          ],
        };
      }

      if (name === "echarr_wait_for_book") {
        const bookId = String(args?.bookId);
        const output = await echarr.waitForBookImport({
          bookId,
          timeoutSeconds: typeof args?.timeoutSeconds === 'number' ? args.timeoutSeconds : undefined,
          intervalMs: typeof args?.intervalMs === 'number' ? args.intervalMs : undefined,
          isDev: typeof args?.isDev === 'boolean' ? args.isDev : undefined,
          app: args?.app ? String(args.app) : undefined,
          host: args?.host ? String(args.host) : undefined,
          select: Array.isArray(args?.select) ? (args?.select as string[]) : undefined,
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(output, null, 2),
            },
          ],
        };
      }

      throw new Error(`Tool not found: ${name}`);
    } catch (error) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `Error executing ${name}: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  });

  return server;
};

// Check if running in stdio mode
const isStdio = process.argv.includes('--stdio');

async function startServer() {
  await SecretCache.fetch();
  SecretCache.startPolling();

  if (isStdio) {
  // --- STDIO TRANSPORT (For local IDE testing) ---
  console.error("Starting MCP server in STDIO mode...");
  const server = createServer();
  const transport = new StdioServerTransport();
  server.connect(transport).catch(console.error);
} else {
  // --- SSE TRANSPORT (For network production) ---
  // Middleware
  app.use(cors());

  // Custom Morgan format excluding Authorization header
  morgan.token('safe-headers', (req: any) => {
    const headers = { ...req.headers };
    delete headers.authorization;
    return JSON.stringify(headers);
  });

  const logFormat = ':remote-addr - :remote-user [:date[clf]] ":method :url HTTP/:http-version" :status :res[content-length] - ":user-agent" :safe-headers';

  // Log to stdout
  app.use(morgan(logFormat));

  // Log to file if configured (Unraid persistent logging)
  if (fs.existsSync('/config')) {
    const accessLogStream = fs.createWriteStream('/config/access.log', { flags: 'a' });
    app.use(morgan(logFormat, { stream: accessLogStream }));
  } else {
    // Local dev fallback
    const accessLogStream = fs.createWriteStream(path.join(__dirname, '../access.log'), { flags: 'a' });
    app.use(morgan(logFormat, { stream: accessLogStream }));
  }

  // Health Check
  app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  // MCP SSE Endpoints (Protected by authMiddleware)
  const transports = new Map<string, SSEServerTransport>();

  // --- OAuth Onboarding Routes ---
  app.get("/login", (req, res) => {
    const htmlPath = path.join(__dirname, '../public/login.html');
    let html = fs.readFileSync(htmlPath, 'utf8');
    html = html.replace('__GOOGLE_CLIENT_ID__', process.env.GOOGLE_CLIENT_ID || '');
    res.send(html);
  });

  app.post("/api/register", express.json(), async (req, res) => {
    try {
      const { credential } = req.body;
      if (!credential) {
          res.status(400).json({ error: 'Missing credential' });
          return;
      }

      // Verify Google Token
      const ticket = await oauthClient.verifyIdToken({ idToken: credential });
      const payload = ticket.getPayload();
      
      if (!payload || !payload.email || !payload.email_verified) {
          res.status(401).json({ error: 'Invalid Google Token' });
          return;
      }

      // Check against Doppler ALLOWED_GOOGLE_EMAILS
      const allowedEmails = (process.env.ALLOWED_GOOGLE_EMAILS || '').split(',').map(e => e.trim().toLowerCase());
      if (!allowedEmails.includes(payload.email.toLowerCase())) {
          res.status(403).json({ error: 'You are not authorized to generate API keys for this server.' });
          return;
      }

      if (!process.env.JWT_SECRET) {
          res.status(500).json({ error: 'Server misconfiguration: Missing JWT_SECRET' });
          return;
      }

      // Mint a persistent JWT
      const token = jwt.sign({ email: payload.email }, process.env.JWT_SECRET, { expiresIn: '10y' });
      res.json({ token });
    } catch (e) {
      console.error('Registration error:', e);
      res.status(500).json({ error: 'Internal server error during registration' });
    }
  });

  // Environment Health Endpoint
  app.get("/debug/health", authMiddleware, (req, res) => {
    if (process.env.DEBUG !== 'true') {
      return res.status(404).json({ error: "Not Found" });
    }
    
    const logPath = fs.existsSync('/config') ? '/config/access.log' : path.join(__dirname, '../access.log');
    let logWritable = false;
    try {
      fs.accessSync(path.dirname(logPath), fs.constants.W_OK);
      logWritable = true;
    } catch {
      logWritable = false;
    }

    res.json({
      hasMcpApiKey: !!process.env.MCP_API_KEY,
      hasDopplerToken: !!process.env.DOPPLER_TOKEN,
      accessLogWritable: logWritable,
      activeSessions: Array.from(transports.keys())
    });
  });

  app.get("/sse", authMiddleware, async (req, res) => {
    const ip = req.ip || req.socket.remoteAddress;
    const ua = req.get('User-Agent');
    if (process.env.DEBUG === 'true') {
      console.log(`[DEBUG] New connection from IP: ${ip}, User-Agent: ${ua}`);
    }
    
    try {
      res.setHeader("X-Accel-Buffering", "no");
      const server = createServer();
      const transport = new SSEServerTransport("/message", res);
      await server.connect(transport);
      transports.set(transport.sessionId, transport);
      
      if (process.env.DEBUG === 'true') {
        console.log(`[DEBUG] Session initialized with ID: ${transport.sessionId}`);
      }

      // Send a keep-alive ping every 15 seconds to prevent Nginx from dropping the SSE connection
      const pingInterval = setInterval(() => {
        res.write(': keepalive\n\n');
      }, 15000);

      // Clean up memory when the client disconnects
      res.on('close', () => {
        clearInterval(pingInterval);
        if (process.env.DEBUG === 'true') {
          console.log(`[DEBUG] Session disconnected: ${transport.sessionId}`);
        }
        // Delay deletion slightly to avoid race conditions with incoming POSTs if connection flickers
        setTimeout(() => transports.delete(transport.sessionId), 5000);
      });
    } catch (e) {
      console.error('SSE Connection Error:', e);
      if (!res.headersSent) res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  app.post("/message", authMiddleware, express.json(), async (req, res) => {
    const sessionId = req.query.sessionId as string;
    if (process.env.DEBUG === 'true') {
      console.log(`[DEBUG] POST /message received. Query sessionId: '${sessionId}'`);
      console.log(`[DEBUG] Active sessions:`, Array.from(transports.keys()));
      console.log(`[DEBUG] Request URL:`, req.originalUrl);
    }
    const transport = transports.get(sessionId);
    if (!transport) {
      console.log(`[ERROR] Session not found for ID: '${sessionId}'`);
      res.status(404).json({ error: "Session not found" });
      return;
    }
    await transport.handlePostMessage(req, res, req.body);
  });

  app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT} for SSE connections`);
  });

  // Graceful Shutdown
  const shutdown = () => {
    console.error('Shutting down server...');
    SecretCache.stopPolling();
    for (const t of transports.values()) { 
      try { 
        t.close(); 
      } catch { 
        // Ignore errors during graceful shutdown
      } 
    }
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
}

startServer().catch(console.error);
