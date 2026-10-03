import { Request, Response, NextFunction } from 'express';
import { OAuth2Client } from 'google-auth-library';

const CLIENT_ID = process.env.GCP_CLIENT_ID;
const client = new OAuth2Client(CLIENT_ID);

export const authMiddleware = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const allowedEmails = process.env.ALLOWED_EMAILS ? process.env.ALLOWED_EMAILS.split(',').map(e => e.trim()) : [];
    
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Unauthorized: Missing or invalid Authorization header' });
      return;
    }

    const token = authHeader.split(' ')[1];
    
    // Verify token
    const ticket = await client.verifyIdToken({
      idToken: token,
      audience: CLIENT_ID,
    });
    
    const payload = ticket.getPayload();
    if (!payload || !payload.email) {
      res.status(401).json({ error: 'Unauthorized: Invalid token payload' });
      return;
    }

    if (!allowedEmails.includes(payload.email)) {
      res.status(403).json({ error: 'Forbidden: Email not allowed' });
      return;
    }

    // Set user info on request
    (req as any).user = payload;
    next();
  } catch (error) {
    console.error('Authentication Error:', error instanceof Error ? error.message : 'Unknown error');
    res.status(401).json({ error: 'Unauthorized: Invalid token' });
  }
};
