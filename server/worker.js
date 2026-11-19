import {assets} from './generated-assets.js';
import {providers, providerRequest, sse, extractText, providerError, isGateway} from './providers.js';
import {gatewayConfig, gatewayModels} from './gateway.js';
import {estimateRun,reportedUsage} from './model-policy.js';
import {initial} from './state.js';
import {revisionHistoryValid} from './revisions.js';
import {projectHierarchyValid} from './projects.js';
import {parseJsonObject,responseFormatValid,responseSchema} from './structured.js';
import {notebookValid} from './notebooks.js';
import {seal, unseal} from './vault.js';
import {authConfig,authenticate,authenticatedOwner,completeAuth,startGoogle} from './auth.js';
import {collaboration} from './collaboration.js';
import {notebookAvailable,notebookCall} from './notebooklm.js';
import {voiceRequest} from './voice.js';
import {mediaRequest} from './media.js';
import {decideWithJev} from './decision-service.js';
import {apiKeyOwner,changeJob,createApiKey,createShare,enqueueJob,getJob,listApiKeys,listJobs,listShares,loadWorkspace,replayJob,prepareJob,revokeApiKey,revokeShare,runIdFor,setSchedule,sharedSnapshot,tickJobs} from './jobs.js';
import {authenticateWebhook,dispatchWebhook,revokeWebhook,rotateWebhook,savedWorkflow,setOneTimeSchedule,triggerStatus} from './workflow-triggers.js';

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
  if(!projectHierarchyValid(s.projects)||s.projects.some(project=>project.gemIds!==undefined&&(!Array.isArray(project.gemIds)||
    project.gemIds.length>250||project.gemIds.some(id=>!keyId(id)||!s.gems.some(gem=>gem.id===id)))))return false;
  if(s.chats.some(c=>!Array.isArray(c.messages) || c.messages.length>500 ||
    c.messages.some(m=>!m || !keyId(m.id) || !['assistant','user'].includes(m.role) || typeof m.text!=='string'))) return false;
  if(s.chats.some(c=>(c.folder!==undefined&&(typeof c.folder!=='string'||c.folder.length>80))||
    (c.pinnedFacts!==undefined&&(typeof c.pinnedFacts!=='string'||c.pinnedFacts.length>4000))||
    (c.historyChars!==undefined&&(!Number.isInteger(c.historyChars)||c.historyChars<2000||c.historyChars>150000))||
    (c.labels!==undefined&&(!Array.isArray(c.labels)||c.labels.length>12||c.labels.some(label=>typeof label!=='string'||label.length>32)))))return false;
  const extensions=['skills','knowledge','workflows','tasks','artifacts','goals','notebooks'];
  if(extensions.some(k=>s[k]!==undefined && (!Array.isArray(s[k])||s[k].length>250||s[k].some(x=>!x||!keyId(x.id)))))return false;
  if([s.gems,s.workflows??[],s.skills??[]].some(records=>records.some(item=>!revisionHistoryValid(item))))return false;
  if((s.notebooks??[]).some(item=>!notebookValid(item)||(item.projectId&&!s.projects.some(project=>project.id===item.projectId))))return false;
  if((s.goals??[]).some(goal=>!['active','paused','done'].includes(goal.status)||typeof goal.title!=='string'||!goal.title.trim()||goal.title.length>120||
    typeof goal.description!=='string'||goal.description.length>4000||!Array.isArray(goal.milestones)||goal.milestones.length>25||
    goal.milestones.some(item=>!item||!keyId(item.id)||typeof item.title!=='string'||!item.title.trim()||item.title.length>120||typeof item.done!=='boolean')||
    !Array.isArray(goal.links)||goal.links.length>25||goal.links.some(link=>!link||!['chat','artifact','workflow','run'].includes(link.kind)||!keyId(link.id))))return false;
  if(['skills','knowledge'].some(k=>(s[k]??[]).some(x=>typeof x.name!=='string'||typeof x.text!=='string'||x.text.length>40000||
    (x.description!==undefined&&typeof x.description!=='string'))))return false;
  if(s.connections.some(c=>!providerCanRelay(c.provider) && c.provider!=='custom')) return false;
  if(s.connections.some(c=>isGateway(c.provider) && (c.mode!=='vault'||c.endpoint!==undefined||c.relay===true))) return false;
  return !/"(?:apiKey|api_key|token|deviceKey|secret|authorization)"\s*:/i.test(JSON.stringify(s));
}
async function ownerOf(request,env) {
  if(env.LOCAL_USER) return {id:'local-owner',email:'Local workspace',local:true};
  if(authConfig(env).mode==='email'){
    const owner=await authenticatedOwner(request,env);
    if(owner)return owner;
    throw Object.assign(new Problem(401,'Sign in to open your workspace.'),{needsSession:true});
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

const utcDay=()=>new Date().toISOString().slice(0,10);
function dailyModelLimit(env){
  if(env.KAPRON_DAILY_MODEL_UNITS==null||env.KAPRON_DAILY_MODEL_UNITS==='')return null;
  const value=Number(env.KAPRON_DAILY_MODEL_UNITS);
  if(!Number.isSafeInteger(value)||value<0)throw new Problem(503,'The deployment model quota is invalid.');
  return value;
}

async function reserveModelQuota(env,owner,amount,limit){
  if(limit===null)return;
  if(amount>limit)throw new Problem(429,'This request exceeds the daily server model quota.');
  const result=await env.DB.prepare(`INSERT INTO kapron_model_quota (owner,utc_day,reserved) VALUES (?,?,?)
    ON CONFLICT(owner,utc_day) DO UPDATE SET reserved=reserved+excluded.reserved WHERE reserved<=?-excluded.reserved`)
    .bind(owner,utcDay(),amount,limit).run();
  if(result.meta.changes!==1)throw new Problem(429,'The daily server model quota has been reached.');
}

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
  const result=await gatewayModels(gateway,key,env.MODEL_FETCH??fetch,request.signal,input.details===true).catch(()=>null);
  if(!result)throw new Problem(424,'Could not load models from the configured gateway.');
  if(result.status)throw new Problem(424,providerError(result.status));
  return json(result);
}

function validateRun(input) {
  if(!input || !keyId(input.connectionId) || typeof input.model!=='string' || input.model.length>160 ||
    !Array.isArray(input.messages) || !input.messages.length || input.messages.length>32 ||
    input.messages.some(m=>!m || !['user','assistant'].includes(m.role) || typeof m.text!=='string' || m.text.length>40_000) ||
    !responseFormatValid(input.options?.responseFormat) || typeof input.instruction!=='string' || input.instruction.length>50_000) throw new Problem(400,'Invalid chat request.');
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
  if(input.options?.responseFormat==='json_object'){
    yield JSON.stringify({request:cleaned,mode:'demo'});
    return;
  }
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
        if(done){controller.enqueue(packet({done:true,...(value?{finishReason:value}:{})}));controller.close();abort();return;}
        controller.enqueue(packet(typeof value==='string'?{delta:value}:value));
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
  const schema=input.options?.responseFormat==='json_object'?responseSchema(input.options?.responseSchema):undefined;
  if(input.connectionId==='demo'&&schema)throw new Problem(400,'Select a connected model for a custom response schema.');
  const abort=new AbortController();
  const timeout=setTimeout(()=>abort.abort(),110000);
  const stop=()=>{clearTimeout(timeout);request.signal.removeEventListener('abort',stop);abort.abort();};
  request.signal.addEventListener('abort',stop,{once:true});
  if(input.connectionId==='demo') return streamResponse(demoReply(input,abort.signal),stop);
  try {
    const row=await env.DB.prepare('SELECT document FROM kapron_workspace WHERE owner=?').bind(owner.id).first();
    const workspace=row&&JSON.parse(row.document);
    const connection=workspace?.connections.find(c=>c.id===input.connectionId);
    if(!connection || !providerCanRelay(connection.provider)) throw new Problem(400,'Select a supported server connection.');
    const estimate=estimateRun(connection,input.model,input,input.options??{}, {...workspace.settings.options,maxRunUsd:workspace.settings.routing?.maxRunUsd});
    if(estimate.error)throw new Problem(422,estimate.error);
    const gateway=isGateway(connection.provider)?gatewayConfig(env):null;
    if(isGateway(connection.provider)&&gateway?.provider!==connection.provider)throw new Problem(409,'This model gateway is unavailable.');
    let key;
    if(connection.mode==='vault') {
      key=await vaultModelKey(env,owner.id,connection.id,connection.provider);
    } else if(!gateway&&connection.mode==='device' && connection.relay===true && typeof input.deviceKey==='string') {
      key=input.deviceKey;
    }
    if(!key || key.length>4000) throw new Problem(400,'This connection has no usable API key.');
    let upstream, outgoing;
    const dailyLimit=dailyModelLimit(env);
    const maxOutput=estimate.maxOutput??(dailyLimit===null?undefined:2048);
    try {
      outgoing=providerRequest({...input,options:{...input.options,maxOutput},endpoint:gateway?.endpoint,provider:connection.provider,key,signal:abort.signal});
    }catch(error){throw new Problem(400,error.message);}
    await reserveModelQuota(env,owner.id,estimate.inputBytes+(maxOutput??0),dailyLimit);
    try {
      upstream=await (env.MODEL_FETCH??fetch)(outgoing);
    } catch(e) {
      if(e instanceof TypeError || e?.name==='AbortError') throw new Problem(502,'The provider connection failed or timed out.');
      throw new Problem(400,'Check the model ID and connection settings.');
    }
    if(!upstream.ok){await upstream.body?.cancel();throw new Problem(502,providerError(upstream.status));}
    const chunks=(async function*(){
      let count=0, usage, upstreamModel, finishReason, structuredText='';
      const structured=input.options?.responseFormat==='json_object';
      for await (const event of sse(upstream)) {
        const observed=reportedUsage(connection.provider,event);
        if(observed)usage={...usage,...observed};
        const identity=event.model??event.modelVersion;
        if(typeof identity==='string'&&/^[\w.:/\-]{1,160}$/.test(identity))upstreamModel=identity;
        const reason=event.choices?.[0]?.finish_reason??event.candidates?.[0]?.finishReason;
        if(['length','MAX_TOKENS'].includes(reason))finishReason='length';
        if(['content_filter','SAFETY','RECITATION'].includes(reason))finishReason='content_filter';
        const chunk=extractText(connection.provider,event);
        if(!chunk) continue;
        count+=chunk.length;
        if(count>60_000) throw new Error('The reply exceeded the response size limit.');
        if(structured)structuredText+=chunk;else yield chunk;
      }
      if(!count) throw new Error('The provider returned no visible text.');
      if(structured){
        if(finishReason)throw new Error('The provider stopped before completing the JSON response.');
        parseJsonObject(structuredText,schema);
        yield structuredText;
      }
      if(usage||upstreamModel)yield {usage,upstreamModel};
      return finishReason;
    })();
    return streamResponse(chunks,stop);
  } catch(e){stop();throw e;}
}

async function executeJobModel(env,ownerId,input){
  const request=new Request('https://kapron.invalid/api/runs',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)});
  const response=await run(request,env,{id:ownerId});
  let text='', usage, upstreamModel;
  for await(const event of sse(response)){
    if(event.error)throw new Error(event.error);
    if(event.delta)text+=event.delta;
    if(event.usage)usage=event.usage;
    if(event.upstreamModel)upstreamModel=event.upstreamModel;
    if(event.done)return {text,usage,upstreamModel};
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
async function searchWeb(env,owner,prompt,signal=new AbortController().signal){
  const key=await vaultModelKey(env,owner,'search-tavily','tavily').catch(error=>{
    if(error.status===400)throw new Problem(400,'Configure an authorized key for this tool.');
    throw error;
  });
  return mediaRequest({operation:'search',prompt,key,signal,fetcher:env.MEDIA_FETCH??fetch});
}
const tick=env=>tickJobs(env,executeJobModel,(env,id,...args)=>decision(env,{id},...args),searchWeb);

async function integrationModels(env,owner){
  const state=await loadWorkspace(env,owner);
  const {results}=await env.DB.prepare('SELECT connection,provider FROM kapron_vault WHERE owner=?').bind(owner).all();
  const keys=new Set(results.map(row=>row.connection+':'+row.provider));
  const gateway=gatewayConfig(env)?.provider;
  return state.connections.filter(connection=>connection.mode==='vault'&&providerCanRelay(connection.provider)
    &&(!isGateway(connection.provider)||connection.provider===gateway)&&keys.has(connection.id+':'+connection.provider));
}

function integrationMessages(messages){
  const valid=Array.isArray(messages)&&messages.length>0&&messages.length<=32
    &&messages.every(message=>['user','assistant','system','developer'].includes(message?.role)&&typeof message.content==='string');
  if(!valid||!messages.some(message=>message.role==='user'))throw new Problem(400,'Supply text messages including at least one user message.');
  const firstTurn=messages.findIndex(message=>['user','assistant'].includes(message.role));
  if(messages.slice(firstTurn).some(message=>['system','developer'].includes(message.role)))throw new Problem(400,'Put system and developer instructions before the conversation.');
  return {instruction:messages.slice(0,firstTurn).map(message=>message.content).join('\n\n'),
    messages:messages.slice(firstTurn).map(message=>({role:message.role,text:message.content}))};
}

async function integrationChat(request,env,owner){
  const input=await readJson(request,250000);
  const supported=['model','messages','stream','stream_options','max_completion_tokens','max_tokens','temperature','response_format'];
  if(!input||Array.isArray(input)||Object.keys(input).some(key=>!supported.includes(key)))throw new Problem(400,'Unsupported chat completion field.');
  const format=input.response_format;
  let schema;
  if(format!==undefined){
    if(!format||typeof format!=='object'||Array.isArray(format)||!['text','json_object','json_schema'].includes(format.type)||
      Object.keys(format).some(key=>!['type',...(format.type==='json_schema'?['json_schema']:[])].includes(key)))
      throw new Problem(400,'Use text, json_object, or json_schema response format.');
    if(format.type==='json_schema'){
      const descriptor=format.json_schema;
      if(!descriptor||typeof descriptor!=='object'||typeof descriptor.name!=='string'||!/^[-a-zA-Z0-9_]{1,64}$/.test(descriptor.name)||
        !descriptor.schema||Object.keys(descriptor).some(key=>!['name','schema','strict','description'].includes(key)))
        throw new Problem(400,'Provide a JSON schema name and schema.');
      schema=responseSchema(descriptor.schema);
    }
  }
  const context=integrationMessages(input.messages);
  const target=(await integrationModels(env,owner)).find(connection=>connection.id===input.model);
  if(!target)throw new Problem(404,'Select a vault model ID from the Kapron model list.');
  const maxOutput=input.max_completion_tokens??input.max_tokens;
  if(maxOutput!==undefined&&(!Number.isInteger(maxOutput)||maxOutput<16||maxOutput>32768))throw new Problem(400,'Use an output token limit from 16 to 32,768.');
  const requestUsage=input.stream_options?.include_usage===true;
  const payload={...context,connectionId:target.id,model:target.model,options:{maxOutput,responseFormat:schema?'json_object':format?.type,responseSchema:schema,temperature:input.temperature,reportUsage:target.capability?.reportUsage===true}};
  const response=await run(new Request(request.url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload),signal:request.signal}),env,{id:owner});
  const id='chatcmpl-'+crypto.randomUUID();
  const created=Math.floor(Date.now()/1000);
  const usageShape=usage=>usage&&Object.fromEntries(Object.entries({prompt_tokens:usage.input,completion_tokens:usage.output,total_tokens:usage.total}).filter(([,value])=>value!==undefined));
  if(input.stream===true){
    const iterator=sse(response);
    let usage;
    const encoder=new TextEncoder();
    const write=(controller,value)=>controller.enqueue(encoder.encode('data: '+(typeof value==='string'?value:JSON.stringify(value))+'\n\n'));
    const chunk=(delta,finish=null)=>({id,created,object:'chat.completion.chunk',model:target.id,choices:[{index:0,delta,finish_reason:finish}]});
    const body=new ReadableStream({
      start(controller){write(controller,chunk({role:'assistant'}));},
      async pull(controller){
        try{
          for(;;){
            const {value:event,done}=await iterator.next();
            if(done)throw new Error('Model stream disconnected.');
            if(event.error)throw new Error(event.error);
            if(event.usage)usage=usageShape(event.usage);
            if(event.delta){write(controller,chunk({content:event.delta}));return;}
            if(event.done){
              write(controller,chunk({},event.finishReason??'stop'));
              if(requestUsage&&usage)write(controller,{...chunk({}),choices:[],usage});
              write(controller,'[DONE]');controller.close();await iterator.return();return;
            }
          }
        }catch(error){write(controller,{error:{message:error.message,type:'upstream_error'}});controller.close();await iterator.return();}
      },
      cancel(){return iterator.return();}
    });
    return new Response(body,{headers:{...noCache,'content-type':'text/event-stream; charset=utf-8'}});
  }
  let text='',usage,finishReason;
  for await(const event of sse(response)){
    if(event.error)throw new Problem(424,event.error);
    if(event.delta)text+=event.delta;
    if(event.usage)usage=usageShape(event.usage);
    if(event.done){finishReason=event.finishReason??'stop';break;}
  }
  if(!finishReason)throw new Problem(424,'Model stream disconnected.');
  return json({id,created,object:'chat.completion',model:target.id,choices:[{index:0,message:{role:'assistant',content:text},finish_reason:finishReason}],...(usage?{usage}:{})});
}

