import { ApprovalManager } from '../src/security/approvalManager';

// Mock Telegram sender
jest.mock('../src/security/telegram', () => ({
  sendTelegramApprovalPrompt: jest.fn().mockResolvedValue(12345),
  updateTelegramMessage: jest.fn().mockResolvedValue(undefined)
}));

describe('ApprovalManager (Interactive HITL Override)', () => {
  beforeEach(() => {
    ApprovalManager.resetForTesting();
    jest.clearAllMocks();
  });

  afterEach(() => {
    ApprovalManager.resetForTesting();
  });

  describe('Single-Use Exact Command Consumption', () => {
    it('should return false if command is not approved', () => {
      const allowed = ApprovalManager.consumeApproval('test-host', 'rm -rf /etc');
      expect(allowed).toBe(false);
    });

    it('should allow approved command ONCE and then consume it immediately', async () => {
      // 1. Initiate approval request
      const requestPromise = ApprovalManager.requestApproval({
        host: 'test-host',
        command: 'zfs destroy -r testpool/appdata',
        rule: 'ZFS_DESTRUCTION',
        reason: 'Dataset deletion',
        instantHoldMs: 100 // Short hold for test
      });

      // Let it fall back to Tier 2 (asynchronous retry window)
      const { approvalId, instantApproved } = await requestPromise;
      expect(instantApproved).toBe(false);
      expect(typeof approvalId).toBe('string');

      // 2. Admin approves on Telegram
      const actionRes = ApprovalManager.handleTelegramAction('approve', approvalId);
      expect(actionRes.success).toBe(true);

      // 3. First execution retry: MUST succeed
      const firstTry = ApprovalManager.consumeApproval('test-host', 'zfs destroy -r testpool/appdata');
      expect(firstTry).toBe(true);

      // 4. Second execution attempt: MUST fail (single-use consumption!)
      const secondTry = ApprovalManager.consumeApproval('test-host', 'zfs destroy -r testpool/appdata');
      expect(secondTry).toBe(false);
    });

    it('should NOT allow a different command even if host matches', async () => {
      const requestPromise = ApprovalManager.requestApproval({
        host: 'test-host',
        command: 'rm -rf $DIR/*',
        rule: 'UNBOUND_VAR_DELETION',
        reason: 'Unbound variable',
        instantHoldMs: 50
      });

      const { approvalId } = await requestPromise;
      ApprovalManager.handleTelegramAction('approve', approvalId);

      // Different command should NOT be approved
      expect(ApprovalManager.consumeApproval('test-host', 'rm -rf $OTHER_DIR/*')).toBe(false);
      // Different host should NOT be approved
      expect(ApprovalManager.consumeApproval('other-host', 'rm -rf $DIR/*')).toBe(false);
      // Exact command and host SHOULD be approved
      expect(ApprovalManager.consumeApproval('test-host', 'rm -rf $DIR/*')).toBe(true);
    });
  });

  describe('Tier 1: Instant Hold (0 - 30 seconds)', () => {
    it('should resolve immediately if admin taps approve within hold window', async () => {
      const requestPromise = ApprovalManager.requestApproval({
        host: 'test-host',
        command: 'docker system prune -a --volumes -f',
        rule: 'DOCKER_DESTRUCTIVE_CLEANUP',
        reason: 'Volume prune',
        instantHoldMs: 5000 // 5 second hold
      });

      // Simulate admin clicking approve 50ms later
      setTimeout(() => {
        // Pending request ID is 6-char hex
        const count = ApprovalManager.getPendingCount();
        expect(count).toBe(1);

        // Find the pending request id
        const pendingId = (ApprovalManager as any).pendingById.keys().next().value;
        ApprovalManager.handleTelegramAction('approve', pendingId);
      }, 50);

      const result = await requestPromise;
      expect(result.instantApproved).toBe(true);
    });

    it('should resolve instantApproved: false if admin taps reject within hold window', async () => {
      const requestPromise = ApprovalManager.requestApproval({
        host: 'test-host',
        command: 'chmod -R 777 /',
        rule: 'ROOT_PERM_WIPE',
        reason: 'Root chmod',
        instantHoldMs: 5000
      });

      setTimeout(() => {
        const pendingId = (ApprovalManager as any).pendingById.keys().next().value;
        ApprovalManager.handleTelegramAction('reject', pendingId);
      }, 50);

      const result = await requestPromise;
      expect(result.instantApproved).toBe(false);

      // Should not be approved for retry
      expect(ApprovalManager.consumeApproval('test-host', 'chmod -R 777 /')).toBe(false);
    });
  });

  describe('Expiration Handling', () => {
    it('should reject approval actions on expired requests', async () => {
      const requestPromise = ApprovalManager.requestApproval({
        host: 'test-host',
        command: 'dd if=/dev/zero of=/dev/sda',
        rule: 'RAW_DEVICE_OVERWRITE',
        reason: 'Zeroing device',
        instantHoldMs: 10
      });

      const { approvalId } = await requestPromise;
      const request = (ApprovalManager as any).pendingById.get(approvalId);

      // Artificially fast-forward expiration past 30 minutes
      request.expiresAt = Date.now() - 1000;

      const res = ApprovalManager.handleTelegramAction('approve', approvalId);
      expect(res.success).toBe(false);
      expect(res.message).toContain('expired');
    });
  });
});
