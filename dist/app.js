import {createWorkspace} from './workspace.js';
import {parseDiagnostics, countBySeverity} from './diagnostics.js';
import {renderMarkdown} from './markdown.js';
const $ = id => document.getElementById(id);
let current = null, history = [], lastOutput = '', noticeTimer;
let runtimeOptions = {};

function el(tag, text, className) { const node = document.createElement(tag); if (text !== undefined && text !== '') node.textContent = text; if (className) node.className = className; return node; }
function notify(text) { $('notice').textContent = text; $('notice').hidden = false; clearTimeout(noticeTimer); noticeTimer = setTimeout(() => $('notice').hidden = true, 7000); }
async function api(url, data) {
  const response = await fetch(url, data ? {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data)} : {});
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Request failed');
  return result;
}
async function waitJob(value, onProgress = () => {}) {
  if (!value.job) return value;
  for (;;) {
    const state = await api('/api/job?id=' + value.job);
    onProgress(state.message, state);
    if (state.status === 'done') return state.result;
    if (state.status === 'error') throw new Error(state.error);
    await new Promise(resolve => setTimeout(resolve, 1500));
  }
}
// Swapping textContent would destroy an icon button's SVG and a select's
// options, so the existing child nodes are kept and restored instead.
async function busy(button, action) {
  const iconOnly = !!button.querySelector('svg') || button.tagName === 'SELECT';
  const children = iconOnly ? null : [...button.childNodes];
  button.disabled = true;
  if (iconOnly) button.classList.add('working');
  else button.replaceChildren(document.createTextNode('Working…'));
  try { await action(); }
  catch (error) { notify(error.message); }
  finally {
    button.disabled = false;
    if (iconOnly) button.classList.remove('working');
    else button.replaceChildren(...children);
  }
}

const workspace = createWorkspace({
  api, notify, el,
  sessionId: () => current?.id,
  onDirtyChange: () => { $('save').textContent = workspace.isDirty() ? 'Save changes' : 'Saved'; }
});

// ── theme ─────────────────────────────────────────────────
// Stored choice wins; with nothing stored the CSS follows the system preference,
// so the first paint already matches and there is no flash.
function applyTheme(mode) {
  const dark = mode === 'dark';
  document.documentElement.dataset.theme = mode;
  $('themeToggle').textContent = dark ? '☀' : '☾';
  $('themeToggle').title = dark ? 'Switch to light theme' : 'Switch to dark theme';
  workspace.setTheme(mode);
}
function initialTheme() {
  const stored = localStorage.getItem('debug-gym-theme');
  if (stored === 'dark' || stored === 'light') return stored;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
applyTheme(initialTheme());
$('themeToggle').onclick = () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  localStorage.setItem('debug-gym-theme', next);
  applyTheme(next);
};
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', event => {
  if (!localStorage.getItem('debug-gym-theme')) applyTheme(event.matches ? 'dark' : 'light');
});

