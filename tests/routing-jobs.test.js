import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import worker from '../dist/server/index.js';
import {initial} from '../server/state.js';
import {parseDecision,routingCandidates,chooseModel} from '../server/routing.js';

function fixture(overrides={}){
  const db=new DatabaseSync(':memory:');
  for(const migration of ['0000_workspace','0001_execution','0002_model_quota']) db.exec(readFileSync('drizzle/'+migration+'.sql','utf8'));
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

test('daily model reservations atomically constrain concurrent calls per workspace',async()=>{
  let calls=0;
  const {db,request}=fixture({KAPRON_DAILY_MODEL_UNITS:'106',MODEL_FETCH:async()=>{calls++;return packet('fixture');}});
  try{
    const state=initial();
    state.connections=[{id:'model1',provider:'openai',model:'fixture',mode:'vault'}];
    await request('workspace',{method:'PUT',body:{state,revision:0}});
    await request('vault/model1',{method:'PUT',body:{provider:'openai',key:'fixture-key'}});
    const body={connectionId:'model1',model:'fixture',messages:[{role:'user',text:'hello'}],instruction:'',options:{maxOutput:16}};
    const replies=await Promise.all(Array.from({length:12},()=>request('runs',{method:'POST',body})));
    assert.equal(replies.filter(reply=>reply.status===200).length,2);
    assert.equal(replies.filter(reply=>reply.status===429).length,10);
    await Promise.all(replies.map(reply=>reply.text()));
    assert.equal(calls,2);
    assert.equal((await (await request('model-quota')).json()).used,106);
    assert.equal((await (await request('model-quota',{user:'bob'})).json()).used,0);
  }finally{db.close();}
});

test('gateway metadata, spend preflight, usage, and integration completions share the vault boundary',async()=>{
  let calls=0;
  const {db,request}=fixture({KAPRON_GATEWAY_PROVIDER:'litellm',KAPRON_GATEWAY_URL:'https://fixture.gateway.example',
    MODEL_FETCH:async req=>{
      if(req.method==='GET')return Response.json({data:[{id:'test/text',model_info:{max_input_tokens:8000,supports_function_calling:true,input_cost_per_token:.00001,api_key:'fixture-secret'}}]});
      calls++;
      const body=await req.json();
      assert.equal(body.model,'test/text');
      assert.deepEqual(body.stream_options,{include_usage:true});
      return new Response('data: '+JSON.stringify({model:'upstream/test',choices:[{delta:{content:'Fixture'},finish_reason:'length'}]})+'\n\ndata: '+JSON.stringify({choices:[],usage:{prompt_tokens:12,completion_tokens:3,total_tokens:15,cost:.00013}})+'\n\ndata: [DONE]\n\n');
    }});
  try{
    const state=initial();
    state.settings.routing={maxRunUsd:.001};
    state.connections=[{id:'gateway',model:'test/text',provider:'litellm',mode:'vault',capability:{inputPrice:10,outputPrice:20,reportUsage:true}}];
    await request('workspace',{method:'PUT',body:{state,revision:0}});
    await request('vault/gateway',{method:'PUT',body:{provider:'litellm',key:'virtual-fixture-key'}});
    const catalog=await (await request('gateway-models',{method:'POST',body:{provider:'litellm',connectionId:'gateway',details:true}})).json();
    assert.deepEqual(catalog.catalog,[{id:'test/text',contextTokens:8000,tools:true,inputPrice:10}]);
    const run={connectionId:'gateway',model:'test/text',messages:[{role:'user',text:'hello'}],instruction:'',options:{maxOutput:2048,reportUsage:true}};
    assert.equal((await request('runs',{method:'POST',body:run})).status,422);
    assert.equal(calls,0);
    run.options.maxOutput=16;
    const stream=await request('runs',{method:'POST',body:run});
    assert.match(await stream.text(),/"total":15,"costUsd":0.00013.*"upstreamModel":"upstream\/test"/);
    const issued=await (await request('access-keys',{method:'POST'})).json();
    const headers={authorization:'Bearer '+issued.value};
    const models=await (await request('v1/models',{user:null,headers})).json();
    assert.deepEqual(models.data.map(model=>model.id),['gateway']);
    const input={model:'gateway',messages:[{role:'user',content:'hello'}],max_completion_tokens:16};
    const complete=await (await request('v1/chat/completions',{user:null,headers,method:'POST',body:input})).json();
    assert.equal(complete.choices[0].message.content,'Fixture');
    assert.equal(complete.choices[0].finish_reason,'length');
    assert.equal(complete.usage.total_tokens,15);
    const formatted=await request('v1/chat/completions',{user:null,headers,method:'POST',body:{...input,stream:true,stream_options:{include_usage:true}}});
    assert.match(await formatted.text(),/"finish_reason":"length"[\s\S]*"total_tokens":15[\s\S]*\[DONE\]/);
    assert.equal((await request('v1/chat/completions',{user:null,headers,method:'POST',body:{...input,model:'test/text'}})).status,404);
    assert.equal((await request('v1/models',{user:null})).status,401);
    assert.equal(calls,3);
  }finally{db.close();}
});

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
    assert.equal((await request('public-share/'+id+'/download',{user:null})).status,403);
    state.artifacts[0].text='second revision';
    await request('workspace',{method:'PUT',body:{state,revision:1}});
    await request('shares/'+id,{user:'bob',method:'DELETE'});
    assert.deepEqual(await (await request('public-share/'+id,{user:null})).json(),{title:'Document',text:'first revision'});
    await request('shares/'+id,{method:'DELETE'});
    assert.equal((await request('public-share/'+id,{user:null})).status,404);
  }finally{db.close();}
});

