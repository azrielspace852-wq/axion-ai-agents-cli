const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'axion-cli-tests-'));
process.env.AXION_DATA_DIR = path.join(testRoot, 'data');

// Load modules only after setting AXION_DATA_DIR because the path module is evaluated at import time.
const { ConfigManager } = require('../dist/config/ConfigManager');
const { ConversationStore } = require('../dist/storage/ConversationStore');
const { MemoryStore } = require('../dist/storage/MemoryStore');
const { ToolRegistry } = require('../dist/agent/tools/ToolRegistry');
const { assertPublicHttpUrl, createPinnedLookup, isPrivateOrReservedIp, resolvePublicHttpUrl } = require('../dist/utils/network');

test('configuration defaults are safe and persisted atomically with private file mode', () => {
  const manager = new ConfigManager();
  assert.equal(manager.get().version, 1);
  assert.equal(manager.get().permissions.shellExec, false);
  assert.equal(manager.get().language, 'en');

  manager.get().language = 'id';
  manager.save();
  const reloaded = new ConfigManager();
  assert.equal(reloaded.get().language, 'id');

  if (process.platform !== 'win32') {
    const configPath = path.join(process.env.AXION_DATA_DIR, 'config.json');
    assert.equal(fs.statSync(configPath).mode & 0o777, 0o600);
  }
});

test('malformed configuration is preserved and defaults are restored', () => {
  const configPath = path.join(process.env.AXION_DATA_DIR, 'config.json');
  fs.writeFileSync(configPath, '{ this is not json');
  const manager = new ConfigManager();
  assert.equal(manager.get().permissions.shellExec, false);
  assert.ok(fs.readdirSync(process.env.AXION_DATA_DIR).some((name) => name.startsWith('config.json.corrupt-')));
});

test('conversation storage creates, persists, lists, backs up, and rejects unsafe IDs', () => {
  const store = new ConversationStore();
  const conversation = store.create('Regression test');
  store.appendMessage(conversation, 'user', 'Hello');
  store.appendMessage(conversation, 'assistant', 'World');

  const loaded = store.load(conversation['conversation-id']);
  assert.equal(loaded.messages.length, 2);
  assert.equal(loaded.messages[0].content, 'Hello');
  assert.equal(store.list().length, 1);
  assert.ok(fs.existsSync(store.backup(conversation['conversation-id'])));
  assert.equal(store.load('../../outside'), null);
  store.delete('../../outside');
});

test('conversation storage preserves provider metadata required for Gemini tool calling', () => {
  const store = new ConversationStore();
  const conversation = store.create('Gemini metadata');
  const providerParts = [
    { functionCall: { name: 'google_search', args: { query: 'AXION' }, id: 'call-1' }, thoughtSignature: 'signature-1' },
    { functionCall: { name: 'web_scrape', args: { url: 'https://example.com' }, id: 'call-2' } },
  ];
  const toolCalls = [
    { id: 'internal-1', providerCallId: 'call-1', thoughtSignature: 'signature-1', name: 'google_search', arguments: { query: 'AXION' } },
    { id: 'internal-2', providerCallId: 'call-2', name: 'web_scrape', arguments: { url: 'https://example.com' } },
  ];
  store.appendMessage(conversation, 'assistant', '', { toolCalls, providerParts });
  store.appendMessage(conversation, 'tool', 'result 1', { name: 'google_search', toolCallId: 'internal-1', providerCallId: 'call-1' });
  const loaded = store.load(conversation['conversation-id']);
  assert.deepEqual(loaded.messages[0].providerParts, providerParts);
  assert.deepEqual(loaded.messages[0].toolCalls, toolCalls);
  assert.equal(loaded.messages[1].providerCallId, 'call-1');
  assert.equal(loaded.messages[1].toolCallId, 'internal-1');
});

