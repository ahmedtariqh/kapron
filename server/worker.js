import {assets} from './generated-assets.js';
import {providers, providerRequest, sse, extractText, providerError, isGateway} from './providers.js';
import {gatewayConfig, gatewayModels} from './gateway.js';
import {initial} from './state.js';
import {seal, unseal} from './vault.js';
import {authenticate,authenticatedOwner} from './auth.js';
import {collaboration} from './collaboration.js';
import {notebookAvailable,notebookCall} from './notebooklm.js';
import {voiceRequest} from './voice.js';
import {mediaRequest} from './media.js';
import {decideWithJev} from './decision-service.js';
import {apiKeyOwner,changeJob,createApiKey,createShare,enqueueJob,getJob,listApiKeys,listJobs,listShares,loadWorkspace,revokeApiKey,revokeShare,setSchedule,sharedSnapshot,tickJobs} from './jobs.js';

const noCache={'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer'};
class Problem extends Error { constructor(status,message){super(message);this.status=status;} }
const json=(data,status=200)=>Response.json(data,{status,headers:noCache});
const keyId = value => typeof value==='string' && /^[a-zA-Z0-9-]{1,80}$/.test(value);
const providerCanRelay = p => ['openai','gemini','openrouter'].includes(p) || isGateway(p);

async function readJson(request,limit) {
  if(!request.headers.get('content-type')?.startsWith('application/json')) throw new Problem(415,'Expected JSON.');
  const reader=request.body?.getReader();
  if(!reader) throw new Problem(400,'A request body is required.');
  const decoder=new TextDecoder();
  let bytes=0, text='';
  try {
    while(true) {
      const item=await reader.read();
      if(item.done) break;
      bytes+=item.value.byteLength;
      if(bytes>limit) throw new Problem(413,'This request exceeds the workspace size limit.');
      text+=decoder.decode(item.value,{stream:true});
    }
    return JSON.parse(text+decoder.decode());
  } catch(e) {
    if(e instanceof Problem) throw e;
    throw new Problem(400,'Invalid JSON.');
  } finally { await reader.cancel().catch(()=>{}); }
}
function workspaceValid(s) {
  const lists=['projects','chats','gems','connections','memory','files'];
  if(!s || !s.settings || lists.some(k=>!Array.isArray(s[k]))) return false;
  if(lists.some(k=>s[k].length>250 || s[k].some(x=>!x || !keyId(x.id)))) return false;
  if(s.chats.some(c=>!Array.isArray(c.messages) || c.messages.length>500 ||
    c.messages.some(m=>!m || !keyId(m.id) || !['assistant','user'].includes(m.role) || typeof m.text!=='string'))) return false;
  const extensions=['skills','knowledge','workflows','tasks','artifacts'];
  if(extensions.some(k=>s[k]!==undefined && (!Array.isArray(s[k])||s[k].length>250||s[k].some(x=>!x||!keyId(x.id)))))return false;
  if(['skills','knowledge'].some(k=>(s[k]??[]).some(x=>typeof x.name!=='string'||typeof x.text!=='string'||x.text.length>40000||
    (x.description!==undefined&&typeof x.description!=='string'))))return false;
  if(s.connections.some(c=>!providerCanRelay(c.provider) && c.provider!=='custom')) return false;
  if(s.connections.some(c=>isGateway(c.provider) && (c.mode!=='vault'||c.endpoint!==undefined||c.relay===true))) return false;
  return !/"(?:apiKey|api_key|token|deviceKey|secret|authorization)"\s*:/i.test(JSON.stringify(s));
}
async function ownerOf(request,env) {
  if(env.LOCAL_USER) return {id:'local-owner',email:'Local workspace',local:true};
  if(env.KAPRON_SUPABASE_URL){
    const owner=await authenticatedOwner(request,env);
    if(owner)return owner;
    throw new Problem(401,'Sign in to open your workspace.');
  }
  if(env.KAPRON_TRUST_SITES_IDENTITY!=='1')throw new Problem(503,'Authentication is not configured.');
  const id=request.headers.get('oai-authenticated-user-id');
  if(!id) throw new Problem(401,'Sign in to open your workspace.');
  return {id,email:request.headers.get('oai-authenticated-user-email')??'',local:false};
}
function checkMutation(request) {
  if(request.headers.get('x-kapron-request')!=='1') throw new Problem(403,'A Kapron request header is required.');
  const origin=request.headers.get('origin');
  if(origin && origin!==new URL(request.url).origin) throw new Problem(403,'Cross-origin writes are disabled.');
}
function keyContext(owner,id,provider) {return JSON.stringify([owner,id,provider]);}

