import {join} from 'node:path';
import {createServer} from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {Readable} from 'node:stream';
import {randomBytes} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import worker from '../dist/server/index.js';
const localDir=process.env.KAPRON_LOCAL_DIRECTORY||'.kapron';
mkdirSync(localDir,{recursive:true,mode:0o700});
const db=new DatabaseSync(join(localDir,'workspace.sqlite'));
db.exec('PRAGMA journal_mode=WAL');
db.exec('CREATE TABLE IF NOT EXISTS kapron_migration (id TEXT PRIMARY KEY)');
for(const migration of ['0000_workspace','0001_execution','0002_model_quota']){
  const id=migration.slice(0,4);
  if(db.prepare('SELECT id FROM kapron_migration WHERE id=?').get(id))continue;
  db.exec('BEGIN');
  try{db.exec(readFileSync('drizzle/'+migration+'.sql','utf8'));db.prepare('INSERT INTO kapron_migration VALUES(?)').run(id);db.exec('COMMIT');}
  catch(error){db.exec('ROLLBACK');throw error;}
}
let key=process.env.KAPRON_VAULT_KEY;
if(!key){
  try{key=readFileSync(join(localDir,'vault.key'),'utf8');}
  catch(e){if(e.code!=='ENOENT')throw e;key=randomBytes(32).toString('base64');writeFileSync(join(localDir,'vault.key'),key,{mode:0o600,flag:'wx'});}
}
const requireAuth=process.env.KAPRON_LOCAL_REQUIRE_AUTH==='1';
const authSettings=Object.fromEntries(['KAPRON_SUPABASE_URL','SUPABASE_URL','KAPRON_SUPABASE_KEY','SUPABASE_PUBLISHABLE_KEY','SUPABASE_ANON_KEY','KAPRON_PUBLIC_URL','KAPRON_AUTH_GOOGLE']
  .map(name=>[name,process.env[name]]));
if(requireAuth)authSettings.KAPRON_SUPABASE_URL=authSettings.KAPRON_SUPABASE_URL||authSettings.SUPABASE_URL||'misconfigured';
const env={LOCAL_USER:!requireAuth,...authSettings,KAPRON_VAULT_KEY:key,
  KAPRON_GATEWAY_PROVIDER:process.env.KAPRON_GATEWAY_PROVIDER,
  KAPRON_GATEWAY_URL:process.env.KAPRON_GATEWAY_URL,
  KAPRON_DAILY_MODEL_UNITS:process.env.KAPRON_DAILY_MODEL_UNITS,
  KAPRON_NOTEBOOKLM_URL:process.env.KAPRON_NOTEBOOKLM_URL,
  KAPRON_NOTEBOOKLM_TOKEN:process.env.KAPRON_NOTEBOOKLM_TOKEN,DB:{prepare(sql){return {bind(...values){return {
  async first(){return db.prepare(sql).get(...values)??null;},
  async all(){return {results:db.prepare(sql).all(...values)};},
  async run(){return {meta:{changes:Number(db.prepare(sql).run(...values).changes)}};}
};}};}}};
const host=process.env.HOST || '127.0.0.1';
if(!['127.0.0.1','localhost','::1'].includes(host)) throw new Error('Local single-user mode requires a loopback host.');
let ticking=false;
setInterval(async()=>{if(ticking)return;ticking=true;try{await worker.scheduled(null,env);}catch{console.error('Background tick failed');}finally{ticking=false;}},3000).unref();
const port=Number(process.env.PORT || 4173);
createServer(async (req,res)=>{
  const controller=new AbortController();
  res.on('close',()=>{if(!res.writableFinished)controller.abort();});
  try {
    const protocol=req.headers['x-forwarded-proto']==='https' ? 'https' : 'http';
    const publicHost=req.headers['x-forwarded-host']||req.headers.host||('localhost:'+port);
    const request=new Request(new URL(req.url,protocol+'://'+publicHost),{method:req.method,headers:req.headers,signal:controller.signal,
      ...(!['GET','HEAD'].includes(req.method)?{body:Readable.toWeb(req),duplex:'half'}:{})});
    const response=await worker.fetch(request,env);
    const headers=Object.fromEntries(response.headers);
    const cookies=response.headers.getSetCookie();
    if(cookies.length)headers['set-cookie']=cookies;
    res.writeHead(response.status,headers);
    if(response.body) Readable.fromWeb(response.body).on('error',()=>res.destroy()).pipe(res);
    else res.end();
  } catch {if(!res.headersSent)res.writeHead(500);res.end('Local server error');}
}).listen(port,host,()=>console.log('Kapron local at http://'+host+':'+port));
