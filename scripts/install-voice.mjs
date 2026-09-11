// Installs a local neural text-to-speech voice so the interviewer does not have
// to use the browser's compact system voices.
//
//   node scripts/install-voice.mjs [voice-id]
//
// Everything lands in .tts/ (gitignored): an isolated virtualenv holding
// piper-tts, and one ONNX voice. Nothing is installed system-wide, and nothing
// is contacted at interview time — synthesis runs entirely offline afterwards.
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TTS = path.join(ROOT, '.tts');
const VOICES = path.join(TTS, 'voices');
const VENV = path.join(TTS, 'venv');
const VOICE = process.argv[2] || 'en_US-hfc_female-medium';
const BASE = 'https://huggingface.co/rhasspy/piper-voices/resolve/main';

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {stdio: 'inherit', ...options});
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)));
  });
}
async function which(candidates) {
  for (const candidate of candidates) {
    try { await run(candidate, ['--version'], {stdio: 'ignore'}); return candidate; } catch {}
  }
  return null;
}
// en_US-hfc_female-medium -> en/en_US/hfc_female/medium
function voicePath(id) {
  const [locale, name, quality] = id.split('-');
  if (!locale || !name || !quality) throw new Error(`Voice id should look like en_US-hfc_female-medium, got "${id}".`);
  return `${locale.split('_')[0]}/${locale}/${name}/${quality}/${id}`;
}
async function download(url, destination) {
  const response = await fetch(url, {redirect: 'follow'});
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  await fs.writeFile(destination, Buffer.from(await response.arrayBuffer()));
  const {size} = await fs.stat(destination);
  console.log(`  ${path.basename(destination)} — ${(size / 1e6).toFixed(1)} MB`);
  return size;
}

const python = await which(['python3.12', 'python3.13', 'python3.11', 'python3']);
if (!python) { console.error('No python3 found. Install Python 3.11+ and retry.'); process.exit(1); }
console.log(`Using ${python}`);

await fs.mkdir(VOICES, {recursive: true});
const pip = path.join(VENV, 'bin', 'pip');
const venvPython = path.join(VENV, 'bin', 'python');
try { await fs.access(venvPython); console.log('Virtualenv already present.'); }
catch {
  console.log('Creating an isolated virtualenv in .tts/venv …');
  await run(python, ['-m', 'venv', VENV]);
}
console.log('Installing piper-tts (this pulls onnxruntime, a few tens of MB) …');
await run(pip, ['install', '--quiet', '--upgrade', 'pip']);
await run(pip, ['install', '--quiet', 'piper-tts']);

const relative = voicePath(VOICE);
const model = path.join(VOICES, `${VOICE}.onnx`);
const config = `${model}.json`;
let haveVoice = true;
try { await fs.access(model); await fs.access(config); } catch { haveVoice = false; }
if (haveVoice) console.log(`Voice ${VOICE} already downloaded.`);
else {
  console.log(`Downloading voice ${VOICE} …`);
  await download(`${BASE}/${relative}.onnx`, model);
  await download(`${BASE}/${relative}.onnx.json`, config);
}

console.log('Synthesising a probe to confirm it works …');
const probe = path.join(TTS, 'probe.wav');
await new Promise((resolve, reject) => {
  const child = spawn(venvPython, ['-m', 'piper', '-m', model, '-f', probe], {stdio: ['pipe', 'inherit', 'inherit']});
  child.on('error', reject);
  child.on('close', code => code === 0 ? resolve() : reject(new Error(`piper exited ${code}`)));
  child.stdin.end('Hello. I am your interviewer today.');
});
const {size} = await fs.stat(probe);
if (size < 1000) throw new Error('piper produced an empty file; the voice is not usable.');
console.log(`  probe.wav — ${(size / 1000).toFixed(0)} kB, so synthesis works.`);

await fs.writeFile(path.join(TTS, 'config.json'), JSON.stringify({python: venvPython, model, voice: VOICE}, null, 2));
console.log(`\nDone. ${VOICE} is installed.`);
console.log('Restart the server and the interviewer will speak with it; the browser voice stays as the fallback.');