// ── status and models ─────────────────────────────────────
async function status() {
  const state = await api('/api/status');
  $('health').textContent = state.docker && state.modelReady ? '●' : '○';
  $('health').style.color = state.docker && state.modelReady ? 'var(--good)' : 'var(--muted)';
  $('setupStatus').textContent = `Docker: ${state.docker ? 'ready' : 'not running'} · Ollama: ${state.ollama ? 'connected' : 'not running'} · copilot ${state.model}: ${state.modelReady ? 'ready' : 'not downloaded'} · interviewer ${state.interviewerModel}: ${state.interviewerReady ? 'ready' : 'not downloaded'}`;
  return state;
}
const roles = [
  ['copilot', 'copilotModel', 'copilotNote', 'Kept small on purpose: spotting its mistakes is the exercise.'],
  ['interviewer', 'interviewerModel', 'interviewerNote', 'Needs enough capacity to hold a conversation and ask follow-ups.']
];
async function loadModels() {
  const info = await api('/api/models');
  for (const [role, selectId, noteId, guidance] of roles) {
    const select = $(selectId), chosen = info.selected[role];
    select.replaceChildren();
    for (const model of info.installed) { const option = el('option', `${model.name}${model.parameters ? ` · ${model.parameters}` : ''}`); option.value = model.name; select.append(option); }
    // Keep a configured-but-absent model visible so it can be downloaded rather
    // than silently replaced by whatever happens to be installed.
    if (![...select.options].some(option => option.value === chosen)) { const option = el('option', `${chosen} · not downloaded`); option.value = chosen; select.append(option); }
    select.value = chosen;
    const details = info.installed.find(model => model.name === chosen);
    $(noteId).textContent = `${guidance}${details ? ` Installed: ${details.parameters || 'unknown size'}${details.capabilities.length ? ` · ${details.capabilities.join(', ')}` : ''}.` : ` ${chosen} is not downloaded yet.`}`;
    select.onchange = () => busy(select, async () => { await api('/api/models', {[role]: select.value}); await loadModels(); await status(); notify(`${role === 'copilot' ? 'Copilot' : 'Interviewer'} set to ${select.value}.`); });
  }
  const contextSelect = $('contextSize');
  const limit = info.contextLimit;
  contextSelect.replaceChildren();
  for (const choice of info.contextChoices.filter(choice => !limit || choice <= limit)) {
    const option = el('option', `${(choice / 1024).toLocaleString()}K tokens`);
    option.value = String(choice);
    contextSelect.append(option);
  }
  if (![...contextSelect.options].some(option => Number(option.value) === info.selected.contextSize)) {
    const option = el('option', `${(info.selected.contextSize / 1024).toLocaleString()}K tokens`);
    option.value = String(info.selected.contextSize);
    contextSelect.append(option);
  }
  contextSelect.value = String(info.selected.contextSize);
  $('contextNote').textContent = `${info.selected.copilot} reports a maximum of ${limit ? `${(limit / 1024).toLocaleString()}K tokens` : 'an unknown size'}. A larger window keeps more of the file, test output and conversation in view, at the cost of slower first responses and more memory.`;
  contextSelect.onchange = () => busy(contextSelect, async () => { await api('/api/models', {contextSize: Number(contextSelect.value)}); await loadModels(); notify(`Copilot context window set to ${(Number(contextSelect.value) / 1024).toLocaleString()}K tokens.`); });
  if (!info.ollama) $('setupStatus').textContent = 'Ollama is not responding, so installed models cannot be listed. Start Ollama and check connections.';
  $('pullModel').placeholder = info.defaults.copilot;
  return info;
}
$('setupButton').onclick = () => { $('setup').showModal(); Promise.all([status(), loadModels()]).catch(error => notify(error.message)); };
$('closeSetup').onclick = () => $('setup').close();
$('refreshStatus').onclick = event => busy(event.currentTarget, async () => { await status(); await loadModels(); });
$('pull').onclick = event => busy(event.currentTarget, async () => {
  const model = $('pullModel').value.trim() || undefined;
  $('setupStatus').textContent = 'Downloading the model. This can take several minutes…';
  await waitJob(await api('/api/model/pull', {model}), text => $('setupStatus').textContent = text);
  await status(); await loadModels();
});

