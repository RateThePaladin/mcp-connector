import { authMiddleware } from '../src/auth';
import { Request, Response, NextFunction } from 'express';
import { OAuth2Client } from 'google-auth-library';

jest.mock('google-auth-library');

describe('Auth Middleware', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let nextFunction: NextFunction;

  beforeEach(() => {
    mockReq = {
      headers: {},
    };
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    nextFunction = jest.fn();
    process.env.GCP_CLIENT_ID = 'test-client-id';
    process.env.ALLOWED_EMAILS = 'allowed@example.com, another@example.com';
  });

  it('should reject requests without authorization header', async () => {
    await authMiddleware(mockReq as Request, mockRes as Response, nextFunction);
    expect(mockRes.status).toHaveBeenCalledWith(401);
  });

  it('should reject invalid emails', async () => {
    mockReq.headers!.authorization = 'Bearer test-token';
    
    const mockVerifyIdToken = jest.fn().mockResolvedValue({
      getPayload: () => ({ email: 'hacker@example.com' })
    });
    OAuth2Client.prototype.verifyIdToken = mockVerifyIdToken;

    await authMiddleware(mockReq as Request, mockRes as Response, nextFunction);
    
    expect(mockRes.status).toHaveBeenCalledWith(403);
    expect(mockRes.json).toHaveBeenCalledWith({ error: 'Forbidden: Email not allowed' });
  });

  it('should accept allowed emails', async () => {
    mockReq.headers!.authorization = 'Bearer test-token';
    
    const mockVerifyIdToken = jest.fn().mockResolvedValue({
      getPayload: () => ({ email: 'allowed@example.com' })
    });
    OAuth2Client.prototype.verifyIdToken = mockVerifyIdToken;

    await authMiddleware(mockReq as Request, mockRes as Response, nextFunction);
    
    expect(nextFunction).toHaveBeenCalled();
    expect((mockReq as any).user.email).toBe('allowed@example.com');
  });
});
