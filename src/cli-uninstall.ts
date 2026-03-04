import { execSync, execFileSync } from 'node:child_process';
import {
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';

import * as p from '@clack/prompts';

// ── Service file paths (mirrors cli-service.ts) ──────────────────────
const PLIST_LABEL = 'sh.opengram.server';
const PLIST_PATH = path.join(
  homedir(),
  'Library',
  'LaunchAgents',
  `${PLIST_LABEL}.plist`,
);
const UNIT_PATH = path.join(
  homedir(),
  '.config',
  'systemd',
  'user',
  'opengram.service',
);

// ── Types ─────────────────────────────────────────────────────────────

type UninstallItem =
  | 'service'
  | 'database'
  | 'uploads'
  | 'config'
  | 'logs'
  | 'env-vars'
  | 'openclaw-plugin'
  | 'self';

interface EnvVarMatch {
  filePath: string;
  lines: { lineNumber: number; content: string }[];
}

interface DetectedState {
  home: string;
  homeExists: boolean;
  serviceInstalled: boolean;
  serviceRunning: boolean;
  databaseExists: boolean;
  databaseSize: string;
  uploadsExist: boolean;
  uploadsCount: number;
  uploadsSize: string;
  configExists: boolean;
  logsExist: boolean;
  envVarFiles: EnvVarMatch[];
  tailscaleServePort: number | null;
  openclawPluginInstalled: boolean;
}

interface UninstallOpts {
  resolveHome: () => string;
  detectPkgManager: () => string;
}

// ── Helpers ───────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const val = bytes / 1024 ** i;
  return `${val < 10 ? val.toFixed(1) : Math.round(val)} ${units[i]}`;
}