async function integration(request,env,path){
  const owner=await apiKeyOwner(env,request.headers.get('authorization'));
  if(!owner)throw new Problem(401,'A valid Kapron bearer key is required.');
  if(path==='/api/v1/models'&&request.method==='GET'){
    return json({object:'list',data:(await integrationModels(env,owner)).map(connection=>({id:connection.id,object:'model',created:0,owned_by:connection.provider}))});
  }
  if(path==='/api/v1/chat/completions'&&request.method==='POST')return integrationChat(request,env,owner);
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
    const runId=await runIdFor(owner,request.headers.get('idempotency-key'));
    if(input.workflowId){
      const state=await loadWorkspace(env,owner);
      const workflow=(state.workflows??[]).find(w=>w.id===input.workflowId);
      if(!workflow)throw new Problem(404,'Workflow unavailable.');
      return json(await enqueueJob(env,owner,{...workflow,input:input.input},runId),202);
    }
    return json(await enqueueJob(env,owner,input,runId),202);
  }
  return json({error:'Route not found.'},404);
}

async function api(request,env,path) {
  if(path.startsWith('/api/v1/'))return integration(request,env,path);
  const hook=path.match(/^\/api\/hooks\/([a-f0-9-]{36})$/);
  if(hook&&request.method==='POST'){
    if(!env.DB)throw new Problem(503,'Workspace storage unavailable.');
    const authorized=await authenticateWebhook(env,hook[1],request.headers.get('authorization'));
    const body=await readJson(request,50000);
    if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>key!=='input'))
      throw new Problem(400,'Send an object with an optional input string.');
    const queued=await dispatchWebhook(env,authorized,request.headers.get('idempotency-key'),Object.hasOwn(body,'input')?body.input:'');
    return json(queued,202);
  }
  const sharedDownload=path.match(/^\/api\/public-share\/([a-zA-Z0-9-]{36})\/download$/);
  if(sharedDownload&&request.method==='GET'){
    const snapshot=await sharedSnapshot(env,sharedDownload[1]);
    if(snapshot.download!==true)throw new Problem(403,'Downloads are disabled for this snapshot.');
    const content=snapshot.messages?snapshot.messages.map(message=>(message.role==='user'?'User':'Assistant')+'\n'+message.text).join('\n\n'):snapshot.text;
    return new Response(snapshot.title+'\n\n'+content,{headers:{...noCache,'content-type':'text/plain; charset=utf-8','content-disposition':'attachment; filename="kapron-snapshot.txt"'}});
  }
  const share=path.match(/^\/api\/public-share\/([a-zA-Z0-9-]{36})$/);
  if(share&&request.method==='GET')return json(await sharedSnapshot(env,share[1]));
  if(path==='/api/auth-config'&&request.method==='GET')return json(authConfig(env));
  if(path.startsWith('/api/auth/')){
    if(authConfig(env).mode!=='email')throw new Problem(404,'This authentication method is unavailable.');
    const callback=path.match(/^\/api\/auth\/callback\/(google|email)$/);
    if(callback&&request.method==='GET'){
      const result=await completeAuth(request,env,callback[1]);
      const headers=new Headers({...noCache,location:result.url});
      for(const value of result.cookies)headers.append('set-cookie',value);
      return new Response(null,{status:303,headers});
    }
    const auth=path.match(/^\/api\/auth\/(login|signup|logout|refresh|google)$/);
    if(!auth||request.method!=='POST')throw new Problem(404,'Authentication route unavailable.');
    checkMutation(request);
    const action=auth[1];
    const values=['login','signup'].includes(action)?await readJson(request,10000):null;
    const result=action==='google'?await startGoogle(request,env):await authenticate(request,env,action,values);
    const headers=new Headers(noCache);
    for(const value of result.cookies??[])headers.append('set-cookie',value);
    return Response.json(result.data,{status:result.status??200,headers});
  }
  const owner=await ownerOf(request,env);
  if(!env.DB)throw Object.assign(new Problem(503,'Workspace storage is unavailable. Configure the DB binding on the Kapron server.'),{publicAuth:true});
  const method=request.method;
  if(method!=='GET') checkMutation(request);
  if(path==='/api/session' && method==='GET') return json({user:owner,vaultAvailable:!!env.KAPRON_VAULT_KEY,gatewayProvider:gatewayConfig(env)?.provider??null,authMode:authConfig(env).mode});
  if(path==='/api/gateway-models'&&method==='POST')return listGatewayModels(request,env,owner);
  if(path==='/api/model-quota'&&method==='GET'){
    const limit=dailyModelLimit(env), day=utcDay();
    const row=limit===null?null:await env.DB.prepare('SELECT reserved FROM kapron_model_quota WHERE owner=? AND utc_day=?').bind(owner.id,day).first();
    return json({limit,used:row?.reserved??0,day});
  }
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
    if(input.operation==='search')return json(await searchWeb(env,owner.id,input.prompt,request.signal));
    const workspace=await loadWorkspace(env,owner.id);
    const connection=workspace.connections.find(c=>c.id===input.connectionId&&c.provider==='openai');
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
    const {text}=await executeJobModel(env,owner.id,{connectionId:selected.id,model:selected.model,
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
  if(path==='/api/jobs'&&method==='GET')
    return json({runs:await listJobs(env,owner.id,new URL(request.url).searchParams.get('filter')??'all')});
  if(path==='/api/jobs'&&method==='POST'){
    const input=await readJson(request,70000);
    if(!input||typeof input!=='object')throw new Problem(400,'Enter a run definition.');
    return json(await enqueueJob(env,owner.id,input,await runIdFor(owner.id,request.headers.get('idempotency-key'))),202);
  }
  const replay=path.match(/^\/api\/jobs\/([a-zA-Z0-9-]{1,180})\/replay$/);
  if(replay&&method==='POST')return json(await replayJob(env,owner.id,replay[1]),202);
  const job=path.match(/^\/api\/jobs\/([a-zA-Z0-9-]{1,180})$/);
  if(job&&method==='GET'){
    const record=await getJob(env,owner.id,job[1]);
    if(!record)throw new Problem(404,'Run unavailable.');
    return json(record);
  }
  if(job&&method==='PATCH'){
    const {action,step}=await readJson(request,300)??{};
    return json(await changeJob(env,owner.id,job[1],action,step));
  }
  const trigger=path.match(/^\/api\/workflow-triggers\/([a-zA-Z0-9-]{1,80})(?:\/(webhook|once|preview))?$/);
  if(trigger){
    const [,workflow,action]=trigger;
    if(!action&&method==='GET'){
      await savedWorkflow(env,owner.id,workflow);
      return json(await triggerStatus(env,owner.id,workflow));
    }
    if(action==='webhook'&&method==='POST')return json(await rotateWebhook(env,owner.id,workflow),201);
    if(action==='webhook'&&method==='DELETE'){
      await revokeWebhook(env,owner.id,workflow);
      return json({revoked:true});
    }
    if(action==='once'&&method==='PUT'){
      const body=await readJson(request,1000);
      await setOneTimeSchedule(env,owner.id,workflow,body?.at);
      return json({saved:true});
    }
    if(action==='preview'&&method==='POST'){
      const plan=await prepareJob(env,owner.id,await savedWorkflow(env,owner.id,workflow));
      return json({name:plan.name,connectionId:plan.connectionId,policy:plan.policy,maxModelCalls:plan.maxModelCalls??null,steps:plan.steps.map(step=>({
        type:step.type,label:step.label??step.type,...(step.nodes?{parallel:step.nodes.length}:{}),...(step.type==='check'?{rule:step.rule,expected:step.expected}:{})
      }))});
    }
  }
  const schedule=path.match(/^\/api\/schedules\/([a-zA-Z0-9-]{1,80})$/);
  if(schedule&&method==='PUT'){
    const {exists}=await setSchedule(env,owner.id,schedule[1]);
    if(!exists){
      await revokeWebhook(env,owner.id,schedule[1]);
      await setOneTimeSchedule(env,owner.id,schedule[1],null);
    }
    return json({saved:true});
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
      catch(error){const status=error.status>=400&&error.status<600?error.status:500;return Response.json({error:status<500||error.publicAuth===true?error.message:'Kapron could not complete this request.'},{status,headers:{...noCache,...(error.needsSession?{'x-kapron-session':'required'}:{})}});}
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
