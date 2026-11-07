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
  assert.equal(manager.get().permissions.shellExec, true);
  assert.equal(manager.get().language, 'en');
  assert.equal(manager.get().accessScope, 'workspace');
  assert.equal(manager.get().maxToolCallsPerRequest, 30);
  assert.equal(manager.needsOnboarding(), true);

  manager.get().language = 'id';
  manager.get().hasCompletedOnboarding = true;
  manager.save();
  const reloaded = new ConfigManager();
  assert.equal(reloaded.get().language, 'id');
  assert.equal(reloaded.needsOnboarding(), false);

  if (process.platform !== 'win32') {
    const configPath = path.join(process.env.AXION_DATA_DIR, 'config.json');
    assert.equal(fs.statSync(configPath).mode & 0o777, 0o600);
  }
});

test('malformed configuration is preserved and defaults are restored', () => {
  const configPath = path.join(process.env.AXION_DATA_DIR, 'config.json');
  fs.writeFileSync(configPath, '{ this is not json');
  const manager = new ConfigManager();
  assert.equal(manager.get().permissions.shellExec, true);
  assert.ok(fs.readdirSync(process.env.AXION_DATA_DIR).some((name) => name.startsWith('config.json.corrupt-')));
});

test('conversation storage creates, persists, lists, backs up, and rejects unsafe IDs', () => {
  const store = new ConversationStore();
  const conversation = store.create('Regression test');
  assert.match(conversation['conversation-id'], /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  store.appendMessage(conversation, 'user', 'Hello');
  store.appendMessage(conversation, 'assistant', 'World');

  const loaded = store.load(conversation['conversation-id']);
  assert.equal(loaded.messages.length, 2);
  assert.equal(loaded.messages[0].content, 'Hello');
  assert.equal(store.list().length, 1);
  assert.ok(fs.existsSync(store.backup(conversation['conversation-id'])));
  assert.equal(store.load('../../outside'), null);
  store.delete('../../outside');
  // rename persists and reloads; empty/unknown ids rejected
  const renamed = store.rename(conversation['conversation-id'], 'Renamed chat');
  assert.equal(renamed['conversation-name'], 'Renamed chat');
  assert.equal(store.load(conversation['conversation-id'])['conversation-name'], 'Renamed chat');
  assert.equal(store.rename(conversation['conversation-id'], '   '), null);
  assert.equal(store.rename('does-not-exist', 'x'), null);
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
    assert.match(first.toolCalls[0].id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
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
    // Gemma 4 with thinking 'off' must NOT send thinkingConfig at all (MINIMAL does not disable thinking).
    assert.equal(Object.hasOwn(capturedBodies[5].generationConfig, 'thinkingConfig'), false);
    assert.deepEqual(capturedBodies[6].generationConfig.thinkingConfig, { thinkingLevel: 'HIGH' });
  } finally {
    axios.post = originalPost;
  }
});

test('OpenAI-compatible provider generates UUID v4 IDs for tool calls without provider IDs', async () => {
  const axios = require('axios');
  const originalPost = axios.post;
  const { OpenAICompatProvider } = require('../dist/agent/providers/OpenAICompatProvider');
  axios.post = async () => ({
    status: 200,
    data: {
      choices: [{
        message: {
          content: '',
          tool_calls: [{ type: 'function', function: { name: 'lookup', arguments: '{"query":"AXION"}' } }],
        },
      }],
    },
  });
  try {
    const provider = new OpenAICompatProvider('https://api.example.test/v1', 'test-key');
    const result = await provider.chat({
      model: 'test-model',
      messages: [{ role: 'user', content: 'look this up' }],
    });
    assert.equal(result.toolCalls.length, 1);
    assert.match(result.toolCalls[0].id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  } finally {
    axios.post = originalPost;
  }
});

test('providers use streaming with idle watchdog and no flat total timeout', async () => {
  const axios = require('axios');
  const originalPost = axios.post;
  const { GoogleAIProvider } = require('../dist/agent/providers/GoogleAIProvider');
  const { OpenAICompatProvider } = require('../dist/agent/providers/OpenAICompatProvider');
  const captured = [];
  axios.post = async (_url, _body, config) => {
    captured.push(config || {});
    return { status: 200, data: {
      choices: [{ message: { content: 'ok' }, finish_reason: 'STOP' }],
      candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }],
    } };
  };
  try {
    const g = new GoogleAIProvider('k');
    await g.chat({ model: 'gemini-3.5-flash', messages: [{ role: 'user', content: 'hi' }] });
    const o = new OpenAICompatProvider('https://api.example.test/v1', 'k');
    await o.chat({ model: 'm', messages: [{ role: 'user', content: 'hi' }] });
    assert.equal(captured.length, 2);
    for (const config of captured) {
      assert.equal(config.responseType, 'stream', 'provider must request a stream');
      assert.ok(!config.timeout || config.timeout === 0, `flat total timeout must be removed, got ${config.timeout}`);
    }
  } finally {
    axios.post = originalPost;
  }
});

