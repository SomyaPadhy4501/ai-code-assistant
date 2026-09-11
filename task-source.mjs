import fs from 'node:fs/promises';
import path from 'node:path';
import { randomInt } from 'node:crypto';
import { parseTestNames } from './scoring.mjs';
const dataset = 'SWE-bench/SWE-bench_Multilingual';
const languages = {'.java':'java','.go':'go','.rs':'rust','.rb':'ruby','.php':'php','.ts':'typescript','.tsx':'typescript','.js':'node','.jsx':'node','.c':'c','.h':'c','.cpp':'cpp','.cc':'cpp','.hpp':'cpp'};
export function sanitizeTask(row) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(row.repo) || !/^[a-f0-9]{40}$/.test(row.base_commit) || !/^swebench\/[a-z0-9_.:-]+$/.test(row.image)) throw new Error('Invalid benchmark task metadata.');
  const names = [...String(row.patch).matchAll(/^\+\+\+ b\/(.+)$/gm)].map(m=>m[1]);
  const counts={}; for(const name of names){const lang=languages[path.extname(name)];if(lang)counts[lang]=(counts[lang]||0)+1;}
  const language=Object.keys(counts).sort((a,b)=>counts[b]-counts[a])[0]||'cpp';
  // Never cache or return the reference solution or hints.
  return {id:row.instance_id, repo:row.repo, commit:row.base_commit, image:row.image, brief:row.problem_statement, created:row.created_at, language, evalScript:row.eval_script, expectedFailures:parseTestNames(row.FAIL_TO_PASS), expectedPasses:parseTestNames(row.PASS_TO_PASS), source:`https://huggingface.co/datasets/${dataset}`};
}
export function publicTask(task) { const {evalScript, expectedFailures, expectedPasses, ...safe}=task; return {...safe, targetTests:(expectedFailures||[]).length}; }
let loading;
export async function loadTasks(cacheDir) {
  if(loading)return loading;
  loading=(async()=>{
    await fs.mkdir(cacheDir,{recursive:true}); const cache=path.join(cacheDir,'multilingual.json');
    try{const stored=JSON.parse(await fs.readFile(cache,'utf8'));if(Date.now()-stored.saved<7*86400000)return stored.tasks;}catch{}
    const tasks=[];
    for(let offset=0;offset<300;offset+=25){
      const url=`https://datasets-server.huggingface.co/rows?dataset=${encodeURIComponent(dataset)}&config=default&split=test&offset=${offset}&length=25`;
      const res=await fetch(url,{signal:AbortSignal.timeout(60000)});
      if(!res.ok)throw new Error(`Task library unavailable (${res.status}). Try again later or import a GitHub URL.`);
      const data=await res.json();
      for(const record of data.rows){if(record.truncated_cells?.length)throw new Error('Task API returned truncated data; retry later.');tasks.push(sanitizeTask(record.row));}
    }
    await fs.writeFile(cache,JSON.stringify({saved:Date.now(),tasks}));return tasks;
  })();
  try{return await loading;}finally{loading=undefined;}
}
export function chooseTask(tasks, seen, language='all', scope='all') {
  let pool=tasks.filter(t=>(language==='all'||t.language===language)&&(scope!=='legacy'||Number(t.created.slice(0,4))<=2020));
  if(!pool.length)throw new Error('No tasks match these filters. Choose another language or include all years.');
  let fresh=pool.filter(t=>!seen.includes(t.id));const recycled=!fresh.length;if(recycled)fresh=pool;
  return {task:fresh[randomInt(fresh.length)],recycled,total:pool.length};
}
