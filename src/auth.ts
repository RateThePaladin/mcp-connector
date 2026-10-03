import { Request, Response, NextFunction } from 'express';
import { OAuth2Client } from 'google-auth-library';

const client = new OAuth2Client();

export const authMiddleware = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Missing or invalid Authorization header' });
      return;
    }

    const token = authHeader.split(' ')[1];
    
    // 1. Check Custom API Key (Fallback Method)
    const expectedKey = process.env.MCP_API_KEY;
    if (expectedKey && token === expectedKey) {
      next();
      return;
    }

    // 2. Check Google Credentials
    const allowedEmailsStr = process.env.ALLOWED_GOOGLE_EMAILS;
    if (!allowedEmailsStr) {
      res.status(401).json({ error: 'Invalid API Key and Google Auth is not configured' });
      return;
    }

    const allowedEmails = allowedEmailsStr.split(',').map(e => e.trim().toLowerCase());

    try {
      const ticket = await client.verifyIdToken({
        idToken: token
      });

      const payload = ticket.getPayload();
      if (!payload || !payload.email || !payload.email_verified) {
        res.status(401).json({ error: 'Invalid Google Token or unverified email' });
        return;
      }

      if (!allowedEmails.includes(payload.email.toLowerCase())) {
        console.warn(`Unauthorized access attempt by: ${payload.email}`);
        res.status(403).json({ error: 'User is not authorized to access this server' });
        return;
      }

      // Attach user payload to request for downstream logging if needed
      (req as any).user = payload;
      next();
      return;
    } catch (e) {
      res.status(401).json({ error: 'Invalid API Key or Google Token' });
      return;
    }
  } catch (error) {
    console.error('Authentication error:', error);
    res.status(500).json({ error: 'Authentication processing failed' });
  }
};
