import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import worker from '../dist/server/index.js';
import {initial} from '../server/state.js';
import {parseDecision,routingCandidates,chooseModel} from '../server/routing.js';

function fixture(overrides={}){
  const db=new DatabaseSync(':memory:');
  for(const migration of ['0000_workspace','0001_execution']) db.exec(readFileSync('drizzle/'+migration+'.sql','utf8'));
  const env={KAPRON_TRUST_SITES_IDENTITY:'1',KAPRON_VAULT_KEY:Buffer.alloc(32,4).toString('base64'),...overrides,DB:{
    prepare(sql){return {bind(...args){return {
      async first(){return db.prepare(sql).get(...args);},
      async all(){return {results:db.prepare(sql).all(...args)};},
      async run(){return {meta:{changes:Number(db.prepare(sql).run(...args).changes)}};}
    };}};}
  }};
  const request=(path,{user='alice',method='GET',body,headers={}}={})=>worker.fetch(new Request('https://kapron.example/api/'+path,{
    method,headers:{...user&&{'oai-authenticated-user-id':user},'x-kapron-request':'1','content-type':'application/json',...headers},
    ...(body!==undefined?{body:JSON.stringify(body)}:{})
  }),env);
  return {db,request,tick:()=>worker.scheduled(null,env)};
}
const packet=(text)=>new Response('data: '+JSON.stringify({choices:[{delta:{content:text}}]})+'\n\ndata: [DONE]\n\n');

for(const provider of ['litellm','omniroute'])test(provider+' gateway serves catalog, chat and jobs under the same vault boundary',async()=>{
  const hits=[];
  const {db,request,tick}=fixture({KAPRON_GATEWAY_PROVIDER:provider,KAPRON_GATEWAY_URL:'https://fixture.gateway.example',
    MODEL_FETCH:async req=>{
      hits.push(req.url);
      assert.equal(req.headers.get('authorization'),'Bearer mock-gateway-key');
      assert.equal(req.redirect,'error');
      if(req.method==='GET')return Response.json({data:[{id:'tier/text'},{id:'tier/text'},{id:'rejected model label'}]});
      assert.equal((await req.json()).model,'tier/text');
      return packet('gateway fixture output');
    }});
  const read=async (route,body,user)=>request(route,{method:'POST',body,user});
  try{
    assert.equal((await (await request('session')).json()).gatewayProvider,provider);
    assert.equal((await read('gateway-models',{provider,key:'',connectionId:'route'})).status,400);
    const state=initial();
    state.connections=[{id:'route',provider,name:'Gateway',mode:'vault',model:'tier/text'}];
    assert.equal((await request('workspace',{method:'PUT',body:{revision:0,state:{...state,connections:[{...state.connections[0],endpoint:'https://untrusted.example'}]}}})).status,400);
    assert.equal((await request('workspace',{method:'PUT',body:{revision:0,state}})).status,200);
    assert.equal((await request('vault/route',{method:'PUT',body:{provider,key:'mock-gateway-key'}})).status,200);
    assert.equal((await read('gateway-models',{provider,connectionId:'route'},'bob')).status,400);
    const models=await read('gateway-models',{provider,connectionId:'route',endpoint:'https://untrusted.example'});
    assert.deepEqual(await models.json(),{models:['tier/text']});
    const response=await read('runs',{connectionId:'route',model:'tier/text',endpoint:'https://untrusted.example',messages:[{role:'user',text:'hello'}],instruction:''});
    assert.match(await response.text(),/gateway fixture output/);
    const queued=await read('jobs',{connectionId:'route',name:'Fixture',policy:'fixed',nodes:[{type:'prompt',prompt:'Run a fixture'}]});
    assert.equal(queued.status,202);
    const job=await queued.json();
    await tick();
    const {runs}=await (await request('jobs')).json();
    const completed=runs.find(run=>run.id===job.id);
    assert.equal(completed.status,'completed');
    assert.equal(completed.outputs[0].text,'gateway fixture output');
    assert.equal(completed.outputs[0].model,'tier/text');
    assert.deepEqual(hits,['https://fixture.gateway.example/v1/models',...Array(2).fill('https://fixture.gateway.example/v1/chat/completions')]);
  }finally{db.close();}
});

