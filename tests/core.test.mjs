import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {safeFile,validRepo,createSourceFile} from '../server.mjs';
import {sanitizeTask,publicTask,chooseTask} from '../task-source.mjs';
import {detectRuntime} from '../runtimes.mjs';
import {challenges} from '../challenges.mjs';
const exec=promisify(execFile);
const childEnv={...process.env};delete childEnv.NODE_TEST_CONTEXT;
test('repository URL restriction',()=>{assert.equal(validRepo('https://github.com/expressjs/express'),'https://github.com/expressjs/express.git');assert.equal(validRepo('https://github.com/expressjs/express.git'),'https://github.com/expressjs/express.git');for(const url of ['file:///tmp/repo','https://evil.com/x/y','https://github.com/a/b/tree/main','https://github.com/a/..'])assert.throws(()=>validRepo(url));});
test('file traversal and Windows streams blocked',async()=>{const root=await fs.mkdtemp(path.join(os.tmpdir(),'gym-path-'));try{await fs.writeFile(path.join(root,'code.js'),'ok');assert.equal(await safeFile(root,'code.js'),path.join(root,'code.js'));for(const name of ['../secret','C:/secret','code.js:stream','.git/config','a\\b','/code.js'])await assert.rejects(safeFile(root,name));}finally{await fs.rm(root,{recursive:true,force:true});}});
test('task cache excludes reference solutions; public task excludes evaluator',()=>{const row={repo:'owner/repo',base_commit:'a'.repeat(40),image:'swebench/test:latest',patch:'+++ b/main.rs\n+SECRET_SOLUTION',instance_id:'owner__repo-1',problem_statement:'A bug',created_at:'2019-01-01',eval_script:'run tests',hints_text:'secret hint'};const task=sanitizeTask(row);assert.equal(task.language,'rust');assert.ok(!JSON.stringify(task).includes('SECRET_SOLUTION'));assert.ok(!JSON.stringify(task).includes('secret hint'));assert.ok(!('evalScript' in publicTask(task)));assert.throws(()=>sanitizeTask({...row,image:'attacker/image'}));});
test('random tasks respect language, legacy filter and no-repeat pool',()=>{const tasks=[{id:'a',language:'java',created:'2019'},{id:'b',language:'java',created:'2018'},{id:'c',language:'rust',created:'2024'}];assert.equal(chooseTask(tasks,['a'],'java','legacy').task.id,'b');assert.equal(chooseTask(tasks,['a','b'],'java','legacy').recycled,true);assert.throws(()=>chooseTask(tasks,[],'rust','legacy'));});
test('runtime inferred from project manifests',()=>{assert.equal(detectRuntime(['go.mod','README.md']),'go');assert.equal(detectRuntime(['project.csproj']),'csharp');assert.equal(detectRuntime(['Cargo.toml']),'rust');});
test('new source files support nested modules without overwrite or traversal',async()=>{const root=await fs.mkdtemp(path.join(os.tmpdir(),'gym-create-'));try{await createSourceFile(root,'src/policy.js','export const policy = {};');assert.equal(await fs.readFile(path.join(root,'src/policy.js'),'utf8'),'export const policy = {};');await assert.rejects(createSourceFile(root,'src/policy.js','overwrite'));await assert.rejects(createSourceFile(root,'../outside.js'));await assert.rejects(createSourceFile(root,'src/.env'));}finally{await fs.rm(root,{recursive:true,force:true});}});
for(const challenge of challenges.filter(c=>c.files[c.id+'.test.mjs']))test(`${challenge.id} fails before repair and passes after repair`,async()=>{const dir=await fs.mkdtemp(path.join(os.tmpdir(),'gym-fixture-'));try{for(const [name,text]of Object.entries(challenge.files))await fs.writeFile(path.join(dir,name),text);await assert.rejects(exec(process.execPath,['--test',challenge.id+'.test.mjs'],{cwd:dir,env:childEnv}));const fixed=challenge.id==='cart'?`export function total(items, discount=0){return Math.round(items.reduce((sum,item)=>sum+item.price*item.quantity,0)*(1-discount)*100)/100;}`:`export class Cache {constructor(now=Date.now){this.now=now;this.entries=new Map()}set(key,value,ttl){this.entries.set(key,{value,expires:this.now()+ttl})}get(key){const e=this.entries.get(key);if(!e)return undefined;if(e.expires<=this.now()){this.entries.delete(key);return undefined}return e.value}}`;await fs.writeFile(path.join(dir,challenge.id+'.mjs'),fixed);await exec(process.execPath,['--test',challenge.id+'.test.mjs'],{cwd:dir,env:childEnv});}finally{await fs.rm(dir,{recursive:true,force:true});}});
test('the vendored editor is served from its own subtree only', async () => {
  const {vendorAsset} = await import('../server.mjs');
  assert.ok(await vendorAsset('/vendor/monaco/vs/loader.js'), 'the editor loader must be reachable');
  assert.equal((await vendorAsset('/vendor/monaco/vs/loader.js')).type, 'text/javascript');
  for (const attempt of [
    '/vendor/../server.mjs', '/vendor/monaco/../../../server.mjs', '/vendor/..%2Fserver.mjs',
    '/vendor/monaco/vs/loader.js\0.txt', '/vendor/.sessions/x', '/vendor/', '/vendor/monaco'
  ]) assert.equal(await vendorAsset(attempt), null, attempt);
});