async function vaultModelKey(env, ownerId, id, provider) {
  if(!env.KAPRON_VAULT_KEY)throw new Problem(503,'The server vault is not configured.');
  const row=await env.DB.prepare('SELECT provider,sealed FROM kapron_vault WHERE owner=? AND connection=?').bind(ownerId,id).first();
  if(!row||row.provider!==provider)throw new Problem(400,'Add a key to this vault connection.');
  return unseal(env.KAPRON_VAULT_KEY,row.sealed,keyContext(ownerId,id,provider)).catch(()=>{
    throw new Problem(409,'The stored key cannot be unlocked. Re-enter it in settings.');
  });
}

async function listGatewayModels(request, env, owner) {
  const input=await readJson(request,6000);
  const gateway=gatewayConfig(env);
  if(!gateway||gateway.provider!==input?.provider)throw new Problem(409,'This model gateway is unavailable.');
  const key=typeof input.key==='string'&&input.key.trim()
    ? input.key.trim()
    : keyId(input.connectionId) ? await vaultModelKey(env,owner.id,input.connectionId,gateway.provider) : '';
  if(!key||key.length>4000)throw new Problem(400,'Enter a gateway virtual key.');
  const result=await gatewayModels(gateway,key,env.MODEL_FETCH??fetch,request.signal).catch(()=>null);
  if(!result)throw new Problem(424,'Could not load models from the configured gateway.');
  if(result.status)throw new Problem(424,providerError(result.status));
  return json(result);
}

