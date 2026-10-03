import { spawn } from 'child_process';
import path from 'path';

export interface ExecuteHostParams {
  host: string;
  command: string;
}

export const executeOnHost = (params: ExecuteHostParams): Promise<string> => {
  return new Promise((resolve, reject) => {
    const { host, command } = params;

    // Strict validation of the host identifier to prevent injection in the bash script
    if (!/^[a-zA-Z0-9_-]+$/.test(host)) {
      return reject(new Error('Invalid host identifier. Only alphanumeric characters, dashes, and underscores are allowed.'));
    }

    const scriptPath = path.resolve(__dirname, '../scripts/ssh-host.sh');

    // Spawn the wrapper script. It takes: host, command
    const sshProcess = spawn(scriptPath, [host, command], {
      // Run completely detached from any shells
      shell: false
    });

    let stdoutData = '';
    let stderrData = '';

    sshProcess.stdout.on('data', (data) => {
      stdoutData += data.toString();
    });

    sshProcess.stderr.on('data', (data) => {
      stderrData += data.toString();
    });

    sshProcess.on('close', (code) => {
      if (code !== 0) {
        // Return a clean error message that encapsulates the command failure
        return reject(new Error(`Command failed with exit code ${code}\nStderr: ${stderrData.trim()}`));
      }
      resolve(stdoutData.trim());
    });
    
    sshProcess.on('error', (err) => {
      reject(new Error(`Failed to spawn SSH wrapper: ${err.message}`));
    });
  });
};
