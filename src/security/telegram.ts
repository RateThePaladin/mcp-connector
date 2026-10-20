import { SecretCache } from '../secrets';
import { ApprovalManager } from './approvalManager';

let isPolling = false;
let pollingAbortController: AbortController | null = null;
let lastUpdateId = 0;

interface TelegramConfig {
  token?: string;
  chatId?: string;
  enabled: boolean;
}

function getTelegramConfig(): TelegramConfig {
  const token = SecretCache.get('TELEGRAM_BOT_TOKEN') || process.env.TELEGRAM_BOT_TOKEN;
  const chatId = SecretCache.get('TELEGRAM_CHAT_ID') || process.env.TELEGRAM_CHAT_ID;
  const enabled = (SecretCache.get('TELEGRAM_ENABLED') || process.env.TELEGRAM_ENABLED) !== 'false';

  return {
    token,
    chatId,
    enabled: Boolean(enabled && token && chatId)
  };
}

/**
 * Sends a simple non-blocking alert to Telegram.
 */
export async function sendTelegramAlert(params: {
  host: string;
  command: string;
  rule: string;
  reason: string;
}): Promise<void> {
  const config = getTelegramConfig();
  if (!config.enabled || !config.token || !config.chatId) return;

  const { host, command, rule, reason } = params;
  const snippet = command.length > 300 ? command.slice(0, 300) + '...' : command;

  const text =
    `🚨 *MCP Security Guardrail Alert*\n` +
    `*Host:* \`${host}\`\n` +
    `*Rule:* \`${rule}\`\n` +
    `*Reason:* ${reason}\n` +
    `*Timestamp:* ${new Date().toISOString()}\n\n` +
    `*Command:*\n\`\`\`bash\n${snippet}\n\`\`\``;

  try {
    await fetch(`https://api.telegram.org/bot${config.token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: config.chatId,
        text,
        parse_mode: 'Markdown'
      })
    });
  } catch (err: any) {
    console.warn(`[TELEGRAM] Failed to send alert: ${err.message}`);
  }
}

/**
 * Dispatches an interactive approval prompt with inline action buttons to Telegram.
 * Starts on-demand long-polling to capture the user's response.
 */
export async function sendTelegramApprovalPrompt(params: {
  approvalId: string;
  host: string;
  command: string;
  rule: string;
  reason: string;
  expiresInMinutes: number;
}): Promise<number | undefined> {
  const config = getTelegramConfig();
  if (!config.enabled || !config.token || !config.chatId) return undefined;

  const { approvalId, host, command, rule, reason, expiresInMinutes } = params;
  const snippet = command.length > 350 ? command.slice(0, 350) + '...' : command;

  const text =
    `⚠️ *MCP Execution Approval Required*\n` +
    `*Approval ID:* \`#${approvalId}\`\n` +
    `*Host:* \`${host}\`\n` +
    `*Triggered Guardrail:* \`${rule}\`\n` +
    `*Reason:* ${reason}\n` +
    `*Auto-Expires:* In ${expiresInMinutes} minutes\n\n` +
    `*Proposed Command:*\n\`\`\`bash\n${snippet}\n\`\`\``;

  const replyMarkup = {
    inline_keyboard: [
      [
        { text: '✅ Approve (Allow Once)', callback_data: `approve:${approvalId}` },
        { text: '❌ Reject', callback_data: `reject:${approvalId}` }
      ]
    ]
  };

  try {
    const res = await fetch(`https://api.telegram.org/bot${config.token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: config.chatId,
        text,
        parse_mode: 'Markdown',
        reply_markup: replyMarkup
      })
    });

    const data: any = await res.json();
    const messageId = data?.result?.message_id;

    // Start on-demand polling to receive user button press
    startPollingIfNeeded();

    return messageId;
  } catch (err: any) {
    console.warn(`[TELEGRAM] Failed to send approval prompt: ${err.message}`);
    return undefined;
  }
}

/**
 * Updates an existing Telegram message in-place (e.g. changing prompt to Approved or Rejected).
 */
export async function updateTelegramMessage(messageId: number, text: string): Promise<void> {
  const config = getTelegramConfig();
  if (!config.enabled || !config.token || !config.chatId) return;

  try {
    await fetch(`https://api.telegram.org/bot${config.token}/editMessageText`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: config.chatId,
        message_id: messageId,
        text,
        parse_mode: 'Markdown'
      })
    });
  } catch (err: any) {
    if (process.env.DEBUG === 'true') {
      console.warn(`[TELEGRAM] Failed to update message #${messageId}: ${err.message}`);
    }
  }
}

