import { executeOnHost } from '../src/ssh';
import { spawn } from 'child_process';
import { EventEmitter } from 'events';

jest.mock('child_process');

describe('SSH Execution Module', () => {
  it('should reject invalid host identifiers', async () => {
    await expect(executeOnHost({ host: 'invalid host', command: 'ls' }))
      .rejects.toThrow('Invalid host identifier');
  });

  it('should securely spawn the wrapper script', async () => {
    const mockProcess = new EventEmitter() as any;
    mockProcess.stdout = new EventEmitter();
    mockProcess.stderr = new EventEmitter();
    
    (spawn as jest.Mock).mockReturnValue(mockProcess);

    const execPromise = executeOnHost({ host: 'valid-host', command: 'echo "test"' });

    mockProcess.stdout.emit('data', 'test output\n');
    mockProcess.emit('close', 0);

    const result = await execPromise;
    expect(result).toBe('test output');

    expect(spawn).toHaveBeenCalledWith(
      expect.stringContaining('ssh-host.sh'),
      ['valid-host', 'echo "test"'],
      { shell: false }
    );
  });
});
