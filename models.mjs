import fs from 'node:fs/promises';

// The copilot stays deliberately small: catching its mistakes is the exercise.
// The interviewer is larger because it has to hold a conversation.
export const DEFAULT_COPILOT = process.env.COPILOT_MODEL || 'qwen3.5:0.8b';
export const DEFAULT_INTERVIEWER = process.env.INTERVIEWER_MODEL || 'qwen3.5:4b';
export const ROLES = ['copilot', 'interviewer'];
// Recent models carry six-figure context windows, so a small fixed window is
// what makes a conversation feel full after one question. The cost of a larger
// one is prefill time and KV-cache memory, so it stays configurable.
export const CONTEXT_CHOICES = [4096, 8192, 16384, 32768, 65536, 131072, 262144];
export const DEFAULT_CONTEXT = Number(process.env.COPILOT_CONTEXT) || 32768;
export function validContextSize(value) { return Number.isInteger(value) && value >= 2048 && value <= 1048576; }

export function validModelName(name) {
  return typeof name === 'string' && name.length <= 120 && /^[a-zA-Z0-9][\w.-]*(\/[\w.-]+)*(:[\w.-]+)?$/.test(name);
}
export function assertModelName(name) {
  if (!validModelName(name)) throw new Error('Use an Ollama model name such as qwen3.5:0.8b.');
  return name;
}
// Ollama treats `foo` and `foo:latest` as the same tag.
export function sameModel(a, b) { const tagged = x => String(x).includes(':') ? String(x) : `${x}:latest`; return tagged(a) === tagged(b); }
export function isInstalled(installed, name) { return (installed || []).some(model => sameModel(model.name ?? model, name)); }
// Reasoning models spend their token budget in `thinking` and can return empty
// content, so thinking is switched off for the short, budgeted replies this app
// asks for. Ollama rejects the flag on models that do not declare the
// capability, so it is only sent when the installed model advertises it.
export function supportsThinking(installed, name) {
  return (installed || []).some(model => sameModel(model.name ?? model, name) && (model.capabilities || []).includes('thinking'));
}

export async function readModelConfig(file) {
  let stored = {};
  try { stored = JSON.parse(await fs.readFile(file, 'utf8')); } catch {}
  return {
    copilot: validModelName(stored.copilot) ? stored.copilot : DEFAULT_COPILOT,
    interviewer: validModelName(stored.interviewer) ? stored.interviewer : DEFAULT_INTERVIEWER,
    contextSize: validContextSize(stored.contextSize) ? stored.contextSize : DEFAULT_CONTEXT
  };
}
export async function writeModelConfig(file, update) {
  const next = await readModelConfig(file);
  let changed = false;
  for (const role of ROLES) if (update?.[role] !== undefined) { next[role] = assertModelName(update[role]); changed = true; }
  if (update?.contextSize !== undefined) {
    const size = Number(update.contextSize);
    if (!validContextSize(size)) throw new Error('Choose a context size between 2,048 and 1,048,576 tokens.');
    next.contextSize = size; changed = true;
  }
  if (!changed) throw new Error('Choose a model for the copilot or the interviewer.');
  await fs.writeFile(file, JSON.stringify(next));
  return next;
}
// Ollama reports its own parameter counts and capabilities; surface them so the
// picker can show what a model actually is rather than guessing from its name.
export function describeInstalled(tags) {
  return (tags?.models || []).map(model => ({
    name: model.name,
    parameters: model.details?.parameter_size || null,
    capabilities: model.capabilities || [],
    sizeBytes: model.size ?? null
  })).sort((a, b) => a.name.localeCompare(b.name));
}
