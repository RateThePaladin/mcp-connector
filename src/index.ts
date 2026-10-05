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
import { OAuth2Client } from 'google-auth-library';
import jwt from 'jsonwebtoken';

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
              application: { type: "string", description: "Target app (e.g., sonarr, nginx)" },
              host: { type: "string", description: "Target host (e.g., node, synology)" },
              method: { type: "string", description: "HTTP method (GET, POST, PUT, DELETE)" },
              endpoint: { type: "string", description: "API path (e.g., /api/v3/system/status)" },
              body: { type: "object", description: "Optional JSON payload" }
            },
            required: ["application", "host", "method", "endpoint"]
          }
        }
      ],
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name === "execute_on_host") {
      const host = String(request.params.arguments?.host);
      const command = String(request.params.arguments?.command);

      try {
        const output = await executeOnHost({ host, command });
        return {
          content: [
            {
              type: "text",
              text: output || "Command executed successfully with no output.",
            },
          ],
        };
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Error executing command: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    } else if (request.params.name === "application_api_request") {
      const application = String(request.params.arguments?.application);
      const host = String(request.params.arguments?.host);
      const method = String(request.params.arguments?.method);
      const endpoint = String(request.params.arguments?.endpoint);
      const body = request.params.arguments?.body;

      try {
        const output = await executeProxyRequest({ application, host, method, endpoint, body });
        return {
          content: [
            {
              type: "text",
              text: typeof output === 'string' ? output : JSON.stringify(output, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Error executing API request: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
    throw new Error("Tool not found");
  });

  return server;
};

// Check if running in stdio mode
const isStdio = process.argv.includes('--stdio');

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
