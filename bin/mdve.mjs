#!/usr/bin/env node

import { randomBytes } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { mkdir, unlink, writeFile, access } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { createInterface } from 'node:readline';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const BIN_DIR = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(BIN_DIR, '..');
const PACKAGE = JSON.parse(await (await import('node:fs/promises')).readFile(join(PACKAGE_ROOT, 'package.json'), 'utf8'));
const CODEX_BIN = process.env.MDVE_CODEX_BIN ?? 'codex';
const DEFAULT_PORT = 8787;
const DEFAULT_HOST = '127.0.0.1';
const CODEX_RANGE = '>=0.146.0 <0.147.0';

function usage() {
  console.log(`MDVE ${PACKAGE.version}

Usage:
  mdve [--no-open] [--port <port>]
  mdve version
  mdve doctor [--json]
`);
}

function parseNodeVersion(version = process.versions.node) {
  const [major = '0', minor = '0', patch = '0'] = version.split('.');
  return { major: Number(major), minor: Number(minor), patch: Number(patch) };
}

function supportedNode(version = process.versions.node) {
  const { major, minor, patch } = parseNodeVersion(version);
  return (major === 22 && (minor > 11 || (minor === 11 && patch >= 0))) ||
    (major === 24 && (minor > 11 || (minor === 11 && patch >= 0)));
}

function nodeRequirement(version = process.versions.node) {
  return supportedNode(version)
    ? `Node ${version} (supported)`
    : `Node ${version} is unsupported; MDVE requires ^22.11.0 or ^24.11.0`;
}