test('Gemini provider returns thought signatures and groups parallel function responses', async () => {
  const axios = require('axios');
  const originalPost = axios.post;
  const { GoogleAIProvider } = require('../dist/agent/providers/GoogleAIProvider');
  const responseParts = [
    { functionCall: { name: 'google_search', args: { query: 'AXION' }, id: 'call-1' }, thoughtSignature: 'signature-1' },
    { functionCall: { name: 'web_scrape', args: { url: 'https://example.com' }, id: 'call-2' } },
  ];
  const capturedBodies = [];
  axios.post = async (_url, body) => {
    capturedBodies.push(body);
    if (capturedBodies.length === 1) {
      return { status: 200, data: { candidates: [{ content: { parts: responseParts }, finishReason: 'STOP' }] } };
    }
    return { status: 200, data: { candidates: [{ content: { parts: [{ text: 'finished' }] }, finishReason: 'STOP' }] } };
  };

  try {
    const provider = new GoogleAIProvider('test-key');
    const first = await provider.chat({ model: 'gemini-3.8-flash', messages: [{ role: 'user', content: 'Search and inspect' }] });
    assert.deepEqual(first.providerParts, responseParts);
    assert.equal(first.toolCalls[0].providerCallId, 'call-1');
    assert.equal(first.toolCalls[0].thoughtSignature, 'signature-1');

    await provider.chat({
      model: 'gemini-3.8-flash',
      messages: [
        { role: 'user', content: 'Search and inspect' },
        { role: 'assistant', content: '', toolCalls: first.toolCalls, providerParts: first.providerParts },
        { role: 'tool', name: 'google_search', content: 'search result', providerCallId: 'call-1' },
        { role: 'tool', name: 'web_scrape', content: 'page result', providerCallId: 'call-2' },
      ],
    });

    await provider.chat({
      model: 'gemini-3.8-flash',
      thinkingLevel: 'medium',
      temperature: 0.2,
      messages: [{ role: 'user', content: 'Use Gemini 3 defaults' }],
    });
    await provider.chat({
      model: 'gemini-2.5-flash',
      thinkingLevel: 'off',
      messages: [{ role: 'user', content: 'Disable thinking' }],
    });
    await provider.chat({
      model: 'gemini-2.5-pro',
      thinkingLevel: 'off',
      messages: [{ role: 'user', content: 'Use provider default' }],
    });
    await provider.chat({
      model: 'gemma-4-31b-it',
      thinkingLevel: 'off',
      messages: [{ role: 'user', content: 'Disable Gemma thinking' }],
    });
    await provider.chat({
      model: 'gemma-4-31b-it',
      thinkingLevel: 'medium',
      messages: [{ role: 'user', content: 'Enable Gemma thinking' }],
    });

    const contents = capturedBodies[1].contents;
    assert.deepEqual(contents[1].parts, responseParts);
    assert.equal(contents[2].role, 'user');
    assert.equal(contents[2].parts.length, 2);
    assert.equal(contents[2].parts[0].functionResponse.id, 'call-1');
    assert.equal(contents[2].parts[1].functionResponse.id, 'call-2');
    assert.equal(Object.hasOwn(capturedBodies[2].generationConfig, 'temperature'), false);
    assert.deepEqual(capturedBodies[2].generationConfig.thinkingConfig, { thinkingLevel: 'MEDIUM' });
    assert.deepEqual(capturedBodies[3].generationConfig.thinkingConfig, { thinkingBudget: 0 });
    assert.equal(Object.hasOwn(capturedBodies[4].generationConfig, 'thinkingConfig'), false);
    assert.deepEqual(capturedBodies[5].generationConfig.thinkingConfig, { thinkingLevel: 'MINIMAL' });
    assert.deepEqual(capturedBodies[6].generationConfig.thinkingConfig, { thinkingLevel: 'HIGH' });
  } finally {
    axios.post = originalPost;
  }
});

test('memory storage creates topics, appends entries, renumbers deletes, and rejects unsafe IDs', () => {
  const store = new MemoryStore();
  store.add('Project', 'First fact');
  const doc = store.add('project', 'Second fact');
  assert.equal(doc.memories.length, 2);
  const updated = store.deleteEntry(doc['memory-id'], 1);
  assert.equal(updated.memories.length, 1);
  assert.equal(updated.memories[0]['memory-number'], 1);
  assert.equal(store.load('../outside'), null);
  assert.match(store.toPromptText(), /Second fact/);
});

test('tool registry handles successful, unknown, and malformed tool calls', async () => {
  const registry = new ToolRegistry();
  registry.register({
    definition: { name: 'echo', description: 'Echo test value', parameters: { type: 'object', properties: {} } },
    async execute(args) {
      return { success: true, output: String(args.value || 'empty') };
    },
  });
  const context = { cwd: process.cwd(), permissions: {} };
  assert.deepEqual(await registry.execute('echo', { value: 'ok' }, context), { success: true, output: 'ok' });
  assert.equal((await registry.execute('missing', {}, context)).success, false);
  assert.equal((await registry.execute('echo', null, context)).output, 'empty');
});

