import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const root = process.cwd();
const fixtureRoot = join(root, 'docs', 'codex', '0.146.0');
const outputPath = process.env.MDVE_CODEX_SCHEMA_OUTPUT ?? 'test-results/codex-schema.json';
const fixtureOnly = process.argv.includes('--fixture-only');
const manifest = JSON.parse(await readFile(join(fixtureRoot, 'manifest.json'), 'utf8'));
const fixture = JSON.parse(await readFile(join(root, 'test', 'fixtures', 'codex-app-server.json'), 'utf8'));

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function fileInfo(path) {
  const bytes = await readFile(path);
  return { path, bytes: bytes.byteLength, sha256: sha256(bytes) };
}

async function countFiles(path, extension) {
  let count = 0;
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) count += await countFiles(child, extension);
    else if (entry.isFile() && entry.name.endsWith(extension)) count += 1;
  }
  return count;
}

function typeMatches(value, type) {
  switch (type) {
    case 'object': return value !== null && typeof value === 'object' && !Array.isArray(value);
    case 'array': return Array.isArray(value);
    case 'string': return typeof value === 'string';
    case 'integer': return typeof value === 'number' && Number.isInteger(value);
    case 'number': return typeof value === 'number' && Number.isFinite(value);
    case 'boolean': return typeof value === 'boolean';
    case 'null': return value === null;
    default: return true;
  }
}

function resolveReference(reference, schemaRoot) {
  assert.match(reference, /^#\/definitions\/[A-Za-z0-9_/-]+$/, `unsupported schema reference ${reference}`);
  const name = reference.slice('#/definitions/'.length);
  assert.ok(schemaRoot.definitions?.[name], `missing schema definition ${name}`);
  return schemaRoot.definitions[name];
}

function validate(value, schema, schemaRoot, path, stack = new Set()) {
  if (schema === true || schema === undefined) return;
  if (schema === false) throw new Error(`${path}: schema rejects every value`);
  if (schema.$ref) {
    const key = `${schema.$ref}:${path}`;
    if (stack.has(key)) return;
    const nextStack = new Set(stack).add(key);
    return validate(value, resolveReference(schema.$ref, schemaRoot), schemaRoot, path, nextStack);
  }
  if (schema.oneOf) {
    const successes = [];
    for (const branch of schema.oneOf) {
      try {
        validate(value, branch, schemaRoot, path, stack);
        successes.push(branch);
      } catch {
        /* Try the next discriminated branch. */
      }
    }
    if (successes.length !== 1) throw new Error(`${path}: expected exactly one oneOf branch, matched ${successes.length}`);
    return;
  }
  if (schema.anyOf) {
    const successes = [];
    for (const branch of schema.anyOf) {
      try {
        validate(value, branch, schemaRoot, path, stack);
        successes.push(branch);
      } catch {
        /* Try the next allowed branch. */
      }
    }
    if (successes.length === 0) throw new Error(`${path}: no anyOf branch matched`);
    return;
  }
  if (schema.allOf) {
    for (const branch of schema.allOf) validate(value, branch, schemaRoot, path, stack);
  }
  if (schema.enum && !schema.enum.some((candidate) => Object.is(candidate, value))) {
    throw new Error(`${path}: ${JSON.stringify(value)} is not in enum ${JSON.stringify(schema.enum)}`);
  }
  if (schema.const !== undefined && !Object.is(schema.const, value)) throw new Error(`${path}: value does not match const`);
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((type) => typeMatches(value, type))) throw new Error(`${path}: value does not match type ${types.join('|')}`);
  }
  if (typeof value === 'string' && schema.minLength !== undefined && value.length < schema.minLength) {
    throw new Error(`${path}: string is shorter than minLength ${schema.minLength}`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) throw new Error(`${path}: too few items`);
    if (schema.items) value.forEach((item, index) => validate(item, schema.items, schemaRoot, `${path}[${index}]`, stack));
  }
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const required of schema.required ?? []) {
      if (!Object.prototype.hasOwnProperty.call(value, required)) throw new Error(`${path}: missing required property ${required}`);
    }
    for (const [key, propertySchema] of Object.entries(schema.properties ?? {})) {
      if (Object.prototype.hasOwnProperty.call(value, key)) validate(value[key], propertySchema, schemaRoot, `${path}.${key}`, stack);
    }
    if (schema.additionalProperties === false) {
      const known = new Set(Object.keys(schema.properties ?? {}));
      for (const key of Object.keys(value)) if (!known.has(key)) throw new Error(`${path}: unexpected property ${key}`);
    }
  }
}