test('Jev sees only scoped descriptions and a brief; bounded scores select the declared model specialty',async()=>{
  let hits=0;
  const family={type:'choice',choice:'coding',confidence:.92,probabilities:{general:.02,coding:.92,research:.02,analysis:.02,writing:.02}};
  const {db,request}=fixture({DECISION_FETCH:async req=>{
    hits++;
    assert.equal(req.url,'https://api.beatapi.io/v1/systemone');
    assert.equal(req.headers.get('authorization'),'Bearer fixture-key');
    const body=await req.json();
    assert.equal(body.model,'jev-1.14');
    assert.deepEqual(Object.keys(body.questions),['family','skills0']);
    assert.doesNotMatch(JSON.stringify(body),/private body|Other scope|private memory/);
    return Response.json({answers:{family,skills0:{type:'noul',noul:.9}}});
  }});
  try{
    const state=initial();
    state.settings.routing={cloud:true};
    state.memory.push({id:'memory',text:'private memory'});
    state.chats.push({id:'chat1',projectId:'proj',messages:[]});
    state.skills=[{id:'skill1',name:'Debugging',description:'fix a bug',text:'private body',enabled:true,projectId:'proj'},
      {id:'skill2',name:'Other scope',text:'private body',enabled:true,projectId:'other'}];
    assert.equal((await request('workspace',{method:'PUT',body:{state,revision:0}})).status,200);
    assert.equal((await request('vault/beatapi-router',{method:'PUT',body:{provider:'beatapi',key:'fixture-key'}})).status,200);
    const response=await request('routing',{method:'POST',body:{chatId:'chat1',scope:{},prompt:'fix a bug'}});
    assert.deepEqual(await response.json(),{engine:'jev',decision:{family:'coding',skills:['skill1'],knowledge:[]}});
    assert.equal((await request('routing',{user:'bob',method:'POST',body:{chatId:'chat1',scope:{},prompt:'fix a bug'}})).status,404);
    assert.equal(hits,1);
    const shortlist=routingCandidates(state,state.chats[0],{},'bug');
    assert.equal(parseDecision({answers:{family:{...family,choice:'invented'}}},shortlist),null);
    const models=[{id:'a',routing:{specialties:['coding'],contextChars:5000}},{id:'b',routing:{specialties:['research'],contextChars:8000}}];
    assert.equal(chooseModel(models,'coding',3000).id,'a');
    assert.equal(chooseModel(models,'coding',6000).id,'b');
  }finally{db.close();}
});

test('jobs persist branch progress, parallel results and account isolation; bearer integration keys are revocable',async()=>{
  const {db,request,tick}=fixture({MODEL_FETCH:async req=>{
    const body=await req.json();
    return packet(body.messages.at(-1).content.endsWith('match me')?'match me':'processed');
  }});
  try{
    const state=initial();
    state.connections=[{id:'model1',provider:'openai',model:'fixture',mode:'vault'}];
    await request('workspace',{method:'PUT',body:{state,revision:0}});
    await request('vault/model1',{method:'PUT',body:{provider:'openai',key:'fixture'}});
    const issued=await (await request('access-keys',{method:'POST'})).json();
    assert(!db.prepare('SELECT * FROM kapron_api_key').get().hash.includes(issued.value));
    const authorization='Bearer '+issued.value;
    const body={name:'Job',policy:'fixed',connectionId:'auto',nodes:[
      {type:'prompt',prompt:'match me'},
      {type:'condition',contains:'other',nodes:[{type:'prompt',prompt:'Skip me'}]},
      {type:'parallel',nodes:[{type:'prompt',prompt:'one'},{type:'prompt',prompt:'two'}]}
    ]};
    const queued=await request('v1/runs',{user:null,method:'POST',body,headers:{authorization}});
    assert.equal(queued.status,202);
    const {id}=await queued.json();
    await Promise.all([tick(),tick()]);
    await tick();await tick();
    const run=await (await request('v1/runs/'+id,{user:null,headers:{authorization}})).json();
    assert.equal(run.status,'completed');
    assert.deepEqual(run.outputs.map(o=>o.text),['match me','processed','processed']);
    assert.deepEqual((await (await request('jobs',{user:'bob'})).json()).runs,[]);
    await request('access-keys/'+issued.id,{method:'DELETE'});
    assert.equal((await request('v1/runs',{user:null,headers:{authorization}})).status,401);
  }finally{db.close();}
});

