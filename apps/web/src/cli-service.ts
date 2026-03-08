import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';

// ── Systemd constants (Linux) ──────────────────────────────────────────
const SERVICE_NAME = 'opengram';
const UNIT_DIR = path.join(homedir(), '.config', 'systemd', 'user');
const UNIT_PATH = path.join(UNIT_DIR, `${SERVICE_NAME}.service`);

// ── Launchd constants (macOS) ──────────────────────────────────────────
const PLIST_LABEL = 'sh.opengram.server';
const PLIST_DIR = path.join(homedir(), 'Library', 'LaunchAgents');
const PLIST_PATH = path.join(PLIST_DIR, `${PLIST_LABEL}.plist`);

// ── Helpers ────────────────────────────────────────────────────────────

/**
 * Return the absolute node binary path and CLI script path for use in
 * service definitions (systemd unit / launchd plist).  We always use the
 * explicit `node + cli.js` form so that:
 *   1. We bypass the `#!/usr/bin/env node` shebang — launchd's default
 *      PATH is `/usr/bin:/bin:/usr/sbin:/sbin` and won't find node when
 *      installed via nvm/fnm/brew/volta.
 *   2. We never split a single string on spaces, which would break paths
 *      that contain whitespace.
 */
function resolveServiceExecParts(): { nodePath: string; cliPath: string } {
  const cliPath = path.resolve(
    new URL('.', import.meta.url).pathname,
    '..', '..', 'dist', 'cli', 'cli.js',
  );
  return { nodePath: process.execPath, cliPath };
}

function run(cmd: string, quiet = false): boolean {
  try {
    execSync(cmd, {
      stdio: quiet ? ['ignore', 'ignore', 'ignore'] : 'inherit',
      encoding: 'utf8',
    });
    return true;
  } catch {
    return false;
  }
}

function isLinux(): boolean {
  return process.platform === 'linux';
}

function isMacOS(): boolean {
  return process.platform === 'darwin';
}

// ── Systemd (Linux) ────────────────────────────────────────────────────

function checkSystemd(): boolean {
  if (!isLinux()) {
    console.error('Systemd service management is only supported on Linux.');
    return false;
  }

  try {
    execSync('systemctl --user --version', { stdio: ['ignore', 'ignore', 'ignore'] });
    return true;
  } catch {
    console.error('systemd user services are not available on this system.');
    return false;
  }
}

function generateUnit(home: string): string {
  const { nodePath, cliPath } = resolveServiceExecParts();

  return `[Unit]
Description=OpenGram
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=${nodePath} ${cliPath} start
Restart=always
RestartSec=2
Environment=NODE_ENV=production
Environment=OPENGRAM_HOME=${home}
Environment=PATH=${process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin'}

[Install]
WantedBy=default.target
`;
}

async function installSystemdService(home: string): Promise<boolean> {
  if (!checkSystemd()) return false;

  mkdirSync(UNIT_DIR, { recursive: true });
  writeFileSync(UNIT_PATH, generateUnit(home));
  console.log(`Service unit written to ${UNIT_PATH}`);

  run('systemctl --user daemon-reload');
  run('systemctl --user enable opengram');
  run('systemctl --user start opengram');

  // Enable lingering so the service runs after logout
  const user = process.env.USER ?? process.env.LOGNAME ?? '';
  if (user) {
    run(`loginctl enable-linger ${user}`, true);
  }

  console.log('OpenGram service installed and started.');
  console.log('  Run `opengram service logs` or `journalctl --user-unit opengram -f` to tail logs.');
  return true;
}

async function uninstallSystemdService(): Promise<boolean> {
  if (!checkSystemd()) return false;

  run('systemctl --user stop opengram', true);
  run('systemctl --user disable opengram', true);

  if (existsSync(UNIT_PATH)) {
    unlinkSync(UNIT_PATH);
    console.log(`Removed ${UNIT_PATH}`);
  }

  run('systemctl --user daemon-reload');
  console.log('OpenGram service uninstalled.');
  return true;
}