function loadSchema(relativePath) {
  const path = join(fixtureRoot, relativePath);
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`missing checked-in Codex schema fixture ${relativePath}: ${error.message}`);
  }
}

async function assertGeneratedMatches() {
  const codex = process.env.MDVE_CODEX_BIN ?? 'codex';
  const version = execFileSync(codex, ['--version'], { encoding: 'utf8' }).trim();
  assert.match(version, new RegExp(`codex-cli ${manifest.codexVersion.replaceAll('.', '\\.')}`));
  const generatedRoot = await mkdtemp(join(tmpdir(), 'mdve-codex-schema-'));
  const tsRoot = join(generatedRoot, 'ts');
  const jsonRoot = join(generatedRoot, 'json');
  try {
    execFileSync(codex, ['app-server', 'generate-ts', '--out', tsRoot], { cwd: root, stdio: 'inherit' });
    execFileSync(codex, ['app-server', 'generate-json-schema', '--out', jsonRoot], { cwd: root, stdio: 'inherit' });
    const generatedFileCounts = {
      typescript: await countFiles(tsRoot, '.ts'),
      jsonSchema: await countFiles(jsonRoot, '.json'),
    };
    assert.deepEqual(generatedFileCounts, manifest.generatedFileCounts, 'Codex generated file count changed');
    for (const relative of manifest.selectedArtifacts) {
      const generatedPath = join(relative.endsWith('.ts') ? tsRoot : jsonRoot, relative);
      const [expected, actual] = await Promise.all([fileInfo(join(fixtureRoot, relative)), fileInfo(generatedPath)]);
      if (relative === 'codex_app_server_protocol.v2.schemas.json') {
        // The bundled schema is semantically stable but its definition-key
        // insertion order follows Rust HashMap iteration and is not byte-stable.
        assert.deepEqual(
          JSON.parse(await readFile(generatedPath, 'utf8')),
          JSON.parse(await readFile(join(fixtureRoot, relative), 'utf8')),
          `generated Codex artifact differs: ${relative}`,
        );
      } else {
        assert.equal(actual.sha256, expected.sha256, `generated Codex artifact differs: ${relative}`);
      }
    }
    return { version, generatedFileCounts, mode: 'generated' };
  } finally {
    await rm(generatedRoot, { recursive: true, force: true });
  }
}

