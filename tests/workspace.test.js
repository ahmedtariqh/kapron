import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import worker from '../dist/server/index.js';
import {assembleContext,initial,modelOptions} from '../server/state.js';
import {extractText,providerRequest,sse} from '../server/providers.js';

function fixture(modelFetch) {
  const db=new DatabaseSync(':memory:');
  db.exec(readFileSync('drizzle/0000_workspace.sql','utf8'));
  db.exec(readFileSync('drizzle/0001_execution.sql','utf8'));
  const env={KAPRON_TRUST_SITES_IDENTITY:'1',KAPRON_VAULT_KEY:Buffer.alloc(32,7).toString('base64'),MODEL_FETCH:modelFetch,DB:{
    prepare(sql){return {bind(...args){return {async first(){return db.prepare(sql).get(...args);},async run(){return {meta:{changes:Number(db.prepare(sql).run(...args).changes)}};}};}};}
  }};
  const request=(path,owner,method='GET',body,origin)=>{
    const headers={'x-kapron-request':'1',...(owner?{'oai-authenticated-user-id':owner}:{}),...(origin?{origin}:{}),...(body===undefined?{}:{'content-type':'application/json'})};
    return worker.fetch(new Request('https://kapron.example/api/'+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)}),env);
  };
  return {db,request};
}
async function events(response) {
  const output=[];
  for await(const item of sse(response))output.push(item);
  return output;
}