test('web scraper URL guard blocks local and reserved address ranges and pins validated DNS', async () => {
  for (const address of [
    '127.0.0.1', '10.1.2.3', '192.168.1.1', '169.254.10.20', '192.88.99.1',
    '::1', 'fc00::1', '2001::1', '2002:c0a8:0101::1', '64:ff9b::c0a8:0101',
  ]) {
    assert.equal(isPrivateOrReservedIp(address), true, `${address} should be blocked`);
  }
  await assert.rejects(() => assertPublicHttpUrl('http://localhost:3000/'), /Local or reserved/);
  await assert.rejects(() => assertPublicHttpUrl('http://127.0.0.1/'), /Private or reserved/);
  await assert.rejects(() => assertPublicHttpUrl('file:///etc/passwd'), /Only HTTP and HTTPS/);

  const destination = await resolvePublicHttpUrl('https://93.184.216.34/');
  assert.equal(destination.addresses[0].address, '93.184.216.34');
  const pinnedLookup = createPinnedLookup('example.com', [{ address: '93.184.216.34', family: 4 }]);
  await new Promise((resolve, reject) => {
    pinnedLookup('example.com', { all: false, family: 4 }, (error, address, family) => {
      if (error) return reject(error);
      assert.equal(address, '93.184.216.34');
      assert.equal(family, 4);
      resolve();
    });
  });
  await new Promise((resolve) => {
    pinnedLookup('internal.example', { all: false, family: 4 }, (error) => {
      assert.equal(error.code, 'EAI_NONAME');
      resolve();
    });
  });
});

test('CLI version command starts without entering the interactive REPL', () => {
  const result = spawnSync(process.execPath, [path.join(__dirname, '../dist/index.js'), '--version'], {
    encoding: 'utf8',
    env: { ...process.env },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^1\.0\.1\s*$/);
});

test('installer validates in staging and preserves the prior app if a build fails', () => {
  const projectRoot = path.join(__dirname, '..');
  const installHome = fs.mkdtempSync(path.join(os.tmpdir(), 'axion-installer-test-'));
  const fakeBin = path.join(installHome, 'fake-bin');
  const termuxPrefix = path.join(installHome, 'termux');
  const commandDir = path.join(termuxPrefix, 'bin');
  const appDir = path.join(installHome, '.axion', 'app');
  fs.mkdirSync(fakeBin, { recursive: true });
  fs.mkdirSync(commandDir, { recursive: true });
  fs.mkdirSync(appDir, { recursive: true });
  fs.writeFileSync(path.join(appDir, 'keep-old-installation.txt'), 'previous version');

  const fakeNode = `#!/bin/sh
if [ "$1" = "-p" ]; then printf '22.16.0\\n'; exit 0; fi
if [ "$2" = "--version" ]; then printf '1.0.1\\n'; exit 0; fi
exec "$REAL_NODE" "$@"
`;
  const fakeNpm = `#!/bin/sh
case "$1" in
  -v) printf '10.9.0\n' ;;
  install|ci) exit 0 ;;
  test|run)
    if [ "$1" = "run" ] && [ "$2" != "build" ]; then exit 1; fi
    if [ "${'${FAKE_NPM_FAIL_BUILD:-0}'}" = "1" ]; then echo 'simulated build/test failure' >&2; exit 1; fi
    mkdir -p dist
    printf '#!/usr/bin/env node\nconsole.log("1.0.1")\n' > dist/index.js
    chmod +x dist/index.js
    exit 0 ;;
  *) exit 1 ;;
esac
`;
  fs.writeFileSync(path.join(fakeBin, 'node'), fakeNode, { mode: 0o755 });
  fs.writeFileSync(path.join(fakeBin, 'npm'), fakeNpm, { mode: 0o755 });

  const commonEnv = {
    ...process.env,
    HOME: installHome,
    PREFIX: termuxPrefix,
    REAL_NODE: process.execPath,
    PATH: `${fakeBin}:${process.env.PATH}`,
  };
  try {
    const failedUpgrade = spawnSync('bash', [path.join(projectRoot, 'install.sh')], {
      cwd: projectRoot,
      env: { ...commonEnv, FAKE_NPM_FAIL_BUILD: '1' },
      encoding: 'utf8',
    });
    assert.notEqual(failedUpgrade.status, 0, failedUpgrade.stdout);
    assert.equal(fs.readFileSync(path.join(appDir, 'keep-old-installation.txt'), 'utf8'), 'previous version');

    const successfulUpgrade = spawnSync('bash', [path.join(projectRoot, 'install.sh')], {
      cwd: projectRoot,
      env: commonEnv,
      encoding: 'utf8',
    });
    assert.equal(successfulUpgrade.status, 0, successfulUpgrade.stderr || successfulUpgrade.stdout);
    assert.ok(fs.existsSync(path.join(appDir, 'dist', 'index.js')));
    const commandLink = path.join(commandDir, 'axion-cli');
    assert.equal(fs.lstatSync(commandLink).isSymbolicLink(), true);
    const backups = fs.readdirSync(path.join(installHome, '.axion')).filter((name) => name.includes('.backup.'));
    assert.ok(backups.length >= 1);
    assert.equal(fs.readFileSync(path.join(installHome, '.axion', backups[0], 'keep-old-installation.txt'), 'utf8'), 'previous version');
  } finally {
    fs.rmSync(installHome, { recursive: true, force: true });
  }
});

test.after(() => {
  fs.rmSync(testRoot, { recursive: true, force: true });
});