async function verifyInitializationLifecycle(codex) {
  const codexHome = await mkdtemp(join(tmpdir(), 'mdve-codex-init-'));
  const child = spawn(codex, ['app-server', '--stdio'], {
    cwd: tmpdir(),
    env: { ...process.env, CODEX_HOME: codexHome },
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  const lines = createInterface({ input: child.stdout });
  const queue = [];
  let wake;
  lines.on('line', (line) => {
    try {
      const message = JSON.parse(line);
      if (wake) {
        const resolve = wake;
        wake = undefined;
        resolve(message);
      } else {
        queue.push(message);
      }
    } catch {
      /* App-server diagnostics are JSONL messages; ignore non-JSON noise. */
    }
  });
  const nextWithId = (id) => new Promise((resolve, reject) => {
    const deadline = setTimeout(() => {
      wake = undefined;
      reject(new Error(`Timed out waiting for app-server response ${id}`));
    }, 15_000);
    const take = () => {
      const index = queue.findIndex((message) => message.id === id);
      if (index !== -1) {
        clearTimeout(deadline);
        resolve(queue.splice(index, 1)[0]);
        return;
      }
      wake = (message) => {
        if (message.id === id) {
          clearTimeout(deadline);
          resolve(message);
        } else {
          queue.push(message);
          take();
        }
      };
    };
    take();
  });
  const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);
  try {
    send({ id: 1, method: 'account/read', params: {} });
    const beforeInitialize = await nextWithId(1);
    assert.ok(beforeInitialize.error, 'app-server accepted a request before initialize');

    send({ id: 2, method: 'initialize', params: { clientInfo: { name: 'mdve-schema-check', version: '1.0.0' } } });
    const initialized = await nextWithId(2);
    assert.ok(initialized.result, 'app-server initialize did not return a result');
    assert.match(initialized.result.userAgent ?? '', /0\.146\.0/);
    send({ method: 'initialized' });

    send({ id: 3, method: 'initialize', params: { clientInfo: { name: 'mdve-schema-check', version: '1.0.0' } } });
    const repeatedInitialize = await nextWithId(3);
    assert.ok(repeatedInitialize.error, 'app-server accepted a second initialize');
    return {
      beforeInitialize: beforeInitialize.error.message,
      repeatedInitialize: repeatedInitialize.error.message,
      serverUserAgent: initialized.result.userAgent,
      passed: true,
    };
  } finally {
    lines.close();
    child.kill('SIGTERM');
    await new Promise((resolve) => child.once('close', resolve));
    await rm(codexHome, { recursive: true, force: true });
  }
}

const clientRequestSchema = loadSchema('ClientRequest.json');
const clientNotificationSchema = loadSchema('ClientNotification.json');
const serverNotificationSchema = loadSchema('ServerNotification.json');
const clientMethods = new Set(clientRequestSchema.oneOf.flatMap((variant) => variant.properties?.method?.enum ?? []));
const serverMethods = new Set(serverNotificationSchema.oneOf.flatMap((variant) => variant.properties?.method?.enum ?? []));
const requiredMethods = ['initialize', 'account/read', 'model/list', 'thread/start', 'thread/read', 'thread/resume', 'turn/start', 'turn/interrupt'];
for (const method of requiredMethods) assert.ok(clientMethods.has(method), `generated ClientRequest is missing ${method}`);
for (const method of ['thread/started', 'turn/started', 'turn/completed', 'item/agentMessage/delta', 'item/completed']) {
  assert.ok(serverMethods.has(method), `generated ServerNotification is missing ${method}`);
}
const protocolSchema = loadSchema('codex_app_server_protocol.v2.schemas.json');
assert.deepEqual(protocolSchema.definitions.TurnStatus.enum, ['completed', 'interrupted', 'failed', 'inProgress']);

for (const [index, request] of fixture.requests.entries()) validate(request, clientRequestSchema, clientRequestSchema, `request[${index}]`);
for (const [index, notification] of fixture.clientNotifications.entries()) validate(notification, clientNotificationSchema, clientNotificationSchema, `clientNotification[${index}]`);
for (const [index, notification] of fixture.notifications.entries()) validate(notification, serverNotificationSchema, serverNotificationSchema, `notification[${index}]`);
for (const response of fixture.responses) {
  const schema = loadSchema(`${response.schema}.json`);
  validate(response.value, schema, schema, `response:${response.schema}`);
}
const initialize = fixture.requests.find((request) => request.method === 'initialize');
assert.equal(initialize.params.capabilities.experimentalApi, false, 'MDVE must not opt into experimentalApi');
assert.equal(serverMethods.has(fixture.unknownNotification.method), false, 'unknown fixture notification unexpectedly became stable');

const generated = fixtureOnly
  ? { mode: 'fixture', version: manifest.generatedBy, generatedFileCounts: manifest.generatedFileCounts }
  : await assertGeneratedMatches();
const initialization = fixtureOnly
  ? { mode: 'fixture', passed: true }
  : await verifyInitializationLifecycle(process.env.MDVE_CODEX_BIN ?? 'codex');
const selectedArtifacts = [];
for (const relative of manifest.selectedArtifacts) selectedArtifacts.push(await fileInfo(join(fixtureRoot, relative)));
const evidence = {
  schemaVersion: 1,
  codexVersion: manifest.codexVersion,
  generated,
  initialization,
  selectedArtifacts,
  contracts: {
    requestCount: fixture.requests.length,
    clientNotificationCount: fixture.clientNotifications.length,
    responseCount: fixture.responses.length,
    serverNotificationCount: fixture.notifications.length,
    terminalStatuses: protocolSchema.definitions.TurnStatus.enum,
    experimentalApiRequested: initialize.params.capabilities.experimentalApi,
    unknownNotificationPolicy: 'retained as an app-server diagnostic event by the adapter',
  },
  passed: true,
};
await mkdir(dirname(resolve(outputPath)), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ output: outputPath, mode: generated.mode, passed: true }, null, 2));
