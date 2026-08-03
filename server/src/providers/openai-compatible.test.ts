import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  clearOpenAICompatibleConfig,
  extractMermaidSource,
  OpenAICompatibleProvider,
  saveOpenAICompatibleConfig,
} from './openai-compatible.js';
import { setDataRoot } from '../sessions.js';

test('BYOK extraction keeps the diagram and removes answer prose', () => {
  assert.equal(
    extractMermaidSource('Here is the update:\n```mermaid\nflowchart TD\n  a[Start] --> b[Done]\n```\nHope this helps.'),
    'flowchart TD\n  a[Start] --> b[Done]',
  );
  assert.equal(extractMermaidSource('I could not create a diagram.'), null);
});

test('BYOK provider sends the current source and writes a reviewable candidate', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mdve-byok-'));
  const workspace = await mkdtemp(join(tmpdir(), 'mdve-byok-workspace-'));
  const previousFetch = globalThis.fetch;
  setDataRoot(root);
  await writeFile(join(workspace, 'diagram.mmd'), 'flowchart TD\n  a[Start]\n', 'utf8');
  await saveOpenAICompatibleConfig({ baseUrl: 'http://127.0.0.1:11434/v1', model: 'local-model', apiKey: '' });
  const events: string[] = [];
  globalThis.fetch = (async (input, init) => {
    assert.equal(input, 'http://127.0.0.1:11434/v1/chat/completions');
    assert.equal(new Headers(init?.headers).get('authorization'), null);
    assert.match(String(init?.body), /flowchart TD/);
    return new Response(JSON.stringify({
      choices: [{ message: { content: '```mermaid\nflowchart TD\n  a[Start] --> b[Done]\n```' } }],
      usage: { prompt_tokens: 12, completion_tokens: 9 },
    }), { status: 200 });
  }) as typeof fetch;

  try {
    await new OpenAICompatibleProvider().run(
      { prompt: 'Add a Done node.', workspace, signal: new AbortController().signal },
      (event) => events.push(event.type),
    );
    assert.equal(await readFile(join(workspace, 'diagram.mmd'), 'utf8'), 'flowchart TD\n  a[Start] --> b[Done]\n');
    assert.deepEqual(events, ['status', 'message', 'usage']);
  } finally {
    globalThis.fetch = previousFetch;
    await clearOpenAICompatibleConfig();
    await rm(root, { recursive: true, force: true });
    await rm(workspace, { recursive: true, force: true });
  }
});
