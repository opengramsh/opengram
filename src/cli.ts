import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Resolve package root: dist/cli/cli.js → ../../, src/cli.ts → ../
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const pkgRoot = existsSync(path.join(__dirname, '..', 'package.json'))
  ? path.resolve(__dirname, '..')      // running from src/
  : path.resolve(__dirname, '..', '..'); // running from dist/cli/

function getVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(path.join(pkgRoot, 'package.json'), 'utf8'));
    return pkg.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

function resolveHome(): string {
  return process.env.OPENGRAM_HOME ?? path.join(homedir(), '.opengram');
}

function printUsage() {
  console.log(`
OpenGram v${getVersion()}

Usage: opengram <command> [options]

Commands:
  init                  Interactive setup wizard
  start [--port N]      Start the server
  stop                  Stop the background service
  restart               Restart the background service
  upgrade               Upgrade to the latest version
  uninstall             Interactive uninstall wizard
  service <action>      Manage background service
    install             Install, enable, and start the service
    uninstall           Stop, disable, and remove the service
    start               Start the service
    stop                Stop the service without removing it
    restart             Restart the service
    status              Show service status
    logs                Tail service logs
  version               Print version

Environment:
  OPENGRAM_HOME         Data directory (default: ~/.opengram)
`.trim());
}

async function cmdStart(args: string[]) {
  const home = resolveHome();
  const dataDir = path.join(home, 'data');

  // Parse --port flag
  let portOverride: string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port' && args[i + 1]) {
      portOverride = args[i + 1];
    }
  }

  // Ensure data directory exists
  mkdirSync(dataDir, { recursive: true });

  // Set environment variables for the server
  const configPath = path.join(home, 'opengram.config.json');
  if (existsSync(configPath)) {
    process.env.OPENGRAM_CONFIG_PATH = configPath;
  }

  process.env.DATABASE_URL = path.join(dataDir, 'opengram.db');
  process.env.OPENGRAM_DATA_ROOT = dataDir;
  process.env.OPENGRAM_MIGRATIONS_DIR = path.join(pkgRoot, 'migrations');
  process.env.NODE_ENV = 'production';

  if (portOverride) {
    process.env.OPENGRAM_SERVER_PORT = portOverride;
  }

  // chdir to package root so ./dist/client resolves correctly
  process.chdir(pkgRoot);

  // Start the server — use computed path so the bundler doesn't inline it
  const serverEntry = pathToFileURL(path.join(pkgRoot, 'dist', 'server', 'server.js')).href;
  await import(serverEntry);
}

async function cmdInit() {
  const { runInitWizard } = await import('./init-wizard.js');
  const result = await runInitWizard({ pkgRoot, resolveHome });
  if (result.startServer) {
    await cmdStart([]);
  }
}

async function cmdService(action: string | undefined) {
  const { runServiceCommand } = await import('./cli-service.js');
  await runServiceCommand(action, { resolveHome });
}

async function isServiceRunningCheck(): Promise<boolean> {
  const { isServiceRunning } = await import('./cli-service.js');
  return isServiceRunning();
}

async function cmdUpgrade() {
  const { execSync } = await import('node:child_process');
  const oldVersion = getVersion();

  console.log('Upgrading Opengram...');

  try {
    execSync('npm --loglevel error --silent --no-fund --no-audit install -g @opengramsh/opengram@latest', {
      stdio: 'inherit',
    });
  } catch {
    console.error('Upgrade failed. Check the error above.');
    process.exit(1);
  }

  const newVersion = getVersion();

  if (await isServiceRunningCheck()) {
    console.log('Service is running, restarting...');
    const { restartService } = await import('./cli-service.js');
    restartService();
  }

  if (oldVersion === newVersion) {
    console.log(`Already on the latest version (v${newVersion}).`);
  } else {
    console.log(`Upgraded: v${oldVersion} → v${newVersion}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case 'version':
    case '--version':
    case '-v':
      console.log(getVersion());
      break;

    case 'start':
      await cmdStart(args.slice(1));
      break;

    case 'init':
      await cmdInit();
      break;

    case 'stop':
      await cmdService('stop');
      break;

    case 'restart':
      await cmdService('restart');
      break;

    case 'upgrade':
      await cmdUpgrade();
      break;

    case 'uninstall': {
      const { runUninstallWizard } = await import('./cli-uninstall.js');
      await runUninstallWizard({ resolveHome });
      break;
    }

    case 'service':
      await cmdService(args[1]);
      break;

    case 'help':
    case '--help':
    case '-h':
    case undefined:
      printUsage();
      break;

    default:
      console.error(`Unknown command: ${command}`);
      printUsage();
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

export { pkgRoot, resolveHome };
