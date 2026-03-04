import { execFileSync, execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

import * as p from '@clack/prompts';

type WizardOpts = {
  pkgRoot: string;
  resolveHome: () => string;
};

/** Check if a TCP port is available by attempting to listen on it. */
function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.once('error', () => resolve(false));
    srv.listen(port, '127.0.0.1', () => srv.close(() => resolve(true)));
  });
}

/** Find the first available port from a list of candidates. */
async function findAvailablePort(candidates: number[]): Promise<number> {
  for (const port of candidates) {
    if (await isPortAvailable(port)) return port;
  }
  return candidates[0]; // fallback — validation will catch it
}

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

/** Parse `tailscale serve status --json` → set of HTTPS ports in use. */
function getTailscaleServedPorts(): Set<number> {
  try {
    const raw = execSync('tailscale serve status --json', {
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString('utf8');

    const status = JSON.parse(raw) as Record<string, unknown>;

    // The TCP map keys are "https:<port>" entries
    const ports = new Set<number>();
    const tcp = (status as { TCP?: Record<string, unknown> }).TCP;
    if (tcp && typeof tcp === 'object') {
      for (const key of Object.keys(tcp)) {
        const match = key.match(/^(\d+)$/);
        if (match) ports.add(Number(match[1]));
      }
    }
    return ports;
  } catch {
    return new Set();
  }
}

/** Pick first available port from preferred list. */
function pickTailscalePort(usedPorts: Set<number>): number {
  for (const port of [8443, 8444, 10443]) {
    if (!usedPorts.has(port)) return port;
  }
  return 8443; // fallback
}

/** Run `tailscale serve --https=<port> http://127.0.0.1:<appPort>`. Returns true on success. */
function runTailscaleServe(tsPort: number, appPort: number): boolean {
  try {
    execSync(`tailscale serve --https=${tsPort} http://127.0.0.1:${appPort}`, {
      timeout: 15000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return true;
  } catch {
    return false;
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

  // 1. Server port — pick first available from preferred candidates
  const defaultPort = await findAvailablePort([3000, 3001, 3333]);
  const port = await p.text({
    message: 'Server port',
    placeholder: String(defaultPort),
    defaultValue: String(defaultPort),
    validate: (val) => {
      const n = Number(val);
      if (!Number.isInteger(n) || n < 1 || n > 65535) {
        return 'Port must be between 1 and 65535';
      }
    },
  });
  if (p.isCancel(port)) { p.outro('Setup cancelled.'); return; }

  const portNum = Number(port);

  // 2. Network access — Tailscale detection + HTTPS setup
  const tsHostname = getTailscaleHostname();
  let publicUrl = `http://localhost:${portNum}`;

  if (!tsHostname) {
    // Branch A: no Tailscale
    p.note(
      `Opengram is currently only accessible on this machine (localhost).\n` +
      `To access it from other devices, we recommend Tailscale — it creates\n` +
      `a private network with automatic HTTPS, no port forwarding needed.\n\n` +
      `  → Install Tailscale: https://tailscale.com/download\n` +
      `  → Then re-run \`opengram init\` to complete the setup.\n\n` +
      `You can also set a public URL later in opengram.config.json:\n` +
      `  { "server": { "publicBaseUrl": "https://your-url" } }`,
      'Network',
    );
  } else {
    // Branch B: Tailscale detected
    const tsChoice = await p.select({
      message: `Tailscale detected: ${tsHostname}\n  Set up HTTPS access via Tailscale?`,
      options: [
        { value: 'default', label: 'Yes, use default port', hint: 'recommended' },
        { value: 'custom', label: 'Yes, use a custom port' },
        { value: 'no', label: "No, I'll set it up later" },
      ],
    });
    if (p.isCancel(tsChoice)) { p.outro('Setup cancelled.'); return; }

    if (tsChoice === 'default' || tsChoice === 'custom') {
      let tsPort: number;

      if (tsChoice === 'custom') {
        const customPort = await p.text({
          message: 'HTTPS port for Tailscale',
          placeholder: '8443',
          validate: (val) => {
            const n = Number(val);
            if (!Number.isInteger(n) || n < 1 || n > 65535) {
              return 'Port must be between 1 and 65535';
            }
            const used = getTailscaleServedPorts();
            if (used.has(n)) {
              return `Port ${n} is already used by tailscale serve`;
            }
          },
        });
        if (p.isCancel(customPort)) { p.outro('Setup cancelled.'); return; }
        tsPort = Number(customPort);
      } else {
        const usedPorts = getTailscaleServedPorts();
        tsPort = pickTailscalePort(usedPorts);
      }

      const serveSpinner = p.spinner();
      serveSpinner.start(`Running tailscale serve --https=${tsPort} ...`);

      const ok = runTailscaleServe(tsPort, portNum);
      if (ok) {
        const portSuffix = tsPort === 443 ? '' : `:${tsPort}`;
        publicUrl = `https://${tsHostname}${portSuffix}`;
        serveSpinner.stop(`Tailscale HTTPS forwarding configured.\n  Opengram is available at ${publicUrl}`);
      } else {
        serveSpinner.stop(
          `Failed to run tailscale serve. You can set it up manually:\n` +
          `  tailscale serve --https=${tsPort} http://127.0.0.1:${portNum}`,
        );
      }
    } else {
      // "No, I'll set it up later"
      const usedPorts = getTailscaleServedPorts();
      const suggestedPort = pickTailscalePort(usedPorts);
      p.note(
        `To set up HTTPS later, run:\n` +
        `  tailscale serve --https=${suggestedPort} http://127.0.0.1:${portNum}\n\n` +
        `Then update opengram.config.json:\n` +
        `  { "server": { "publicBaseUrl": "https://${tsHostname}:${suggestedPort}" } }`,
        'Network',
      );
    }
  }

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
        if (!val?.trim()) return 'Secret cannot be empty';
      },
    });
    if (p.isCancel(customSecret)) { p.outro('Setup cancelled.'); return; }
    instanceSecret = customSecret;
    instanceSecretEnabled = true;
  }

  // 4. Auto-rename
  const { RENAME_PROVIDERS, getProviderById, resolveApiKey, getEnvVarName } = await import('./services/auto-rename-service.js');

  const enableAutoRename = await p.confirm({
    message: 'Enable automatic chat renaming?',
    initialValue: true,
  });

  let autoRenameConfig: { enabled: boolean; provider: string; modelId: string; apiKey?: string } | null = null;

  if (!p.isCancel(enableAutoRename) && enableAutoRename) {
    const providerChoice = await p.select({
      message: 'AI provider for title generation',
      options: RENAME_PROVIDERS.map((prov) => {
        const envVars = Array.isArray(prov.envVar) ? prov.envVar : [prov.envVar];
        const hasKey = envVars.some((v) => Boolean(process.env[v]));
        return {
          value: prov.id,
          label: prov.name,
          hint: hasKey ? 'key detected' : undefined,
        };
      }),
    });
    if (p.isCancel(providerChoice)) { p.outro('Setup cancelled.'); return; }

    const selectedProvider = getProviderById(providerChoice as string)!;
    const envVars = Array.isArray(selectedProvider.envVar) ? selectedProvider.envVar : [selectedProvider.envVar];
    const envKey = envVars.find((v) => Boolean(process.env[v]));
    let chosenApiKey: string | undefined;

    if (envKey) {
      const useEnv = await p.confirm({
        message: `Use detected ${envKey} from environment?`,
        initialValue: true,
      });
      if (p.isCancel(useEnv)) { p.outro('Setup cancelled.'); return; }
      if (!useEnv) {
        const customKey = await p.text({
          message: `Enter API key for ${selectedProvider.name}`,
          placeholder: 'sk-...',
        });
        if (p.isCancel(customKey)) { p.outro('Setup cancelled.'); return; }
        chosenApiKey = customKey || undefined;
      }
    } else {
      const customKey = await p.text({
        message: `Enter API key for ${selectedProvider.name} (optional — can be set later)`,
        placeholder: getEnvVarName(selectedProvider),
        defaultValue: '',
      });
      if (p.isCancel(customKey)) { p.outro('Setup cancelled.'); return; }
      chosenApiKey = customKey || undefined;
    }

    const modelChoice = await p.select({
      message: 'Model for title generation',
      options: selectedProvider.cheapModels.map((m) => ({
        value: m.id,
        label: m.label,
      })),
    });
    if (p.isCancel(modelChoice)) { p.outro('Setup cancelled.'); return; }

    autoRenameConfig = {
      enabled: true,
      provider: providerChoice as string,
      modelId: modelChoice as string,
    };
    if (chosenApiKey) {
      autoRenameConfig.apiKey = chosenApiKey;
    }
  }

  // 5. OpenClaw detection
  if (isOpenClawInstalled()) {
    p.note('OpenClaw CLI detected on PATH', 'Integrations');
    const connectOpenClaw = await p.confirm({
      message: 'Connect OpenGram to OpenClaw?',
      initialValue: true,
    });
    if (!p.isCancel(connectOpenClaw) && connectOpenClaw) {
      const pluginSpinner = p.spinner();
      pluginSpinner.start('Installing @opengramsh/openclaw-plugin...');
      try {
        execSync('npm install -g @opengramsh/openclaw-plugin', {
          stdio: ['ignore', 'pipe', 'ignore'],
          timeout: 120000,
        });
        pluginSpinner.stop('Plugin installed.');
      } catch {
        pluginSpinner.stop('Plugin install failed — you can install it later with:\n  npm i -g @opengramsh/openclaw-plugin');
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

  // 6. Generate config — merge wizard-managed keys into existing config
  let config: Record<string, unknown> = {};
  if (existsSync(configPath)) {
    try {
      config = JSON.parse(readFileSync(configPath, 'utf8')) as Record<string, unknown>;
    } catch {
      // Corrupted file — start fresh
    }
  }

  // Server settings — merge into existing server block
  const existingServer = (typeof config.server === 'object' && config.server !== null
    ? config.server : {}) as Record<string, unknown>;
  if (portNum !== 3000) {
    existingServer.port = portNum;
  } else {
    delete existingServer.port;
  }
  if (!publicUrl.startsWith('http://localhost:')) {
    existingServer.publicBaseUrl = publicUrl;
  } else {
    delete existingServer.publicBaseUrl;
  }
  if (Object.keys(existingServer).length > 0) {
    config.server = existingServer;
  } else {
    delete config.server;
  }

  // Security settings
  if (instanceSecretEnabled) {
    config.security = {
      ...((typeof config.security === 'object' && config.security !== null
        ? config.security : {}) as Record<string, unknown>),
      instanceSecretEnabled: true,
      instanceSecret,
    };
  } else {
    // User chose "no secret" — update but preserve other security keys
    const existingSecurity = (typeof config.security === 'object' && config.security !== null
      ? config.security : {}) as Record<string, unknown>;
    delete existingSecurity.instanceSecretEnabled;
    delete existingSecurity.instanceSecret;
    if (Object.keys(existingSecurity).length > 0) {
      config.security = existingSecurity;
    } else {
      delete config.security;
    }
  }

  if (autoRenameConfig) {
    config.autoRename = autoRenameConfig;
  } else {
    delete config.autoRename;
  }

  // Write config
  mkdirSync(home, { recursive: true });
  mkdirSync(path.join(home, 'data'), { recursive: true });
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf8');

  p.note(configPath, 'Config written');

  // 7. Background service (Linux + macOS)
  if (process.platform === 'linux' || process.platform === 'darwin') {
    const isLinux = process.platform === 'linux';
    const installSvc = await p.confirm({
      message: isLinux
        ? 'Start OpenGram automatically on boot? (systemd user service)'
        : 'Start OpenGram automatically on login? (launchd service)',
      initialValue: true,
    });

    if (!p.isCancel(installSvc) && installSvc) {
      const { installService } = await import('./cli-service.js');
      const svcSpinner = p.spinner();
      svcSpinner.start(isLinux ? 'Installing systemd service...' : 'Installing launchd service...');
      const ok = await installService(home);
      if (ok) {
        svcSpinner.stop('Service installed and started.');
      } else {
        svcSpinner.stop('Service installation failed. You can run `opengram service install` later.');
      }
    }
  } else {
    p.note('Run `opengram start` to start the server.\nFor auto-start, consider using a process manager like pm2.', 'Startup');
  }

  // 8. Print summary
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

  if (process.platform === 'linux' || process.platform === 'darwin') {
    p.outro('Setup complete!');
  } else {
    p.outro('Run `opengram start` to start the server.');
  }
}