test('immutable share snapshots expose content only while valid and revocation is owner-scoped',async()=>{
  const {db,request}=fixture();
  try{
    const state=initial();
    state.artifacts.push({id:'artifact',name:'Document',text:'first revision'});
    await request('workspace',{method:'PUT',body:{state,revision:0}});
    const {id}=await (await request('shares',{method:'POST',body:{kind:'artifact',id:'artifact'}})).json();
    state.artifacts[0].text='second revision';
    await request('workspace',{method:'PUT',body:{state,revision:1}});
    await request('shares/'+id,{user:'bob',method:'DELETE'});
    assert.deepEqual(await (await request('public-share/'+id,{user:null})).json(),{title:'Document',text:'first revision'});
    await request('shares/'+id,{method:'DELETE'});
    assert.equal((await request('public-share/'+id,{user:null})).status,404);
  }finally{db.close();}
});

test('hosted worker ignores forged Sites identity when independently configured',async()=>{
  const verified='8a103fae-f607-48bd-bbf4-4690d505a321';
  const {db,request}=fixture({KAPRON_SUPABASE_URL:'https://fixture.supabase.co',KAPRON_SUPABASE_KEY:'fixture',AUTH_FETCH:async req=>{
    assert.equal(req.url,'https://fixture.supabase.co/auth/v1/user');
    return Response.json({id:verified,email:'user@example.test'});
  }});
  try{
    assert.equal((await request('workspace')).status,401);
    const session=await request('session',{headers:{cookie:'__Host-kapron-session=fixture.header.signature'}});
    assert.equal((await session.json()).user.id,verified);
  }finally{db.close();}
});

test('shared project roles and revision conflicts are enforced at the server',async()=>{
  const {db,request}=fixture();
  try{
    const {id}=await (await request('spaces',{method:'POST',body:{name:'Shared project'}})).json();
    const invite=async role=>(await (await request('spaces/'+id+'/invites',{method:'POST',body:{role}})).json()).code;
    const viewer=await invite('viewer'), editor=await invite('editor');
    assert.equal((await request('spaces/'+id,{user:'other'})).status,404);
    await request('spaces/join',{user:'bob',method:'POST',body:{code:viewer}});
    await request('spaces/join',{user:'carol',method:'POST',body:{code:editor}});
    assert.equal((await request('spaces/'+id,{user:'bob',method:'PUT',body:{document:'private',revision:0}})).status,403);
    const saved=await request('spaces/'+id,{user:'carol',method:'PUT',body:{document:'first revision',revision:0}});
    assert.equal(saved.status,200);
    assert.equal((await request('spaces/'+id,{method:'PUT',body:{document:'stale',revision:0}})).status,409);
    assert.equal((await (await request('spaces/'+id,{user:'bob'})).json()).document,'first revision');
    await request('spaces/'+id+'/members',{method:'DELETE'});
    assert.equal((await request('spaces/'+id,{user:'carol'})).status,404);
  }finally{db.close();}
});

