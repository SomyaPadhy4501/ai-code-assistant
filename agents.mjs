// A small multi-agent system for the interview.
//
// Four roles, each with one job and no knowledge of the others:
//
//   Observer    turns raw activity signals (edits, test runs, silence, camera)
//               into a short situation report. No model call.
//   Coordinator decides whether the interviewer should speak unprompted, and
//               about what. Deterministic, so it is cheap and predictable.
//   Interviewer holds the conversation (interview.mjs).
//   Proctor     reports what the camera and screen show. Reports only — it
//               never renders a verdict about the candidate.
//   Grader      turns recorded evidence into the report (interview.mjs).
//
// The decision of *whether* to speak is deterministic and testable; only the
// wording of what gets said is left to a model. Handing that decision to a model
// as well would make the interview unpredictable and expensive for no gain.

export const ROLES = {OBSERVER: 'observer', COORDINATOR: 'coordinator', INTERVIEWER: 'interviewer', PROCTOR: 'proctor', GRADER: 'grader'};

// ── candidate intent to stop ──────────────────────────────
// A real interviewer hears "I'm done" and asks whether you mean it. Matching is
// deliberately conservative: a false positive interrupts with a scary question,
// so only clear statements count.
const GIVE_UP = [
  /\bi (?:give up|quit|surrender)\s*(?:$|[.!,;]|\bnow\b|\bhere\b|\bon this\b)/i,
  /\bi(?:'m| am)? ?(?:done|finished)\s*(?:$|[.!,;]|\bwith this\b|\bnow\b|\bhere\b|\bfor (?:today|now)\b)/i,
  /\bi can'?t (?:do|answer|solve|figure|continue|go on)\b/i,
  /\bno (?:more|further) (?:idea|ideas|clue|clues)\b/i,
  /\b(?:let'?s|lets) (?:stop|end|finish)\b/i,
  /\bend (?:the )?interview\b/i,
  /\bstop the interview\b/i,
  /\bthat'?s (?:it|all) (?:for me|from me)\b/i
];
const AFFIRM = /^\s*(y|ya|yes|yeah|yep|yup|sure|ok|okay|please do|do it|confirm|confirmed|end it|finish it|correct|affirmative)\b/i;
const DENY = /^\s*(n|no|nope|nah|not yet|wait|keep going|continue|carry on|never ?mind|cancel|no i|i want to continue)\b/i;

export function detectEndIntent(text) {
  const value = String(text ?? '');
  return GIVE_UP.some(pattern => pattern.test(value)) ? 'give_up' : null;
}
export function readConfirmation(text) {
  const value = String(text ?? '').trim();
  if (DENY.test(value)) return 'deny';
  if (AFFIRM.test(value)) return 'affirm';
  return 'unclear';
}

// ── Observer ──────────────────────────────────────────────
// Raw signals in, one readable situation report out. Pure, so the coordinator's
// behaviour can be tested without a model or a browser.
export function describeSituation({observed = {}, attention = null, lastAnswerAt = 0, lastActivityAt = 0, now = Date.now()} = {}) {
  const runs = observed.latestTests || [];
  const edits = observed.recentEdits || [];
  const failingStreak = (() => {
    let streak = 0;
    for (const run of [...runs].reverse()) { if (run.code === 0 && !run.timedOut) break; streak++; }
    return streak;
  })();
  return {
    minutesUsed: observed.minutesUsed ?? 0,
    answers: observed.answers ?? 0,
    testRuns: observed.testRuns ?? 0,
    failingStreak,
    filesEdited: observed.filesEdited || [],
    recentEdits: edits,
    editedRecently: edits.some(edit => (edit.secondsAgo ?? 1e9) < 120),
    silentSeconds: lastAnswerAt ? Math.round((now - lastAnswerAt) / 1000) : null,
    idleSeconds: lastActivityAt ? Math.round((now - lastActivityAt) / 1000) : null,
    attention
  };
}

// ── Coordinator ───────────────────────────────────────────
// One trigger fires at a time, highest priority first. `cooldown` keeps the
// interviewer from nagging: it will not interject twice inside the window.
export const INTERJECT_COOLDOWN_MS = 150000;

export function shouldInterject(situation = {}, {lastInterjectionAt = 0, now = Date.now(), hasSpoken = true} = {}) {
  if (!hasSpoken) return {interject: false, reason: 'waiting for the candidate to start'};
  if (lastInterjectionAt && now - lastInterjectionAt < INTERJECT_COOLDOWN_MS) return {interject: false, reason: 'cooldown'};
  const silent = situation.silentSeconds ?? 0;
  const idle = situation.idleSeconds ?? 0;
  const away = situation.attention?.awaySeconds ?? 0;

  if ((situation.attention?.faces ?? 1) > 1) return {
    interject: true, trigger: 'multiple_people',
    prompt: 'The camera reports more than one person in frame. Mention neutrally what you can see, ask who else is there, and remind them this is meant to be their own work. Do not accuse them of anything.'
  };
  if (situation.failingStreak >= 3 && silent > 90) return {
    interject: true, trigger: 'repeated_failures',
    prompt: `The candidate has run the tests ${situation.failingStreak} times without passing and has not said anything for ${Math.round(silent / 60)} minute(s). Ask what their current hypothesis is and what the last run actually told them. One or two sentences.`
  };
  if (situation.editedRecently && silent > 210) return {
    interject: true, trigger: 'silent_editing',
    prompt: `The candidate is editing ${situation.filesEdited.slice(-1)[0] || 'the code'} but has not explained anything for a while. Ask them to talk through the change they are making and why. One or two sentences.`
  };
  if (away > 75) return {
    interject: true, trigger: 'looking_away',
    prompt: 'The candidate has been looking away from the screen for a while. Ask lightly whether they are thinking something through or are stuck. One sentence, friendly, not accusatory.'
  };
  if (idle > 240) return {
    interject: true, trigger: 'idle',
    prompt: 'The candidate has done nothing at all for several minutes: no edits, no test runs, no answers. Check in and ask where they have got to. One sentence.'
  };
  return {interject: false, reason: 'nothing worth interrupting for'};
}

// ── Proctor ───────────────────────────────────────────────
// Camera and screen observations are recorded as observations, never as a
// judgement. This is a practice tool: the candidate is the only person who could
// be deceived, and an unreliable cheating verdict in a report would be worse
// than no verdict at all.
export function summarizeAttention(samples = [], {now = Date.now(), window = 120000} = {}) {
  const recent = samples.filter(sample => now - sample.at <= window);
  if (!recent.length) return null;
  const faces = Math.max(...recent.map(sample => sample.faces ?? 1));
  const away = recent.filter(sample => sample.facing === false).length;
  const present = recent.filter(sample => (sample.faces ?? 0) > 0).length;
  const perSample = window / recent.length;
  return {
    samples: recent.length,
    faces,
    presentRatio: Number((present / recent.length).toFixed(2)),
    awaySeconds: Math.round((away * perSample) / 1000),
    note: 'Camera observations only. They describe what was visible, not whether the candidate did anything wrong.'
  };
}
