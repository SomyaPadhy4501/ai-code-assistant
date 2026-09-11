// SWE-bench records which tests must flip from failing to passing (FAIL_TO_PASS)
// and which must keep passing (PASS_TO_PASS). The upstream evaluation scripts are
// not consistent about exit codes, so a run is scored by locating each named test
// in the output instead of trusting `code === 0`.
const MAX_NAMES = 400;

export function parseTestNames(value) {
  if (Array.isArray(value)) return value.filter(name => typeof name === 'string' && name.trim()).slice(0, MAX_NAMES);
  if (typeof value === 'string') {
    try { return parseTestNames(JSON.parse(value)); } catch { return value.trim() ? [value.trim()] : []; }
  }
  return [];
}

// A test name may be printed in a different shape than the benchmark records it:
// `pkg.BarTest#testBaz` becomes `testBaz(pkg.BarTest)` under Surefire, and
// `mod::tests::case` becomes `mod::tests::case ... ok` under cargo. Matching the
// whole name catches the common case; the trailing segments catch reorderings.
export function nameSegments(name) {
  return name.split(/[#:>\s/()[\],]+|\.(?=[A-Za-z_])/).filter(Boolean);
}
function mentions(line, name, segments) {
  if (line.includes(name)) return true;
  return segments.length > 1 && segments.slice(-2).every(segment => line.includes(segment));
}

const FAILED = [/\bFAILED\b/, /\bFAIL\b/, /\bERRORED?\b/, /\bnot ok\b/, /[✕✗✖]/, /\bfailure\b/i, /\bassertion(?:error| failed)/i];
const PASSED = [/\bPASSED\b/, /\bPASS\b/, /\bSUCCESS\b/, /[✓✔]/, /\.\.\.\s*ok\b/, /^\s*ok\s+\d+/, /\bok\b\s*$/];
function verdictFor(line) {
  // A line that reports a failure wins over one that merely mentions passing, so
  // an ambiguous log is never read as success.
  if (FAILED.some(pattern => pattern.test(line))) return 'failing';
  if (PASSED.some(pattern => pattern.test(line))) return 'passing';
  return null;
}

export function classifyTest(lines, name) {
  const segments = nameSegments(name);
  let seen = false, passing = false;
  for (const line of lines) {
    if (!mentions(line, name, segments)) continue;
    seen = true;
    const verdict = verdictFor(line);
    if (verdict === 'failing') return 'failing';
    if (verdict === 'passing') passing = true;
  }
  return passing ? 'passing' : seen ? 'unknown' : 'missing';
}

export function scoreBenchmark(output, meta = {}, run = {}) {
  const targets = parseTestNames(meta.expectedFailures);
  const guards = parseTestNames(meta.expectedPasses);
  if (!targets.length && !guards.length) return null;
  const lines = String(output || '').split(/\r?\n/);
  const group = names => {
    const result = {passing: [], failing: [], unknown: [], missing: []};
    for (const name of names) result[classifyTest(lines, name)].push(name);
    return result;
  };
  const target = group(targets), guard = group(guards);
  const undetermined = target.unknown.length + target.missing.length;
  let verdict, reason;
  if (run.timedOut) { verdict = 'timed_out'; reason = 'The suite was stopped before it finished, so no test result is conclusive.'; }
  else if (!targets.length) { verdict = 'unknown'; reason = 'This task records no fail-to-pass tests, so the fix cannot be verified automatically.'; }
  else if (undetermined) { verdict = 'unknown'; reason = `${undetermined} of ${targets.length} target test${targets.length === 1 ? '' : 's'} could not be located in the output. Read the log directly — this is not a pass.`; }
  else if (target.failing.length) { verdict = 'unresolved'; reason = `${target.failing.length} of ${targets.length} target tests still fail.`; }
  else if (guard.failing.length) { verdict = 'regressed'; reason = `The target tests pass, but ${guard.failing.length} previously passing test${guard.failing.length === 1 ? '' : 's'} now fail${guard.failing.length === 1 ? 's' : ''}.`; }
  else { verdict = 'resolved'; reason = `All ${targets.length} target test${targets.length === 1 ? '' : 's'} pass and no recorded regression was detected.`; }
  return {
    verdict, reason,
    exitCode: run.code ?? null,
    // Kept deliberately: an upstream script exiting 0 while tests fail is the
    // reason this scorer exists, so the disagreement is worth showing.
    exitCodeAgrees: run.code === 0 === (verdict === 'resolved'),
    targets: {total: targets.length, ...target},
    guards: {total: guards.length, ...guard}
  };
}

export function summarizeScore(score) {
  if (!score) return '';
  const labels = {resolved: 'Target tests pass', unresolved: 'Target tests still failing', regressed: 'Regression detected', unknown: 'Not determined', timed_out: 'Timed out'};
  return `${labels[score.verdict]} · ${score.targets.passing.length}/${score.targets.total} target tests passing. ${score.reason}`;
}