test('research uses only the authorized Tavily key and strips unsafe result URLs',async()=>{
  const {db,request}=fixture({MEDIA_FETCH:async req=>{
    assert.equal(req.url,'https://api.tavily.com/search');
    assert.equal(req.headers.get('authorization'),'Bearer fixture');
    assert.equal((await req.json()).query,'Kapron');
    return Response.json({results:[{url:'javascript:ignored()',title:'Unsafe'},{url:'https://example.org',title:'Source',content:'test'}]});
  }});
  try{
    await request('vault/search-tavily',{method:'PUT',body:{provider:'tavily',key:'fixture'}});
    const body={operation:'search',prompt:'Kapron'};
    assert.equal((await request('tools',{user:'bob',method:'POST',body})).status,400);
    const result=await request('tools',{method:'POST',body});
    assert.deepEqual(await result.json(),{sources:[{url:'https://example.org/',title:'Source',excerpt:'test'}]});
  }finally{db.close();}
});

test('NotebookLM runs inside Cowork, preserves references and never forwards private workspace context',async()=>{
  const notebookId='a64a7a73-3f65-4cd6-8ca7-ceb725e77e0a';
  let attempt=0;
  const {db,request,tick}=fixture({
    KAPRON_NOTEBOOKLM_OWNER:'alice',KAPRON_NOTEBOOKLM_URL:'https://connector.example',KAPRON_NOTEBOOKLM_TOKEN:'fixture-secret',
    NOTEBOOK_FETCH:async outgoing=>{
      assert.equal(outgoing.headers.get('authorization'),'Bearer fixture-secret');
      assert.equal(outgoing.redirect,'error');
      if(outgoing.method==='GET')return Response.json({notebooks:[{id:notebookId,title:'Approved notebook'}]});
      assert.deepEqual(await outgoing.json(),{notebookId,question:'What is the conclusion?'});
      if(++attempt===1)return Response.json({}, {status:409});
      return Response.json({answer:'Source-backed answer [1]',citations:[{sourceId:notebookId,number:1,quote:'Evidence excerpt'}]});
    }
  });
  try{
    const state=initial();
    state.memory.push({id:'private-memory',text:'Do not send this'});
    await request('workspace',{method:'PUT',body:{state,revision:0}});
    const data=await (await request('integrations/notebooklm')).json();
    assert.deepEqual(data.notebooks,[{id:notebookId,title:'Approved notebook'}]);
    assert.equal((await request('integrations/notebooklm',{user:'bob'})).status,409);
    const job={name:'Research',kind:'task',policy:'fixed',connectionId:'demo',input:'Private run input',useMemory:true,
      nodes:[{type:'notebooklm',notebookId,prompt:'What is the conclusion?'}]};
    assert.equal((await request('jobs',{user:'bob',method:'POST',body:job})).status,409);
    const created=await request('jobs',{method:'POST',body:job});
    assert.equal(created.status,202);
    const {id}=await created.json();
    await tick();
    let run=(await (await request('jobs')).json()).runs[0];
    assert.equal(run.status,'blocked');
    assert.match(run.outputs[0].error,/sign in again/i);
    await request('jobs/'+id,{method:'PATCH',body:{action:'resume'}});
    await tick();
    run=(await (await request('jobs')).json()).runs[0];
    assert.equal(run.status,'completed');
    assert.match(run.outputs[0].text,/Evidence excerpt/);
    assert.deepEqual(run.outputs[0].citations,[{sourceId:notebookId,number:1,quote:'Evidence excerpt'}]);
  }finally{db.close();}
});

