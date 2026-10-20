import { validateCommand } from '../src/security/guardrail';

describe('Security Guardrail Engine', () => {
  describe('Input Validation & Edge Cases', () => {
    it('should reject empty or undefined commands', () => {
      expect(validateCommand('')).toEqual({
        allowed: false,
        rule: 'MALFORMED_INPUT',
        reason: 'Command string cannot be empty'
      });
      expect(validateCommand(null as any)).toEqual({
        allowed: false,
        rule: 'MALFORMED_INPUT',
        reason: 'Command string cannot be empty'
      });
    });

    it('should reject null-byte injections', () => {
      const res = validateCommand('echo hello\0 && rm -rf /');
      expect(res.allowed).toBe(false);
      expect(res.rule).toBe('NULL_BYTE_INJECTION');
    });
  });

  describe('Rule Coverage: Synthetic Catastrophic & Hallucinated Commands', () => {
    const attackPayloads: { cmd: string; expectedRule: string }[] = [
      // 1. Root deletions
      { cmd: 'rm -rf /', expectedRule: 'ROOT_DELETION' },
      { cmd: 'rm -fr /', expectedRule: 'ROOT_DELETION' },
      { cmd: 'rm -r -f /', expectedRule: 'ROOT_DELETION' },
      { cmd: 'rm -f -r /', expectedRule: 'ROOT_DELETION' },
      { cmd: 'rm --recursive --force /', expectedRule: 'ROOT_DELETION' },
      { cmd: 'rm -rf /*', expectedRule: 'ROOT_DELETION' },
      { cmd: 'rm -rf /.', expectedRule: 'ROOT_DELETION' },
      { cmd: 'rm -rf /..', expectedRule: 'ROOT_DELETION' },
      { cmd: 'rm -rf .', expectedRule: 'ROOT_DELETION' },
      { cmd: 'rm -rf ./', expectedRule: 'ROOT_DELETION' },
      { cmd: 'rm -rf ./*', expectedRule: 'ROOT_DELETION' },
      { cmd: 'rm -rf ~', expectedRule: 'ROOT_DELETION' },
      { cmd: 'rm -rf ~/', expectedRule: 'ROOT_DELETION' },
      { cmd: 'rm -rf ~/*', expectedRule: 'ROOT_DELETION' },
      { cmd: 'sudo rm -rf /', expectedRule: 'ROOT_DELETION' },
      { cmd: 'rm -rf --no-preserve-root /', expectedRule: 'ROOT_DELETION' },

      // 2. System directory deletions
      { cmd: 'rm -rf /etc', expectedRule: 'SYSTEM_DIR_DELETION' },
      { cmd: 'rm -rf /etc/', expectedRule: 'SYSTEM_DIR_DELETION' },
      { cmd: 'rm -rf /etc/*', expectedRule: 'SYSTEM_DIR_DELETION' },
      { cmd: 'rm -rf /bin', expectedRule: 'SYSTEM_DIR_DELETION' },
      { cmd: 'rm -rf /boot', expectedRule: 'SYSTEM_DIR_DELETION' },
      { cmd: 'rm -rf /usr', expectedRule: 'SYSTEM_DIR_DELETION' },
      { cmd: 'rm -rf /lib', expectedRule: 'SYSTEM_DIR_DELETION' },
      { cmd: 'rm -rf /dev', expectedRule: 'SYSTEM_DIR_DELETION' },
      { cmd: 'rm -rf /proc', expectedRule: 'SYSTEM_DIR_DELETION' },
      { cmd: 'rm -rf /sys', expectedRule: 'SYSTEM_DIR_DELETION' },
      { cmd: 'rm -rf /root', expectedRule: 'SYSTEM_DIR_DELETION' },

      // 3. Unraid array disk & storage root wipes
      { cmd: 'rm -rf /mnt/disk1', expectedRule: 'UNRAID_ARRAY_DISK_WIPE' },
      { cmd: 'rm -rf /mnt/disk2/*', expectedRule: 'UNRAID_ARRAY_DISK_WIPE' },
      { cmd: 'rm -rf /mnt/user', expectedRule: 'UNRAID_ARRAY_DISK_WIPE' },
      { cmd: 'rm -rf /mnt/user/*', expectedRule: 'UNRAID_ARRAY_DISK_WIPE' },
      { cmd: 'rm -rf /mnt/core/*', expectedRule: 'UNRAID_ARRAY_DISK_WIPE' },
      { cmd: 'rm -rf /mnt/rocket/*', expectedRule: 'UNRAID_ARRAY_DISK_WIPE' },
      { cmd: 'rm -rf /mnt/cache/*', expectedRule: 'UNRAID_ARRAY_DISK_WIPE' },

      // 4. Unraid flash config & parity driver tampering
      { cmd: 'mdcmd stop', expectedRule: 'UNRAID_CONFIG_TAMPER' },
      { cmd: 'mdcmd check stop', expectedRule: 'UNRAID_CONFIG_TAMPER' },
      { cmd: 'mdcmd set invalidslot 1', expectedRule: 'UNRAID_CONFIG_TAMPER' },
      { cmd: '> /proc/mdcmd', expectedRule: 'UNRAID_CONFIG_TAMPER' },
      { cmd: 'echo "stop" > /proc/mdcmd', expectedRule: 'UNRAID_CONFIG_TAMPER' },
      { cmd: 'rm -rf /boot/config', expectedRule: 'UNRAID_CONFIG_TAMPER' },
      { cmd: 'rm -rf /boot/config/*', expectedRule: 'UNRAID_CONFIG_TAMPER' },
      { cmd: 'rm -rf /boot/syslinux', expectedRule: 'UNRAID_CONFIG_TAMPER' },
      { cmd: 'rm -f /boot/config/super.dat', expectedRule: 'UNRAID_CONFIG_TAMPER' },
      { cmd: '> /boot/config/super.dat', expectedRule: 'UNRAID_CONFIG_TAMPER' },
      { cmd: 'rm -f /boot/config/ident.cfg', expectedRule: 'UNRAID_CONFIG_TAMPER' },

      // 5. Unbound & hallucinated variables
      { cmd: 'rm -rf $DIR/*', expectedRule: 'UNBOUND_VAR_DELETION' },
      { cmd: 'rm -rf "$DIR"/*', expectedRule: 'UNBOUND_VAR_DELETION' },
      { cmd: 'rm -rf "${DIR}"/*', expectedRule: 'UNBOUND_VAR_DELETION' },
      { cmd: 'rm -rf "$DIR/"', expectedRule: 'UNBOUND_VAR_DELETION' },
      { cmd: 'rm -rf $EMPTY_VAR/', expectedRule: 'UNBOUND_VAR_DELETION' },
      { cmd: 'rm -rf "/$EMPTY_VAR"', expectedRule: 'UNBOUND_VAR_DELETION' },
      { cmd: 'rm -rf /${SUBDIR}/*', expectedRule: 'UNBOUND_VAR_DELETION' },
      { cmd: 'rm -rf $1/*', expectedRule: 'UNBOUND_VAR_DELETION' },

      // 6. Docker nuclear prune & mass removals
      { cmd: 'docker system prune -a --volumes -f', expectedRule: 'DOCKER_DESTRUCTIVE_CLEANUP' },
      { cmd: 'docker system prune --volumes -f', expectedRule: 'DOCKER_DESTRUCTIVE_CLEANUP' },
      { cmd: 'docker volume prune -f', expectedRule: 'DOCKER_DESTRUCTIVE_CLEANUP' },
      { cmd: 'docker volume prune -a --force', expectedRule: 'DOCKER_DESTRUCTIVE_CLEANUP' },
      { cmd: 'docker rm -f $(docker ps -aq)', expectedRule: 'DOCKER_DESTRUCTIVE_CLEANUP' },
      { cmd: 'docker container rm -f $(docker container ls -aq)', expectedRule: 'DOCKER_DESTRUCTIVE_CLEANUP' },
      { cmd: 'docker volume rm $(docker volume ls -q)', expectedRule: 'DOCKER_DESTRUCTIVE_CLEANUP' },
      { cmd: 'docker rmi -f $(docker images -q)', expectedRule: 'DOCKER_DESTRUCTIVE_CLEANUP' },

      // 6b. Docker root host escape
      { cmd: 'docker run -v /:/host --privileged alpine', expectedRule: 'DOCKER_ROOT_ESCAPE' },
      { cmd: 'docker run -v /:/rootfs -d ubuntu', expectedRule: 'DOCKER_ROOT_ESCAPE' },
      { cmd: 'docker run -v /etc:/etc-host --privileged alpine', expectedRule: 'DOCKER_ROOT_ESCAPE' },
      { cmd: 'docker run --net=host --pid=host --privileged alpine', expectedRule: 'DOCKER_ROOT_ESCAPE' },

      // 7. ZFS pool & dataset destruction
      { cmd: 'zpool destroy testpool', expectedRule: 'ZFS_DESTRUCTION' },
      { cmd: 'zpool destroy -f testpool', expectedRule: 'ZFS_DESTRUCTION' },
      { cmd: 'zpool labelclear /dev/sda', expectedRule: 'ZFS_DESTRUCTION' },
      { cmd: 'zpool split testpool', expectedRule: 'ZFS_DESTRUCTION' },
      { cmd: 'zfs destroy -r testpool', expectedRule: 'ZFS_DESTRUCTION' },
      { cmd: 'zfs destroy -r testpool/appdata', expectedRule: 'ZFS_DESTRUCTION' },
      { cmd: 'zfs rollback -r testpool@snapshot', expectedRule: 'ZFS_DESTRUCTION' },
      { cmd: 'zfs set mountpoint=none testpool', expectedRule: 'ZFS_DESTRUCTION' },

      // 8. FreeBSD disk & package destruction
      { cmd: 'gpart destroy -F da0', expectedRule: 'BSD_DESTRUCTION' },
      { cmd: 'newfs /dev/da0', expectedRule: 'BSD_DESTRUCTION' },
      { cmd: 'pkg delete -a -f', expectedRule: 'BSD_DESTRUCTION' },
      { cmd: 'rm -rf /usr/local/etc', expectedRule: 'BSD_DESTRUCTION' },

      // 9. Raw block device overwrites
      { cmd: 'dd if=/dev/zero of=/dev/sda', expectedRule: 'RAW_DEVICE_OVERWRITE' },
      { cmd: 'dd if=/dev/urandom of=/dev/nvme0n1 bs=1M', expectedRule: 'RAW_DEVICE_OVERWRITE' },
      { cmd: 'dd of=/dev/sda if=/dev/zero', expectedRule: 'RAW_DEVICE_OVERWRITE' },
      { cmd: 'cat /dev/zero > /dev/sda', expectedRule: 'RAW_DEVICE_OVERWRITE' },
      { cmd: '> /dev/sda', expectedRule: 'RAW_DEVICE_OVERWRITE' },
      { cmd: '> /dev/nvme0n1', expectedRule: 'RAW_DEVICE_OVERWRITE' },
      { cmd: 'cp /dev/null /dev/sda', expectedRule: 'RAW_DEVICE_OVERWRITE' },

      // 10. Raw block device formatting
      { cmd: 'mkfs.ext4 /dev/sda', expectedRule: 'RAW_DEVICE_FORMAT' },
      { cmd: 'mkfs.xfs -f /dev/sdb', expectedRule: 'RAW_DEVICE_FORMAT' },
      { cmd: 'fdisk /dev/sda', expectedRule: 'RAW_DEVICE_FORMAT' },
      { cmd: 'parted /dev/sda rm 1', expectedRule: 'RAW_DEVICE_FORMAT' },
      { cmd: 'sgdisk -Z /dev/sda', expectedRule: 'RAW_DEVICE_FORMAT' },
      { cmd: 'wipefs -af /dev/nvme0n1', expectedRule: 'RAW_DEVICE_FORMAT' },

      // 11. Fork bombs
      { cmd: ':(){ :|:& };:', expectedRule: 'FORK_BOMB' },
      { cmd: ':(){ :|:& }; : ', expectedRule: 'FORK_BOMB' },
      { cmd: 'bomb() { bomb | bomb & }; bomb', expectedRule: 'FORK_BOMB' },
      { cmd: 'perl -e "fork while fork"', expectedRule: 'FORK_BOMB' },
      { cmd: 'python3 -c "import os; while 1: os.fork()"', expectedRule: 'FORK_BOMB' },

      // 12. Critical auth & boot files
      { cmd: '> /etc/passwd', expectedRule: 'AUTH_FILE_DESTRUCTION' },
      { cmd: '> /etc/shadow', expectedRule: 'AUTH_FILE_DESTRUCTION' },
      { cmd: '> /etc/sudoers', expectedRule: 'AUTH_FILE_DESTRUCTION' },
      { cmd: 'rm /etc/passwd', expectedRule: 'AUTH_FILE_DESTRUCTION' },
      { cmd: 'rm -f /etc/shadow', expectedRule: 'AUTH_FILE_DESTRUCTION' },
      { cmd: 'cp /dev/null /etc/passwd', expectedRule: 'AUTH_FILE_DESTRUCTION' },
      { cmd: 'cp /dev/null /boot/config/super.dat', expectedRule: 'AUTH_FILE_DESTRUCTION' },

      // 13. Catastrophic permissions
      { cmd: 'chmod -R 777 /', expectedRule: 'ROOT_PERM_WIPE' },
      { cmd: 'chmod -R 000 /', expectedRule: 'ROOT_PERM_WIPE' },
      { cmd: 'chmod -R 777 /*', expectedRule: 'ROOT_PERM_WIPE' },
      { cmd: 'chmod -R 777 /etc', expectedRule: 'ROOT_PERM_WIPE' },
      { cmd: 'chown -R nobody:users /', expectedRule: 'ROOT_PERM_WIPE' }
    ];

    test.each(attackPayloads)('should block "$cmd" with rule $expectedRule', ({ cmd, expectedRule }) => {
      const res = validateCommand(cmd);
      expect(res.allowed).toBe(false);
      expect(res.rule).toBe(expectedRule);
    });
  });

  describe('Legitimate Administrative Workloads (Zero False Positives)', () => {
    const safeCommands = [
      'df -h /mnt/core /mnt/rocket',
      'docker ps --format "table {{.Names}}\\t{{.Status}}"',
      'docker restart test-container',
      'docker logs --tail 100 test-container',
      'docker image prune -f',
      'docker builder prune -f',
      'dd if=/dev/urandom of=/dev/null bs=1M count=50',
      'dd if=/dev/zero of=/dev/null bs=1M count=200',
      'rm -f /tmp/test.db /tmp/test_backup.db',
      'rm -rf /tmp/my-temp-dir',
      'rm -rf /root/stale_appdata',
      'rm -f /boot/config/plugins/dockerMan/templates-user/my-app.xml.bak',
      'zfs list -o name,used,avail',
      'zfs snapshot core/appdata/test@snap_20261020',
      'zfs destroy core/appdata/test@snap_20261020',
      'zfs destroy -r core/appdata/test_old_migration',
      'cat /etc/nginx/nginx.conf',
      'tail -n 50 /var/log/syslog',
      'systemctl status docker',
      'sqlite3 /mnt/core/appdata/test/test.db "PRAGMA integrity_check;"',
      'chmod 644 /mnt/core/appdata/test/config.xml',
      'chown nobody:users /mnt/core/appdata/test/config.xml'
    ];

    test.each(safeCommands)('should allow safe command: "%s"', (cmd) => {
      const res = validateCommand(cmd);
      expect(res.allowed).toBe(true);
      expect(res.rule).toBeUndefined();
    });
  });
});