function isServiceRunning(): boolean {
  try {
    if (process.platform === 'darwin') {
      execSync('launchctl list sh.opengram.server', {
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      return true;
    }
    const result = execSync('systemctl --user is-active opengram', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return result === 'active';
  } catch {
    return false;
  }
}

function isServiceInstalled(): boolean {
  if (process.platform === 'darwin') return existsSync(PLIST_PATH);
  return existsSync(UNIT_PATH);
}

function isNpmPackageInstalled(name: string): boolean {
  try {
    execSync(`npm list -g --depth=0 ${name}`, {
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return true;
  } catch {
    return false;
  }
}

/** Walk a directory tree, returning total size and file count (capped at 10k files). */
function dirStats(dir: string): { count: number; size: number } {
  let count = 0;
  let size = 0;

  function walk(d: string) {
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (count >= 10_000) return;
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else {
        count++;
        try {
          size += statSync(full).size;
        } catch {
          // skip unreadable files
        }
      }
    }
  }

  walk(dir);
  return { count, size };
}

function dbFileSize(home: string): number {
  let total = 0;
  for (const ext of ['', '-shm', '-wal']) {
    const f = path.join(home, 'data', `opengram.db${ext}`);
    try {
      total += statSync(f).size;
    } catch {
      // file doesn't exist
    }
  }
  return total;
}

// ── OpenClaw config cleanup ───────────────────────────────────────────

function resolveOpenClawStateDir(): string {
  return process.env.OPENCLAW_STATE_DIR ?? path.join(homedir(), '.openclaw');
}

function resolveOpenClawConfigPath(): string | null {
  if (process.env.OPENCLAW_CONFIG_PATH) {
    return existsSync(process.env.OPENCLAW_CONFIG_PATH)
      ? process.env.OPENCLAW_CONFIG_PATH
      : null;
  }
  const candidate = path.join(resolveOpenClawStateDir(), 'openclaw.json');
  return existsSync(candidate) ? candidate : null;
}

function isOpenClawOnPath(): boolean {
  try {
    execSync('which openclaw', { stdio: ['ignore', 'pipe', 'ignore'] });
    return true;
  } catch {
    return false;
  }
}

/**
 * Remove all Opengram-related keys from openclaw.json and delete
 * the pairing credentials file.
 */
function cleanOpenClawConfig(): void {
  const configPath = resolveOpenClawConfigPath();
  if (!configPath) return;

  try {
    const raw = readFileSync(configPath, 'utf8');
    const cfg = JSON.parse(raw) as Record<string, any>;

    // channels.opengram
    if (cfg.channels && typeof cfg.channels === 'object') {
      delete cfg.channels.opengram;
    }

    // plugins.allow — remove @opengramsh/openclaw-plugin
    if (cfg.plugins && Array.isArray(cfg.plugins.allow)) {
      cfg.plugins.allow = cfg.plugins.allow.filter(
        (p: string) => p !== '@opengramsh/openclaw-plugin',
      );
    }

    // plugins.load.paths — remove entries containing "openclaw-plugin"
    if (cfg.plugins?.load && Array.isArray(cfg.plugins.load.paths)) {
      cfg.plugins.load.paths = cfg.plugins.load.paths.filter(
        (p: string) => !p.includes('openclaw-plugin'),
      );
    }

    // plugins.entries
    if (cfg.plugins?.entries && typeof cfg.plugins.entries === 'object') {
      delete cfg.plugins.entries['@opengramsh/openclaw-plugin'];
    }

    // session.resetByChannel.opengram
    if (cfg.session?.resetByChannel && typeof cfg.session.resetByChannel === 'object') {
      delete cfg.session.resetByChannel.opengram;
    }

    writeFileSync(configPath, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
  } catch {
    // Non-fatal — warn but don't block uninstall
    p.log.warn('Could not clean up openclaw.json. You may need to edit it manually.');
  }

  // Remove pairing credentials file
  const allowFromPath = path.join(
    resolveOpenClawStateDir(),
    'credentials',
    'opengram-allowFrom.json',
  );
  try {
    if (existsSync(allowFromPath)) unlinkSync(allowFromPath);
  } catch {
    // Non-fatal
  }
}

// ── Env var detection ─────────────────────────────────────────────────

const SHELL_CONFIG_FILES = [
  '.bashrc',
  '.zshrc',
  '.profile',
  '.bash_profile',
  '.zprofile',
  '.config/fish/config.fish',
];

function detectEnvVarFiles(): EnvVarMatch[] {
  const home = homedir();
  const matches: EnvVarMatch[] = [];
  const re = /^[^#]*\bOPENGRAM_\w+/;

  for (const rel of SHELL_CONFIG_FILES) {
    const filePath = path.join(home, rel);
    if (!existsSync(filePath)) continue;

    let content: string;
    try {
      content = readFileSync(filePath, 'utf8');
    } catch {
      continue;
    }

    const matchedLines: { lineNumber: number; content: string }[] = [];
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (re.test(lines[i])) {
        matchedLines.push({ lineNumber: i + 1, content: lines[i] });
      }
    }

    if (matchedLines.length > 0) {
      matches.push({ filePath, lines: matchedLines });
    }
  }

  return matches;
}

function commentOutEnvVarLines(matches: EnvVarMatch[]): void {
  for (const { filePath, lines: matchedLines } of matches) {
    try {
      const content = readFileSync(filePath, 'utf8');
      const lines = content.split('\n');
      const lineNumbers = new Set(matchedLines.map((l) => l.lineNumber));

      for (let i = 0; i < lines.length; i++) {
        if (lineNumbers.has(i + 1)) {
          lines[i] = `# [opengram uninstall] ${lines[i]}`;
        }
      }

      writeFileSync(filePath, lines.join('\n'), 'utf8');
    } catch {
      p.log.warn(`Could not update ${filePath}. You may need to edit it manually.`);
    }
  }
}

// ── Tailscale detection ───────────────────────────────────────────────

function readServerPort(home: string): number {
  try {
    const configPath = path.join(home, 'opengram.config.json');
    const raw = readFileSync(configPath, 'utf8');
    const cfg = JSON.parse(raw) as Record<string, any>;
    if (typeof cfg.server?.port === 'number') return cfg.server.port;
  } catch {
    // fall through to default
  }
  return 3000;
}

function detectTailscaleServe(serverPort: number): number | null {
  try {
    const output = execFileSync('tailscale', ['serve', 'status', '--json'], {
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const status = JSON.parse(output) as Record<string, any>;
    const web = status.Web as Record<string, any> | undefined;
    if (!web) return null;

    const target = `127.0.0.1:${serverPort}`;
    for (const [portKey, handlers] of Object.entries(web)) {
      if (typeof handlers !== 'object' || handlers === null) continue;
      for (const handler of Object.values(handlers as Record<string, any>)) {
        if (
          typeof handler === 'object' &&
          handler !== null &&
          typeof (handler as any).Proxy === 'string' &&
          (handler as any).Proxy.includes(target)
        ) {
          // Extract port number from key like "https:8443"
          const match = portKey.match(/:(\d+)$/);
          return match ? parseInt(match[1], 10) : null;
        }
      }
    }
  } catch {
    // tailscale not installed or serve not configured — ignore
  }
  return null;
}

// ── Detection ─────────────────────────────────────────────────────────

function detect(home: string): DetectedState {
  const homeExists = existsSync(home);
  const databaseExists = existsSync(path.join(home, 'data', 'opengram.db'));
  const uploadsDir = path.join(home, 'data', 'uploads');
  const uploadsExist = existsSync(uploadsDir);
  const uploads = uploadsExist ? dirStats(uploadsDir) : { count: 0, size: 0 };

  const serverPort = readServerPort(home);

  return {
    home,
    homeExists,
    serviceInstalled: isServiceInstalled(),
    serviceRunning: isServiceRunning(),
    databaseExists,
    databaseSize: databaseExists ? formatBytes(dbFileSize(home)) : '0 B',
    uploadsExist,
    uploadsCount: uploads.count,
    uploadsSize: formatBytes(uploads.size),
    configExists: existsSync(path.join(home, 'opengram.config.json')),
    logsExist: existsSync(path.join(home, 'logs')),
    envVarFiles: detectEnvVarFiles(),
    tailscaleServePort: detectTailscaleServe(serverPort),
    openclawPluginInstalled: isNpmPackageInstalled(
      '@opengramsh/openclaw-plugin',
    ),
  };
}

// ── Main ──────────────────────────────────────────────────────────────

export async function runUninstallWizard(opts: UninstallOpts): Promise<void> {
  const home = opts.resolveHome();
  const pm = opts.detectPkgManager();
  const state = detect(home);

  p.intro('OpenGram Uninstall');

  // Build options from detected state
  const options: { value: UninstallItem; label: string; hint?: string }[] = [];

  if (state.serviceInstalled) {
    options.push({
      value: 'service',
      label: 'Background service',
      hint: state.serviceRunning ? 'currently running' : 'installed, not running',
    });
  }

  if (state.databaseExists) {
    options.push({
      value: 'database',
      label: `Database — all chats and messages (${state.databaseSize})`,
    });
  }

  if (state.uploadsExist) {
    options.push({
      value: 'uploads',
      label: `Uploaded files (${state.uploadsCount} files, ${state.uploadsSize})`,
    });
  }

  if (state.configExists) {
    options.push({
      value: 'config',
      label: 'Configuration (opengram.config.json)',
    });
  }

  if (state.logsExist) {
    options.push({
      value: 'logs',
      label: 'Logs (~/.opengram/logs)',
    });
  }

  if (state.envVarFiles.length > 0) {
    const totalLines = state.envVarFiles.reduce((sum, m) => sum + m.lines.length, 0);
    const fileNames = state.envVarFiles.map((m) => path.basename(m.filePath)).join(', ');
    options.push({
      value: 'env-vars',
      label: `Environment variables (${totalLines} line${totalLines === 1 ? '' : 's'} in ${fileNames})`,
    });
  }

  if (state.openclawPluginInstalled) {
    options.push({
      value: 'openclaw-plugin',
      label: 'OpenClaw plugin (@opengramsh/openclaw-plugin)',
    });
  }

  // Self-uninstall is always last
  options.push({
    value: 'self',
    label: 'Opengram CLI (@opengramsh/opengram)',
  });

  if (options.length === 1 && options[0].value === 'self' && !state.homeExists) {
    p.log.info('Nothing to uninstall.');
    p.outro('');
    return;
  }

  // Multiselect — pre-select everything so the user opts out of what to keep
  const selected = await p.multiselect<UninstallItem>({
    message: 'What would you like to remove? (press space to toggle)',
    options,
    initialValues: options.map((o) => o.value),
    required: true,
  });

  if (p.isCancel(selected)) {
    p.cancel('Uninstall cancelled.');
    return;
  }

  const sel = new Set(selected);

  // Build summary lines
  const summaryLines: string[] = [];
  if (sel.has('service')) summaryLines.push('Stop and remove the background service');
  if (sel.has('database')) summaryLines.push(`Database (${state.databaseSize})`);
  if (sel.has('uploads'))
    summaryLines.push(`Uploaded files (${state.uploadsCount} files, ${state.uploadsSize})`);
  if (sel.has('config')) summaryLines.push('Configuration');
  if (sel.has('logs')) summaryLines.push('Logs');
  if (sel.has('env-vars')) summaryLines.push('Comment out OPENGRAM_* env vars from shell configs');
  if (sel.has('openclaw-plugin'))
    summaryLines.push('Uninstall @opengramsh/openclaw-plugin and remove OpenClaw config');
  if (sel.has('self')) summaryLines.push('Uninstall @opengramsh/opengram');

  p.note(summaryLines.map((l) => `• ${l}`).join('\n'), 'The following will be permanently deleted');

  const proceed = await p.confirm({
    message: 'Proceed?',
    initialValue: false,
  });

  if (p.isCancel(proceed) || !proceed) {
    p.cancel('Uninstall cancelled.');
    return;
  }

  // Determine if we should clean up the entire home dir
  const allDataItems: UninstallItem[] = ['database', 'uploads', 'config', 'logs'];
  const removeHome =
    state.homeExists && allDataItems.every((item) => !options.some((o) => o.value === item) || sel.has(item));

  // Execute
  await p.tasks([
    {
      title: 'Stopping and removing background service',
      enabled: sel.has('service'),
      task: async () => {
        const { uninstallService } = await import('./cli-service.js');
        await uninstallService();
        return 'Service removed';
      },
    },
    {
      title: 'Deleting database',
      enabled: sel.has('database'),
      task: () => {
        for (const ext of ['', '-shm', '-wal']) {
          const f = path.join(home, 'data', `opengram.db${ext}`);
          if (existsSync(f)) unlinkSync(f);
        }
        return 'Database deleted';
      },
    },
    {
      title: 'Deleting uploaded files',
      enabled: sel.has('uploads'),
      task: () => {
        rmSync(path.join(home, 'data', 'uploads'), {
          recursive: true,
          force: true,
        });
        return 'Uploads deleted';
      },
    },
    {
      title: 'Deleting configuration',
      enabled: sel.has('config'),
      task: () => {
        const configPath = path.join(home, 'opengram.config.json');
        if (existsSync(configPath)) unlinkSync(configPath);
        return 'Config deleted';
      },
    },
    {
      title: 'Deleting logs',
      enabled: sel.has('logs'),
      task: () => {
        rmSync(path.join(home, 'logs'), { recursive: true, force: true });
        return 'Logs deleted';
      },
    },
    {
      title: 'Commenting out OPENGRAM_* env vars',
      enabled: sel.has('env-vars'),
      task: () => {
        commentOutEnvVarLines(state.envVarFiles);
        return 'Environment variables commented out';
      },
    },
    {
      title: `Removing ${home}`,
      enabled: removeHome,
      task: () => {
        rmSync(home, { recursive: true, force: true });
        return 'Home directory removed';
      },
    },
    {
      title: 'Uninstalling OpenClaw plugin and cleaning config',
      enabled: sel.has('openclaw-plugin'),
      task: () => {
        cleanOpenClawConfig();
        execSync(`${pm} uninstall -g @opengramsh/openclaw-plugin`, {
          stdio: ['ignore', 'pipe', 'ignore'],
        });
        return 'Plugin uninstalled, config cleaned';
      },
    },
    {
      title: 'Uninstalling Opengram CLI',
      enabled: sel.has('self'),
      task: () => {
        execSync(`${pm} uninstall -g @opengramsh/opengram`, {
          stdio: ['ignore', 'pipe', 'ignore'],
        });
        return 'Opengram uninstalled';
      },
    },
  ]);

  // Hint to reload shell config after env var removal
  if (sel.has('env-vars')) {
    const shellFiles = state.envVarFiles.map((m) => path.basename(m.filePath));
    const sourceCmd = shellFiles.map((f) => `source ~/${f}`).join(' && ');
    p.log.info(`Reload your shell config to apply changes:\n  ${sourceCmd}`);
  }

  // Offer to restart the OpenClaw gateway so it picks up config changes
  if (sel.has('openclaw-plugin') && isOpenClawOnPath()) {
    const restart = await p.confirm({
      message: 'Restart OpenClaw gateway to apply config changes?',
      initialValue: true,
    });

    if (!p.isCancel(restart) && restart) {
      try {
        execSync('openclaw service restart', { stdio: 'inherit' });
      } catch {
        p.log.warn('Could not restart the OpenClaw gateway. Run `openclaw service restart` manually.');
      }
    } else {
      p.log.info('Run `openclaw service restart` to apply the config changes.');
    }
  }

  // Warn about Tailscale still serving traffic to Opengram
  if (state.tailscaleServePort !== null) {
    p.log.warn(
      `Tailscale is still serving traffic to Opengram on HTTPS port ${state.tailscaleServePort}.\n` +
        `  To stop it, run:\n` +
        `  sudo tailscale serve --https=${state.tailscaleServePort} off`,
    );
  }

  p.outro('Opengram has been uninstalled. Goodbye!');
}
