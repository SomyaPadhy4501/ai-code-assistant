// Turns raw compiler and test output into structured problems: file, line,
// column, severity, message. Kept DOM-free so it can be unit tested directly.
//
// Container paths are rewritten back to repository-relative paths, and a problem
// is only kept when its file actually exists in the session, which discards
// noise from dependency and toolchain paths.
const CONTAINER_ROOTS = [/^\/testbed\//, /^\/work\//, /^\/candidate\//, /^\.\//, /^\//];

export function normalizePath(raw, knownFiles) {
  if (!raw) return null;
  let candidate = raw.trim().replace(/\\/g, '/');
  for (const root of CONTAINER_ROOTS) candidate = candidate.replace(root, '');
  if (!candidate) return null;
  const known = knownFiles instanceof Set ? knownFiles : new Set(knownFiles || []);
  if (known.has(candidate)) return candidate;
  // Toolchains print paths relative to a subdirectory, so fall back to a unique
  // suffix match rather than guessing between several candidates.
  const matches = [...known].filter(file => file === candidate || file.endsWith(`/${candidate}`));
  return matches.length === 1 ? matches[0] : null;
}

const PATTERNS = [
  // TypeScript: src/a.ts(12,5): error TS2304: Cannot find name 'x'.
  {re: /^\s*(\S+?)\((\d+),(\d+)\):\s*(error|warning)\s+\w+:\s*(.+)$/i, map: m => ({file: m[1], line: m[2], column: m[3], severity: m[4], message: m[5]})},
  // Maven: [ERROR] /testbed/src/Main.java:[12,5] cannot find symbol
  {re: /^\s*\[(ERROR|WARNING)\]\s+(\S+?):\[(\d+),(\d+)\]\s*(.+)$/i, map: m => ({file: m[2], line: m[3], column: m[4], severity: m[1], message: m[5]})},
  // GCC/Clang/Go/ESLint-style: src/a.c:12:5: error: message
  {re: /^\s*(\S+?):(\d+):(\d+):\s*(error|warning|note|fatal error)\s*:\s*(.+)$/i, map: m => ({file: m[1], line: m[2], column: m[3], severity: m[4], message: m[5]})},
  // Go vet/compile: ./a.go:12:5: undefined: x   (no severity word)
  {re: /^\s*(\.\/\S+?|\/\S+?):(\d+):(\d+):\s*(.+)$/, map: m => ({file: m[1], line: m[2], column: m[3], severity: 'error', message: m[4]})},
  // javac / Ruby: src/Main.java:12: error: cannot find symbol
  {re: /^\s*(\S+?):(\d+):\s*(error|warning)\s*:\s*(.+)$/i, map: m => ({file: m[1], line: m[2], column: null, severity: m[3], message: m[4]})},
  // Rust/cargo location line:   --> src/a.rs:12:5
  {re: /^\s*-->\s*(\S+?):(\d+):(\d+)\s*$/, map: m => ({file: m[1], line: m[2], column: m[3], severity: 'error', message: null})},
  // Python traceback:   File "cart.py", line 12
  {re: /^\s*File "([^"]+)", line (\d+)/, map: m => ({file: m[1], line: m[2], column: null, severity: 'error', message: null})},
  // PHP: PHP Parse error: syntax error ... in /work/a.php on line 12
  {re: /^\s*PHP (?:Parse|Fatal) error:\s*(.+?) in (\S+) on line (\d+)/i, map: m => ({file: m[2], line: m[3], column: null, severity: 'error', message: m[1]})},
  // Node stack frame: at fn (/work/src/a.js:12:5)
  {re: /^\s*at\s+.*?\((\S+?):(\d+):(\d+)\)\s*$/, map: m => ({file: m[1], line: m[2], column: m[3], severity: 'error', message: null})},
  // `node --check` and similar print the location alone on its line. Safe as the
  // last pattern because the path still has to resolve to a session file.
  {re: /^\s*(\S+?):(\d+)\s*$/, map: m => ({file: m[1], line: m[2], column: null, severity: 'error', message: null})}
];

const SEVERITY = {error: 'error', 'fatal error': 'error', warning: 'warning', note: 'info'};

// A location-only line (a cargo `-->`, a Python `File "..."`, a stack frame)
// borrows the nearest preceding message line, which is where the reason lives.
function nearestMessage(lines, index) {
  for (let back = index; back >= Math.max(0, index - 4); back--) {
    const text = lines[back].trim();
    const match = /^(?:error(?:\[[^\]]+\])?|warning|\w*Error|\w*Exception|SyntaxError)\s*:?\s*(.*)$/i.exec(text);
    if (match) return (match[1] || text).trim();
  }
  // Node prints the offending source line, a caret and a blank line before the
  // error itself, so the forward window has to reach past all three.
  for (let forward = index + 1; forward <= Math.min(lines.length - 1, index + 6); forward++) {
    const text = lines[forward].trim();
    if (/^(\w*Error|\w*Exception|error:)\b/i.test(text)) return text;
  }
  return null;
}

export function parseDiagnostics(output, knownFiles = [], limit = 200) {
  const known = new Set(knownFiles);
  const lines = String(output || '').split(/\r?\n/);
  const seen = new Set(), problems = [];
  lines.forEach((line, index) => {
    if (problems.length >= limit || line.length > 2000) return;
    for (const {re, map} of PATTERNS) {
      const match = re.exec(line);
      if (!match) continue;
      const raw = map(match);
      const file = normalizePath(raw.file, known);
      if (!file) break;
      const lineNumber = Number(raw.line);
      if (!Number.isInteger(lineNumber) || lineNumber < 1) break;
      const message = (raw.message || nearestMessage(lines, index) || 'Reported here; see the output for detail.').replace(/\s+/g, ' ').trim().slice(0, 400);
      const key = `${file}:${lineNumber}:${message}`;
      if (!seen.has(key)) {
        seen.add(key);
        problems.push({file, line: lineNumber, column: Number(raw.column) || 1, severity: SEVERITY[String(raw.severity).toLowerCase()] || 'error', message});
      }
      break;
    }
  });
  return problems;
}

export function countBySeverity(problems) {
  return problems.reduce((totals, problem) => ({...totals, [problem.severity]: (totals[problem.severity] || 0) + 1}), {});
}
