import { Request, Response, NextFunction } from 'express';

export const authMiddleware = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Missing or invalid Authorization header' });
      return;
    }

    const token = authHeader.split(' ')[1];
    const expectedKey = process.env.MCP_API_KEY;

    if (!expectedKey) {
      console.error("CRITICAL: MCP_API_KEY environment variable is not set!");
      res.status(500).json({ error: 'Server authentication is not configured correctly' });
      return;
    }

    if (token !== expectedKey) {
      res.status(401).json({ error: 'Invalid API Key' });
      return;
    }

    next();
  } catch (error) {
    console.error('Authentication error:', error);
    res.status(401).json({ error: 'Authentication failed' });
  }
};