// ── runtime and test result ───────────────────────────────
// Running only the full test suite is not how debugging actually works: you want
// a fast compile, then a focused run, and only then the whole suite. These
// targets all execute in the same container; only `suite` is graded.
function runTargets() {
  const benchmark = !!current?.benchmark;
  return [
    benchmark && {id: 'suite', label: 'Graded regression suite', command: null},
    {id: 'test', label: 'Run tests', command: 'command'},
    {id: 'build', label: 'Build / compile', command: 'build'},
    {id: 'custom', label: 'Custom command…', command: null}
  ].filter(Boolean);
}
function populateTargets() {
  const select = $('runTarget'), targets = runTargets();
  const previous = select.value;
  select.replaceChildren();
  for (const target of targets) { const option = el('option', target.label); option.value = target.id; select.append(option); }
  select.value = targets.some(target => target.id === previous) ? previous : targets[0].id;
}
function configureRuntime() {
  const runtime = runtimeOptions[$('runtime').value];
  if (!runtime) return;
  const benchmark = !!current?.benchmark;
  const target = $('runTarget').value;
  if (target === 'suite') { $('command').value = 'Graded regression suite'; $('command').disabled = true; }
  else if (target === 'test') { $('command').value = runtime.command; $('command').disabled = false; }
  else if (target === 'build') { $('command').value = runtime.build || runtime.command; $('command').disabled = false; }
  else $('command').disabled = false;
  $('run').textContent = target === 'suite' ? '▶ Run suite' : '▶ Run';
  $('runtimeImage').value = benchmark ? current.image : runtime.image;
  $('runtimeImage').disabled = benchmark;
  $('runtime').disabled = benchmark;
  // The image only matters for an imported repository, where the candidate may
  // have to supply one carrying the project's dependencies. A benchmark task and
  // a built-in exercise both come with a known environment, so this is noise.
  $('envSettings').hidden = benchmark || !current || current.source === 'Built-in challenge';
  $('environmentNote').textContent = benchmark
    ? 'Uses the task’s prepared dependencies. Benchmark images are x86_64 only and run emulated on Apple Silicon, so expect slower runs.'
    : 'Commands run in a disposable writable copy, without network access. Compilers are included; third-party project dependencies require a prepared image. Build outputs are discarded after each run.';
}
$('runTarget').onchange = configureRuntime;
$('briefButton').onclick = () => $('briefDialog').showModal();
$('closeBrief').onclick = () => $('briefDialog').close();
const verdicts = {resolved: 'Target tests pass', unresolved: 'Target tests still failing', regressed: 'Regression detected', unknown: 'Not determined', timed_out: 'Timed out'};
const verdictTone = {resolved: 'good', unresolved: 'bad', regressed: 'bad', unknown: 'warn', timed_out: 'warn'};
function listNames(label, names, limit = 8) {
  const node = el('p', '', 'name-list');
  node.textContent = `${label}: ${names.slice(0, limit).join(', ')}${names.length > limit ? ` (+${names.length - limit} more)` : ''}`;
  return node;
}
function setTestState(text, tone) { $('testState').textContent = text; $('testState').className = `pill${tone ? ` ${tone}` : ''}`; }
function renderScore(score) {
  const node = $('score');
  node.replaceChildren();
  if (!score) { node.className = 'panel-pane'; return; }
  node.className = `panel-pane ${score.verdict}`;
  const head = el('div', '', 'score-head');
  head.append(el('span', `${verdicts[score.verdict]} · ${score.targets.passing.length}/${score.targets.total} target tests passing`));
  node.append(head, el('p', score.reason));
  if (score.targets.failing.length) node.append(listNames('Still failing', score.targets.failing));
  if (score.guards.failing.length) node.append(listNames('Newly failing', score.guards.failing));
  if (score.targets.missing.length) node.append(listNames('Not found in the output', score.targets.missing));
  // The whole point of scoring by test name is that the exit code can lie.
  if (!score.exitCodeAgrees) node.append(el('small', `The evaluation script exited ${score.exitCode}, which disagrees with the per-test result above. Trust the per-test result and read the log.`));
}
function showPanel(which) { document.querySelector(`.panel-tab[data-panel="${which}"]`)?.click(); }
// Raw log text is not a debugging aid. Compiler and runtime output is parsed
// into file/line/message problems, listed here and marked in the editor.
function renderProblems(output) {
  const problems = parseDiagnostics(output, current?.files || []);
  const host = $('problems');
  host.replaceChildren();
  const counts = countBySeverity(problems);
  const badge = $('problemCount');
  badge.textContent = problems.length ? `${problems.length}` : '0';
  badge.className = `pill${counts.error ? ' bad' : counts.warning ? ' warn' : ''}`;
  if (!problems.length) {
    host.append(el('p', output ? 'No file-and-line problems were recognised in this output. Read the Output tab — the failure may not name a source location.' : 'Run something to collect problems.', 'problems-empty'));
    workspace.setDiagnostics([]);
    return problems;
  }
  host.append(el('p', `${counts.error || 0} error${counts.error === 1 ? '' : 's'}, ${counts.warning || 0} warning${counts.warning === 1 ? '' : 's'}`, 'problems-head'));
  for (const problem of problems) {
    const row = el('button', '', `problem problem-${problem.severity}`);
    row.append(el('span', problem.severity === 'error' ? '✕' : problem.severity === 'warning' ? '⚠' : 'ℹ', 'problem-mark'));
    const body = el('div', '', 'problem-body');
    body.append(el('span', problem.message, 'problem-message'), el('span', `${problem.file}:${problem.line}${problem.column > 1 ? `:${problem.column}` : ''}`, 'problem-where'));
    row.append(body);
    row.onclick = () => workspace.open(problem.file, {line: problem.line}).catch(error => notify(error.message));
    host.append(row);
  }
  workspace.setDiagnostics(problems);
  return problems;
}