function showSystemdStatus(): void {
  if (!checkSystemd()) return;
  run('systemctl --user status opengram');
}

function showSystemdLogs(): void {
  if (!checkSystemd()) return;

  try {
    execSync('journalctl --user-unit opengram -f --no-pager', {
      stdio: 'inherit',
    });
  } catch {
    // User interrupted with Ctrl+C
  }
}

// ── Launchd (macOS) ────────────────────────────────────────────────────

function generatePlist(home: string): string {
  const { nodePath, cliPath } = resolveServiceExecParts();
  const logsDir = path.join(home, 'logs');
  const envPath = process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin';

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${PLIST_LABEL}</string>

  <key>ProgramArguments</key>
  <array>
      <string>${nodePath}</string>
      <string>${cliPath}</string>
      <string>start</string>
  </array>

  <key>RunAtLoad</key>
  <true/>

  <key>KeepAlive</key>
  <true/>

  <key>EnvironmentVariables</key>
  <dict>
    <key>NODE_ENV</key>
    <string>production</string>
    <key>OPENGRAM_HOME</key>
    <string>${home}</string>
    <key>PATH</key>
    <string>${envPath}</string>
  </dict>

  <key>StandardOutPath</key>
  <string>${path.join(logsDir, 'stdout.log')}</string>

  <key>StandardErrorPath</key>
  <string>${path.join(logsDir, 'stderr.log')}</string>
</dict>
</plist>
`;
}

async function installLaunchdService(home: string): Promise<boolean> {
  const logsDir = path.join(home, 'logs');
  mkdirSync(logsDir, { recursive: true });
  mkdirSync(PLIST_DIR, { recursive: true });

  writeFileSync(PLIST_PATH, generatePlist(home));
  console.log(`Plist written to ${PLIST_PATH}`);

  const uid = execSync('id -u', { encoding: 'utf8' }).trim();
  // Unload any existing service first (may fail if not loaded — that's OK)
  run(`launchctl bootout gui/${uid}/${PLIST_LABEL}`, true);
  // Try modern API first (`bootstrap`), fall back to deprecated `load -w`.
  // Both are quiet so only one final error is shown if both fail.
  const ok = run(`launchctl bootstrap gui/${uid} ${PLIST_PATH}`, true)
    || run(`launchctl load -w ${PLIST_PATH}`, true);
  if (!ok) {
    console.error('Failed to load the launchd service. Try: launchctl load -w ' + PLIST_PATH);
    return false;
  }

  console.log('OpenGram service installed and started.');
  return true;
}

async function uninstallLaunchdService(): Promise<boolean> {
  if (existsSync(PLIST_PATH)) {
    const uid = execSync('id -u', { encoding: 'utf8' }).trim();
    // Try modern API first (`bootout`), fall back to deprecated `unload`
    if (!run(`launchctl bootout gui/${uid}/${PLIST_LABEL}`, true)) {
      run(`launchctl unload ${PLIST_PATH}`, true);
    }
    unlinkSync(PLIST_PATH);
    console.log(`Removed ${PLIST_PATH}`);
  } else {
    console.log('No launchd service found.');
  }

  console.log('OpenGram service uninstalled.');
  return true;
}

function showLaunchdStatus(): void {
  console.log(`Looking for ${PLIST_LABEL} in launchctl...\n`);
  const found = run(`launchctl list ${PLIST_LABEL}`);
  if (!found) {
    console.log('Service is not loaded. Run `opengram service install` to install it.');
  }
}

function showLaunchdLogs(): void {
  const logsDir = path.join(homedir(), '.opengram', 'logs');
  const stdoutLog = path.join(logsDir, 'stdout.log');
  const stderrLog = path.join(logsDir, 'stderr.log');

  const logFiles = [stdoutLog, stderrLog].filter(existsSync);
  if (logFiles.length === 0) {
    console.log(`No log files found in ${logsDir}`);
    console.log('Is the service installed? Run `opengram service install` first.');
    return;
  }

  try {
    execSync(`tail -f ${logFiles.join(' ')}`, { stdio: 'inherit' });
  } catch {
    // User interrupted with Ctrl+C
  }
}

// ── Status helpers (public API) ────────────────────────────────────────

export function isServiceRunning(): boolean {
  try {
    if (isMacOS()) {
      execSync(`launchctl list ${PLIST_LABEL}`, {
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

export function isServiceInstalled(): boolean {
  if (isMacOS()) return existsSync(PLIST_PATH);
  return existsSync(UNIT_PATH);
}

// ── Router functions (public API) ──────────────────────────────────────

export async function installService(home: string): Promise<boolean> {
  if (isMacOS()) return installLaunchdService(home);
  return installSystemdService(home);
}

export async function uninstallService(): Promise<boolean> {
  if (isMacOS()) return uninstallLaunchdService();
  return uninstallSystemdService();
}

export function stopService(): void {
  if (isMacOS()) {
    const ok = run(`launchctl stop ${PLIST_LABEL}`);
    if (ok) {
      console.log('OpenGram service stopped.');
    } else {
      console.error('Failed to stop the service. Is it installed? Run `opengram service install` first.');
      process.exit(1);
    }
    return;
  }

  if (!checkSystemd()) return;
  const ok = run('systemctl --user stop opengram');
  if (ok) {
    console.log('OpenGram service stopped.');
  } else {
    console.error('Failed to stop the service. Is it installed? Run `opengram service install` first.');
    process.exit(1);
  }
}

export function startService(): void {
  if (isMacOS()) {
    const ok = run(`launchctl start ${PLIST_LABEL}`);
    if (ok) {
      console.log('OpenGram service started.');
    } else {
      console.error('Failed to start the service. Is it installed? Run `opengram service install` first.');
      process.exit(1);
    }
    return;
  }

  if (!checkSystemd()) return;
  const ok = run('systemctl --user start opengram');
  if (ok) {
    console.log('OpenGram service started.');
  } else {
    console.error('Failed to start the service. Is it installed? Run `opengram service install` first.');
    process.exit(1);
  }
}

export function restartService(): void {
  if (isMacOS()) {
    const uid = execSync('id -u', { encoding: 'utf8' }).trim();
    const ok = run(`launchctl kickstart -k gui/${uid}/${PLIST_LABEL}`);
    if (ok) {
      console.log('OpenGram service restarted.');
    } else {
      console.error('Failed to restart the service. Is it installed? Run `opengram service install` first.');
      process.exit(1);
    }
    return;
  }

  if (!checkSystemd()) return;
  const ok = run('systemctl --user restart opengram');
  if (ok) {
    console.log('OpenGram service restarted.');
  } else {
    console.error('Failed to restart the service. Is it installed? Run `opengram service install` first.');
    process.exit(1);
  }
}

export function showServiceStatus(): void {
  if (isMacOS()) return showLaunchdStatus();
  showSystemdStatus();
}

export function showServiceLogs(): void {
  if (isMacOS()) return showLaunchdLogs();
  showSystemdLogs();
}

export async function runServiceCommand(
  action: string | undefined,
  opts: { resolveHome: () => string },
): Promise<void> {
  if (!isLinux() && !isMacOS()) {
    console.error('Service management is only supported on Linux (systemd) and macOS (launchd).');
    console.log('On other platforms, run `opengram start` directly or use a process manager like pm2.');
    process.exit(1);
  }

  switch (action) {
    case 'install': {
      const home = opts.resolveHome();
      await installService(home);
      break;
    }
    case 'uninstall':
      await uninstallService();
      break;
    case 'start':
      startService();
      break;
    case 'stop':
      stopService();
      break;
    case 'restart':
      restartService();
      break;
    case 'status':
      showServiceStatus();
      break;
    case 'logs':
      showServiceLogs();
      break;
    default:
      console.error(`Unknown service action: ${action ?? '(none)'}`);
      console.log('Usage: opengram service <install|uninstall|start|stop|restart|status|logs>');
      process.exit(1);
  }
}