test('snapshot exports obey the chosen expiry and download policy',async()=>{
  const {db,request}=fixture();
  try{
    const state=initial();
    state.chats.push({id:'safe-chat',title:'Shared chat',messages:[{id:'user-turn',role:'user',text:'Fixture content'}]});
    assert.equal((await request('workspace',{method:'PUT',body:{state,revision:0}})).status,200);
    assert.equal((await request('shares',{method:'POST',body:{kind:'chat',id:'safe-chat',days:31,download:true}})).status,400);
    const {id,expires}=await (await request('shares',{method:'POST',body:{kind:'chat',id:'safe-chat',days:1,download:true}})).json();
    assert.ok(expires>Date.now()+86_390_000&&expires<=Date.now()+86_400_000);
    const response=await request('public-share/'+id+'/download',{user:null});
    assert.equal(response.status,200);
    assert.match(response.headers.get('content-disposition'),/^attachment;/);
    assert.match(await response.text(),/Fixture content/);
    db.prepare('UPDATE kapron_share SET expires=0 WHERE id=?').run(id);
    assert.equal((await request('public-share/'+id+'/download',{user:null})).status,404);
  }finally{db.close();}
});

test('hosted worker ignores forged Sites identity when independently configured',async()=>{
  const verified='8a103fae-f607-48bd-bbf4-4690d505a321';
  const {db,request}=fixture({KAPRON_SUPABASE_URL:'https://fixture.supabase.co',KAPRON_SUPABASE_KEY:'sb_publishable_fixture',AUTH_FETCH:async req=>{
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

test('JSON jobs select one branch, pause for owner approval and record one decision per gate',async()=>{
  const inputs=[];
  const {request,tick,db}=fixture({MODEL_FETCH:async outgoing=>{
    const input=await outgoing.json();
    inputs.push(input);
    return input.response_format?.type==='json_object'?packet('{"result":{"accepted":true}}'):packet('confirmed');
  }});
  try{
    const state=initial();
    state.connections=[{id:'source',provider:'openai',model:'fixture',mode:'vault'}];
    await request('workspace',{method:'PUT',body:{state,revision:0}});
    await request('vault/source',{method:'PUT',body:{provider:'openai',key:'fixture'}});
    const queued=await request('jobs',{method:'POST',body:{name:'Report fixture',connectionId:'source',policy:'fixed',nodes:[
      {type:'prompt',prompt:'Return the result as JSON',responseFormat:'json_object'},
      {type:'condition',match:'json',path:'result.accepted',equals:true,nodes:[
        {type:'approval',note:'Check the analysis'},
        {type:'approval',note:'Check the proposed deliverable'},
        {type:'prompt',prompt:'Only the accepted branch'}
      ],otherwise:[{type:'prompt',prompt:'Only the rejected branch'}]}
    ]}});
    assert.equal(queued.status,202);
    const {id}=await queued.json();
    const status=async()=>await (await request('jobs/'+id)).json();
    for(let n=0;n<3;n++)await tick();
    let run=await status();
    assert.equal(run.status,'awaiting_approval');
    assert.equal(run.cursor,2);
    assert.equal(inputs.length,1);
    const approve=(user,step)=>request('jobs/'+id,{user,method:'PATCH',body:{action:'approve',step}});
    assert.equal((await request('jobs/'+id,{user:'bob'})).status,404);
    assert.equal((await approve('bob',2)).status,409);
    const racing=await Promise.all([approve('alice',2),approve('alice',2)]);
    assert.deepEqual(racing.map(reply=>reply.status).sort(),[200,409]);
    await tick();
    run=await status();
    assert.equal(run.cursor,3);
    assert.equal(run.status,'awaiting_approval');
    assert.equal((await approve('alice',2)).status,409);
    assert.equal((await approve('alice',3)).status,200);
    for(let n=0;n<3;n++)await tick();
    run=await status();
    assert.equal(run.status,'completed');
    assert.deepEqual(run.outputs.filter(output=>output.decision).map(output=>output.step),[2,3]);
    assert.equal(inputs.length,2);
    assert.equal(inputs[1].messages.at(-1).content.includes('Only the accepted branch'),true);
    assert.deepEqual(inputs[0].response_format,{type:'json_object'});
    assert.equal((await request('jobs/'+id+'/replay',{user:'bob',method:'POST'})).status,404);
    const replay=await request('jobs/'+id+'/replay',{method:'POST'});
    assert.equal(replay.status,202);
    const newRun=await replay.json();
    assert.notEqual(newRun.id,id);
    assert.equal((await request('jobs/'+newRun.id+'/replay',{method:'POST'})).status,409);
    for(let n=0;n<3;n++)await tick();
    const pending=await (await request('jobs/'+newRun.id)).json();
    assert.equal(pending.status,'awaiting_approval');
    assert.equal(pending.definition.replayOf,id);
    assert.equal(pending.outputs.some(output=>output.decision),false);
  }finally{db.close();}
});

test('JSON mode validates complete objects and blocks malformed provider results',async()=>{
  let reply='{"valid":true}';
  const {request,db}=fixture({MODEL_FETCH:async outgoing=>{
    const input=await outgoing.json();
    assert.deepEqual(input.response_format,{type:'json_object'});
    assert.match(input.messages[0].content,/JSON object/);
    return packet(reply);
  }});
  try{
    const state=initial();
    state.connections=[{id:'source',provider:'openai',model:'fixture',mode:'vault'}];
    await request('workspace',{method:'PUT',body:{state,revision:0}});
    await request('vault/source',{method:'PUT',body:{provider:'openai',key:'fixture'}});
    const issued=await (await request('access-keys',{method:'POST'})).json();
    const headers={authorization:'Bearer '+issued.value};
    const execute=(response_format={type:'json_object'})=>request('v1/chat/completions',{method:'POST',headers,user:null,
      body:{model:'source',messages:[{role:'user',content:'Analyze this'}],response_format}});
    assert.equal((await execute({type:'json_schema'})).status,400);
    const result=await (await execute()).json();
    assert.deepEqual(JSON.parse(result.choices[0].message.content),{valid:true});
    reply='["not","an","object"]';
    const invalid=await execute();
    assert.equal(invalid.status,424);
    assert.match(await invalid.text(),/valid JSON object/);
  }finally{db.close();}
});

test('queued workflows resolve the retained Gem revision and ignore later edits',async()=>{
  const instructions=[];
  const {request,tick,db}=fixture({MODEL_FETCH:async outgoing=>{
    const input=await outgoing.json();
    instructions.push(input.messages[0].content);
    return packet('done');
  }});
  try{
    const state=initial();
    state.connections=[{id:'source',provider:'openai',model:'fixture',mode:'vault'}];
    state.gems=[{id:'g',version:1,name:'Versioned Gem',instructions:'Original instructions'}];
    await request('workspace',{method:'PUT',body:{state,revision:0}});
    await request('vault/source',{method:'PUT',body:{provider:'openai',key:'fixture'}});
    const run={name:'Pinned Gem fixture',connectionId:'source',policy:'fixed',nodes:[{type:'gem',gemId:'g',prompt:'Use the Gem'}]};
    assert.equal((await request('jobs',{method:'POST',body:run})).status,202);
    const old=state.gems[0];
    state.gems=[{...old,version:2,instructions:'Changed instructions',versions:[{version:1,config:old}]}];
    await request('workspace',{method:'PUT',body:{state,revision:1}});
    assert.equal((await request('jobs',{method:'POST',body:{...run,nodes:[{...run.nodes[0],gemVersion:5}]}})).status,400);
    assert.equal((await request('jobs',{method:'POST',body:{...run,nodes:[{...run.nodes[0],gemVersion:1}]}})).status,202);
    for(let n=0;n<4;n++)await tick();
    assert.equal(instructions.length,2);
    assert(instructions.every(text=>text.includes('Original instructions')&&!text.includes('Changed instructions')));
  }finally{db.close();}
});

test('research batches respect domain rules and retry only failed searches before compiling evidence',async()=>{
  const calls=[];
  let outage=true;
  const {db,request,tick}=fixture({MEDIA_FETCH:async req=>{
    assert.equal(req.url,'https://api.tavily.com/search');
    assert.equal(req.headers.get('authorization'),'Bearer research-fixture');
    const {query}=await req.json();
    calls.push(query);
    if(query==='second query'&&outage)return Response.json({},{status:503});
    return Response.json({results:[
      {url:'https://source.example/article?utm_campaign='+encodeURIComponent(query),title:'Preferred source',content:'Public evidence.',published_date:'2026-11-18T00:00:00Z'},
      {url:'https://news.example/report',title:'Second source',content:'Another excerpt.'},
      {url:'https://skip.source.example/private',title:'Blocked',content:'must stay out'},
      {url:'https://source.example.evil.test/spoof',title:'Lookalike',content:'must stay out'}
    ]});
  }});
  try{
    const headers={method:'POST',body:{kind:'research',question:'Research fixture',queries:['first query','second query'],
      domains:{allow:['source.example','news.example'],block:['skip.source.example'],prefer:['source.example']},
      useMemory:true,cloudRouting:true,input:'Private conversation draft'}};
    assert.equal((await request('jobs',{...headers,body:{...headers.body,domains:{allow:['https://source.example']}}})).status,400);
    await request('vault/search-tavily',{method:'PUT',body:{provider:'tavily',key:'research-fixture'}});
    const queued=await request('jobs',headers);
    assert.equal(queued.status,202);
    const {id}=await queued.json();
    await tick();
    const run=()=>request('jobs/'+id).then(reply=>reply.json());
    assert.equal((await run()).status,'blocked');
    assert.deepEqual(calls.sort(),['first query','second query']);
    assert.equal((await request('jobs/'+id,{user:'other'})).status,404);
    outage=false;
    await request('jobs/'+id,{method:'PATCH',body:{action:'resume'}});
    await tick();await tick();
    const complete=await run();
    assert.equal(complete.status,'completed');
    assert.equal(complete.definition.input,'');
    assert.equal(complete.definition.useMemory,false);
    assert.equal(calls.filter(query=>query==='first query').length,1);
    const report=complete.outputs.at(-1);
    assert.deepEqual(report.queries,['first query','second query']);
    assert.deepEqual(report.sources.map(source=>source.url),['https://source.example/article','https://news.example/report']);
    assert.match(report.text,/2026-11-18/);
    assert.doesNotMatch(report.text,/Blocked|Lookalike|utm_campaign|Private conversation draft/);
  }finally{db.close();}
});

test('integration response schemas validate fields and reject unsupported schemas before spending',async()=>{
  const calls=[];
  let output='{"items":[{"name":"alpha","count":2}]}';
  const {request,db}=fixture({MODEL_FETCH:async outgoing=>{
    calls.push(await outgoing.json());
    return packet(output);
  }});
  try{
    const state=initial();
    state.connections=[{id:'source',provider:'openai',model:'fixture',mode:'vault'}];
    await request('workspace',{method:'PUT',body:{state,revision:0}});
    await request('vault/source',{method:'PUT',body:{provider:'openai',key:'fixture'}});
    const key=(await (await request('access-keys',{method:'POST'})).json()).value;
    const schema={type:'object',required:['items'],additionalProperties:false,properties:{items:{type:'array',minItems:1,items:{
      type:'object',additionalProperties:false,required:['name','count'],properties:{name:{type:'string',minLength:1},count:{type:'integer',minimum:1}}
    }}}};
    const complete=(input=schema)=>request('v1/chat/completions',{user:null,headers:{authorization:'Bearer '+key},method:'POST',body:{
      model:'source',messages:[{role:'user',content:'Generate the report'}],response_format:{type:'json_schema',json_schema:{name:'report',schema:input,strict:true}}
    }});
    assert.equal((await complete({...schema,allOf:[]})).status,400);
    assert.equal(calls.length,0);
    const valid=await complete();
    assert.equal(valid.status,200);
    assert.equal((await valid.json()).choices[0].message.content,output);
    assert.match(calls[0].messages[0].content,/Match this JSON schema exactly/);
    output='{"items":[{"name":"alpha","count":"2"}]}';
    const mismatch=await complete();
    assert.equal(mismatch.status,424);
    assert.match(await mismatch.text(),/\/items\/0\/count/);
  }finally{db.close();}
});

test('concurrent Cowork submissions deduplicate by owner and enforce the pending capacity atomically',async()=>{
  const {request,db}=fixture();
  const body={kind:'task',name:'Test dedupe',policy:'fixed',connectionId:'demo',nodes:[{type:'prompt',prompt:'Run one task'}]};
  const post=(user,key,current=body)=>request('jobs',{user,method:'POST',headers:{'idempotency-key':key},body:current});
  try{
    const retries=await Promise.all(Array.from({length:8},()=>post('alice','same-request-key-01')));
    assert(retries.every(response=>response.status===202));
    const ids=await Promise.all(retries.map(response=>response.json().then(run=>run.id)));
    assert.equal(new Set(ids).size,1);
    assert.equal((await post('alice','same-request-key-01',{...body,name:'Different request'})).status,409);
    const other=await (await post('bob','same-request-key-01')).json();
    assert.notEqual(other.id,ids[0]);
    assert.equal((await post('alice','short')).status,400);
    const parallel=await Promise.all(Array.from({length:37},(_,i)=>post('alice','another-request-key-'+i)));
    assert.equal(parallel.filter(response=>response.status===202).length,29);
    assert.equal(parallel.filter(response=>response.status===429).length,8);
    assert.equal((await post('alice','same-request-key-01')).status,202);
  }finally{db.close();}
});