// The raw dataset URL and a 40-character hash are noise for a candidate; the
// provenance still matters, so it is kept short and secondary.
function sourceLabel(session) {
  const commit = session.commit ? ` · commit ${session.commit.slice(0, 7)}` : '';
  if (session.source?.includes('huggingface.co')) return `SWE-bench Multilingual${commit}`;
  if (session.source === 'Built-in challenge') return 'Built-in exercise';
  return `${String(session.source || '').replace(/^https?:\/\/(www\.)?/, '').replace(/\.git$/, '')}${commit}`;
}

// ── session lifecycle ─────────────────────────────────────
async function enter(session) {
  // A previous session whose interview has ended refuses writes, and that must
  // not block opening a different one.
  if (current && workspace.isDirty()) await workspace.saveAll().catch(error => notify(`Previous session not saved: ${error.message}`));
  current = session;
  history = []; lastOutput = '';
  workspace.reset(session.files);
  renderMarkdown(session.brief, $('brief'));
  $('briefTitle').textContent = session.benchmark ? 'Problem statement' : 'Problem statement';
  $('source').textContent = sourceLabel(session);
  usage = null;
  $('messages').replaceChildren(el('div', 'Run the tests, inspect the failure, and ask me what to investigate.', 'message assistant'));
  $('output').textContent = 'Run the tests to establish your starting point.';
  setTestState('Not run');
  renderScore(null);
  renderProblems('');
  loadChats();
  renderContext();
  showPanel('output');
  $('runtime').value = session.runtime || 'node';
  populateTargets();
  configureRuntime();
  $('lobby').hidden = true; $('workspace').hidden = false; $('back').hidden = false; $('clockWrap').hidden = false;
  document.body.classList.add('workspace-active');
  $('briefButton').hidden = false;
  const startInterview = $('startInterview'); if (startInterview) startInterview.hidden = false;
  localStorage.setItem('debug-gym-session', session.id);
  await workspace.boot();
  const first = session.files.find(name => /readme/i.test(name))
    || session.files.find(name => /\.(mjs|js|py|java|go|rs|rb|php|ts)$/.test(name) && !/test|spec/i.test(name))
    || session.files[0];
  if (first) await workspace.open(first).catch(error => notify(error.message));
  window.dispatchEvent(new CustomEvent('gym-session', {detail: session}));
}
$('back').onclick = event => busy(event.currentTarget, async () => {
  if (workspace.isDirty()) await workspace.saveAll().catch(error => notify(`Not saved: ${error.message}`));
  $('workspace').hidden = true; $('lobby').hidden = false; $('back').hidden = true; $('clockWrap').hidden = true;
  document.body.classList.remove('workspace-active');
  $('briefButton').hidden = true;
  const startInterview = $('startInterview'); if (startInterview) startInterview.hidden = true;
});
$('save').onclick = event => busy(event.currentTarget, async () => { if (!await workspace.saveActive()) notify('No unsaved changes in this file.'); });
window.addEventListener('beforeunload', event => { if (workspace.isDirty()) { event.preventDefault(); event.returnValue = ''; } });
$('runtime').onchange = configureRuntime;

$('run').onclick = event => busy(event.currentTarget, async () => {
  await workspace.saveAll();
  const target = $('runTarget').value;
  setTestState('Running', 'warn');
  $('output').textContent = 'Starting isolated runtime…';
  renderScore(null); showPanel('output');
  $('back').disabled = true;
  try {
    const result = await waitJob(await api('/api/run', {id: current.id, runtime: $('runtime').value, image: $('runtimeImage').value, command: $('command').value, target: target === 'suite' ? 'suite' : 'command'}), (text, state) => {
      const live = state?.output?.trim();
      $('output').textContent = live ? `${text}\n\n${state.output}` : text;
      $('output').scrollTop = $('output').scrollHeight;
    });
    lastOutput = result.output;
    $('output').textContent = result.output || '(No output)';
    const problems = renderProblems(result.output);
    renderScore(result.score);
    if (result.timedOut) setTestState('Timed out', 'warn');
    else if (result.score) { setTestState(verdicts[result.score.verdict], verdictTone[result.score.verdict]); showPanel(problems.length ? 'problems' : 'result'); }
    else { setTestState(result.code === 0 ? 'Command passed' : `Exit ${result.code}`, result.code === 0 ? 'good' : 'bad'); if (result.code !== 0 && problems.length) showPanel('problems'); }
  } catch (error) {
    setTestState('Could not run', 'bad');
    $('output').textContent = error.message;
    throw error;
  } finally { $('back').disabled = false; }
});