test('workspace is account-isolated, revision-checked, and rejects cross-origin writes',async()=>{
  const {request,db}=fixture();
  try {
    assert.equal((await request('workspace',null)).status,401);
    const state=initial();state.projects.push({id:'private-a',name:'Private project A'});
    assert.equal((await request('workspace','alice','PUT',{state,revision:0},'https://other.example')).status,403);
    assert.equal((await request('workspace','alice','PUT',{state,revision:0},'https://kapron.example')).status,200);
    assert.equal((await request('workspace','alice','PUT',{state,revision:0})).status,409);
    assert.deepEqual((await (await request('workspace','bob')).json()).state.projects,[]);
    assert.equal((await (await request('workspace','alice')).json()).state.projects[0].name,'Private project A');
    assert.equal((await request('workspace','alice','PUT',{state:{...state,apiKey:'fixture'},revision:1})).status,400);
  }finally{db.close();}
});
test('vault key is encrypted, scoped, usable for streaming, and removed on deletion',async()=>{
  const secret='synthetic-fixture-key';
  const {request,db}=fixture(async outgoing=>{
    assert.equal(outgoing.url,'https://api.openai.com/v1/chat/completions');
    assert.equal(outgoing.headers.get('authorization'),'Bearer '+secret);
    const b=await outgoing.json();assert.equal(b.model,'fixture-model');assert.equal(b.messages.at(-1).content,'Hello');
    return new Response('data: {"choices":[{"delta":{"content":"Hello"}}]}\n\ndata: {"choices":[{"delta":{"content":" there"}}]}\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
  });
  try {
    const connection={id:'test-connection',provider:'openai',name:'Test',mode:'vault',model:'fixture-model'};
    const state={...initial(),connections:[connection]};
    assert.equal((await request('workspace','alice','PUT',{state,revision:0})).status,200);
    assert.equal((await request('workspace','bob','PUT',{state,revision:0})).status,200);
    assert.equal((await request('vault/test-connection','alice','PUT',{provider:'openai',key:secret})).status,200);
    const sealed=db.prepare('SELECT sealed FROM kapron_vault').get().sealed;
    assert.match(sealed,/^v1\./);assert(!sealed.includes(secret));
    assert(!(await (await request('workspace','alice')).text()).includes(secret));
    const input={connectionId:connection.id,model:connection.model,messages:[{role:'user',text:'Hello'}],instruction:''};
    assert.equal((await request('runs','bob','POST',input)).status,400);
    const r=await request('runs','alice','POST',input);
    assert.equal(r.status,200);assert.deepEqual(await events(r),[{delta:'Hello'},{delta:' there'},{done:true}]);
    assert.equal((await request('vault/test-connection','alice','DELETE')).status,200);
    assert.equal((await request('runs','alice','POST',input)).status,400);
  }finally{db.close();}
});
test('project and Gem conflicts remain visible and context honors source choices',()=>{
  const state=initial();
  state.connections.push({id:'gemini',provider:'gemini',model:'gemini-test'},{id:'openai',provider:'openai',model:'openai-test'});
  state.projects.push({id:'p',choice:{connectionId:'openai',model:'openai-test'},instructions:'project instruction',memoryEnabled:false});
  state.memory.push({text:'private memory'});
  state.files.push({id:'file-a',chatId:'c',name:'a.txt',text:'allowed text'},{id:'file-b',chatId:'other',name:'b.txt',text:'wrong chat'});
  const chat={id:'c',projectId:'p',messages:[{role:'user',text:'previous turn'}]};
  const gem={choice:{connectionId:'gemini',model:'gemini-test'},instructions:'gem instruction',knowledge:'references'};
  assert.deepEqual(modelOptions(state,chat,gem).map(x=>x.source),['Project','Gem']);
  const result=assembleContext(state,chat,gem,{history:false,project:true,memory:true,gem:true,files:true},'current prompt');
  assert.match(result.instruction,/project instruction/);assert.match(result.instruction,/allowed text/);assert.match(result.instruction,/gem instruction/);
  assert.doesNotMatch(result.instruction,/private memory|wrong chat/);
  assert.deepEqual(result.messages,[{role:'user',text:'current prompt'}]);
});
test('project-only memory and legacy project settings isolate context',()=>{
  const state=initial();
  state.projects.push({id:'private',memoryMode:'project'},{id:'other',memoryMode:'project'},{id:'legacy',memoryEnabled:false});
  state.memory.push({text:'Account detail'},{projectId:'private',text:'Private project detail'},{projectId:'other',text:'Other project detail'});
  const context=(projectId,memory=true)=>assembleContext(state,{projectId,messages:[]},null,{memory},'test').instruction;
  assert.equal(context('private'),'User supplied project memory:\nPrivate project detail');
  assert.equal(context('other'),'User supplied project memory:\nOther project detail');
  assert.equal(context('legacy'),'');
  assert.equal(context(null),'User supplied personal memory:\nAccount detail');
  assert.equal(context('private',false),'');
  state.settings.memoryEnabled=false;
  assert.equal(context(null),'');
  assert.match(context('private'),/Private project detail/);
});
test('Gemini and OpenRouter request formats and provider stream parsing',async()=>{
  const input={model:'fixture-model',key:'synthetic',instruction:'Be concise',messages:[{role:'user',text:'First'},{role:'user',text:'Second'},{role:'assistant',text:'Reply'},{role:'user',text:'Third'}],options:{maxOutput:4096}};
  const gemini=providerRequest({...input,provider:'gemini'});
  assert.equal(new URL(gemini.url).hostname,'generativelanguage.googleapis.com');
  assert.equal(gemini.headers.get('x-goog-api-key'),'synthetic');
  const payload=await gemini.json();
  assert.equal(payload.contents[0].parts.length,2);
  assert.equal(payload.generationConfig.maxOutputTokens,4096);
  const router=providerRequest({...input,provider:'openrouter',model:'provider/model'});
  assert.equal(new URL(router.url).hostname,'openrouter.ai');
  assert.equal((await router.json()).max_tokens,4096);
  assert.equal(extractText('gemini',{candidates:[{content:{parts:[{thought:true,text:'hidden'},{text:'visible'}]}}]}),'visible');
  const parts=['data: {"choices":','[{"delta":{"content":"ok"}}]}\r\n\r\n','data: [DONE]\r\n\r\n'];
  const stream=new ReadableStream({pull(c){if(parts.length)c.enqueue(new TextEncoder().encode(parts.shift()));else c.close();}});
  assert.equal(extractText('openrouter',(await events(new Response(stream)))[0]),'ok');
  const custom=providerRequest({...input,provider:'custom',endpoint:'http://localhost:11434/v1',key:''});
  assert.equal(custom.url,'http://localhost:11434/v1/chat/completions');
  assert.throws(()=>providerRequest({...input,provider:'custom',endpoint:'http://example.net/v1'}),/HTTPS/);
});
test('only fixed public provider destinations are relayed',async()=>{
  const {request,db}=fixture(async()=>{throw new Error('Unexpected outgoing network request');});
  try{
    const state=initial();state.connections=[{id:'custom1',provider:'custom',endpoint:'http://127.0.0.1/',mode:'device',relay:true}];
    assert.equal((await request('workspace','alice','PUT',{state,revision:0})).status,200);
    assert.equal((await request('runs','alice','POST',{connectionId:'custom1',model:'fixture',deviceKey:'synthetic',messages:[{role:'user',text:'Hello'}],instruction:''})).status,400);
  }finally{db.close();}
});
