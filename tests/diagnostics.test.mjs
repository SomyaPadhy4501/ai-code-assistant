import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseDiagnostics, normalizePath, countBySeverity} from '../dist/diagnostics.js';

const FILES = ['src/cart.js', 'src/Main.java', 'src/a.c', 'cart.py', 'lib/a.go', 'src/a.rs', 'web/a.ts', 'app.php'];

test('container paths are rewritten to repository-relative paths', () => {
  assert.equal(normalizePath('/testbed/src/cart.js', FILES), 'src/cart.js');
  assert.equal(normalizePath('/work/src/cart.js', FILES), 'src/cart.js');
  assert.equal(normalizePath('./lib/a.go', FILES), 'lib/a.go');
  assert.equal(normalizePath('cart.js', FILES), 'src/cart.js', 'a unique suffix resolves');
  assert.equal(normalizePath('/usr/lib/node_modules/x/index.js', FILES), null, 'toolchain paths are discarded');
  assert.equal(normalizePath('', FILES), null);
});

test('compiler output from each toolchain becomes file, line and message', () => {
  const cases = [
    ['web/a.ts(12,5): error TS2304: Cannot find name \'foo\'.', {file: 'web/a.ts', line: 12, column: 5, severity: 'error'}],
    ['[ERROR] /testbed/src/Main.java:[30,17] cannot find symbol', {file: 'src/Main.java', line: 30, column: 17, severity: 'error'}],
    ['/work/src/a.c:8:12: error: expected \';\' before \'}\' token', {file: 'src/a.c', line: 8, column: 12, severity: 'error'}],
    ['./lib/a.go:14:2: undefined: helper', {file: 'lib/a.go', line: 14, column: 2, severity: 'error'}],
    ['src/Main.java:7: warning: deprecated API', {file: 'src/Main.java', line: 7, severity: 'warning'}],
    ['PHP Parse error: syntax error, unexpected \'}\' in /work/app.php on line 22', {file: 'app.php', line: 22, severity: 'error'}]
  ];
  for (const [line, expected] of cases) {
    const [problem] = parseDiagnostics(line, FILES);
    assert.ok(problem, line);
    for (const [key, value] of Object.entries(expected)) assert.equal(problem[key], value, `${line} → ${key}`);
    assert.ok(problem.message.length > 0, line);
  }
});

test('a location-only line borrows the reason from its error line', () => {
  const rust = ['error[E0425]: cannot find value `x` in this scope', '  --> src/a.rs:9:13'].join('\n');
  const [problem] = parseDiagnostics(rust, FILES);
  assert.equal(problem.file, 'src/a.rs');
  assert.equal(problem.line, 9);
  assert.match(problem.message, /cannot find value/);

  const python = ['Traceback (most recent call last):', '  File "cart.py", line 17', '    return total', 'NameError: name \'total\' is not defined'].join('\n');
  const [pyProblem] = parseDiagnostics(python, FILES);
  assert.equal(pyProblem.file, 'cart.py');
  assert.equal(pyProblem.line, 17);
  assert.match(pyProblem.message, /NameError|not defined/);
});

test('duplicates collapse and unknown files produce nothing', () => {
  const repeated = ['/work/src/a.c:8:12: error: boom', '/work/src/a.c:8:12: error: boom'].join('\n');
  assert.equal(parseDiagnostics(repeated, FILES).length, 1);
  assert.equal(parseDiagnostics('/elsewhere/other.c:8:12: error: boom', FILES).length, 0);
  assert.deepEqual(parseDiagnostics('', FILES), []);
  assert.deepEqual(countBySeverity(parseDiagnostics(repeated, FILES)), {error: 1});
});

test('a clean run reports no problems', () => {
  const output = ['collected 3 items', 'tests/test_cart.py::test_total PASSED', '3 passed in 0.12s'].join('\n');
  assert.deepEqual(parseDiagnostics(output, FILES), []);
});

test('a bare location line picks up the error printed below it', () => {
  // This is what `node --check` emits.
  const output = ['/work/src/cart.js:3', '  const total = ;', '                ^', '', 'SyntaxError: Unexpected token \';\''].join('\n');
  const [problem] = parseDiagnostics(output, FILES);
  assert.equal(problem.file, 'src/cart.js');
  assert.equal(problem.line, 3);
  assert.match(problem.message, /SyntaxError|Unexpected token/);
});