function validateRun(input) {
  if(!input || !keyId(input.connectionId) || typeof input.model!=='string' || input.model.length>160 ||
    !Array.isArray(input.messages) || !input.messages.length || input.messages.length>32 ||
    input.messages.some(m=>!m || !['user','assistant'].includes(m.role) || typeof m.text!=='string' || m.text.length>40_000) ||
    typeof input.instruction!=='string' || input.instruction.length>50_000) throw new Problem(400,'Invalid chat request.');
}
function delay(ms,signal) {
  return new Promise(resolve=>{
    const finish=()=>{clearTimeout(timer);signal.removeEventListener('abort',finish);resolve();};
    const timer=setTimeout(finish,ms);
    signal.addEventListener('abort',finish,{once:true});
  });
}
async function* demoReply(input,signal) {
  const request=input.messages.at(-1).text.trim().split('\n').at(-1).slice(0,300);
  const cleaned=request.replace(/[\[\]<>*_~`]/g,'').replace(/\s+/g,' ');
  const extra=input.instruction.includes('Gem instructions:') ? 'The selected Gem’s instructions were included in this run.\n\n' : '';
  const answer='### A starting point\n\nYou asked: **'+cleaned+'**\n\n'+extra+
    '1. **Define the outcome.** Write one sentence describing what a successful result looks like.\n'+
    '2. **List the inputs.** Gather the files, constraints, and examples that should shape the answer.\n'+
    '3. **Test a small version.** Review one draft or experiment before expanding the scope.\n\n'+
    'This is a built-in demo response. Connect a provider for a model-generated answer.';
  const pieces=answer.match(/.{1,22}(?:\s|$)|\S+|\s+/gs)??[answer];
  for(const piece of pieces){if(signal.aborted) return;yield piece;await delay(12,signal);}
}
function streamResponse(iterator,abort) {
  const encoder=new TextEncoder();
  const packet=(data)=>encoder.encode('data: '+JSON.stringify(data)+'\n\n');
  const body=new ReadableStream({
    async pull(controller){
      try {
        const {done,value}=await iterator.next();
        if(done){controller.enqueue(packet({done:true}));controller.close();abort();return;}
        controller.enqueue(packet({delta:value}));
      } catch(error) {
        controller.enqueue(packet({error:error?.message || 'Streaming failed.'}));
        controller.close();abort();
      }
    },
    async cancel(){abort();await iterator.return?.();}
  });
  return new Response(body,{headers:{...noCache,'content-type':'text/event-stream; charset=utf-8','x-accel-buffering':'no'}});
}
async function run(request,env,owner) {
  const input=await readJson(request,250000);
  validateRun(input);
  const abort=new AbortController();
  const timeout=setTimeout(()=>abort.abort(),110000);
  const stop=()=>{clearTimeout(timeout);abort.abort();};
  request.signal.addEventListener('abort',stop,{once:true});
  if(input.connectionId==='demo') return streamResponse(demoReply(input,abort.signal),stop);
  try {
    const row=await env.DB.prepare('SELECT document FROM kapron_workspace WHERE owner=?').bind(owner.id).first();
    const connection=row && JSON.parse(row.document).connections.find(c=>c.id===input.connectionId);
    if(!connection || !providerCanRelay(connection.provider)) throw new Problem(400,'Select a supported server connection.');
    const gateway=isGateway(connection.provider)?gatewayConfig(env):null;
    if(isGateway(connection.provider)&&gateway?.provider!==connection.provider)throw new Problem(409,'This model gateway is unavailable.');
    let key;
    if(connection.mode==='vault') {
      key=await vaultModelKey(env,owner.id,connection.id,connection.provider);
    } else if(!gateway&&connection.mode==='device' && connection.relay===true && typeof input.deviceKey==='string') {
      key=input.deviceKey;
    }
    if(!key || key.length>4000) throw new Problem(400,'This connection has no usable API key.');
    let upstream;
    try {
      const outgoing=providerRequest({...input,endpoint:gateway?.endpoint,provider:connection.provider,key,signal:abort.signal});
      upstream=await (env.MODEL_FETCH??fetch)(outgoing);
    } catch(e) {
      if(e instanceof TypeError || e?.name==='AbortError') throw new Problem(502,'The provider connection failed or timed out.');
      throw new Problem(400,'Check the model ID and connection settings.');
    }
    if(!upstream.ok){await upstream.body?.cancel();throw new Problem(502,providerError(upstream.status));}
    const chunks=(async function*(){
      let count=0;
      for await (const event of sse(upstream)) {
        const chunk=extractText(connection.provider,event);
        if(!chunk) continue;
        count+=chunk.length;
        if(count>60_000) throw new Error('The reply exceeded the response size limit.');
        yield chunk;
      }
      if(!count) throw new Error('The provider returned no visible text.');
    })();
    return streamResponse(chunks,stop);
  } catch(e){stop();throw e;}
}

async function executeJobModel(env,ownerId,input){
  const request=new Request('https://kapron.invalid/api/runs',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)});
  const response=await run(request,env,{id:ownerId});
  let text='';
  for await(const event of sse(response)){
    if(event.error)throw new Error(event.error);
    if(event.delta)text+=event.delta;
    if(event.done)return text;
  }
  throw new Error('The model stream did not complete.');
}
async function decision(env,owner,state,chat,scope,prompt,request=new Request('https://kapron.invalid')){
  let key;
  if(state.settings.routing?.cloud===true && env.KAPRON_VAULT_KEY){
    const saved=await env.DB.prepare('SELECT provider,sealed FROM kapron_vault WHERE owner=? AND connection=?').bind(owner.id,'beatapi-router').first();
    if(saved?.provider==='beatapi')key=await unseal(env.KAPRON_VAULT_KEY,saved.sealed,keyContext(owner.id,'beatapi-router','beatapi')).catch(()=>undefined);
  }
  return decideWithJev({env,owner,state,chat,scope,prompt,request,key});
}
const tick=env=>tickJobs(env,executeJobModel,(env,id,...args)=>decision(env,{id},...args));
async function integration(request,env,path){
  const owner=await apiKeyOwner(env,request.headers.get('authorization'));
  if(!owner)throw new Problem(401,'A valid Kapron bearer key is required.');
  if(path==='/api/v1/runs'&&request.method==='GET')return json({runs:await listJobs(env,owner)});
  const lookup=path.match(/^\/api\/v1\/runs\/([a-zA-Z0-9-]{1,180})$/);
  if(lookup&&request.method==='GET'){
    const job=await getJob(env,owner,lookup[1]);
    if(!job)throw new Problem(404,'Run unavailable.');
    return json(job);
  }
  if(path==='/api/v1/runs'&&request.method==='POST'){
    const input=await readJson(request,60000);
    if(!input||typeof input!=='object')throw new Problem(400,'Enter a run definition.');
    if(input.workflowId){
      const state=await loadWorkspace(env,owner);
      const workflow=(state.workflows??[]).find(w=>w.id===input.workflowId);
      if(!workflow)throw new Problem(404,'Workflow unavailable.');
      return json(await enqueueJob(env,owner,{...workflow,input:input.input}),202);
    }
    return json(await enqueueJob(env,owner,input),202);
  }
  return json({error:'Route not found.'},404);
}

async function api(request,env,path) {
  if(path.startsWith('/api/v1/'))return integration(request,env,path);
  const share=path.match(/^\/api\/public-share\/([a-zA-Z0-9-]{36})$/);
  if(share&&request.method==='GET')return json(await sharedSnapshot(env,share[1]));
  if(path==='/api/auth-config'&&request.method==='GET')return json({mode:env.KAPRON_SUPABASE_URL?'email':'sites'});
  const auth=path.match(/^\/api\/auth\/(login|signup|logout)$/);
  if(auth&&request.method==='POST'&&env.KAPRON_SUPABASE_URL){
    checkMutation(request);
    const result=await authenticate(env,auth[1],auth[1]==='logout'?null:await readJson(request,10000));
    return Response.json(result.data,{headers:{...noCache,...(result.cookie?{'set-cookie':result.cookie}:{})}});
  }
  const owner=await ownerOf(request,env);
  if(!env.DB) throw new Problem(503,'Workspace storage is unavailable.');
  const method=request.method;
  if(method!=='GET') checkMutation(request);
  if(path==='/api/session' && method==='GET') return json({user:owner,vaultAvailable:!!env.KAPRON_VAULT_KEY,gatewayProvider:gatewayConfig(env)?.provider??null,authMode:env.KAPRON_SUPABASE_URL?'email':'sites'});
  if(path==='/api/gateway-models'&&method==='POST')return listGatewayModels(request,env,owner);
  if(path==='/api/connection-readiness'&&method==='GET'){
    const {results}=await env.DB.prepare('SELECT connection,provider FROM kapron_vault WHERE owner=?').bind(owner.id).all();
    const activeGateway=gatewayConfig(env)?.provider;
    return json({ready:env.KAPRON_VAULT_KEY?results.filter(x=>providerCanRelay(x.provider)&&(!isGateway(x.provider)||x.provider===activeGateway)).map(x=>x.connection+':'+x.provider):[]});
  }
  if(path==='/api/workspace' && method==='GET') {
    const row=await env.DB.prepare('SELECT revision, document FROM kapron_workspace WHERE owner=?').bind(owner.id).first();
    return json(row?{revision:row.revision,state:JSON.parse(row.document)}:{revision:0,state:initial()});
  }
  if(path==='/api/workspace' && method==='PUT') {
    const body=await readJson(request,800000);
    const {revision,state}=body??{};
    if(!Number.isSafeInteger(revision) || revision<0 || !workspaceValid(state)) throw new Problem(400,'Invalid workspace changes.');
    const doc=JSON.stringify(state);
    if(revision===0) await env.DB.prepare('INSERT OR IGNORE INTO kapron_workspace(owner,revision,document) VALUES(?,0,?)').bind(owner.id,JSON.stringify(initial())).run();
    const result=await env.DB.prepare('UPDATE kapron_workspace SET revision=revision+1,document=? WHERE owner=? AND revision=?').bind(doc,owner.id,revision).run();
    if(result.meta.changes!==1) throw new Problem(409,'Your workspace changed on another device.');
    return json({revision:revision+1});
  }
  const match=path.match(/^\/api\/vault\/([a-zA-Z0-9-]{1,80})$/);
  if(match && method==='PUT') {
    if(!env.KAPRON_VAULT_KEY) throw new Problem(503,'The server vault is not configured.');
    const {provider,key}=await readJson(request,6000);
    if((!providerCanRelay(provider) && !(provider==='beatapi'&&match[1]==='beatapi-router') && !(provider==='tavily'&&match[1]==='search-tavily')) || typeof key!=='string' || !key.trim() || key.length>4000) throw new Problem(400,'Enter a provider key.');
    if(isGateway(provider)&&gatewayConfig(env)?.provider!==provider)throw new Problem(409,'This model gateway is unavailable.');
    const sealed=await seal(env.KAPRON_VAULT_KEY,key.trim(),keyContext(owner.id,match[1],provider));
    await env.DB.prepare('INSERT INTO kapron_vault(owner,connection,provider,sealed) VALUES(?,?,?,?) ON CONFLICT(owner,connection) DO UPDATE SET provider=excluded.provider,sealed=excluded.sealed').bind(owner.id,match[1],provider,sealed).run();
    return json({saved:true});
  }
  if(match && method==='DELETE') {
    await env.DB.prepare('DELETE FROM kapron_vault WHERE owner=? AND connection=?').bind(owner.id,match[1]).run();
    return json({removed:true});
  }
  if(path==='/api/routing' && method==='POST'){
    const input=await readJson(request,12000);
    if(typeof input?.prompt!=='string'||input.prompt.length>1400||!keyId(input.chatId)||typeof input.scope!=='object'||!input.scope)
      throw new Problem(400,'Invalid routing request.');
    const row=await env.DB.prepare('SELECT document FROM kapron_workspace WHERE owner=?').bind(owner.id).first();
    const state=row?JSON.parse(row.document):initial();
    const chat=state.chats.find(c=>c.id===input.chatId);
    if(!chat)throw new Problem(404,'Chat unavailable for routing.');
    return json(await decision(env,owner,state,chat,input.scope,input.prompt,request));
  }
  const voice=path.match(/^\/api\/voice\/(live|transcribe)$/);
  if(voice&&method==='POST'){
    const input=await readJson(request,voice[1]==='live'?75000:2850000);
    if(!input||!keyId(input.connectionId))throw new Problem(400,'Select an OpenAI connection.');
    const state=await loadWorkspace(env,owner.id);
    const conn=state.connections.find(c=>c.id===input.connectionId&&c.provider==='openai');
    let key;
    if(conn?.mode==='vault'&&env.KAPRON_VAULT_KEY){
      const record=await env.DB.prepare('SELECT provider,sealed FROM kapron_vault WHERE owner=? AND connection=?').bind(owner.id,conn.id).first();
      if(record?.provider==='openai')key=await unseal(env.KAPRON_VAULT_KEY,record.sealed,keyContext(owner.id,conn.id,'openai')).catch(()=>undefined);
    }else if(conn?.mode==='device'&&conn.relay===true&&typeof input.deviceKey==='string'&&input.deviceKey.length<=4000)key=input.deviceKey.trim();
    if(!key)throw new Problem(400,'Use an OpenAI vault connection or enable relay for this device key.');
    return json(await voiceRequest({kind:voice[1],input,key,request,fetcher:env.VOICE_FETCH??fetch}));
  }
  if(path==='/api/tools'&&method==='POST'){
    const input=await readJson(request,1500000);
    if(!input||!['search','generate','edit','vision'].includes(input.operation))throw new Problem(400,'Invalid tool request.');
    const search=input.operation==='search';
    const workspace=await loadWorkspace(env,owner.id);
    const connection=search?{id:'search-tavily',provider:'tavily',mode:'vault'}:workspace.connections.find(c=>c.id===input.connectionId&&c.provider==='openai');
    if(!connection)throw new Problem(400,'Select an OpenAI connection for image tools.');
    let key;
    if(connection.mode==='vault'&&env.KAPRON_VAULT_KEY){
      const saved=await env.DB.prepare('SELECT provider,sealed FROM kapron_vault WHERE owner=? AND connection=?').bind(owner.id,connection.id).first();
      if(saved?.provider===connection.provider)key=await unseal(env.KAPRON_VAULT_KEY,saved.sealed,keyContext(owner.id,connection.id,connection.provider)).catch(()=>undefined);
    }else if(connection.relay===true&&typeof input.deviceKey==='string'&&input.deviceKey.length<=4000)key=input.deviceKey;
    const model=input.operation==='vision'?connection.model:typeof input.model==='string'&&/^gpt-image-[a-z0-9.-]{1,55}$/.test(input.model)?input.model:'gpt-image-2.5-flare';
    return json(await mediaRequest({operation:input.operation,prompt:input.prompt,image:input.image,key,model,signal:request.signal,fetcher:env.MEDIA_FETCH??fetch}));
  }
  const space=path.match(/^\/api\/spaces(?:\/([a-zA-Z0-9-]{1,36})(?:\/(invites|members))?)?$/);
  if(space)return json(await collaboration(env,owner.id,method,space[1],space[2],['POST','PUT'].includes(method)?await readJson(request,270000):null));
  if(path==='/api/integrations'&&method==='GET')return json({notebooklm:{configured:notebookAvailable(env,owner.id)}});
  if(path==='/api/integrations/notebooklm'&&method==='GET')return json(await notebookCall(env,owner.id,'list',{},request.signal));
  if(path==='/api/task-plan'&&method==='POST'){
    const values=await readJson(request,16000);
    if(!values||typeof values.goal!=='string'||!values.goal.trim()||values.goal.length>6000)throw new Problem(400,'Describe the task in up to 6,000 characters.');
    const state=await loadWorkspace(env,owner.id);
    const selected=state.connections.find(c=>c.id===values.connectionId&&c.mode==='vault');
    if(values.connectionId==='demo')return json({nodes:[
      {type:'prompt',label:'Clarify the outcome',prompt:'Identify the deliverable, constraints, and open questions for this goal: '+values.goal},
      {type:'prompt',label:'Produce the deliverable',prompt:'Work toward this goal using the previous step as context: '+values.goal},
      {type:'prompt',label:'Review the output',prompt:'Review the previous output against this goal and revise where needed: '+values.goal}
    ]});
    if(!selected)throw new Problem(400,'Select a vault model for planning or use the demo template.');
    const text=await executeJobModel(env,owner.id,{connectionId:selected.id,model:selected.model,
      instruction:'Return only a JSON array of 1 to 5 ordered model-only steps, each with a short label and a specific prompt. Do not request external actions or credentials. The user will review your proposal before execution.',
      messages:[{role:'user',text:values.goal}],options:{maxOutput:1800}});
    let nodes;
    try{
      const parsed=JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/gi,''));
      if(!Array.isArray(parsed)||parsed.length<1||parsed.length>5||parsed.some(x=>typeof x?.label!=='string'||typeof x?.prompt!=='string'||!x.prompt.trim()||x.prompt.length>12000))throw Error();
      nodes=parsed.map(x=>({type:'prompt',label:x.label.slice(0,80),prompt:x.prompt}));
    }catch{throw new Problem(422,'The model returned an invalid task plan. Retry or plan the steps manually.');}
    return json({nodes});
  }
  if(path==='/api/jobs'&&method==='GET')return json({runs:await listJobs(env,owner.id)});
  if(path==='/api/jobs'&&method==='POST'){
    const input=await readJson(request,70000);
    if(!input||typeof input!=='object')throw new Problem(400,'Enter a run definition.');
    return json(await enqueueJob(env,owner.id,input),202);
  }
  const job=path.match(/^\/api\/jobs\/([a-zA-Z0-9-]{1,180})$/);
  if(job&&method==='PATCH'){
    const {action}=await readJson(request,300);
    return json(await changeJob(env,owner.id,job[1],action));
  }
  const schedule=path.match(/^\/api\/schedules\/([a-zA-Z0-9-]{1,80})$/);
  if(schedule&&method==='PUT'){
    await setSchedule(env,owner.id,schedule[1]);return json({saved:true});
  }
  if(path==='/api/shares'&&method==='GET')return json({shares:await listShares(env,owner.id)});
  if(path==='/api/shares'&&method==='POST')return json(await createShare(env,owner.id,await readJson(request,800)),201);
  const ownedShare=path.match(/^\/api\/shares\/([a-zA-Z0-9-]{36})$/);
  if(ownedShare&&method==='DELETE'){
    await revokeShare(env,owner.id,ownedShare[1]);return json({removed:true});
  }
  if(path==='/api/access-keys'&&method==='GET')return json({keys:await listApiKeys(env,owner.id)});
  if(path==='/api/access-keys'&&method==='POST')return json(await createApiKey(env,owner.id),201);
  const accessKey=path.match(/^\/api\/access-keys\/([a-f0-9]{64})$/);
  if(accessKey&&method==='DELETE'){
    await revokeApiKey(env,owner.id,accessKey[1]);return json({removed:true});
  }
  if(path==='/api/runs' && method==='POST') return run(request,env,owner);
  return json({error:'Route not found.'},404);
}

function effectiveEnv(env){
  return typeof KAPRON_SITES_BUILD!=='undefined'&&KAPRON_SITES_BUILD?{...env,KAPRON_TRUST_SITES_IDENTITY:'1'}:env;
}
export default {
  scheduled(_controller,env){return tick(env);},
  async fetch(request,env){
    env=effectiveEnv(env);
    const url=new URL(request.url);
    if(url.pathname.startsWith('/api/')){
      try{return await api(request,env,url.pathname);}
      catch(error){const status=error.status>=400&&error.status<600?error.status:500;return json({error:status<500?error.message:'Kapron could not complete this request.'},status);}
    }
    if(!['GET','HEAD'].includes(request.method)) return new Response('Method not allowed',{status:405});
    const asset=assets[url.pathname==='/'?'/index.html':url.pathname];
    if(!asset) return new Response('Not found',{status:404});
    const headers={'content-type':asset.type,'x-content-type-options':'nosniff','referrer-policy':'no-referrer','cache-control':'no-cache',
      'content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' https: http://localhost:* http://127.0.0.1:* http://[::1]:*; object-src 'none'; worker-src 'self' blob:; base-uri 'none'; form-action 'self'; frame-src 'self'"};
    if(url.pathname==='/sandbox.html'){
      headers['content-security-policy']="default-src 'none'; script-src 'self'; worker-src blob:; connect-src 'none'; object-src 'none'; frame-ancestors 'self'";
    }
    return new Response(request.method==='HEAD'?null:asset.binary?Uint8Array.from(atob(asset.body),c=>c.charCodeAt(0)):asset.body,{headers});
  }
};
