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

  app.get("/sse", authMiddleware, async (req, res) => {
    try {
      const server = createServer();
      const transport = new SSEServerTransport("/message", res);
      await server.connect(transport);
      transports.set(transport.sessionId, transport);

      // Clean up memory when the client disconnects
      res.on('close', () => {
        transports.delete(transport.sessionId);
      });
    } catch (e) {
      console.error('SSE Connection Error:', e);
      if (!res.headersSent) res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  app.post("/message", authMiddleware, express.json(), async (req, res) => {
    const sessionId = req.query.sessionId as string;
    const transport = transports.get(sessionId);
    if (!transport) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    await transport.handlePostMessage(req, res);
  });

  app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT} for SSE connections`);
  });

  // Graceful Shutdown
  const shutdown = () => {
    console.error('Shutting down server...');
    for (const t of transports.values()) { try { t.close(); } catch (e) { } }
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