// ── copilot context meter ─────────────────────────────────
// The ring only ever shows what the model actually reported using. Before the
// first reply there is no measurement, so it reads as unmeasured rather than
// guessing — an invented number here would be worse than none.
const RING_CIRCUMFERENCE = 2 * Math.PI * 9;
let usage = null, chats = [];
const approxTokens = characters => Math.ceil(characters / 4);
function renderContext() {
  const contextSize = usage?.contextSize || 4096;
  const measured = Number.isInteger(usage?.promptTokens);
  const tokens = measured ? usage.promptTokens : 0;
  const ratio = Math.min(1, tokens / contextSize);
  const fill = document.querySelector('.ring-fill');
  fill.style.strokeDasharray = `${RING_CIRCUMFERENCE}`;
  fill.style.strokeDashoffset = `${RING_CIRCUMFERENCE * (1 - ratio)}`;
  const ring = $('contextRing');
  ring.classList.toggle('tight', ratio >= 0.75);
  ring.classList.toggle('full', ratio >= 0.95);
  ring.classList.toggle('idle', !measured);
  $('contextLabel').textContent = measured ? `${Math.round(ratio * 100)}%` : '—';
  const tip = $('contextTip');
  tip.replaceChildren();
  if (!measured) {
    tip.append(el('strong', 'No context used yet'), el('em', 'This fills in once the copilot answers, using the prompt token count the model itself reports. Nothing here is estimated.'));
    return;
  }
  tip.append(el('strong', `${tokens.toLocaleString()} of ${contextSize.toLocaleString()} tokens used`));
  const parts = usage.parts || {};
  const rows = [['Issue brief', parts.brief], ['Open file', parts.file], ['Test output', parts.output], ['Conversation', parts.history], ['Your question', parts.question]]
    .filter(([, chars]) => chars > 0)
    .map(([label, chars]) => `${label}: ~${approxTokens(chars).toLocaleString()} tokens`);
  for (const row of rows) tip.append(el('span', row));
  tip.append(el('em', 'Total is measured by the model. The per-section split is derived from character counts, so it is approximate. Most of the budget is the open file and test output — compressing the conversation frees only its share.'));
}
for (const event of ['mouseenter', 'focus']) $('contextRing').addEventListener(event, () => { renderContext(); $('contextTip').hidden = false; });
for (const event of ['mouseleave', 'blur']) $('contextRing').addEventListener(event, () => { $('contextTip').hidden = true; });
$('contextRing').onclick = () => { renderContext(); $('contextTip').hidden = !$('contextTip').hidden; };