test('voice endpoints scope OpenAI keys and relay transcription and WebRTC offers',async()=>{
  let calls=0;
  const {db,request}=fixture({VOICE_FETCH:async outgoing=>{
    calls++;
    assert.equal(outgoing.headers.get('authorization'),'Bearer voice-fixture');
    assert.equal(outgoing.redirect,'error');
    const data=await outgoing.formData();
    if(outgoing.url.endsWith('/audio/transcriptions')){
      assert.equal(data.get('language'),'ar');
      assert.equal(data.get('model'),'gpt-transcribe');
      assert.equal(await data.get('file').text(),'voice');
      return Response.json({text:'  صباح الخير  '});
    }
    assert.equal(outgoing.url,'https://api.openai.com/v1/realtime/calls');
    assert.match(data.get('sdp'),/m=audio/);
    const config=JSON.parse(data.get('session'));
    assert.equal(config.model,'gpt-realtime-2');
    assert.equal(config.audio.input.turn_detection.interrupt_response,true);
    assert.match(config.instructions,/Egyptian Arabic/);
    return new Response('v=0\r\nm=audio fixture');
  }});
  try{
    const state=initial();
    state.connections.push({id:'voice1',provider:'openai',model:'text-model',mode:'vault'});
    await request('workspace',{method:'PUT',body:{state,revision:0}});
    await request('vault/voice1',{method:'PUT',body:{provider:'openai',key:'voice-fixture'}});
    const payload={connectionId:'voice1',language:'ar',mime:'audio/webm',audio:btoa('voice')};
    assert.equal((await request('voice/transcribe',{user:'bob',method:'POST',body:payload})).status,400);
    assert.equal((await request('voice/transcribe',{method:'POST',body:{...payload,mime:'text/html'}})).status,400);
    assert.deepEqual(await (await request('voice/transcribe',{method:'POST',body:payload})).json(),{text:'صباح الخير'});
    const live=await request('voice/live',{method:'POST',body:{connectionId:'voice1',language:'ar',sdp:'v=0\r\nm=audio offer\r\nm=application events'}});
    assert.deepEqual(await live.json(),{sdp:'v=0\r\nm=audio fixture',model:'gpt-realtime-2'});
    assert.equal(calls,2);
  }finally{db.close();}
});

test('Auto uses the Abliterated profile only after a confident, approved preflight',async()=>{
  const family={type:'choice',choice:'writing',confidence:.92,
    probabilities:{general:.02,coding:.02,research:.02,analysis:.02,writing:.92}};
  const modelCalls=[];
  let profileReads=0;
  const {db,request,tick}=fixture({
    DECISION_FETCH:async req=>{
      const {state,questions}=await req.json();
      if(!questions.responseProfile)return Response.json({answers:{family}});
      profileReads++;
      const responseProfile=state.task==='uncertain'?
        {type:'choice',choice:'abliterated',confidence:.7,probabilities:{standard:.1,abliterated:.7,uncertain:.2}}:
        {type:'choice',choice:'abliterated',confidence:.94,probabilities:{standard:.03,abliterated:.94,uncertain:.03}};
      return Response.json({answers:{family,responseProfile}});
    },
    MODEL_FETCH:async req=>{
      const {model}=await req.json();
      modelCalls.push(model);
      return packet('Fixture reply');
    }
  });
  try{
    const state=initial();
    state.settings.routing={cloud:true};
    state.connections=[
      {id:'standard',provider:'openai',model:'standard-fixture',mode:'vault'},
      {id:'alternative',provider:'openrouter',model:'abliterated-fixture',mode:'vault',routing:{profile:'abliterated',quality:5}}
    ];
    await request('workspace',{method:'PUT',body:{state,revision:0}});
    for(const [id,provider] of [['standard','openai'],['alternative','openrouter'],['beatapi-router','beatapi']]){
      assert.equal((await request('vault/'+id,{method:'PUT',body:{provider,key:'fixture'}})).status,200);
    }
    async function run(prompt,overrides={}){
      const body={name:'Profile',policy:'fixed',connectionId:'auto',cloudRouting:true,abliterated:true,nodes:[{type:'prompt',prompt}],...overrides};
      assert.equal((await request('jobs',{method:'POST',body})).status,202);
      await tick();
    }
    await run('Write non-graphic historical satire.');
    await run('uncertain');
    await run('Write another satire.',{abliterated:false});
    await run('Write another satire.',{connectionId:'standard'});
    await run('x'.repeat(951));
    await run('Write another satire.',{cloudRouting:false});
    assert.deepEqual(modelCalls,['abliterated-fixture',...Array(5).fill('standard-fixture')]);
    assert.equal(profileReads,2);
    const selected=chooseModel(state.connections,'writing',300000,'quality','abliterated');
    assert.equal(selected,undefined);
    assert.equal(chooseModel(state.connections.slice(1),'writing',100),undefined);
  }finally{db.close();}
});
