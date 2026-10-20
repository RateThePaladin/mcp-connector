export interface GuardrailCheckResult {
  allowed: boolean;
  rule?: string;
  reason?: string;
}

export interface SecurityRule {
  name: string;
  regex: RegExp;
  description: string;
}

export const SECURITY_RULES: SecurityRule[] = [
  // 1. Catastrophic root/home/curdir recursive deletion
  {
    name: 'ROOT_DELETION',
    regex: /\brm\s+(-[a-zA-Z0-9-]+\s+)*(-[a-zA-Z]*[rR][a-zA-Z]*|--recursive)\b(\s+-[a-zA-Z0-9-]+)*\s+(--no-preserve-root\s+)?(\/|\/\*|\/\.|\/\.\.|\.|\.\/|\.\/\*|~|~\/|~\/\*)\s*($|[;&|><])/i,
    description: 'Recursive deletion of root, home, or current directory'
  },
  // 2. Critical top-level system directory deletion
  {
    name: 'SYSTEM_DIR_DELETION',
    regex: /\brm\s+(-[a-zA-Z0-9-]+\s+)*(-[a-zA-Z]*[rR][a-zA-Z]*|--recursive)\b(\s+-[a-zA-Z0-9-]+)*\s+(\/(bin|boot|dev|etc|lib|lib64|proc|root|sbin|sys|usr|mnt)(\/|\/\*)?)\s*($|[;&|><])/i,
    description: 'Recursive deletion of top-level system directory'
  },
  // 3. Unraid array disk & share root wiping
  {
    name: 'UNRAID_ARRAY_DISK_WIPE',
    regex: /\brm\s+(-[a-zA-Z0-9-]+\s+)*(-[a-zA-Z]*[rR][a-zA-Z]*|--recursive)\b(\s+-[a-zA-Z0-9-]+)*\s+(\/mnt\/(disk[0-9]+|user|user0|core|rocket|cache|disks)(\/|\/\*)?)\s*($|[;&|><])/i,
    description: 'Recursive deletion of Unraid array disk or storage root'
  },
  // 4. Unraid flash config & parity driver tampering
  {
    name: 'UNRAID_CONFIG_TAMPER',
    regex: /(\bmdcmd\s+(stop|check\s+stop|set\s+invalidslot)\b|>\s*\/proc\/mdcmd|echo\s+.*>\s*\/proc\/mdcmd|\brm\s+(-[a-zA-Z0-9-]+\s+)*(-[a-zA-Z]*[rR][a-zA-Z]*\s+)?\/boot\/(config(\/|\/\*)?$|syslinux(\/|\/\*)?|config\/shares(\/|\/\*)?)\s*($|[;&|><])|\brm\s+(-[a-zA-Z0-9-]+\s+)*\/boot\/(config\/super\.dat|config\/ident\.cfg|config\/network\.cfg|config\/shares\/.*|syslinux\/syslinux\.cfg)|>\s*\/boot\/(config\/super\.dat|config\/ident\.cfg|config\/network\.cfg|syslinux\/syslinux\.cfg))/i,
    description: 'Tampering with Unraid parity array driver, disk assignment data, or flash boot config'
  },
  // 5. Unbound or empty variable deletion e.g. rm -rf $VAR/* or rm -rf "$VAR/" or rm -rf "/$EMPTY_VAR"
  {
    name: 'UNBOUND_VAR_DELETION',
    regex: /\brm\s+(-[a-zA-Z0-9-]+\s+)*(-[a-zA-Z]*[rR][a-zA-Z]*|--recursive)\b(\s+-[a-zA-Z0-9-]+)*\s+(["']?\$(\{?[a-zA-Z_0-9]*\}?)\/?["']?(\/|\/\*|\*|\s*($|[;&|><]))|["']?\/+["']?\$(\{?[a-zA-Z_0-9]*\}?)["']?(\/|\/\*|\s*["']?\s*($|[;&|><])))/i,
    description: 'Recursive deletion using potentially unbound variable leading to root wipe'
  },
  // 6. Docker nuclear prune with volumes or mass container/volume removal
  {
    name: 'DOCKER_DESTRUCTIVE_CLEANUP',
    regex: /\bdocker\s+(system|volume)\s+prune\b.*(--volumes|-a\s+--volumes|--volumes\s+-a|-f\b|--force\b)|\bdocker\s+(container\s+rm|rm|volume\s+rm|rmi)\b.*(\$\(docker\s+(ps|container\s+ls|images|image\s+ls|volume\s+ls)|`docker\s+(ps|container\s+ls|images|image\s+ls|volume\s+ls))/i,
    description: 'Docker volume destruction or mass container/image wipe via subshells'
  },
  // 6b. Docker container host escape / mounting root filesystem
  {
    name: 'DOCKER_ROOT_ESCAPE',
    regex: /\bdocker\s+run\b.*(-v|--volume)\s+["']?(\/:\/|\/(etc|dev|boot|root|sys|proc|mnt)[:\s])|\bdocker\s+run\b.*--privileged.*(-v|--volume)\s+["']?\/(:\/|etc|dev|mnt)|\bdocker\s+run\b.*--net=host.*--pid=host.*--privileged/i,
    description: 'Docker container host escape mounting root or system filesystem'
  },
  // 7. ZFS pool destroy, labelclear, top-level dataset destroy, mountpoint tampering, or recursive rollback
  {
    name: 'ZFS_DESTRUCTION',
    regex: /\bzpool\s+(destroy|labelclear|split)\b|\bzfs\s+destroy\s+(-[a-zA-Z0-9-]*[rR][a-zA-Z0-9-]*\s+)+([a-zA-Z0-9_-]+)(\/appdata)?\s*($|[;&|])|\bzfs\s+rollback\s+(-[a-zA-Z0-9-]*[rR][a-zA-Z0-9-]*\s+)|\bzfs\s+set\s+mountpoint=(none|\/tmp)\s+[a-zA-Z0-9_-]+\s*($|[;&|])/i,
    description: 'Destruction of ZFS storage pool, label, root dataset, or recursive rollback'
  },
  // 8. FreeBSD disk, config, & package destruction
  {
    name: 'BSD_DESTRUCTION',
    regex: /\b(gpart\s+destroy\s+-F|newfs(_msdos)?\s+.*\/dev\/|pkg\s+delete\s+(-[a-zA-Z0-9-]+\s+)*-[a-zA-Z0-9]*a[a-zA-Z0-9]*|\brm\s+(-[a-zA-Z0-9-]+\s+)*(-[a-zA-Z]*[rR][a-zA-Z]*\s+)?\/usr\/local\/etc(\/|\/\*)?)/i,
    description: 'FreeBSD disk partition destruction, formatting, config wipe, or mass package deletion'
  },
  // 9. Raw block device direct write/wipe
  {
    name: 'RAW_DEVICE_OVERWRITE',
    regex: /(\bdd\s+.*of=\/dev\/(sd[a-z]|nvme[0-9]+n(s)?[0-9]+|hd[a-z]|vd[a-z]|mmcblk[0-9]|md[0-9]|da[0-9]|ada[0-9]|vtbd[0-9])\b|(\b|^|[;&|>\s])(>|cp\s+.*)\s*\/dev\/(sd[a-z]|nvme[0-9]+n(s)?[0-9]+|hd[a-z]|vd[a-z]|mmcblk[0-9]|md[0-9]|da[0-9]|ada[0-9]|vtbd[0-9]))/i,
    description: 'Direct overwrite or truncation of raw storage block device'
  },
  // 10. Raw block device formatting / partition wipe
  {
    name: 'RAW_DEVICE_FORMAT',
    regex: /\b(mkfs(\.[a-z0-9]+)?|mke2fs|fdisk|parted|sgdisk|sfdisk|wipefs)\s+.*\/dev\/(sd[a-z]|nvme[0-9]+n(s)?[0-9]+|hd[a-z]|vd[a-z]|mmcblk[0-9]|md[0-9]|da[0-9]|ada[0-9])/i,
    description: 'Formatting, partitioning, or wiping raw storage block device signatures'
  },
  // 11. Fork bombs & DoS
  {
    name: 'FORK_BOMB',
    regex: /(:\(\)\s*\{\s*:\|:&\s*\};(\s*:)?|:\(\)\{:\|:&\};:|(\b(bomb|func)\(\)\s*\{.*\};)|perl\s+-[eE]\s+["'].*fork\s+while\s+fork["']|python[0-9]?\s+-c\s+["'].*os\.fork\(\)["'])/i,
    description: 'Fork bomb or denial-of-service process spawning attempt'
  },
  // 12. Critical auth file clobbering or deletion
  {
    name: 'AUTH_FILE_DESTRUCTION',
    regex: /(>\s*\/etc\/(passwd|shadow|sudoers|fstab|group)|(\brm\s+(-[a-zA-Z0-9-]+\s+)*)\/etc\/(passwd|shadow|sudoers|fstab|group)|cp\s+.*(\/etc\/(passwd|shadow|sudoers|fstab|group)|\/boot\/(config\/super\.dat|syslinux\/syslinux\.cfg)))/i,
    description: 'Direct truncation, overwrite, or deletion of critical system auth/config files'
  },
  // 13. Recursive root permission alterations
  {
    name: 'ROOT_PERM_WIPE',
    regex: /\b(chmod|chown)\s+-[a-zA-Z]*R[a-zA-Z]*\s+([0-7]{3,4}|[a-zA-Z0-9_:-]+)\s+(\/|\/\*|\/etc|\/etc\/\*|\/usr|\/bin|\/boot|\/mnt|\/mnt\/\*)\s*($|[;&|><])/i,
    description: 'Recursive chmod/chown on root or top-level system directories'
  }
];

/**
 * Validates a command against the security rules.
 * Pure deterministic token and regex matching.
 * Executes in < 0.1ms without external processes.
 */
export function validateCommand(command: string): GuardrailCheckResult {
  if (!command || typeof command !== 'string') {
    return { allowed: false, rule: 'MALFORMED_INPUT', reason: 'Command string cannot be empty' };
  }

  // Null byte injection check
  if (command.includes('\0')) {
    return { allowed: false, rule: 'NULL_BYTE_INJECTION', reason: 'Command contains dangerous null byte' };
  }

  for (const rule of SECURITY_RULES) {
    if (rule.regex.test(command)) {
      return {
        allowed: false,
        rule: rule.name,
        reason: rule.description
      };
    }
  }

  return { allowed: true };
}
