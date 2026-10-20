import {
  sendTelegramApprovalPrompt,
  updateTelegramMessage,
  sendTelegramAlert,
  stopPolling
} from '../src/security/telegram';
import { SecretCache } from '../src/secrets';

// Mock SecretCache
jest.mock('../src/secrets');

describe('Telegram Security Dispatcher & Polling', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    (SecretCache.get as jest.Mock).mockImplementation((key) => {
      if (key === 'TELEGRAM_BOT_TOKEN') return '123456:ABC-DEF-MOCK-TOKEN';
      if (key === 'TELEGRAM_CHAT_ID') return '99887766';
      if (key === 'TELEGRAM_ENABLED') return 'true';
      return undefined;
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    stopPolling();
  });

  it('should format and send an interactive approval prompt with inline buttons', async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        result: { message_id: 42 }
      })
    });
    global.fetch = mockFetch;

    const messageId = await sendTelegramApprovalPrompt({
      approvalId: 'A7F2B1',
      host: 'test-node',
      command: 'docker system prune -a --volumes -f',
      rule: 'DOCKER_DESTRUCTIVE_CLEANUP',
      reason: 'Volume destruction',
      expiresInMinutes: 30
    });

    expect(messageId).toBe(42);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('https://api.telegram.org/bot123456:ABC-DEF-MOCK-TOKEN/sendMessage'),
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: expect.stringMatching(/inline_keyboard/)
      })
    );

    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(callBody.chat_id).toBe('99887766');
    expect(callBody.text).toContain('#A7F2B1');
    expect(callBody.text).toContain('DOCKER_DESTRUCTIVE_CLEANUP');
    expect(callBody.reply_markup.inline_keyboard[0][0].callback_data).toBe('approve:A7F2B1');
    expect(callBody.reply_markup.inline_keyboard[0][1].callback_data).toBe('reject:A7F2B1');
  });

  it('should edit an existing Telegram message in-place', async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true })
    });
    global.fetch = mockFetch;

    await updateTelegramMessage(42, '✅ Approved & Executed');

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/editMessageText'),
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('Approved & Executed')
      })
    );
  });

  it('should send standard non-interactive alert notifications', async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true })
    });
    global.fetch = mockFetch;

    await sendTelegramAlert({
      host: 'test-host',
      command: 'cat /etc/shadow',
      rule: 'AUTH_FILE_DESTRUCTION',
      reason: 'Critical auth file inspection'
    });

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/sendMessage'),
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('AUTH_FILE_DESTRUCTION')
      })
    );
  });

  it('should gracefully no-op if Telegram credentials are not configured', async () => {
    (SecretCache.get as jest.Mock).mockReturnValue(undefined);
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;

    const mockFetch = jest.fn();
    global.fetch = mockFetch;

    const messageId = await sendTelegramApprovalPrompt({
      approvalId: 'B1C2D3',
      host: 'node',
      command: 'rm -rf /',
      rule: 'ROOT_DELETION',
      reason: 'Root deletion',
      expiresInMinutes: 30
    });

    expect(messageId).toBeUndefined();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