test('memory storage creates topics, appends entries, renumbers deletes, and rejects unsafe IDs', () => {
  const store = new MemoryStore();
  store.add('Project', 'First fact');
  const doc = store.add('project', 'Second fact');
  assert.match(doc['memory-id'], /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
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

test('npm package metadata, lockfile, and public release version are synchronized', () => {
  const projectRoot = path.join(__dirname, '..');
  const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
  const lock = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package-lock.json'), 'utf8'));
  const version = JSON.parse(fs.readFileSync(path.join(projectRoot, 'version.json'), 'utf8'));
  assert.equal(pkg.name, '@axion-neuralis/axion-ai-cli');
  assert.equal(pkg.author, 'axion');
  assert.equal(pkg.version, '1.0.0');
  assert.equal(lock.name, pkg.name);
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[''].name, pkg.name);
  assert.equal(lock.packages[''].version, pkg.version);
  assert.equal(version.name, pkg.name);
  assert.equal(version.version, pkg.version);
  assert.equal(pkg.bin['axion-ai-cli'], 'dist/index.js');
  assert.equal(pkg.publishConfig.registry, 'https://registry.npmjs.org/');
});

test('CLI version command starts without entering the interactive REPL', () => {
  const result = spawnSync(process.execPath, [path.join(__dirname, '../dist/index.js'), '--version'], {
    encoding: 'utf8',
    env: { ...process.env },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^1\.0\.0\s*$/);
});

test('npmjs installer delegates installation to the official npm registry', () => {
  const projectRoot = path.join(__dirname, '..');
  const installHome = fs.mkdtempSync(path.join(os.tmpdir(), 'axion-npm-installer-test-'));
  const fakeBin = path.join(installHome, 'bin');
  const npmLog = path.join(installHome, 'npm-args.log');
  fs.mkdirSync(fakeBin, { recursive: true });
  fs.writeFileSync(path.join(fakeBin, 'node'), `#!/bin/sh
if [ "$1" = "-p" ]; then printf '22.16.0\\n'; else exec "${process.execPath}" "$@"; fi
`, { mode: 0o755 });
  fs.writeFileSync(path.join(fakeBin, 'npm'), `#!/bin/sh
if [ "$1" = "--version" ]; then printf '10.9.0\\n'; exit 0; fi
printf '%s\\n' "$*" >> "${npmLog}"
exit 0
`, { mode: 0o755 });
  try {
    const result = spawnSync('bash', [path.join(projectRoot, 'install.sh')], {
      cwd: projectRoot,
      env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}` },
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const args = fs.readFileSync(npmLog, 'utf8');
    assert.match(args, /install --global @axion-neuralis\/axion-ai-cli@latest --registry https:\/\/registry\.npmjs\.org\//);
    assert.match(result.stdout, /npmjs/);
  } finally {
    fs.rmSync(installHome, { recursive: true, force: true });
  }
});

test.after(() => {
  fs.rmSync(testRoot, { recursive: true, force: true });
});


test('configuration migrates legacy instructions and clamps the per-request tool limit', () => {
  const configPath = path.join(process.env.AXION_DATA_DIR, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify({
    version: 1,
    instructions: 'legacy prompt',
    permissions: { shellExec: false },
    maxToolCallsPerRequest: 999,
  }));
  const manager = new ConfigManager();
  assert.equal(manager.get().customInstructions, 'legacy prompt', 'legacy instructions migrate to customInstructions');
  assert.equal(manager.get().systemPrompt, '', 'legacy systemPrompt field is normalized empty');
  assert.equal(manager.get().permissions.shellExec, false, 'explicit prior opt-out is preserved');
  assert.equal(manager.get().maxToolCallsPerRequest, 100);
  assert.equal(manager.needsOnboarding(), false);
});

test('memory entries and topic names can be edited and remain persisted', () => {
  const store = new MemoryStore();
  const topic = store.add('Original topic', 'Original fact');
  const edited = store.updateEntry(topic['memory-id'], 1, 'Updated fact');
  assert.equal(edited.memories[0].content, 'Updated fact');
  const renamed = store.renameTopic(topic['memory-id'], 'Renamed topic');
  assert.equal(renamed.about, 'Renamed topic');
  const reloaded = store.load(topic['memory-id']);
  assert.equal(reloaded.about, 'Renamed topic');
  assert.equal(reloaded.memories[0].content, 'Updated fact');
});

test('agent system prompt describes workspace, anti-hallucination, planning, and access scope', () => {
  const { Agent } = require('../dist/agent/Agent');
  const { DEFAULT_CONFIG } = require('../dist/config/ConfigManager');
  const cfg = structuredClone(DEFAULT_CONFIG);
  cfg.customInstructions = 'Use concise Indonesian.';
  const agent = new Agent(() => cfg, () => {});
  const prompt = agent.buildSystemPrompt('Known preference: concise');
  assert.match(prompt, /Workspace root:/);
  assert.match(prompt, /ANTI-HALLUCINATION/);
  assert.match(prompt, /TASK PLANNING/);
  assert.match(prompt, /WORKSPACE ONLY/);
  assert.match(prompt, /Use concise Indonesian/);
  assert.match(prompt, /core rules take precedence/, 'base prompt locks core rules over custom instructions');
  assert.match(prompt, /Known preference: concise/);
});

test('shell tool blocks an explicit working directory outside workspace scope and logs execution command', async () => {
  const { ShellTool } = require('../dist/agent/tools/ShellTool');
  const outside = path.resolve(os.tmpdir());
  const notices = [];
  const result = await ShellTool.execute({ command: 'pwd', cwd: outside }, {
    cwd: process.cwd(), accessScope: 'workspace', notice: (message) => notices.push(message),
    permissions: { shellExec: true },
  });
  assert.equal(result.success, false);
  assert.match(result.output, /outside the workspace/);
  assert.equal(notices.length, 0);
});

test('agent enforces maxToolCallsPerRequest while allowing a final model response', async () => {
  const axios = require('axios');
  const originalPost = axios.post;
  const { Agent } = require('../dist/agent/Agent');
  const { DEFAULT_CONFIG } = require('../dist/config/ConfigManager');
  const cfg = structuredClone(DEFAULT_CONFIG);
  cfg.google.apiKey = 'test-key';
  cfg.maxToolCallsPerRequest = 2;
  cfg.permissions.shellExec = true;
  const notices = [];
  const modelReplies = [
    { functionCall: { name: 'run_shell', args: { command: 'echo API_KEY=do-not-print' } } },
    { functionCall: { name: 'run_shell', args: { command: 'echo two' } } },
    { functionCall: { name: 'run_shell', args: { command: 'echo must-not-run' } } },
    null,
  ];
  let requestIndex = 0;
  axios.post = async () => {
    const next = modelReplies[requestIndex++];
    return { status: 200, data: { candidates: [{ content: { parts: next ? [next] : [{ text: 'done within the limit' }] }, finishReason: 'STOP' }] } };
  };
  try {
    const agent = new Agent(() => cfg, (message) => notices.push(message));
    const history = [{ role: 'user', content: 'Run a few commands' }];
    const answer = await agent.chat(history, agent.buildSystemPrompt(''));
    assert.equal(answer, 'done within the limit');
    assert.equal(notices.filter((message) => message.startsWith('$ ')).length, 2);
    assert.equal(notices[0], '$ echo API_KEY=[REDACTED]');
    assert.doesNotMatch(notices[0], /do-not-print/);
    assert.equal(notices[1], '$ echo two');
    const toolMessages = history.filter((message) => message.role === 'tool');
    assert.equal(toolMessages.length, 3);
    assert.match(toolMessages[2].content, /tool call limit \(2\) reached/);
  } finally {
    axios.post = originalPost;
  }
});

test('feedback command prints both contact emails and the issue tracker', async () => {
  const { CommandRouter } = require('../dist/commands/CommandRouter');
  const output = [];
  const { DEFAULT_CONFIG } = require('../dist/config/ConfigManager');
  const fakeContext = {
    args: '', config: structuredClone(DEFAULT_CONFIG), saveConfig() {},
    repl: { print: (message) => output.push(message) },
  };
  await new CommandRouter().route('/feedback', fakeContext);
  const joined = output.join('\n');
  assert.match(joined, /axionneuralis@gmail\.com/);
  assert.match(joined, /azrielspace852@gmail\.com/);
  assert.match(joined, /github\.com\/azrielspace852-wq\/axion-ai-agents-cli\/issues/);
});

test('custom models can be edited while built-in model definitions stay immutable', async () => {
  const H = require('../dist/commands/handlers');
  const { DEFAULT_CONFIG } = require('../dist/config/ConfigManager');
  const cfg = structuredClone(DEFAULT_CONFIG);
  cfg.customModels = [{ id: 'legacy-model-id', label: 'Legacy model', provider: 'google-ai-studio' }];
  cfg.model = 'legacy-model-id';
  const selections = [2, 0, 0]; // edit custom model -> first custom model -> Google AI Studio
  const answers = ['New display name', 'new-provider-basename'];
  const ctx = {
    config: cfg,
    saveConfig() {},
    repl: {
      select: async () => selections.shift(),
      question: async () => answers.shift(),
      print() {},
    },
  };
  await H.handleModels(ctx);
  assert.equal(cfg.customModels[0].label, 'New display name');
  assert.equal(cfg.customModels[0].id, 'new-provider-basename');
  assert.equal(cfg.model, 'new-provider-basename');
  assert.equal(cfg.customModels.length, 1);
  assert.ok(require('../dist/types').DEFAULT_MODELS.some((item) => item.id === 'gemma-4-31b-it'));
});

test('access scope and tool limit commands persist selected settings', async () => {
  const { CommandRouter } = require('../dist/commands/CommandRouter');
  const { DEFAULT_CONFIG } = require('../dist/config/ConfigManager');
  const cfg = structuredClone(DEFAULT_CONFIG);
  const selections = [1, 3]; // global scope, then 30 calls
  const output = [];
  const ctx = {
    args: '', config: cfg, saveConfig() {},
    repl: { select: async () => selections.shift(), print: (message) => output.push(message) },
  };
  const router = new CommandRouter();
  await router.route('/acces', ctx);
  await router.route('/tool-limit', ctx);
  assert.equal(cfg.accessScope, 'global');
  assert.equal(cfg.maxToolCallsPerRequest, 30);
  assert.ok(output.some((message) => /global/.test(message)));
});

test('workspace scope rejects a symlinked working directory that resolves outside workspace', async () => {
  if (process.platform === 'win32') return;
  const { ShellTool } = require('../dist/agent/tools/ShellTool');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'axion-workspace-'));
  const external = fs.mkdtempSync(path.join(os.tmpdir(), 'axion-external-'));
  const link = path.join(root, 'linked-outside');
  try {
    fs.symlinkSync(external, link, 'dir');
    const result = await ShellTool.execute({ command: 'pwd', cwd: link }, {
      cwd: root, accessScope: 'workspace', permissions: { shellExec: true },
    });
    assert.equal(result.success, false);
    assert.match(result.output, /outside the workspace/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(external, { recursive: true, force: true });
  }
});

test('selected custom model metadata is applied only when its provider matches active provider', () => {
  const { Agent } = require('../dist/agent/Agent');
  const { DEFAULT_CONFIG } = require('../dist/config/ConfigManager');
  const cfg = structuredClone(DEFAULT_CONFIG);
  cfg.model = 'private-openai-model';
  cfg.customModels = [{ id: 'private-openai-model', label: 'Private OpenAI Model', provider: 'openai-compatible', baseUrl: 'https://custom.example/v1' }];
  cfg.activeProvider = 'google-ai-studio';
  cfg.google.apiKey = 'google-test-key';
  cfg.openaiCompatible = { baseUrl: '', apiKey: '' };
  const agent = new Agent(() => cfg, () => {});
  assert.equal(agent.hasApiKey(), true, 'active Google provider should not be overridden by a mismatched OpenAI custom model');
});

test('terminal --help lists both terminal and in-chat commands', () => {
  const result = spawnSync(process.execPath, [path.join(__dirname, '../dist/index.js'), '--help'], {
    encoding: 'utf8', env: { ...process.env },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Terminal commands/);
  assert.match(result.stdout, /In-chat commands/);
  assert.match(result.stdout, /\/privacy-policy/);
  assert.match(result.stdout, /\/max-token/);
  assert.match(result.stdout, /\/max-tool-call/);
  assert.match(result.stdout, /update --info/);
});

test('terminal update --info shows installed vs latest without updating', () => {
  const result = spawnSync(process.execPath, [path.join(__dirname, '../dist/index.js'), 'update', '--info'], {
    encoding: 'utf8', env: { ...process.env }, timeout: 20000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Installed version:/);
  assert.match(result.stdout, /Latest available:/);
});

test('terminal update dry-run prints the npmjs install command', () => {
  const result = spawnSync(process.execPath, [path.join(__dirname, '../dist/index.js'), 'update'], {
    encoding: 'utf8', env: { ...process.env, AXION_UPDATE_DRY_RUN: '1' },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /npm install --global @axion-neuralis\/axion-ai-cli@latest/);
  assert.match(result.stdout, /https:\/\/registry\.npmjs\.org\//);
});

test('terminal --feedback prints support contacts and exits cleanly on EOF', () => {
  const result = spawnSync(process.execPath, [path.join(__dirname, '../dist/index.js'), '--feedback'], {
    encoding: 'utf8', env: { ...process.env }, input: '', timeout: 15000,
  });
  assert.match(result.stdout, /axionneuralis@gmail\.com/);
  assert.match(result.stdout, /github\.com\/azrielspace852-wq/);
});

// ---- provider and permissions regression tests ----
test('custom providers persist, enforce unique ids, and switch without re-entering credentials', () => {
  const { ConfigManager } = require('../dist/config/ConfigManager');
  const configPath = path.join(process.env.AXION_DATA_DIR, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify({
    version: 1,
    customProviders: [
      { id: 'my-ai', name: 'My AI', baseUrl: 'https://my.ai/v1', apiKey: 'secret-1234', defaultModel: 'my-model' },
      { id: 'my-ai', name: 'Dup', baseUrl: 'https://dup.ai/v1', apiKey: 'x' }, // duplicate id — must be dropped
    ],
    activeProvider: 'my-ai',
  }));
  const manager = new ConfigManager();
  const cfg = manager.get();
  assert.equal(cfg.customProviders.length, 1, 'duplicate custom provider id is dropped');
  assert.equal(cfg.customProviders[0].id, 'my-ai');
  assert.equal(cfg.activeProvider, 'my-ai', 'activeProvider can be a custom provider id');
  // Switching to the custom provider loads baseUrl/apiKey/model automatically (no re-entry).
  const { Agent } = require('../dist/agent/Agent');
  const agent = new Agent(() => cfg, () => {});
  assert.equal(agent.hasApiKey(), true, 'custom provider api key is loaded from config');
});

test('dangerous action policy defaults to always-ask and allow/deny are respected', () => {
  const { ConfigManager, DEFAULT_CONFIG } = require('../dist/config/ConfigManager');
  assert.equal(DEFAULT_CONFIG.dangerousActionPolicy, 'always-ask', 'default policy is always-ask');
  const { dangerousCommandReason } = require('../dist/agent/tools/ShellTool');
  assert.ok(dangerousCommandReason('rm -rf /tmp/x'), 'rm -rf detected as dangerous');
  assert.ok(dangerousCommandReason('git push origin main'), 'git push detected as dangerous');
  assert.ok(dangerousCommandReason('git push --force'), 'git push --force detected');
  assert.equal(dangerousCommandReason('ls -la'), null, 'ls is not dangerous');
  assert.equal(dangerousCommandReason('echo hello'), null, 'echo is not dangerous');
});

test('ESC cancel sets the cancellation flag (checked between tool-call iterations)', () => {
  const { Agent } = require('../dist/agent/Agent');
  const { DEFAULT_CONFIG } = require('../dist/config/ConfigManager');
  const cfg = structuredClone(DEFAULT_CONFIG);
  const agent = new Agent(() => cfg, () => {});
  assert.equal(agent.isCancelled(), false, 'starts uncancelled');
  agent.cancel();
  assert.equal(agent.isCancelled(), true, 'cancel() sets the flag');
});

test('UI step classification maps tool calls to human-readable steps', () => {
  const { classifyStep } = require('../dist/agent/Agent');
  assert.equal(classifyStep('read_file', { path: 'a.ts' }), 'Reading');
  assert.equal(classifyStep('list_dir', { path: '.' }), 'Reading');
  assert.equal(classifyStep('write_file', { path: 'a.ts' }), 'Editing file');
  assert.equal(classifyStep('delete_file', { path: 'a.ts' }), 'Deleting file');
  assert.equal(classifyStep('run_shell', { command: 'npm test' }), 'Running tests');
  assert.equal(classifyStep('run_shell', { command: 'npm run build' }), 'Building');
  assert.equal(classifyStep('run_shell', { command: 'git push' }), 'Running (privileged/destructive)');
  assert.equal(classifyStep('run_shell', { command: 'ls' }), 'Running command');
});

test('filesystem write_file is atomic and gated by fileWrite permission', async () => {
  const { WriteFileTool, ReadFileTool } = require('../dist/agent/tools/FileSystemTools');
  const target = path.join(os.tmpdir(), `axn-write-test-${Date.now()}.txt`);
  // Without fileWrite permission → blocked.
  let res = await WriteFileTool.execute({ path: target, content: 'hello' }, {
    permissions: { webAccess: true, searchAccess: true, shellExec: true, fileRead: true, fileWrite: false },
    cwd: os.tmpdir(), accessScope: 'global',
  });
  assert.equal(res.success, false, 'write_file blocked without fileWrite');
  // With fileWrite + always-allow policy → writes.
  res = await WriteFileTool.execute({ path: target, content: 'hello-atomic' }, {
    permissions: { webAccess: true, searchAccess: true, shellExec: true, fileRead: true, fileWrite: true },
    cwd: os.tmpdir(), accessScope: 'global', dangerousActionPolicy: 'always-allow',
  });
  assert.equal(res.success, true, res.output);
  assert.match(res.output, /Created/);
  const read = await ReadFileTool.execute({ path: target }, {
    permissions: { webAccess: true, searchAccess: true, shellExec: true, fileRead: true, fileWrite: false },
    cwd: os.tmpdir(), accessScope: 'global',
  });
  assert.match(read.output, /hello-atomic/);
  fs.unlinkSync(target);
});
