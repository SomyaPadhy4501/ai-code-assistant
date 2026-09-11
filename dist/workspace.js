// The IDE surface: vendored Monaco, a folder tree, editor tabs, a go-to-file
// palette and project search. It owns all editing state; app.js owns the session
// and the network calls it passes in.
const $ = id => document.getElementById(id);
const LANGUAGES = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
  ts: 'typescript', tsx: 'typescript', mts: 'typescript',
  py: 'python', pyi: 'python', java: 'java', kt: 'kotlin', scala: 'scala',
  c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp', hh: 'cpp',
  cs: 'csharp', go: 'go', rs: 'rust', rb: 'ruby', php: 'php', swift: 'swift',
  r: 'r', ex: 'elixir', exs: 'elixir', pl: 'perl', pm: 'perl', t: 'perl',
  sh: 'shell', bash: 'shell', zsh: 'shell', md: 'markdown', markdown: 'markdown',
  json: 'json', yml: 'yaml', yaml: 'yaml', xml: 'xml', html: 'html', htm: 'html',
  css: 'css', scss: 'scss', less: 'less', sql: 'sql', toml: 'ini', ini: 'ini',
  gradle: 'plaintext', properties: 'ini', lua: 'lua', dart: 'dart', vb: 'vb'
};
// Icons are drawn from one inline sheet rather than loaded, so the tree stays
// scannable without adding a request or an icon dependency.
const FILE_KINDS = {
  javascript: {tone: 'js', label: 'JS'}, typescript: {tone: 'ts', label: 'TS'},
  python: {tone: 'py', label: 'PY'}, java: {tone: 'java', label: 'JV'},
  c: {tone: 'c', label: 'C'}, cpp: {tone: 'c', label: 'C+'}, csharp: {tone: 'cs', label: 'C#'},
  go: {tone: 'go', label: 'GO'}, rust: {tone: 'rust', label: 'RS'}, ruby: {tone: 'ruby', label: 'RB'},
  php: {tone: 'php', label: 'PHP'}, swift: {tone: 'swift', label: 'SW'}, r: {tone: 'r', label: 'R'},
  elixir: {tone: 'elixir', label: 'EX'}, perl: {tone: 'perl', label: 'PL'}, shell: {tone: 'shell', label: 'SH'},
  markdown: {tone: 'doc', label: 'MD'}, json: {tone: 'data', label: '{}'}, yaml: {tone: 'data', label: 'YML'},
  xml: {tone: 'data', label: '<>'}, html: {tone: 'web', label: '<>'}, css: {tone: 'web', label: 'CSS'},
  scss: {tone: 'web', label: 'SCS'}, less: {tone: 'web', label: 'LES'}, sql: {tone: 'data', label: 'SQL'},
  ini: {tone: 'data', label: 'CFG'}, dockerfile: {tone: 'data', label: 'DK'}, kotlin: {tone: 'java', label: 'KT'},
  scala: {tone: 'java', label: 'SC'}, lua: {tone: 'js', label: 'LUA'}, dart: {tone: 'ts', label: 'DT'},
  vb: {tone: 'cs', label: 'VB'}, plaintext: {tone: 'plain', label: '•'}
};
function fileIcon(name) {
  const kind = FILE_KINDS[languageFor(name)] || FILE_KINDS.plaintext;
  const node = document.createElement('span');
  node.className = `file-icon tone-${kind.tone}`;
  node.textContent = kind.label;
  node.setAttribute('aria-hidden', 'true');
  return node;
}
function folderIcon(open) {
  const node = document.createElement('span');
  node.className = 'folder-icon';
  node.setAttribute('aria-hidden', 'true');
  node.innerHTML = open
    ? '<svg viewBox="0 0 16 16"><path d="M1.5 13V4.2c0-.4.3-.7.7-.7h3.2l1.3 1.6h6.1c.4 0 .7.3.7.7v.7H4.6L2.2 13z"/></svg>'
    : '<svg viewBox="0 0 16 16"><path d="M1.5 12.8V4.2c0-.4.3-.7.7-.7h3.2l1.3 1.6h6.6c.4 0 .7.3.7.7v7c0 .4-.3.7-.7.7H2.2a.7.7 0 0 1-.7-.7z"/></svg>';
  return node;
}