// ── saved chats ───────────────────────────────────────────
// Starting a new chat archives the old one rather than discarding it.
const chatsKey = () => `debug-gym-chats-${current?.id}`;
function loadChats() {
  try { chats = JSON.parse(localStorage.getItem(chatsKey()) || '[]'); } catch { chats = []; }
  if (!Array.isArray(chats)) chats = [];
  renderChats();
}
function persistChats() {
  try { localStorage.setItem(chatsKey(), JSON.stringify(chats.slice(-30))); } catch {}
  renderChats();
}
function renderChats() {
  $('chatsCount').textContent = chats.length ? `${chats.length}` : '';
  $('chatsCount').dataset.zero = String(!chats.length);
  const host = $('chatsList');
  host.replaceChildren();
  if (!chats.length) { host.append(el('p', 'A chat is saved here when you start a new one.', 'chats-empty')); return; }
  for (const chat of [...chats].reverse()) {
    const asked = chat.messages.filter(message => message.role === 'user').length;
    const row = el('button', '', 'chat-row');
    row.append(el('span', chat.title, 'chat-title'), el('span', `${asked} question${asked === 1 ? '' : 's'} · ${new Date(chat.at).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}`, 'chat-meta'));
    row.onclick = () => { $('chatsList').hidden = true; $('chatsToggle').classList.remove('active'); restoreChat(chat.id); };
    host.append(row);
  }
}
function archiveCurrentChat() {
  if (!history.length) return false;
  const firstQuestion = history.find(message => message.role === 'user')?.content || 'Conversation';
  chats.push({id: crypto.randomUUID(), title: firstQuestion.slice(0, 70), messages: history, at: Date.now()});
  persistChats();
  return true;
}
function paintMessages(messages) {
  const host = $('messages');
  host.replaceChildren();
  for (const message of messages) {
    const bubble = el('div', '', `message ${message.role}`);
    if (message.role === 'user') bubble.textContent = message.content;
    else renderMarkdown(message.content, bubble);
    host.append(bubble);
  }
  host.scrollTop = host.scrollHeight;
}
function restoreChat(id) {
  const chat = chats.find(entry => entry.id === id);
  if (!chat) return;
  archiveCurrentChat();
  chats = chats.filter(entry => entry.id !== id);
  history = chat.messages;
  usage = null;
  paintMessages(history);
  persistChats();
  renderContext();
  notify('Reopened a saved chat. Its context is rebuilt from the transcript on your next question.');
}
$('chatsToggle').onclick = () => {
  const list = $('chatsList');
  list.hidden = !list.hidden;
  $('chatsToggle').setAttribute('aria-expanded', String(!list.hidden));
  $('chatsToggle').classList.toggle('active', !list.hidden);
};
function startNewChat(note = 'New chat. The copilot no longer sees the earlier conversation.') {
  const archived = archiveCurrentChat();
  history = [];
  usage = null;
  $('messages').replaceChildren(el('div', note, 'message assistant'));
  renderContext();
  return archived;
}
$('newChat').onclick = event => { const archived = startNewChat(); notify(archived ? 'Saved the previous chat.' : 'Already a new chat.'); event.currentTarget.blur(); };

// ── slash commands ────────────────────────────────────────
async function compressChat() {
  const result = await api('/api/chat/compress', {id: current.id, history});
  archiveCurrentChat();
  history = [{role: 'assistant', content: `Earlier conversation, condensed: ${result.summary}`}];
  usage = null;
  const bubble = el('div', '', 'message summary');
  renderMarkdown(`Conversation condensed from ${result.replaced} messages:\n\n${result.summary}`, bubble);
  $('messages').replaceChildren(bubble);
  renderContext();
  notify('Compressed. The open file and test output still take most of the context.');
}
const COMMANDS = [
  {name: '/compress', hint: 'Summarise this conversation to free its share of the context', run: compressChat},
  {name: '/new', hint: 'Start a new chat and save this one', run: async () => { const archived = startNewChat(); notify(archived ? 'Saved the previous chat.' : 'Already a new chat.'); }},
  {name: '/chats', hint: 'List the chats saved in this session', run: async () => { $('chatsList').hidden = false; $('chatsToggle').classList.add('active'); notify(`${chats.length} saved chat${chats.length === 1 ? '' : 's'}.`); }}
];
function renderSlashMenu() {
  const value = $('prompt').value;
  const menu = $('slashMenu');
  if (!value.startsWith('/')) { menu.hidden = true; return; }
  const typed = value.trim().toLowerCase();
  const matches = COMMANDS.filter(command => command.name.startsWith(typed) || typed === '/');
  menu.replaceChildren();
  if (!matches.length) { menu.hidden = true; return; }
  for (const command of matches) {
    const row = el('button', '', 'slash-row');
    row.type = 'button';
    row.append(el('span', command.name, 'slash-name'), el('span', command.hint, 'slash-hint'));
    row.onclick = () => { $('prompt').value = command.name; menu.hidden = true; $('chatForm').requestSubmit(); };
    menu.append(row);
  }
  menu.hidden = false;
}
$('prompt').addEventListener('input', () => {
  const box = $('prompt');
  box.style.height = 'auto';
  box.style.height = `${Math.min(160, box.scrollHeight)}px`;
  renderSlashMenu();
});
// Enter sends, Shift+Enter adds a newline — the convention everywhere else.
$('prompt').addEventListener('keydown', event => {
  if (event.key === 'Escape') { $('slashMenu').hidden = true; return; }
  if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); $('chatForm').requestSubmit(); }
});

