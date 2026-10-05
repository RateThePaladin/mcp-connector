import { spawn } from 'child_process';
import path from 'path';
import { SecretCache } from './secrets';

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

    if (process.env.DEBUG === 'true') {
      console.log(`[DEBUG] Executing on host ${host}. Spawning wrapper: ${scriptPath} [${host}]`);
      console.log(`[DEBUG] Stdin payload: ${command}`);
    }

    const hostUpper = host.toUpperCase();
    const safeEnv = {
      PATH: process.env.PATH,
      ALLOWED_SSH_HOSTS: SecretCache.get('ALLOWED_SSH_HOSTS'),
      [`${hostUpper}_USER`]: SecretCache.get(`${hostUpper}_USER`),
      [`${hostUpper}_HOST`]: SecretCache.get(`${hostUpper}_HOST`),
      [`${hostUpper}_KEY`]: SecretCache.get(`${hostUpper}_KEY`)
    };

    // Spawn the wrapper script. It takes: host
    const sshProcess = spawn(scriptPath, [host], {
      // Run completely detached from any shells
      shell: false,
      env: safeEnv as any
    });

    // Write the command to stdin to keep it out of process arguments
    sshProcess.stdin.write(command);
    sshProcess.stdin.end();

    let stdoutData = '';
    let stderrData = '';

    sshProcess.stdout.on('data', (data) => {
      stdoutData += data.toString();
    });

    sshProcess.stderr.on('data', (data) => {
      stderrData += data.toString();
    });

    sshProcess.on('close', (code) => {
      if (process.env.DEBUG === 'true') {
        console.log(`[DEBUG] SSH wrapper exited with code: ${code}`);
        console.log(`[DEBUG] Stdout buffer: ${stdoutData.trim()}`);
        console.log(`[DEBUG] Stderr buffer: ${stderrData.trim()}`);
      }
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
