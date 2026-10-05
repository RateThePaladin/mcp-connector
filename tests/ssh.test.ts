import { executeOnHost } from '../src/ssh';
import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import { SecretCache } from '../src/secrets';

jest.mock('child_process');
jest.mock('../src/secrets');

describe('SSH Execution Module', () => {
  it('should reject invalid host identifiers', async () => {
    await expect(executeOnHost({ host: 'invalid host', command: 'ls' }))
      .rejects.toThrow('Invalid host identifier');
  });

  it('should securely spawn the wrapper script', async () => {
    const mockProcess = new EventEmitter() as any;
    mockProcess.stdout = new EventEmitter();
    mockProcess.stderr = new EventEmitter();
    mockProcess.stdin = { write: jest.fn(), end: jest.fn() };
    
    (spawn as jest.Mock).mockReturnValue(mockProcess);
    (SecretCache.get as jest.Mock).mockImplementation((key) => {
      if (key === 'VALID-HOST_USER') return 'testuser';
      if (key === 'VALID-HOST_HOST') return 'testhost';
      if (key === 'VALID-HOST_KEY') return 'testkey';
      if (key === 'ALLOWED_SSH_HOSTS') return 'valid-host';
      return undefined;
    });

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
});
