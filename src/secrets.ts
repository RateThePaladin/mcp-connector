import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export class SecretCache {
  private static secrets: Record<string, string> = {};
  private static pollingInterval: NodeJS.Timeout | null = null;

  public static async fetch(): Promise<void> {
    try {
      const { stdout } = await execAsync('doppler secrets download --no-file --format json', {
        encoding: 'utf-8'
      });
      const parsed = JSON.parse(stdout);
      this.secrets = parsed;
      if (process.env.DEBUG === 'true') {
        console.log('[DEBUG] Successfully refreshed Doppler secrets cache.');
      }
    } catch {
      console.warn('[WARN] Background secret fetch failed. Using last known cached secrets.');
      if (process.env.DEBUG === 'true') {
        console.error('[DEBUG] Doppler fetch error details omitted for security.');
      }
    }
  }

  public static get(key: string): string | undefined {
    return this.secrets[key];
  }

  public static startPolling(intervalMs: number = 60000): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
    }
    this.pollingInterval = setInterval(() => {
      this.fetch().catch(() => {}); // Catch unhandled rejections just in case
    }, intervalMs);
  }

  public static stopPolling(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
  }
}