function languageFor(name) {
  const base = name.split('/').pop();
  if (/^dockerfile/i.test(base)) return 'dockerfile';
  if (/^makefile/i.test(base)) return 'plaintext';
  return LANGUAGES[base.split('.').pop().toLowerCase()] || 'plaintext';
}

export function createWorkspace({api, notify, el, sessionId, onDirtyChange}) {
  let monaco = null, editor = null, files = [], monacoTheme = 'gym-light';
  const tabs = new Map();            // path -> {model, viewState, saved}
  let activePath = '', expanded = new Set(), searchTimer = null, paletteIndex = 0, paletteRows = [];

  // ── Monaco ──────────────────────────────────────────────
  async function boot() {
    if (monaco) return monaco;
    window.require.config({paths: {vs: '/vendor/monaco/vs'}});
    monaco = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('The bundled editor did not load. Reload the page.')), 30000);
      window.require(['vs/editor/editor.main'], () => { clearTimeout(timer); resolve(window.monaco); });
    });
    monaco.editor.defineTheme('gym-light', {
      base: 'vs', inherit: true, rules: [],
      colors: {'editor.background': '#ffffff', 'editorGutter.background': '#ffffff', 'editorLineNumber.foreground': '#b6bdc8', 'editorLineNumber.activeForeground': '#4a515b', 'editor.lineHighlightBackground': '#f6f7f9', 'editorIndentGuide.background1': '#eef0f3'}
    });
    monaco.editor.defineTheme('gym-dark', {
      base: 'vs-dark', inherit: true, rules: [],
      colors: {'editor.background': '#1b1f24', 'editorGutter.background': '#1b1f24', 'editorLineNumber.foreground': '#5a6573', 'editorLineNumber.activeForeground': '#b3bcc7', 'editor.lineHighlightBackground': '#22272e', 'editorIndentGuide.background1': '#2c3238'}
    });
    editor = monaco.editor.create($('monaco'), {
      theme: monacoTheme, automaticLayout: true, fontSize: 13, lineHeight: 21,
      fontFamily: 'ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace',
      minimap: {enabled: false}, scrollBeyondLastLine: false,
      renderWhitespace: 'selection', tabSize: 2, padding: {top: 12, bottom: 12},
      smoothScrolling: true, cursorBlinking: 'smooth', roundedSelection: false,
      // Word-based suggestions offer every token in the file, prose included.
      // Turning them off leaves only real symbol completions from a language
      // service, which Monaco ships for JS/TS, JSON, CSS and HTML.
      wordBasedSuggestions: 'off',
      quickSuggestions: {other: true, comments: false, strings: false},
      suggestOnTriggerCharacters: true, parameterHints: {enabled: true},
      suggest: {showWords: false, showSnippets: false}
    });
    editor.onDidChangeModelContent(() => { renderTabs(); onDirtyChange?.(); });
    editor.onDidChangeCursorPosition(event => {
      $('statusCursor').textContent = `Ln ${event.position.lineNumber}, Col ${event.position.column}`;
    });
    // Cmd/Ctrl+S is the editor's own chord once focus is inside Monaco.
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => $('save').click());
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyP, () => openPalette());
    return monaco;
  }

  // ── tabs ────────────────────────────────────────────────
  function dirty(path) { const tab = tabs.get(path); return !!tab && tab.model.getValue() !== tab.saved; }
  function anyDirty() { return [...tabs.keys()].some(dirty); }
  function renderTabs() {
    const bar = $('tabs');
    bar.replaceChildren();
    for (const path of tabs.keys()) {
      const tab = el('button', '', 'tab' + (path === activePath ? ' active' : ''));
      tab.setAttribute('role', 'tab');
      if (dirty(path)) tab.append(el('span', '', 'tab-dirty'));
      tab.append(el('span', path.split('/').pop()));
      tab.title = path;
      tab.onclick = () => activate(path);
      const close = el('span', '×', 'tab-close');
      close.onclick = event => { event.stopPropagation(); closeTab(path); };
      tab.append(close);
      bar.append(tab);
    }
    $('editorEmpty').hidden = tabs.size > 0;
  }
  function activate(path) {
    if (!tabs.has(path)) return;
    if (activePath && tabs.has(activePath)) tabs.get(activePath).viewState = editor.saveViewState();
    activePath = path;
    const tab = tabs.get(path);
    editor.setModel(tab.model);
    if (tab.viewState) editor.restoreViewState(tab.viewState);
    editor.updateOptions({readOnly: readOnly});
    editor.focus();
    renderTabs(); renderTree();
  }
  function closeTab(path) {
    const tab = tabs.get(path);
    if (!tab) return;
    if (dirty(path) && !confirm(`${path} has unsaved changes. Close it anyway?`)) return;
    tab.model.dispose();
    tabs.delete(path);
    if (activePath === path) {
      activePath = '';
      const next = [...tabs.keys()].at(-1);
      if (next) activate(next); else { editor.setModel(null); renderTabs(); renderTree(); }
    } else renderTabs();
    onDirtyChange?.();
  }

  async function open(path, options = {}) {
    await boot();
    if (!tabs.has(path)) {
      const file = await api(`/api/file?id=${sessionId()}&path=${encodeURIComponent(path)}`);
      // A model URI must be unique per path, and per session so a reopened
      // workspace never inherits a stale model.
      const uri = monaco.Uri.parse(`gym://${sessionId()}/${path}`);
      const model = monaco.editor.getModel(uri) || monaco.editor.createModel(file.content, languageFor(path), uri);
      model.setValue(file.content);
      tabs.set(path, {model, viewState: null, saved: file.content});
    }
    activate(path);
    if (options.line) {
      editor.revealLineInCenter(options.line);
      editor.setPosition({lineNumber: options.line, column: 1});
    }
    return path;
  }

  // ── saving ──────────────────────────────────────────────
  async function saveActive() {
    if (!activePath || !dirty(activePath)) return false;
    const tab = tabs.get(activePath);
    const content = tab.model.getValue();
    await api('/api/file', {id: sessionId(), path: activePath, content});
    tab.saved = content;
    renderTabs(); onDirtyChange?.();
    return true;
  }
  async function saveAll() {
    let saved = 0;
    for (const path of [...tabs.keys()]) {
      if (!dirty(path)) continue;
      const tab = tabs.get(path);
      const content = tab.model.getValue();
      await api('/api/file', {id: sessionId(), path, content});
      tab.saved = content; saved++;
    }
    if (saved) { renderTabs(); onDirtyChange?.(); }
    return saved;
  }

  let readOnly = false;
  function setReadOnly(value) { readOnly = !!value; editor?.updateOptions({readOnly}); }

  // ── folder tree ─────────────────────────────────────────
  function buildTree(paths) {
    const root = {dirs: new Map(), files: []};
    for (const path of paths) {
      const parts = path.split('/');
      let node = root;
      for (const part of parts.slice(0, -1)) {
        if (!node.dirs.has(part)) node.dirs.set(part, {dirs: new Map(), files: []});
        node = node.dirs.get(part);
      }
      node.files.push({name: parts.at(-1), path});
    }
    return root;
  }
  function renderTree() {
    const filter = $('fileFilter').value.trim().toLowerCase();
    // The query matches any part of the path, so folder names match too, and the
    // result keeps its tree shape rather than collapsing to a flat list.
    const visible = filter ? files.filter(path => path.toLowerCase().includes(filter)) : files;
    $('fileCount').textContent = `${files.length.toLocaleString()} files${filter ? ` · ${visible.length.toLocaleString()} matching` : ''}`;
    const host = $('tree');
    host.replaceChildren();
    if (!visible.length) { host.append(el('p', filter ? 'No file or folder name matches.' : 'No files indexed.', 'tree-empty')); return; }
    if (filter) {
      host.append(el('p', `Names · ${visible.length.toLocaleString()}`, 'side-section'));
      renderLevel(buildTree(visible.slice(0, 600)), '', 0, host, true);
      if (visible.length > 600) host.append(el('p', `Showing the first 600 of ${visible.length.toLocaleString()} name matches.`, 'tree-empty'));
      return;
    }
    const root = buildTree(visible);
    // Auto-expand a single-child chain so a deep source root is not all clicks.
    if (!expanded.size) {
      let node = root, prefix = '';
      while (node.dirs.size === 1 && !node.files.length) {
        const [name, child] = [...node.dirs.entries()][0];
        prefix = prefix ? `${prefix}/${name}` : name;
        expanded.add(prefix); node = child;
      }
    }
    renderLevel(root, '', 0, host);
  }
  function renderLevel(node, prefix, depth, host, expandAll = false) {
    for (const [name, child] of [...node.dirs.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      const path = prefix ? `${prefix}/${name}` : name;
      const isOpen = expandAll || expanded.has(path);
      const row = el('button', '', `tree-row dir${isOpen ? ' open' : ''}`);
      row.style.paddingLeft = `${8 + depth * 12}px`;
      row.append(el('span', '▶', 'twisty'), folderIcon(isOpen), el('span', name, 'label'));
      row.onclick = () => { isOpen ? expanded.delete(path) : expanded.add(path); renderTree(); };
      host.append(row);
      if (isOpen) renderLevel(child, path, depth + 1, host, expandAll);
    }
    for (const file of node.files.sort((a, b) => a.name.localeCompare(b.name))) host.append(fileRow(file, depth));
  }
  function fileRow(file, depth) {
    const row = el('button', '', `tree-row file${file.path === activePath ? ' active' : ''}`);
    row.style.paddingLeft = `${20 + depth * 12}px`;
    row.append(fileIcon(file.name), el('span', file.name, 'label'));
    row.title = file.path;
    row.onclick = () => open(file.path).catch(error => notify(error.message));
    return row;
  }

  // ── go-to-file palette ──────────────────────────────────
  function scorePath(path, query) {
    const lower = path.toLowerCase(), name = path.split('/').pop().toLowerCase();
    if (!query) return 0;
    if (name.startsWith(query)) return 0;
    if (name.includes(query)) return 1;
    if (lower.includes(query)) return 2;
    // Subsequence match, so "cartts" still finds "src/cart.test.ts".
    let index = 0;
    for (const char of lower) if (char === query[index]) index++;
    return index === query.length ? 3 : -1;
  }
  function renderPalette() {
    const query = $('paletteInput').value.trim().toLowerCase();
    paletteRows = files.map(path => ({path, rank: scorePath(path, query)}))
      .filter(item => item.rank >= 0)
      .sort((a, b) => a.rank - b.rank || a.path.length - b.path.length)
      .slice(0, 60);
    paletteIndex = 0;
    const host = $('paletteResults');
    host.replaceChildren();
    if (!paletteRows.length) { host.append(el('p', 'No matching file.', 'tree-empty')); return; }
    paletteRows.forEach((item, index) => {
      const row = el('button', '', 'palette-row' + (index === 0 ? ' active' : ''));
      const parts = item.path.split('/');
      row.append(fileIcon(item.path), el('span', parts.pop(), 'row-name'));
      if (parts.length) row.append(el('span', parts.join('/'), 'row-dir'));
      row.onclick = () => choosePalette(index);
      host.append(row);
    });
  }
  function movePalette(delta) {
    if (!paletteRows.length) return;
    paletteIndex = (paletteIndex + delta + paletteRows.length) % paletteRows.length;
    const rows = [...$('paletteResults').children];
    rows.forEach((row, index) => row.classList.toggle('active', index === paletteIndex));
    rows[paletteIndex]?.scrollIntoView({block: 'nearest'});
  }
  function choosePalette(index = paletteIndex) {
    const item = paletteRows[index];
    if (!item) return;
    $('palette').close();
    open(item.path).catch(error => notify(error.message));
  }
  function openPalette() {
    if (!files.length) return;
    $('paletteInput').value = '';
    renderPalette();
    if (!$('palette').open) $('palette').showModal();
    $('paletteInput').focus();
  }

  // ── content search ──────────────────────────────────────
  // The one search box covers names and contents: names filter the tree
  // instantly, contents follow from the server a moment later.
  async function runSearch() {
    const query = $('fileFilter').value.trim();
    const host = $('codeSearchResults');
    if (query.length < 2) { host.replaceChildren(); return; }
    host.replaceChildren(el('p', 'Searching contents…', 'tree-empty'));
    try {
      const result = await api(`/api/code-search?id=${sessionId()}&q=${encodeURIComponent(query)}`);
      if ($('fileFilter').value.trim() !== query) return;   // a newer query already ran
      host.replaceChildren();
      if (!result.matches.length) { host.append(el('p', 'No content matches.', 'side-section')); return; }
      host.append(el('p', `In contents · ${result.matches.length}${result.truncated ? '+' : ''}`, 'side-section'));
      for (const match of result.matches) {
        const hit = el('button', '', 'search-hit');
        hit.append(el('span', `${match.path}:${match.line}`, 'hit-path'), el('span', match.text, 'hit-text'));
        hit.onclick = () => open(match.path, {line: match.line}).catch(error => notify(error.message));
        host.append(hit);
      }
    } catch (error) { host.replaceChildren(el('p', error.message, 'tree-empty')); }
  }

  // ── editor diagnostics ──────────────────────────────────
  const SEVERITY_LEVEL = {error: 8, warning: 4, info: 2};
  function setDiagnostics(problems) {
    if (!monaco) return;
    for (const [path, tab] of tabs) {
      const forFile = problems.filter(problem => problem.file === path);
      monaco.editor.setModelMarkers(tab.model, 'debug-gym', forFile.map(problem => ({
        severity: SEVERITY_LEVEL[problem.severity] || 8,
        message: problem.message,
        startLineNumber: problem.line, endLineNumber: problem.line,
        startColumn: problem.column || 1, endColumn: (problem.column || 1) + 1
      })));
    }
  }

  // ── wiring ──────────────────────────────────────────────
  $('fileFilter').oninput = () => { renderTree(); clearTimeout(searchTimer); searchTimer = setTimeout(runSearch, 350); };
  $('fileFilter').onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); clearTimeout(searchTimer); runSearch(); } };
  // The copilot is a drawer on narrow displays, where there is no room for a column.
  $('copilotToggle').onclick = () => document.body.classList.toggle('copilot-open');
  for (const button of document.querySelectorAll('.panel-tab')) button.onclick = () => {
    for (const tab of document.querySelectorAll('.panel-tab')) tab.classList.toggle('active', tab === button);
    for (const pane of document.querySelectorAll('.panel-pane')) pane.hidden = pane.dataset.panel !== button.dataset.panel;
    $('panel').classList.remove('collapsed');
  };
  $('togglePanel').onclick = () => {
    const collapsed = $('panel').classList.toggle('collapsed');
    $('togglePanel').textContent = collapsed ? '⌃' : '⌄';
  };
  $('paletteInput').oninput = renderPalette;
  $('paletteInput').onkeydown = event => {
    if (event.key === 'ArrowDown') { event.preventDefault(); movePalette(1); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); movePalette(-1); }
    else if (event.key === 'Enter') { event.preventDefault(); choosePalette(); }
  };
  window.addEventListener('keydown', event => {
    if ($('workspace').hidden) return;
    const meta = event.metaKey || event.ctrlKey;
    if (meta && !event.shiftKey && event.key.toLowerCase() === 'p') { event.preventDefault(); openPalette(); }
    else if (meta && event.shiftKey && ['f', 'e'].includes(event.key.toLowerCase())) { event.preventDefault(); $('fileFilter').focus(); $('fileFilter').select(); }
    else if (meta && !event.shiftKey && event.key.toLowerCase() === 's' && !$('palette').open) { event.preventDefault(); $('save').click(); }
  });

  // ── draggable pane splitters ────────────────────────────
  const LIMITS = {sidebar: [150, 560], copilot: [240, 680], panel: [33, 900]};
  const clamp = (value, [low, high]) => Math.min(high, Math.max(low, value));
  function applySize(kind, value) {
    const size = `${Math.round(clamp(value, LIMITS[kind]))}px`;
    if (kind === 'panel') $('panel').style.height = size;
    else document.querySelector('.ide').style.setProperty(`--${kind}-w`, size);
    localStorage.setItem(`debug-gym-size-${kind}`, size);
  }
  function currentSize(kind) {
    if (kind === 'panel') return $('panel').offsetHeight;
    return document.querySelector(kind === 'sidebar' ? '.sidebar' : '.copilot').offsetWidth;
  }
  function initSplitters() {
    for (const kind of Object.keys(LIMITS)) {
      const stored = parseFloat(localStorage.getItem(`debug-gym-size-${kind}`));
      if (stored) applySize(kind, stored);
    }
    for (const handle of document.querySelectorAll('[data-split]')) {
      const kind = handle.dataset.split;
      handle.addEventListener('pointerdown', event => {
        event.preventDefault();
        handle.setPointerCapture(event.pointerId);
        handle.classList.add('dragging');
        const origin = kind === 'panel' ? event.clientY : event.clientX;
        const start = currentSize(kind);
        // The copilot sits right of the handle and the panel below it, so both
        // grow as the pointer moves the other way.
        const sign = kind === 'sidebar' ? 1 : -1;
        const onMove = move => applySize(kind, start + sign * ((kind === 'panel' ? move.clientY : move.clientX) - origin));
        const onUp = () => {
          handle.removeEventListener('pointermove', onMove);
          handle.removeEventListener('pointerup', onUp);
          handle.removeEventListener('pointercancel', onUp);
          handle.classList.remove('dragging');
        };
        handle.addEventListener('pointermove', onMove);
        handle.addEventListener('pointerup', onUp);
        handle.addEventListener('pointercancel', onUp);
      });
      handle.addEventListener('keydown', event => {
        const step = {ArrowLeft: -16, ArrowRight: 16, ArrowUp: 16, ArrowDown: -16}[event.key];
        if (step === undefined) return;
        event.preventDefault();
        applySize(kind, currentSize(kind) + (kind === 'panel' ? (event.key === 'ArrowUp' ? 16 : -16) : step));
      });
    }
  }
  initSplitters();

  function reset(nextFiles) {
    for (const tab of tabs.values()) tab.model.dispose();
    tabs.clear();
    activePath = ''; expanded = new Set();
    files = nextFiles || [];
    editor?.setModel(null);
    $('fileFilter').value = '';
    $('codeSearchResults').replaceChildren();
    $('statusCursor').textContent = '';
    document.body.classList.remove('copilot-open');
    renderTabs(); renderTree();
  }
  function setFiles(nextFiles) { files = nextFiles || []; renderTree(); }

  // Called before boot() on first load, so the editor is created in the right
  // theme rather than flashing light first.
  function setTheme(mode) {
    monacoTheme = mode === 'dark' ? 'gym-dark' : 'gym-light';
    monaco?.editor.setTheme(monacoTheme);
  }

  return {
    boot, open, reset, setFiles, saveActive, saveAll, setReadOnly, openPalette, setTheme, setDiagnostics,
    // The copilot only ever receives the saved text, so the context meter has to
    // measure the saved text too, not the unsaved buffer.
    contentLength: path => (tabs.get(path)?.saved ?? '').length,
    activePath: () => activePath,
    isDirty: () => anyDirty(),
    files: () => files,
    ready: () => !!editor
  };
}
