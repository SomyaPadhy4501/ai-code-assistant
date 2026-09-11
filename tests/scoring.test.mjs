import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseTestNames, classifyTest, scoreBenchmark, summarizeScore} from '../scoring.mjs';

const score = (output, meta, run = {}) => scoreBenchmark(output, meta, run);

test('fail-to-pass names are parsed from the dataset JSON encoding', () => {
  assert.deepEqual(parseTestNames('["test_a", "test_b"]'), ['test_a', 'test_b']);
  assert.deepEqual(parseTestNames(['test_a']), ['test_a']);
  assert.deepEqual(parseTestNames(null), []);
  assert.deepEqual(parseTestNames(''), []);
  assert.deepEqual(parseTestNames('bare_name'), ['bare_name']);
});

test('a passing exit code does not override a failing target test', () => {
  // The upstream evaluation scripts are the reason this scorer exists: several
  // of them exit 0 while the tests they ran reported failures.
  const output = ['tests/test_cart.py::test_total PASSED   [ 50%]', 'tests/test_cart.py::test_discount FAILED  [100%]'].join('\n');
  const result = score(output, {expectedFailures: ['tests/test_cart.py::test_total', 'tests/test_cart.py::test_discount']}, {code: 0});
  assert.equal(result.verdict, 'unresolved');
  assert.deepEqual(result.targets.failing, ['tests/test_cart.py::test_discount']);
  assert.deepEqual(result.targets.passing, ['tests/test_cart.py::test_total']);
  assert.equal(result.exitCode, 0);
  assert.equal(result.exitCodeAgrees, false);
});

test('target tests passing with no regression is the only resolved verdict', () => {
  const output = ['--- PASS: TestDiscount (0.00s)', '--- PASS: TestTotal (0.00s)', 'PASS', 'ok  \tgithub.com/x/cart\t0.2s'].join('\n');
  const result = score(output, {expectedFailures: ['TestDiscount'], expectedPasses: ['TestTotal']}, {code: 0});
  assert.equal(result.verdict, 'resolved');
  assert.equal(result.exitCodeAgrees, true);
  assert.match(summarizeScore(result), /1\/1 target tests passing/);
});

test('a broken previously-passing test is reported as a regression', () => {
  const output = ['test cart::tests::caps_discount ... ok', 'test cart::tests::rounds_cents ... FAILED'].join('\n');
  const result = score(output, {expectedFailures: ['cart::tests::caps_discount'], expectedPasses: ['cart::tests::rounds_cents']}, {code: 1});
  assert.equal(result.verdict, 'regressed');
  assert.deepEqual(result.guards.failing, ['cart::tests::rounds_cents']);
});

test('test names printed in a different shape are still matched', () => {
  // Surefire prints `method(Class)` where the benchmark records `pkg.Class#method`.
  const output = 'testCap(com.shop.CartTest)  Time elapsed: 0.01 s  <<< FAILURE!';
  assert.equal(classifyTest(output.split('\n'), 'com.shop.CartTest#testCap'), 'failing');
});

test('tests that cannot be located are never counted as passing', () => {
  const output = ['Tests run: 3, Failures: 0, Errors: 0, Skipped: 0', 'BUILD SUCCESS'].join('\n');
  const result = score(output, {expectedFailures: ['com.shop.CartTest#testCap']}, {code: 0});
  assert.equal(result.verdict, 'unknown');
  assert.deepEqual(result.targets.missing, ['com.shop.CartTest#testCap']);
  assert.equal(result.targets.passing.length, 0);
  assert.match(result.reason, /could not be located/);
});

test('an interrupted suite yields no verdict at all', () => {
  const output = 'tests/test_cart.py::test_total PASSED';
  const result = score(output, {expectedFailures: ['tests/test_cart.py::test_total']}, {code: 143, timedOut: true});
  assert.equal(result.verdict, 'timed_out');
});

test('a task with no recorded target tests is not scored as a pass', () => {
  assert.equal(score('everything fine', {}, {code: 0}), null);
  assert.equal(score('everything fine', {expectedPasses: ['test_a']}, {code: 0}).verdict, 'unknown');
});

test('an ambiguous line is read as failing rather than passing', () => {
  const output = 'test_discount PASSED earlier\ntest_discount FAILED on rerun';
  assert.equal(classifyTest(output.split('\n'), 'test_discount'), 'failing');
});
