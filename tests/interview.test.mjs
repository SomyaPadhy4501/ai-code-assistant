import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {DURATION,phaseAt,startInterview,readInterview,writeInterview,remaining,recordEvidence,interviewTurn,endInterview,assertPracticeOpen,groundedReport,evidenceSummary} from '../interview.mjs';
async function fixture(fn){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'gym-interview-'));try{await fn(dir);}finally{await fs.rm(dir,{recursive:true,force:true});}}
const meta={title:'Test checkout',brief:'Fix rounding errors.'};
test('45-minute deadline persists and repeated starts do not reset it',()=>fixture(async dir=>{const first=await startInterview(dir,meta),second=await startInterview(dir,meta);assert.equal(first.deadline-first.started,DURATION);assert.equal(first.id,second.id);assert.equal(first.deadline,second.deadline);assert.equal(phaseAt(0,23*60000),'Implement a small feature');}));
test('expired interview refuses turns and code edits',()=>fixture(async dir=>{await startInterview(dir,meta);const state=await readInterview(dir);state.deadline=Date.now()-1;await writeInterview(dir,state);assert.equal(remaining(state),0);await assert.rejects(assertPracticeOpen(dir));await assert.rejects(interviewTurn(dir,meta,{text:'hello'},()=>{throw Error('Should not call model');}));}));
test('hints, feature requirements and observed test output persist',()=>fixture(async dir=>{await startInterview(dir,meta);await recordEvidence(dir,{type:'test',code:1,output:'rounding test failed'});const llm=async()=>({message:{content:'Consider what happens to cents. Which test would isolate it?'}});await interviewTurn(dir,meta,{kind:'hint'},llm);await interviewTurn(dir,meta,{kind:'feature'},llm);const state=await readInterview(dir);assert.equal(state.hints,1);assert.ok(state.feature);assert.equal(state.events[0].output,'rounding test failed');assert.equal(state.transcript.length,5);}));
test('give-up produces an honest fallback when model is unavailable',()=>fixture(async dir=>{await startInterview(dir,meta);await recordEvidence(dir,{type:'save',path:'cart.mjs'});const result=await endInterview(dir,meta,'give_up',async()=>{throw Error('offline');});assert.equal(result.status,'ended');assert.equal(result.reason,'give_up');assert.equal(result.report.generatedBy,'observations');assert.deepEqual(result.report.observed.filesEdited,['cart.mjs']);assert.ok(result.report.rubric.every(r=>r.assessment==='Not observed'));await assert.rejects(assertPracticeOpen(dir));}));
test('timeout finalization is idempotent and preserves first report',()=>fixture(async dir=>{await startInterview(dir,meta);const state=await readInterview(dir);state.deadline=Date.now()-1;await writeInterview(dir,state);let calls=0;const llm=async()=>{calls++;throw Error('offline');};const first=await endInterview(dir,meta,'completed',llm),second=await endInterview(dir,meta,'give_up',llm);assert.equal(first.reason,'time_up');assert.equal(second.reason,'time_up');assert.equal(calls,1);}));
test('feedback quotes candidate evidence and never credits interviewer suggestions',()=>fixture(async dir=>{await startInterview(dir,meta);const state=await readInterview(dir);state.transcript.push({role:'assistant',content:'I implemented the whole feature.'},{role:'user',kind:'answer',content:'I would inject a fake clock to reproduce the expiration boundary.'},{role:'user',kind:'feature',content:'Let’s move to feature work.'});const report=groundedReport(state);assert.equal(report.observed.answers,1);assert.equal(report.rubric.find(r=>r.area==='Testing').assessment,'Not observed');assert.equal(report.rubric.find(r=>r.area==='Implementation').assessment,'Not observed');assert.match(report.rubric.find(r=>r.area==='Low-level design').evidence,/inject a fake clock/);assert.ok(!JSON.stringify(report).includes('implemented the whole feature'));}));
test('the interviewer is told what recently changed, not just that something did',()=>fixture(async dir=>{
  await startInterview(dir,meta);
  const now=Date.now();
  await recordEvidence(dir,{type:'save',path:'cart.mjs',added:3,removed:1,lines:12});
  await recordEvidence(dir,{type:'test',code:1,output:'not ok 2'});
  const state=await readInterview(dir);
  const observed=evidenceSummary(state,now+5000);
  assert.deepEqual(observed.filesEdited,['cart.mjs']);
  assert.equal(observed.recentEdits.length,1);
  assert.equal(observed.recentEdits[0].added,3);
  assert.equal(observed.recentEdits[0].removed,1);
  assert.ok(observed.recentEdits[0].secondsAgo>=0&&observed.recentEdits[0].secondsAgo<=10);
  assert.equal(observed.testRuns,1);
}));
