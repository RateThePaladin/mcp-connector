import { authMiddleware } from '../src/auth';
import { Request, Response, NextFunction } from 'express';

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
  });

  it('should reject requests without authorization header', async () => {
    await authMiddleware(mockReq as Request, mockRes as Response, nextFunction);
    expect(mockRes.status).toHaveBeenCalledWith(401);
  });

  it('should reject invalid api keys', async () => {
    mockReq.headers!.authorization = 'Bearer wrong-key';
    
    await authMiddleware(mockReq as Request, mockRes as Response, nextFunction);
    
    expect(mockRes.status).toHaveBeenCalledWith(401);
    expect(mockRes.json).toHaveBeenCalledWith({ error: 'Invalid API Key' });
  });

  it('should accept the correct api key', async () => {
    mockReq.headers!.authorization = 'Bearer test-secret-key';
    
    await authMiddleware(mockReq as Request, mockRes as Response, nextFunction);
    
    expect(nextFunction).toHaveBeenCalled();
  });
  
  it('should error 500 if MCP_API_KEY is not set', async () => {
    delete process.env.MCP_API_KEY;
    mockReq.headers!.authorization = 'Bearer test-secret-key';
    
    await authMiddleware(mockReq as Request, mockRes as Response, nextFunction);
    
    expect(mockRes.status).toHaveBeenCalledWith(500);
    expect(mockRes.json).toHaveBeenCalledWith({ error: 'Server authentication is not configured correctly' });
  });
});
