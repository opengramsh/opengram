import { execFileSync, execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

import * as p from '@clack/prompts';

type WizardOpts = {
  pkgRoot: string;
  resolveHome: () => string;
};

function getTailscaleHostname(): string | undefined {
  try {
    const raw = execSync('tailscale status --json', {
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString('utf8');

    const status = JSON.parse(raw) as { Self?: { DNSName?: string } };
    const dnsName = status.Self?.DNSName?.replace(/\.$/, '');
    return dnsName || undefined;
  } catch {
    return undefined;
  }
}

function generateSecret(): string {
  return 'og_' + randomBytes(24).toString('base64url');
}

function isOpenClawInstalled(): boolean {
  try {
    execSync('which openclaw', { stdio: ['ignore', 'pipe', 'ignore'] });
    return true;
  } catch {
    return false;
  }
}

function getVersion(pkgRoot: string): string {
  try {
    const pkg = JSON.parse(readFileSync(path.join(pkgRoot, 'package.json'), 'utf8'));
    return pkg.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

export async function runInitWizard(opts: WizardOpts): Promise<void> {
  const home = opts.resolveHome();

  p.intro(`OpenGram v${getVersion(opts.pkgRoot)} Setup`);

  // Check for existing config
  const configPath = path.join(home, 'opengram.config.json');
  if (existsSync(configPath)) {
    const overwrite = await p.confirm({
      message: `Config already exists at ${configPath}. Overwrite?`,
      initialValue: false,
    });
    if (p.isCancel(overwrite) || !overwrite) {
      p.outro('Setup cancelled.');
      return;
    }
  }

  // 1. Server port
  const port = await p.text({
    message: 'Server port',
    placeholder: '3000',
    defaultValue: '3000',
    validate: (val) => {
      const n = Number(val);
      if (!Number.isInteger(n) || n < 1 || n > 65535) {
        return 'Port must be between 1 and 65535';
      }
    },
  });
  if (p.isCancel(port)) { p.outro('Setup cancelled.'); return; }

  const portNum = Number(port);

  // 2. Public base URL — try Tailscale auto-detect
  const tsHostname = getTailscaleHostname();
  let defaultUrl = `http://localhost:${portNum}`;
  if (tsHostname) {
    defaultUrl = `https://${tsHostname}`;
    p.note(`Tailscale detected: ${tsHostname}`, 'Network');
  }

  const publicUrl = await p.text({
    message: 'Public base URL',
    placeholder: defaultUrl,
    defaultValue: defaultUrl,
  });
  if (p.isCancel(publicUrl)) { p.outro('Setup cancelled.'); return; }

  // 3. Instance secret
  const secretChoice = await p.select({
    message: 'Instance secret (protects API access)',
    options: [
      { value: 'generate', label: 'Auto-generate a secret', hint: 'recommended' },
      { value: 'custom', label: 'Enter a custom secret' },
      { value: 'none', label: 'No secret', hint: 'not recommended for network access' },
    ],
  });
  if (p.isCancel(secretChoice)) { p.outro('Setup cancelled.'); return; }

  let instanceSecret = '';
  let instanceSecretEnabled = false;

  if (secretChoice === 'generate') {
    instanceSecret = generateSecret();
    instanceSecretEnabled = true;
  } else if (secretChoice === 'custom') {
    const customSecret = await p.text({
      message: 'Enter your instance secret',
      validate: (val) => {
        if (!val.trim()) return 'Secret cannot be empty';
      },
    });
    if (p.isCancel(customSecret)) { p.outro('Setup cancelled.'); return; }
    instanceSecret = customSecret;
    instanceSecretEnabled = true;
  }

  // 4. OpenClaw detection
  if (isOpenClawInstalled()) {
    p.note('OpenClaw CLI detected on PATH', 'Integrations');
    const connectOpenClaw = await p.confirm({
      message: 'Connect OpenGram to OpenClaw?',
      initialValue: true,
    });
    if (!p.isCancel(connectOpenClaw) && connectOpenClaw) {
      const pluginSpinner = p.spinner();
      pluginSpinner.start('Installing openclaw-plugin-opengram...');
      try {
        execSync('npm install -g openclaw-plugin-opengram', {
          stdio: ['ignore', 'pipe', 'ignore'],
          timeout: 120000,
        });
        pluginSpinner.stop('Plugin installed.');
      } catch {
        pluginSpinner.stop('Plugin install failed — you can install it later with:\n  npm i -g openclaw-plugin-opengram');
      }

      // Chain into the OpenClaw setup wizard with pre-filled values
      try {
        const setupArgs = ['opengram', 'setup', '--base-url', publicUrl];
        if (instanceSecretEnabled) {
          setupArgs.push('--instance-secret', instanceSecret);
        } else {
          setupArgs.push('--no-instance-secret');
        }
        execFileSync('openclaw', setupArgs, { stdio: 'inherit' });
      } catch {
        p.note(
          'OpenClaw setup did not complete.\nYou can run `openclaw opengram setup` later.',
          'Note',
        );
      }
    }
  }

  // 5. Generate config
  const config: Record<string, unknown> = {};

  // Only write non-default values
  const serverConfig: Record<string, unknown> = {};
  if (portNum !== 3000) serverConfig.port = portNum;
  if (publicUrl !== 'http://localhost:3000') serverConfig.publicBaseUrl = publicUrl;
  if (Object.keys(serverConfig).length > 0) config.server = serverConfig;

  if (instanceSecretEnabled) {
    config.security = {
      instanceSecretEnabled: true,
      instanceSecret,
    };
  }

  // Write config
  mkdirSync(home, { recursive: true });
  mkdirSync(path.join(home, 'data'), { recursive: true });
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf8');

  p.note(configPath, 'Config written');

  // 6. Systemd service (Linux only)
  if (process.platform === 'linux') {
    const installSvc = await p.confirm({
      message: 'Start OpenGram automatically on boot? (systemd user service)',
      initialValue: true,
    });

    if (!p.isCancel(installSvc) && installSvc) {
      const { installService } = await import('./cli-service.js');
      const svcSpinner = p.spinner();
      svcSpinner.start('Installing systemd service...');
      const ok = await installService(home);
      if (ok) {
        svcSpinner.stop('Service installed and started.');
      } else {
        svcSpinner.stop('Service installation failed. You can run `opengram service install` later.');
      }
    }
  } else {
    p.note('Run `opengram start` to start the server.\nFor auto-start on macOS, consider using a process manager like pm2.', 'Startup');
  }

  // 7. Print summary
  const lines: string[] = [
    `Config:    ${configPath}`,
    `Data:      ${path.join(home, 'data')}`,
    `Database:  ${path.join(home, 'data', 'opengram.db')}`,
    `Server:    ${publicUrl}`,
  ];
  if (instanceSecretEnabled) {
    lines.push(`Secret:    ${instanceSecret}`);
  }

  p.note(lines.join('\n'), 'Summary');

  if (process.platform !== 'linux') {
    p.outro('Run `opengram start` to start the server.');
  } else {
    p.outro('Setup complete!');
  }
}
