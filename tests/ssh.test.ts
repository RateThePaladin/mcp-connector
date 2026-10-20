import { executeOnHost } from '../src/ssh';
import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import { SecretCache } from '../src/secrets';
import { ApprovalManager } from '../src/security/approvalManager';

jest.mock('child_process');
jest.mock('../src/secrets');

describe('SSH Execution Module', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    ApprovalManager.resetForTesting();
    (SecretCache.get as jest.Mock).mockImplementation((key) => {
      if (key === 'VALID-HOST_USER') return 'testuser';
      if (key === 'VALID-HOST_HOST') return 'testhost';
      if (key === 'VALID-HOST_KEY') return 'testkey';
      if (key === 'ALLOWED_SSH_HOSTS') return 'valid-host';
      return undefined;
    });
  });

  afterEach(() => {
    ApprovalManager.resetForTesting();
  });

  it('should reject invalid host identifiers', async () => {
    await expect(executeOnHost({ host: 'invalid host', command: 'ls' }))
      .rejects.toThrow('Invalid host identifier');
  });

  it('should securely spawn the wrapper script for safe commands', async () => {
    const mockProcess = new EventEmitter() as any;
    mockProcess.stdout = new EventEmitter();
    mockProcess.stderr = new EventEmitter();
    mockProcess.stdin = { write: jest.fn(), end: jest.fn() };
    
    (spawn as jest.Mock).mockReturnValue(mockProcess);

    const execPromise = executeOnHost({ host: 'valid-host', command: 'echo "test"' });

    mockProcess.stdout.emit('data', 'test output\n');
    mockProcess.emit('close', 0);

    const result = await execPromise;
    expect(result).toBe('test output');

    expect(spawn).toHaveBeenCalledWith(
      expect.stringContaining('ssh-host.sh'),
      ['valid-host'],
      { 
        shell: false,
        env: expect.objectContaining({
          'VALID-HOST_USER': 'testuser',
          'VALID-HOST_HOST': 'testhost',
          'VALID-HOST_KEY': 'testkey',
          'ALLOWED_SSH_HOSTS': 'valid-host'
        })
      }
    );
    expect(mockProcess.stdin.write).toHaveBeenCalledWith('echo "test"');
  });

  it('should block dangerous commands and abort without spawning SSH', async () => {
    // Mock ApprovalManager to simulate immediate timeout / refusal
    const spy = jest.spyOn(ApprovalManager, 'requestApproval').mockResolvedValue({
      instantApproved: false,
      approvalId: 'MOCK99'
    });

    await expect(
      executeOnHost({ host: 'valid-host', command: 'rm -rf /' })
    ).rejects.toThrow(/Command blocked by MCP Security Guardrail \[ROOT_DELETION\]/);

    expect(spy).toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
  });

  it('should allow dangerous command if pre-approved via ApprovalManager', async () => {
    const mockProcess = new EventEmitter() as any;
    mockProcess.stdout = new EventEmitter();
    mockProcess.stderr = new EventEmitter();
    mockProcess.stdin = { write: jest.fn(), end: jest.fn() };
    (spawn as jest.Mock).mockReturnValue(mockProcess);

    // Mock consumeApproval to return true for this pre-approved execution
    jest.spyOn(ApprovalManager, 'consumeApproval').mockReturnValue(true);

    const execPromise = executeOnHost({ host: 'valid-host', command: 'rm -rf /' });

    mockProcess.stdout.emit('data', 'approved execution output\n');
    mockProcess.emit('close', 0);

    const result = await execPromise;
    expect(result).toBe('approved execution output');
    expect(spawn).toHaveBeenCalled();
  });
});
