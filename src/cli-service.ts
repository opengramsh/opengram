import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';

const SERVICE_NAME = 'opengram';
const UNIT_DIR = path.join(homedir(), '.config', 'systemd', 'user');
const UNIT_PATH = path.join(UNIT_DIR, `${SERVICE_NAME}.service`);

function resolveExecStart(): string {
  // Try to find the opengram binary on PATH
  try {
    const which = execSync('which opengram', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (which) return which;
  } catch {
    // not on PATH
  }

  // Fall back to node + the CLI script
  const cliPath = path.resolve(
    new URL('.', import.meta.url).pathname,
    '..', '..', 'dist', 'cli', 'cli.js',
  );
  return `${process.execPath} ${cliPath}`;
}

function generateUnit(home: string): string {
  const execStart = resolveExecStart();

  return `[Unit]
Description=OpenGram
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=${execStart} start
Restart=always
RestartSec=2
Environment=NODE_ENV=production
Environment=OPENGRAM_HOME=${home}

[Install]
WantedBy=default.target
`;
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

function checkSystemd(): boolean {
  if (!isLinux()) {
    console.error('Systemd service management is only supported on Linux.');
    console.log('On macOS, run `opengram start` directly or use a process manager like pm2.');
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

export async function installService(home: string): Promise<boolean> {
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
  return true;
}

export async function uninstallService(): Promise<boolean> {
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

export function showServiceStatus(): void {
  if (!checkSystemd()) return;
  run('systemctl --user status opengram');
}

export function showServiceLogs(): void {
  if (!checkSystemd()) return;

  try {
    execSync('journalctl --user-unit opengram -f --no-pager', {
      stdio: 'inherit',
    });
  } catch {
    // User interrupted with Ctrl+C
  }
}

export async function runServiceCommand(
  action: string | undefined,
  opts: { resolveHome: () => string },
): Promise<void> {
  switch (action) {
    case 'install': {
      const home = opts.resolveHome();
      await installService(home);
      break;
    }
    case 'uninstall':
      await uninstallService();
      break;
    case 'status':
      showServiceStatus();
      break;
    case 'logs':
      showServiceLogs();
      break;
    default:
      console.error(`Unknown service action: ${action ?? '(none)'}`);
      console.log('Usage: opengram service <install|uninstall|status|logs>');
      process.exit(1);
  }
}
