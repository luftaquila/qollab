import {randomUUID} from 'node:crypto';
import {mkdir,writeFile,rename,readdir,rm} from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import type pg from 'pg';
import {pool,transaction,Fault} from './db.js';
import {config} from './config.js';
import type {Identity} from './auth.js';
import type {Project,ProjectData,Role} from './model.js';
const exec=promisify(execFile);
export const ranks={viewer:0,editor:1,owner:2};
export async function access(db:pg.Pool|pg.PoolClient,id:string,user:string,required:Role='viewer',lock=false):Promise<Project>{
 const result=await db.query(`SELECT p.*,m.role FROM projects p JOIN members m ON m.project_id=p.id WHERE p.id=$1 AND m.user_id=$2 ${lock?'FOR UPDATE OF p':''}`,[id,user]);
 const p=result.rows[0];if(!p)throw new Fault('NOT_FOUND',404);if(ranks[p.role as Role]<ranks[required])throw new Fault('FORBIDDEN',403);p.revision=Number(p.revision);return p;
}
export async function writable(db:pg.PoolClient){const r=await db.query('SELECT frozen FROM maintenance');if(r.rows[0].frozen)throw new Fault('MAINTENANCE',503);}
export async function change<T>(id:string,user:Identity,revision:number|undefined,role:Role,fn:(p:Project,db:pg.PoolClient)=>Promise<T>,options:{build:boolean;document?:boolean}={build:true}):Promise<{result:T;revision:number}>{
 const out=await transaction(async db=>{
  await writable(db);const p=await access(db,id,user.id,role,true);
  if(revision!==undefined&&revision!==p.revision)throw new Fault('REVISION_CONFLICT',409,{revision:p.revision});
  const result=await fn(p,db);validateSize(p.data);p.revision++;
  for(const f of p.data.files.filter(f=>f.kind==='document'))await db.query('INSERT INTO document_generations VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET epoch=GREATEST(document_generations.epoch,EXCLUDED.epoch)',[f.id,f.epoch]);
  await db.query('UPDATE projects SET data=$2,revision=$3,name=$4 WHERE id=$1',[id,p.data,p.revision,p.name]);
  if(options.build)await queueBuild(db,p);
  return {result,revision:p.revision};
 });
 await mirror(id).catch(()=>events(id,{type:'file-error'}));events(id,{type:options.document?'document':'changed',revision:out.revision});return out;
}
export function validateSize(data:ProjectData){
 const total=data.files.reduce((n,f)=>n+(f.bytes?Buffer.byteLength(f.bytes,'base64'):Buffer.byteLength(f.source||'')),0);
 if(total>config.projectBytes)throw new Fault('PROJECT_LIMIT',413,{limit:config.projectBytes});
 for(const f of data.files)if(f.kind!=='image'&&Buffer.byteLength(f.source||'')>config.documentBytes)throw new Fault('DOCUMENT_LIMIT',413,{limit:config.documentBytes});
 if(data.files.length>1000)throw new Fault('FILE_COUNT',413);
}
export async function queueBuild(db:pg.PoolClient,p:Project,immediate=false){
 if(!p.data.files.some(f=>f.path===p.data.target))return;
 const pending=await db.query("SELECT created FROM builds WHERE project_id=$1 AND status='queued' ORDER BY created LIMIT 1",[p.id]);
 const first=pending.rows[0]?.created||new Date();
 await db.query("DELETE FROM builds WHERE project_id=$1 AND status='queued'",[p.id]);
 await db.query("INSERT INTO builds(id,project_id,revision,epoch,target,status,input,lease_until,created) VALUES($1,$2,$3,$4,$5,'queued',$6,LEAST(now()+$7*interval '1 millisecond',$8::timestamptz+$9*interval '1 millisecond'),$8)",[randomUUID(),p.id,p.revision,p.data.epoch,p.data.target,{files:p.data.files.map(f=>({path:f.path,source:f.source,bytes:f.bytes})),epoch:p.data.epoch},immediate?0:config.debounce,first,config.maxWait]);
}
export async function audit(db:pg.PoolClient,p:string,actor:string,event:string,detail:unknown){await db.query('INSERT INTO audit(project_id,actor,event,detail) VALUES($1,$2,$3,$4)',[p,actor,event,JSON.stringify(detail)]);}
export async function checkpoint(db:pg.PoolClient,p:Project,label:string,actor:string|null){
 const id=randomUUID();await db.query('INSERT INTO checkpoints(id,project_id,revision,label,actor,snapshot) VALUES($1,$2,$3,$4,$5,$6)',[id,p.id,p.revision,label.slice(0,160),actor,p.data]);return id;
}
const listeners=new Map<string,Set<(event:unknown)=>void>>();
export function events(id:string,event:unknown){listeners.get(id)?.forEach(fn=>fn(event));}
export function subscribe(id:string,fn:(event:unknown)=>void){if(!listeners.has(id))listeners.set(id,new Set());listeners.get(id)!.add(fn);return ()=>listeners.get(id)?.delete(fn);}
const mirrors=new Map<string,Promise<void>>();
export function mirror(id:string):Promise<void>{
 const task=(mirrors.get(id)||Promise.resolve()).catch(()=>{}).then(async()=>{
  const r=await pool.query('SELECT data,revision FROM projects WHERE id=$1',[id]);if(!r.rowCount)return;
  const data=r.rows[0].data as ProjectData;const root=path.join(config.data,'projects',id);await mkdir(root,{recursive:true,mode:0o700});
  await exec('git',['init','-q','-b','main',root]);
  const wanted=new Set(data.files.map(f=>f.path));
  async function clean(dir:string,rel=''){for(const e of await readdir(dir,{withFileTypes:true})){if(e.name==='.git')continue;const name=path.posix.join(rel,e.name);if(e.isDirectory()){await clean(path.join(dir,e.name),name);}else if(!wanted.has(name))await rm(path.join(dir,e.name));}}
  await clean(root);
  for(const f of data.files){const dest=path.join(root,f.path);await mkdir(path.dirname(dest),{recursive:true});await writeFile(dest+'.qollab-tmp',f.bytes?Buffer.from(f.bytes,'base64'):f.source||'',{mode:0o600});await rename(dest+'.qollab-tmp',dest);}
  const cps=await pool.query('SELECT * FROM checkpoints WHERE project_id=$1 AND git_hash IS NULL ORDER BY created',[id]);
  for(const cp of cps.rows){
   let existing='';try{existing=(await exec('git',['-C',root,'log','--all','--format=%H','--grep',`^Qollab-Checkpoint: ${cp.id}$`,'-1'])).stdout.trim();}catch{}
   if(existing){await pool.query('UPDATE checkpoints SET git_hash=$2 WHERE id=$1',[cp.id,existing]);continue;}
   // Git commits use a temporary index and write-tree, so a past checkpoint can
   // never overwrite the live worktree while its durable journal is replayed.
   const env={...process.env,GIT_INDEX_FILE:path.join(root,'.git','qollab-index')};
   await exec('git',['-C',root,'read-tree','--empty'],{env});
   for(const f of (cp.snapshot as ProjectData).files){
    const tmp=path.join(root,'.git','qollab-blob');await writeFile(tmp,f.bytes?Buffer.from(f.bytes,'base64'):f.source||'');
    const blob=(await exec('git',['-C',root,'hash-object','-w',tmp])).stdout.trim();
    await exec('git',['-C',root,'update-index','--add','--cacheinfo',`100644,${blob},${f.path}`],{env});
   }
   const tree=(await exec('git',['-C',root,'write-tree'],{env})).stdout.trim();let parent='';try{parent=(await exec('git',['-C',root,'rev-parse','HEAD'])).stdout.trim();}catch{}
   const args=['-C',root,'-c','user.name=Qollab','-c','user.email=qollab@localhost','commit-tree',tree,...(parent?['-p',parent]:[]),'-m',`${cp.label}\n\nQollab-Checkpoint: ${cp.id}`];
   const commit=(await exec('git',args)).stdout.trim();await exec('git',['-C',root,'update-ref','refs/heads/main',commit]);
   await pool.query('UPDATE checkpoints SET git_hash=$2 WHERE id=$1',[cp.id,commit]);
  }
 });mirrors.set(id,task);void task.finally(()=>{if(mirrors.get(id)===task)mirrors.delete(id);}).catch(()=>{});return task;
}
export async function recover(){
 const all=await pool.query('SELECT id FROM projects');for(const p of all.rows)await mirror(p.id);
 await pool.query("UPDATE restores SET status='complete' WHERE status='committed'");
 await pool.query("UPDATE builds SET status='failed',log='RENDERER_LEASE_EXPIRED',finished=now() WHERE status='running' AND lease_until<now()");
}
