import crypto from 'crypto';
import { sendTelegramApprovalPrompt, updateTelegramMessage } from './telegram';

export interface ApprovalRequest {
  id: string;
  host: string;
  command: string;
  commandHash: string;
  rule: string;
  reason: string;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  createdAt: number;
  expiresAt: number;
  telegramMessageId?: number;
  resolveInstant?: (approved: boolean) => void;
}

export class ApprovalManager {
  private static pendingById = new Map<string, ApprovalRequest>();
  private static approvedByHash = new Map<string, ApprovalRequest>();
  private static cleanupInterval: NodeJS.Timeout | null = null;

  public static getCommandHash(host: string, command: string): string {
    return crypto
      .createHash('sha256')
      .update(`${host.trim()}:${command.trim()}`)
      .digest('hex');
  }

  /**
   * Checks if an exact (host + command) combination has been pre-approved.
   * If approved and valid, consumes (deletes) the approval immediately so it can only be used once.
   */
  public static consumeApproval(host: string, command: string): boolean {
    this.cleanupExpired();
    const hash = this.getCommandHash(host, command);
    const approval = this.approvedByHash.get(hash);

    if (approval && approval.status === 'approved' && Date.now() < approval.expiresAt) {
      // Exact-command single-use: purge immediately
      this.approvedByHash.delete(hash);
      this.pendingById.delete(approval.id);

      if (process.env.DEBUG === 'true') {
        console.log(`[SECURITY] Consumed single-use approval #${approval.id} for host '${host}'`);
      }

      // Notify Telegram in background that the approved command was executed
      if (approval.telegramMessageId) {
        updateTelegramMessage(
          approval.telegramMessageId,
          `🚀 *Executed via Agent Retry*\n*Host:* \`${approval.host}\`\n*Approval ID:* \`#${approval.id}\`\n*Executed at:* ${new Date().toISOString()}`
        ).catch(() => {});
      }

      return true;
    }

    return false;
  }

  /**
   * Registers a blocked command, dispatches interactive Telegram prompt,
   * and holds for instant approval (up to instantHoldMs).
   */
  public static async requestApproval(params: {
    host: string;
    command: string;
    rule: string;
    reason: string;
    instantHoldMs?: number;
  }): Promise<{ instantApproved: boolean; approvalId: string }> {
    this.ensureCleanupLoop();
    const { host, command, rule, reason, instantHoldMs = 30000 } = params;

    const approvalId = crypto.randomBytes(3).toString('hex').toUpperCase();
    const commandHash = this.getCommandHash(host, command);
    const now = Date.now();
    const expiresAt = now + 30 * 60 * 1000; // 30-minute expiration

    const request: ApprovalRequest = {
      id: approvalId,
      host,
      command,
      commandHash,
      rule,
      reason,
      status: 'pending',
      createdAt: now,
      expiresAt
    };

    this.pendingById.set(approvalId, request);

    // Send Telegram interactive alert with inline buttons
    try {
      const sentMessageId = await sendTelegramApprovalPrompt({
        approvalId,
        host,
        command,
        rule,
        reason,
        expiresInMinutes: 30
      });
      if (sentMessageId) {
        request.telegramMessageId = sentMessageId;
      }
    } catch (err: any) {
      console.warn(`[SECURITY] Failed to dispatch Telegram approval prompt: ${err.message}`);
    }

    // Tier 1: Instant Hold (up to instantHoldMs)
    return new Promise((resolve) => {
      let timer: NodeJS.Timeout | null = null;

      request.resolveInstant = (approved: boolean) => {
        if (timer) clearTimeout(timer);
        request.resolveInstant = undefined;
        resolve({ instantApproved: approved, approvalId });
      };

      timer = setTimeout(() => {
        request.resolveInstant = undefined;
        // Instant hold timed out; fallback to 30-minute asynchronous window
        resolve({ instantApproved: false, approvalId });
      }, instantHoldMs);
    });
  }

  /**
   * Handles interactive button presses from Telegram (callback_query).
   */
  public static handleTelegramAction(
    action: 'approve' | 'reject',
    approvalId: string
  ): { success: boolean; message: string } {
    const request = this.pendingById.get(approvalId);

    if (!request || request.status === 'expired' || Date.now() > request.expiresAt) {
      return { success: false, message: 'Approval request not found or has expired.' };
    }

    const timestamp = new Date().toISOString();

    if (action === 'approve') {
      request.status = 'approved';
      this.approvedByHash.set(request.commandHash, request);

      // If instant hold is active, resolve it immediately
      if (request.resolveInstant) {
        request.resolveInstant(true);
        if (request.telegramMessageId) {
          updateTelegramMessage(
            request.telegramMessageId,
            `✅ *Approved & Executed Instantly*\n*Host:* \`${request.host}\`\n*Rule:* \`${request.rule}\`\n*Approval ID:* \`#${request.id}\`\n*Approved at:* ${timestamp}\n\`\`\`bash\n${request.command.slice(0, 300)}\n\`\`\``
          ).catch(() => {});
        }
      } else {
        // Fallback Tier 2 approval (waiting for agent retry)
        if (request.telegramMessageId) {
          updateTelegramMessage(
            request.telegramMessageId,
            `✅ *Approved by Admin*\n*Host:* \`${request.host}\`\n*Approval ID:* \`#${request.id}\`\n*Status:* Ready for agent retry (Valid for 30 min)\n*Approved at:* ${timestamp}\n\`\`\`bash\n${request.command.slice(0, 300)}\n\`\`\``
          ).catch(() => {});
        }
      }

      return { success: true, message: `Command #${approvalId} approved successfully.` };
    }

    if (action === 'reject') {
      request.status = 'rejected';
      this.approvedByHash.delete(request.commandHash);

      if (request.resolveInstant) {
        request.resolveInstant(false);
      }

      if (request.telegramMessageId) {
        updateTelegramMessage(
          request.telegramMessageId,
          `❌ *Rejected by Admin*\n*Host:* \`${request.host}\`\n*Rule:* \`${request.rule}\`\n*Approval ID:* \`#${request.id}\`\n*Rejected at:* ${timestamp}`
        ).catch(() => {});
      }

      return { success: true, message: `Command #${approvalId} rejected.` };
    }

    return { success: false, message: 'Invalid action.' };
  }

  public static hasPendingRequests(): boolean {
    return this.pendingById.size > 0;
  }

  public static getPendingCount(): number {
    return this.pendingById.size;
  }

  private static cleanupExpired(): void {
    const now = Date.now();
    for (const [id, req] of this.pendingById.entries()) {
      if (now > req.expiresAt) {
        req.status = 'expired';
        this.pendingById.delete(id);
        this.approvedByHash.delete(req.commandHash);
      }
    }
  }

  private static ensureCleanupLoop(): void {
    if (!this.cleanupInterval) {
      this.cleanupInterval = setInterval(() => {
        this.cleanupExpired();
        if (this.pendingById.size === 0 && this.approvedByHash.size === 0 && this.cleanupInterval) {
          clearInterval(this.cleanupInterval);
          this.cleanupInterval = null;
        }
      }, 60000);
    }
  }

  public static resetForTesting(): void {
    this.pendingById.clear();
    this.approvedByHash.clear();
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }
}