function codexVersion() {
  try {
    return execFileSync(CODEX_BIN, ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
  } catch {
    return null;
  }
}

function supportedCodex(version) {
  const match = version?.match(/(\d+)\.(\d+)\.(\d+)/);
  return Boolean(match && Number(match[1]) === 0 && Number(match[2]) === 146);
}

async function codexStatus() {
  const version = codexVersion();
  if (!version) {
    return { version: null, available: false, supported: false, authenticated: false, detail: `\`${CODEX_BIN}\` was not found on PATH` };
  }
  if (!supportedCodex(version)) {
    return {
      version,
      available: true,
      supported: false,
      authenticated: false,
      detail: `Codex ${version} is outside MDVE's tested range ${CODEX_RANGE}`,
    };
  }

  return await new Promise((resolveStatus) => {
    const child = spawn(CODEX_BIN, ['app-server', '--stdio'], {
      env: process.env,
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    const lines = createInterface({ input: child.stdout });
    let settled = false;
    let timer;
    const finish = (status) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      lines.close();
      child.kill('SIGTERM');
      resolveStatus({ version, available: true, supported: true, ...status });
    };
    const send = (message) => {
      if (!child.stdin.destroyed) child.stdin.write(`${JSON.stringify(message)}\n`);
    };

    lines.on('line', (line) => {
      if (!line.trim().startsWith('{')) return;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        return;
      }
      if (message.id === 1) {
        if (message.error) {
          finish({ authenticated: false, detail: 'Codex app-server initialization failed' });
          return;
        }
        send({ method: 'initialized' });
        send({ id: 2, method: 'account/read', params: {} });
      } else if (message.id === 2) {
        const account = message.result?.account;
        if (message.error) {
          finish({ authenticated: false, detail: 'Codex authentication could not be checked through app-server' });
        } else if (!account) {
          finish({ authenticated: false, detail: 'Codex is not logged in. Run `codex login`, then retry.' });
        } else if (account.type !== 'chatgpt') {
          finish({ authenticated: false, detail: 'MDVE v1 requires a ChatGPT-authenticated Codex account.' });
        } else {
          finish({ authenticated: true, detail: `Codex ${version} · ChatGPT account` });
        }
      }
    });
    child.once('error', () => finish({ authenticated: false, detail: 'Codex app-server could not be started' }));
    child.once('close', () => {
      if (!settled) finish({ authenticated: false, detail: `Codex app-server is unavailable for ${version}` });
    });
    timer = setTimeout(() => finish({ authenticated: false, detail: `Codex app-server did not respond for ${version}` }), 5_000);
    send({
      id: 1,
      method: 'initialize',
      params: {
        clientInfo: { name: 'mdve', title: 'MDVE', version: PACKAGE.version },
        capabilities: { experimentalApi: false, requestAttestation: false },
      },
    });
  });
}

async function dataDirectoryStatus({ create = false } = {}) {
  const root = process.env.MDVE_HOME ?? join(process.env.HOME ?? '', '.mdve');
  let probeRoot = root;
  try {
    if (create) {
      await mkdir(join(root, 'sessions'), { recursive: true });
    } else {
      try {
        await access(root);
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
        probeRoot = dirname(root);
        await access(dirname(root));
      }
    }
    const probe = join(probeRoot, `.doctor-${process.pid}-${randomBytes(8).toString('hex')}`);
    await writeFile(probe, 'mdve doctor\n', { flag: 'wx' });
    await unlink(probe);
    return { path: root, writable: true };
  } catch (error) {
    return { path: root, writable: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

async function doctor(json = false) {
  const data = await dataDirectoryStatus();
  const codex = await codexStatus();
  const result = {
    mdveVersion: PACKAGE.version,
    node: process.versions.node,
    nodeRequirement: '^22.11.0 || ^24.11.0',
    supportedNode: supportedNode(),
    platform: process.platform,
    supportedPlatform: process.platform === 'linux',
    dataDirectory: data,
    codex: {
      binary: CODEX_BIN,
      version: codex.version,
      available: codex.available,
      supported: codex.supported,
      authenticated: codex.authenticated,
      detail: codex.detail,
      supportedRange: CODEX_RANGE,
      authentication: 'checked by the Codex app-server; credentials are not read by MDVE',
    },
    origin: `http://${DEFAULT_HOST}:${process.env.MDVE_PORT ?? DEFAULT_PORT}`,
  };
  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`MDVE ${PACKAGE.version}`);
    console.log(nodeRequirement());
    console.log(`Platform: ${process.platform}${result.supportedPlatform ? '' : ' (unsupported; Linux is required)'}`);
    console.log(`Data directory: ${data.path} (${data.writable ? 'writable' : `unwritable: ${data.detail}`})`);
    console.log(`Codex: ${codex.detail} · supported range ${CODEX_RANGE}`);
    console.log(`Origin: ${result.origin}`);
  }
  return supportedNode() && result.supportedPlatform && data.writable && codex.available && codex.supported && codex.authenticated ? 0 : 1;
}

function parsePort(args) {
  const index = args.indexOf('--port');
  const value = Number(index === -1 ? process.env.MDVE_PORT ?? DEFAULT_PORT : args[index + 1]);
  if (!Number.isInteger(value) || value < 1 || value > 65535) throw new Error('--port must be an integer from 1 to 65535');
  return value;
}

async function portAvailable(host, port) {
  return await new Promise((resolvePort) => {
    const socket = createConnection({ host, port });
    const done = (available) => {
      socket.destroy();
      resolvePort(available);
    };
    socket.once('connect', () => done(false));
    socket.once('error', (error) => done(error.code === 'ECONNREFUSED' || error.code === 'EHOSTUNREACH'));
  });
}

async function start(args) {
  if (!supportedNode()) throw new Error(nodeRequirement());
  if (process.platform !== 'linux') throw new Error(`MDVE requires Linux; detected ${process.platform}`);
  const port = parsePort(args);
  if (!(await portAvailable(DEFAULT_HOST, port))) {
    throw new Error(`MDVE cannot use http://${DEFAULT_HOST}:${port}; the port is occupied. Stop the process using it or pass an explicit --port.`);
  }
  const codex = await codexStatus();
  if (!codex.available || !codex.supported || !codex.authenticated) throw new Error(`${codex.detail}. Install the supported Codex runtime, log in, then run mdve again.`);
  const data = await dataDirectoryStatus({ create: true });
  if (!data.writable) throw new Error(`MDVE data directory is not writable: ${data.path}\nFix the directory permissions, then run mdve again.`);

  const token = randomBytes(32).toString('hex');
  const origin = `http://${DEFAULT_HOST}:${port}`;
  const bootstrapUrl = `${origin}/_auth/bootstrap?token=${token}`;
  const child = spawn(process.execPath, [join(PACKAGE_ROOT, 'dist', 'server', 'index.js')], {
    cwd: PACKAGE_ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      MDVE_AUTH_REQUIRED: '1',
      MDVE_BOOTSTRAP_TOKEN: token,
      MDVE_HOST: DEFAULT_HOST,
      MDVE_PORT: String(port),
      MDVE_VERSION: PACKAGE.version,
      MDVE_WEB_DIST: join(PACKAGE_ROOT, 'dist', 'web'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.on('data', (chunk) => process.stdout.write(chunk));
  child.stderr.on('data', (chunk) => process.stderr.write(chunk));
  child.once('error', (error) => console.error(`MDVE failed to start: ${error.message}`));
  const stop = () => {
    if (!child.killed) child.kill('SIGTERM');
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);

  await new Promise((resolveReady, rejectReady) => {
    const deadline = Date.now() + 10_000;
    const poll = async () => {
      if (child.exitCode !== null) return rejectReady(new Error(`MDVE server exited before becoming ready (code ${child.exitCode})`));
      try {
        const response = await fetch(`${origin}/_mdve/ready`);
        if (response.ok) return resolveReady(undefined);
      } catch {
        /* keep polling while the server starts */
      }
      if (Date.now() >= deadline) return rejectReady(new Error('MDVE server did not become ready within 10 seconds'));
      setTimeout(poll, 50);
    };
    void poll();
  });

  console.log(`MDVE is ready at ${origin}`);
  if (args.includes('--no-open')) {
    console.log(`Open this URL to authenticate the local browser session:\n${bootstrapUrl}`);
  } else {
    const opener = spawn('xdg-open', [bootstrapUrl], { detached: true, stdio: 'ignore' });
    opener.unref();
  }

  return await new Promise((resolveExit) => {
    child.once('exit', (code, signal) => {
      process.removeListener('SIGINT', stop);
      process.removeListener('SIGTERM', stop);
      if (signal) console.log(`MDVE stopped (${signal})`);
      resolveExit(code ?? 1);
    });
  });
}

const args = process.argv.slice(2);
try {
  const command = args[0];
  if (command === 'help' || command === '--help' || command === '-h') {
    usage();
    process.exitCode = 0;
  } else if (command === 'version' || command === '--version' || command === '-v') {
    console.log(`mdve ${PACKAGE.version}`);
    console.log(`Node ${process.versions.node}`);
    console.log(`Codex ${codexVersion() ?? 'not found'}`);
  } else if (command === 'doctor') {
    process.exitCode = await doctor(args.includes('--json'));
  } else {
    process.exitCode = await start(args);
  }
} catch (error) {
  console.error(`MDVE: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
