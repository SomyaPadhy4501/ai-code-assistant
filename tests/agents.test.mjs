import {test} from 'node:test';
import assert from 'node:assert/strict';
import {detectEndIntent, readConfirmation, describeSituation, shouldInterject, summarizeAttention, INTERJECT_COOLDOWN_MS} from '../agents.mjs';

test('a candidate saying they are done is heard, and ordinary talk is not', () => {
  for (const text of ['I give up', 'i quit', "I'm done", 'I cant answer anymore', 'no more ideas', "let's stop", 'end the interview', "that's it for me"]) {
    assert.equal(detectEndIntent(text), 'give_up', text);
  }
  // False positives interrupt with an alarming question, so these must not fire.
  for (const text of ['I am done with the first test', 'I quit the process in the container', "I can't reproduce it yet", 'done — the suite passes now', 'should I stop the server?']) {
    assert.equal(detectEndIntent(text), null, text);
  }
});

test('confirmation is read as yes, no, or unclear', () => {
  for (const text of ['yes', 'yeah', 'ok', 'do it', 'end it']) assert.equal(readConfirmation(text), 'affirm', text);
  for (const text of ['no', 'not yet', 'wait', 'keep going', 'never mind']) assert.equal(readConfirmation(text), 'deny', text);
  for (const text of ['why does reduce throw?', 'maybe', '']) assert.equal(readConfirmation(text), 'unclear', text);
});

test('the observer counts a failing streak and how long the candidate has been quiet', () => {
  const now = 1_000_000;
  const situation = describeSituation({
    observed: {minutesUsed: 12, answers: 2, testRuns: 4, filesEdited: ['cart.mjs'], recentEdits: [{path: 'cart.mjs', secondsAgo: 30}], latestTests: [{code: 0}, {code: 1}, {code: 1}]},
    lastAnswerAt: now - 200000, lastActivityAt: now - 30000, now
  });
  assert.equal(situation.failingStreak, 2);
  assert.equal(situation.editedRecently, true);
  assert.equal(situation.silentSeconds, 200);
  assert.equal(situation.idleSeconds, 30);
});

test('the coordinator interjects only on a real signal, and not twice in a row', () => {
  const base = {now: 1_000_000, hasSpoken: true, lastInterjectionAt: 0};
  assert.equal(shouldInterject({failingStreak: 0, silentSeconds: 10, idleSeconds: 10}, base).interject, false);

  const stuck = shouldInterject({failingStreak: 3, silentSeconds: 120, filesEdited: ['a.js']}, base);
  assert.equal(stuck.interject, true);
  assert.equal(stuck.trigger, 'repeated_failures');
  assert.match(stuck.prompt, /hypothesis/);

  // Cooldown, so it cannot nag.
  assert.equal(shouldInterject({failingStreak: 3, silentSeconds: 120}, {...base, lastInterjectionAt: base.now - 1000}).interject, false);
  // Nothing is said before the candidate has done anything at all.
  assert.equal(shouldInterject({failingStreak: 3, silentSeconds: 120}, {...base, hasSpoken: false}).interject, false);
  assert.ok(INTERJECT_COOLDOWN_MS >= 60000);
});

test('more than one person in frame is raised, but never as an accusation', () => {
  const decision = shouldInterject({attention: {faces: 2}, failingStreak: 0}, {now: Date.now(), hasSpoken: true});
  assert.equal(decision.trigger, 'multiple_people');
  assert.match(decision.prompt, /Do not accuse them/);
});

test('camera samples become observations with an explicit caveat, not a verdict', () => {
  const now = 500_000;
  const samples = [
    {at: now - 10000, faces: 1, facing: true}, {at: now - 20000, faces: 1, facing: false},
    {at: now - 30000, faces: 1, facing: false}, {at: now - 500000, faces: 0, facing: false}
  ];
  const summary = summarizeAttention(samples, {now, window: 120000});
  assert.equal(summary.samples, 3, 'samples outside the window are dropped');
  assert.equal(summary.faces, 1);
  assert.equal(summary.presentRatio, 1);
  assert.ok(summary.awaySeconds > 0);
  assert.match(summary.note, /not whether the candidate did anything wrong/);
  assert.equal(summarizeAttention([], {now}), null);
});