/**
 * Answers a Telegram callback query (removes the loading spinner on the button).
 */
async function answerCallbackQuery(callbackQueryId: string, text: string): Promise<void> {
  const config = getTelegramConfig();
  if (!config.token) return;

  try {
    await fetch(`https://api.telegram.org/bot${config.token}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        callback_query_id: callbackQueryId,
        text
      })
    });
  } catch {
    // Ignore callback answer errors
  }
}

/**
 * Starts the Telegram getUpdates long-polling loop if approvals are pending.
 * Shuts down automatically when no pending requests remain to keep Pi 3B idle CPU at 0%.
 */
export function startPollingIfNeeded(): void {
  if (isPolling) return;
  const config = getTelegramConfig();
  if (!config.enabled || !config.token) return;

  isPolling = true;
  pollingAbortController = new AbortController();

  if (process.env.DEBUG === 'true') {
    console.log('[TELEGRAM] Starting on-demand Telegram polling loop...');
  }

  runPollingLoop(config.token, config.chatId!).catch((err) => {
    if (process.env.DEBUG === 'true') {
      console.warn('[TELEGRAM] Polling loop error:', err.message);
    }
    stopPolling();
  });
}

export function stopPolling(): void {
  if (pollingAbortController) {
    pollingAbortController.abort();
    pollingAbortController = null;
  }
  isPolling = false;
  if (process.env.DEBUG === 'true') {
    console.log('[TELEGRAM] Polling loop stopped (idle).');
  }
}

async function runPollingLoop(token: string, authorizedChatId: string): Promise<void> {
  while (isPolling) {
    // If no requests are pending in memory, sleep and spin down
    if (!ApprovalManager.hasPendingRequests()) {
      stopPolling();
      break;
    }

    try {
      const url = `https://api.telegram.org/bot${token}/getUpdates?offset=${lastUpdateId + 1}&timeout=15`;
      const res = await fetch(url, {
        signal: pollingAbortController?.signal
      });

      if (!res.ok) {
        await new Promise((r) => setTimeout(r, 5000));
        continue;
      }

      const data: any = await res.json();
      if (Array.isArray(data.result)) {
        for (const update of data.result) {
          lastUpdateId = Math.max(lastUpdateId, update.update_id);

          // 1. Handle Inline Button Press (callback_query)
          if (update.callback_query) {
            const query = update.callback_query;
            const fromChatId = String(query.message?.chat?.id || query.from?.id);

            // Authorization Check: Ignore anyone who isn't the administrator
            if (fromChatId !== String(authorizedChatId)) {
              await answerCallbackQuery(query.id, 'Unauthorized user.');
              continue;
            }

            const dataStr = String(query.data || '');
            const [action, approvalId] = dataStr.split(':') as ['approve' | 'reject', string];

            if ((action === 'approve' || action === 'reject') && approvalId) {
              const result = ApprovalManager.handleTelegramAction(action, approvalId);
              await answerCallbackQuery(query.id, result.message);
            }
          }

          // 2. Handle Direct Text Commands (e.g. /approve A7F2 or /reject A7F2)
          if (update.message?.text && String(update.message.chat?.id) === String(authorizedChatId)) {
            const text = update.message.text.trim();
            const parts = text.split(/\s+/);
            const cmd = parts[0].toLowerCase();
            const approvalId = (parts[1] || '').replace('#', '').toUpperCase();

            if ((cmd === '/approve' || cmd === '/reject') && approvalId) {
              const action = cmd === '/approve' ? 'approve' : 'reject';
              ApprovalManager.handleTelegramAction(action, approvalId);
            }
          }
        }
      }
    } catch (err: any) {
      if (err.name === 'AbortError') break;
      // Backoff on network failure
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}
