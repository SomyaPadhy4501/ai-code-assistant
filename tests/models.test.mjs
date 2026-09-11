import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {readModelConfig, writeModelConfig, validModelName, validContextSize, sameModel, isInstalled, describeInstalled, DEFAULT_COPILOT, DEFAULT_INTERVIEWER, DEFAULT_CONTEXT} from '../models.mjs';

async function fixture(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gym-models-'));
  try { await fn(path.join(dir, 'models.json')); } finally { await fs.rm(dir, {recursive: true, force: true}); }
}

test('model configuration falls back to the defaults and survives a round trip', () => fixture(async file => {
  assert.deepEqual(await readModelConfig(file), {copilot: DEFAULT_COPILOT, interviewer: DEFAULT_INTERVIEWER, contextSize: DEFAULT_CONTEXT});
  await writeModelConfig(file, {interviewer: 'qwen3.5:latest'});
  assert.deepEqual(await readModelConfig(file), {copilot: DEFAULT_COPILOT, interviewer: 'qwen3.5:latest', contextSize: DEFAULT_CONTEXT});
  await writeModelConfig(file, {copilot: 'qwen3:0.6b'});
  assert.deepEqual(await readModelConfig(file), {copilot: 'qwen3:0.6b', interviewer: 'qwen3.5:latest', contextSize: DEFAULT_CONTEXT});
  await writeModelConfig(file, {contextSize: 65536});
  assert.equal((await readModelConfig(file)).contextSize, 65536);
}));

test('a corrupt or hostile configuration file cannot inject a model name', () => fixture(async file => {
  await fs.writeFile(file, '{"copilot":"../../etc/passwd","interviewer":"a model; rm -rf /","contextSize":"lots"}');
  assert.deepEqual(await readModelConfig(file), {copilot: DEFAULT_COPILOT, interviewer: DEFAULT_INTERVIEWER, contextSize: DEFAULT_CONTEXT});
  await fs.writeFile(file, 'not json at all');
  assert.deepEqual(await readModelConfig(file), {copilot: DEFAULT_COPILOT, interviewer: DEFAULT_INTERVIEWER, contextSize: DEFAULT_CONTEXT});
  await assert.rejects(writeModelConfig(file, {contextSize: 10}), /context size/);
  await assert.rejects(writeModelConfig(file, {contextSize: 'huge'}), /context size/);
  await assert.rejects(writeModelConfig(file, {copilot: 'bad name'}), /Ollama model name/);
  await assert.rejects(writeModelConfig(file, {}), /Choose a model/);
}));

test('model names accept registry paths and reject shell or path characters', () => {
  for (const name of ['qwen3.5:0.8b', 'llama3.2:3b', 'hf.co/ggml-org/Voxtral-Mini-3B-2507-GGUF:Q4_K_M', 'qwen3.5']) assert.ok(validModelName(name), name);
  for (const name of ['../escape', 'model;whoami', 'model name', '-leading', '', null, 'a'.repeat(200)]) assert.ok(!validModelName(name), String(name));
});

test('an untagged model matches its latest tag the way Ollama resolves it', () => {
  assert.ok(sameModel('qwen3.5', 'qwen3.5:latest'));
  assert.ok(!sameModel('qwen3.5:9b', 'qwen3.5:latest'));
  const installed = describeInstalled({models: [{name: 'qwen3.5:latest', size: 6594474711, details: {parameter_size: '9.7B'}, capabilities: ['vision', 'tools']}]});
  assert.deepEqual(installed, [{name: 'qwen3.5:latest', parameters: '9.7B', capabilities: ['vision', 'tools'], sizeBytes: 6594474711}]);
  assert.ok(isInstalled(installed, 'qwen3.5'));
  assert.ok(!isInstalled(installed, 'qwen3.5:0.8b'));
  assert.ok(!isInstalled([], 'qwen3.5:latest'));
});

test('the context window default is large enough to be useful and is bounds checked', () => {
  // A 4K window fills after a single question on a real file, which is the
  // problem this default exists to avoid.
  assert.ok(DEFAULT_CONTEXT >= 16384, `default context ${DEFAULT_CONTEXT} is too small to hold a source file and a conversation`);
  for (const size of [2048, 32768, 262144]) assert.ok(validContextSize(size), String(size));
  for (const size of [0, -1, 1024, 2_000_000, 4096.5, '8192', null]) assert.ok(!validContextSize(size), String(size));
});
