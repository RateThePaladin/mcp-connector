import { authMiddleware } from '../src/auth';
import { Request, Response, NextFunction } from 'express';

// Mock google-auth-library
jest.mock('google-auth-library', () => {
  return {
    OAuth2Client: jest.fn().mockImplementation(() => {
      return {
        verifyIdToken: jest.fn().mockImplementation(async ({ idToken }) => {
          if (idToken === 'valid-google-token') {
            return {
              getPayload: () => ({ email: 'test@example.com', email_verified: true })
            };
          } else if (idToken === 'valid-google-token-wrong-email') {
            return {
              getPayload: () => ({ email: 'bad@example.com', email_verified: true })
            };
          }
          throw new Error('Invalid token');
        })
      };
    })
  };
});

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
    process.env.MCP_API_KEY = 'test-secret-key';
    process.env.ALLOWED_GOOGLE_EMAILS = 'test@example.com,admin@example.com';
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should reject requests without authorization header', async () => {
    await authMiddleware(mockReq as Request, mockRes as Response, nextFunction);
    expect(mockRes.status).toHaveBeenCalledWith(401);
  });

  it('should reject if API key is invalid and Google Auth is not configured', async () => {
    delete process.env.ALLOWED_GOOGLE_EMAILS;
    mockReq.headers!.authorization = 'Bearer wrong-key';
    
    await authMiddleware(mockReq as Request, mockRes as Response, nextFunction);
    
    expect(mockRes.status).toHaveBeenCalledWith(401);
    expect(mockRes.json).toHaveBeenCalledWith({ error: 'Invalid API Key, JWT, or Google Auth is not configured' });
  });

  it('should accept the correct api key', async () => {
    mockReq.headers!.authorization = 'Bearer test-secret-key';
    
    await authMiddleware(mockReq as Request, mockRes as Response, nextFunction);
    
    expect(nextFunction).toHaveBeenCalled();
  });
  
  it('should accept valid google token when API key does not match', async () => {
    mockReq.headers!.authorization = 'Bearer valid-google-token';
    
    await authMiddleware(mockReq as Request, mockRes as Response, nextFunction);
    
    expect(nextFunction).toHaveBeenCalled();
    expect((mockReq as any).user.email).toBe('test@example.com');
  });

  it('should reject valid google token if email is not in ALLOWED_GOOGLE_EMAILS', async () => {
    mockReq.headers!.authorization = 'Bearer valid-google-token-wrong-email';
    
    await authMiddleware(mockReq as Request, mockRes as Response, nextFunction);
    
    expect(mockRes.status).toHaveBeenCalledWith(403);
    expect(mockRes.json).toHaveBeenCalledWith({ error: 'User is not authorized to access this server' });
  });

  it('should reject if both API key is wrong and Google token is invalid', async () => {
    mockReq.headers!.authorization = 'Bearer invalid-token-for-both';
    
    await authMiddleware(mockReq as Request, mockRes as Response, nextFunction);
    
    expect(mockRes.status).toHaveBeenCalledWith(401);
    expect(mockRes.json).toHaveBeenCalledWith({ error: 'Invalid API Key, JWT, or Google Token' });
  });
});