$('chatForm').onsubmit = event => {
  event.preventDefault();
  const prompt = $('prompt').value.trim();
  if (!prompt) return;
  const command = COMMANDS.find(entry => entry.name === prompt.toLowerCase());
  if (command) {
    $('prompt').value = ''; $('prompt').style.height = 'auto'; $('slashMenu').hidden = true;
    busy($('sendChat'), command.run);
    return;
  }
  busy($('sendChat'), async () => {
    await workspace.saveAll();
    const pending = el('div', 'Thinking…', 'message assistant');
    $('messages').append(el('div', prompt, 'message user'), pending);
    $('prompt').value = ''; $('prompt').style.height = 'auto';
    $('messages').scrollTop = $('messages').scrollHeight;
    try {
      const answer = await api('/api/chat', {id: current.id, path: workspace.activePath(), prompt, history, output: lastOutput});
      renderMarkdown(answer.content, pending);
      history.push({role: 'user', content: prompt}, {role: 'assistant', content: answer.content});
      usage = answer.usage || null;
    } catch (error) { pending.textContent = error.message; $('prompt').value = prompt; }
    renderContext();
    $('messages').scrollTop = $('messages').scrollHeight;
  });
};

// ── new file ──────────────────────────────────────────────
const fileDialog = el('dialog');
fileDialog.innerHTML = '<form id="newFileForm"><div class="dialog-heading"><h2>Create a source file</h2></div><label for="newFilePath">Relative path</label><input id="newFilePath" required maxlength="500" placeholder="src/discount-policy.js"><div class="inline" style="margin-top:16px;justify-content:flex-end"><button type="button" id="cancelNewFile">Cancel</button><button class="primary">Create file</button></div></form>';
document.body.append(fileDialog);
$('newFile').onclick = () => { fileDialog.showModal(); $('newFilePath').focus(); };
$('cancelNewFile').onclick = () => fileDialog.close();
$('newFileForm').onsubmit = event => {
  event.preventDefault();
  busy(event.submitter, async () => {
    if (workspace.isDirty()) await workspace.saveAll();
    const name = $('newFilePath').value.trim();
    const result = await api('/api/file/create', {id: current.id, path: name});
    current.files = result.files;
    workspace.setFiles(result.files);
    fileDialog.close();
    $('newFilePath').value = '';
    await workspace.open(name);
  });
};

setInterval(() => {
  if (!current) return;
  const seconds = Math.floor((Date.now() - current.started) / 1000);
  $('timer').textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}, 1000);

async function init() {
  runtimeOptions = await api('/api/runtimes');
  for (const [id, runtime] of Object.entries(runtimeOptions)) { const option = el('option', runtime.label); option.value = id; $('runtime').append(option); }
  await status();
  await loadModels().catch(() => {});
  const id = localStorage.getItem('debug-gym-session');
  if (id) { try { await enter(await api('/api/session?id=' + id)); } catch { localStorage.removeItem('debug-gym-session'); } }
}
init().catch(error => notify(error.message));

window.gym = {
  api, waitJob, enter, notify, el,
  save: () => workspace.saveAll(),
  current: () => current,
  file: () => workspace.activePath(),
  isDirty: () => workspace.isDirty(),
  setReadOnly: value => workspace.setReadOnly(value),
  workspace
};
import('./interview-ui.js').catch(error => notify(error.message));
if (document.modelContext?.registerTool) {
  const lifecycle = new AbortController();
  window.addEventListener('pagehide', () => lifecycle.abort(), {once: true});
  try {
    Promise.resolve(document.modelContext.registerTool({
      name: 'read_practice_session',
      description: 'Read the active debugging session and selected source file name.',
      inputSchema: {type: 'object', properties: {}, additionalProperties: false},
      annotations: {readOnlyHint: true, untrustedContentHint: true},
      execute: () => current ? {id: current.id, title: current.title, file: workspace.activePath(), benchmark: !!current.benchmark} : {active: false}
    }, {signal: lifecycle.signal})).catch(() => {});
  } catch {}
}
