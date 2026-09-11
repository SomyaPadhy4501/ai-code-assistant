import assert from 'node:assert/strict';
const base='http://127.0.0.1:3210';
async function api(route,data){const res=await fetch(base+route,data?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}:{});const result=await res.json();assert.equal(res.status,200,JSON.stringify(result));return result;}
async function wait(value){if(!value.job)return value;for(;;){const state=await api('/api/job?id='+value.job);if(state.status==='done')return state.result;if(state.status==='error')throw new Error(state.error);await new Promise(r=>setTimeout(r,1500));}}
const runtimes=await api('/api/runtimes');assert.equal(Object.keys(runtimes).length,16);
const session=await api('/api/session',{challenge:'cart'});assert.ok(session.files.includes('cart.mjs'));
const file=await api(`/api/file?id=${session.id}&path=cart.mjs`);assert.ok(file.content.includes('export function total'));
await api('/api/file',{id:session.id,path:'cart.mjs',content:file.content});
const forbidden=await fetch(base+'/api/file',{method:'POST',headers:{'Content-Type':'application/json','Origin':'http://untrusted.example'},body:'{}'});assert.equal(forbidden.status,403);
const traversal=await fetch(base+`/api/file?id=${session.id}&path=..%2Fsession.json`);assert.equal(traversal.status,400);
assert.ok(!('expectedFailures' in session)&&!('expectedPasses' in session),'target test names must stay on the server');
const models=await api('/api/models');assert.ok(models.selected.copilot&&models.selected.interviewer);assert.ok(Array.isArray(models.installed));
const found=await api(`/api/code-search?id=${session.id}&q=discount`);assert.ok(found.matches.some(m=>m.path==='cart.mjs'),JSON.stringify(found));
assert.equal((await api(`/api/code-search?id=${session.id}&q=z`)).matches.length,0,'a one-character query must not scan the repository');
for(const attempt of ['/vendor/../server.mjs','/vendor/monaco/../../../server.mjs']){const blocked=await fetch(base+attempt);assert.equal(blocked.status,404,attempt);}
assert.equal((await fetch(base+'/vendor/monaco/vs/loader.js')).status,200,'the vendored editor must be served');
const status=await api('/api/status');console.log('Core API verified.',status,'models:',models.selected);
if(status.modelReady){const reply=await api('/api/chat',{id:session.id,path:'cart.mjs',prompt:'What happens when items is an empty array? Answer briefly.',history:[]});assert.ok(reply.content.length>0);console.log('Live Ollama reply:',reply.content);}
if(status.docker){const result=await wait(await api('/api/run',{id:session.id,runtime:'node',command:'node --test'}));assert.equal(result.code,1,result.output);assert.match(result.output,/empty cart/);console.log('Docker executed the intentionally failing tests.');const fixed='export function total(items,discount=0){return Math.round(items.reduce((s,i)=>s+i.price*i.quantity,0)*(1-discount)*100)/100;}';await api('/api/file',{id:session.id,path:'cart.mjs',content:fixed});const passed=await wait(await api('/api/run',{id:session.id,runtime:'node',command:'node --test'}));assert.equal(passed.code,0,passed.output);console.log('Docker passed all four tests after repair.');}else console.log('Docker unavailable: live execution not verified.');
if(process.argv.includes('--tasks')){const first=await wait(await api('/api/task/random',{language:'node',scope:'all'}));const second=await wait(await api('/api/task/random',{language:'node',scope:'all'}));assert.notEqual(first.id,second.id);assert.ok(!('evalScript' in first));const imported=await wait(await api('/api/task/start',{taskId:first.id}));assert.equal(imported.commit,first.commit);assert.ok(imported.files.length>0);console.log('Historical task imported:',imported.taskId,imported.commit,'files:',imported.files.length);}
