import assert from 'node:assert/strict';
import test from 'node:test';
import {initial,assembleContext,historyBudget} from '../server/state.js';
import {exportChatBundle,findChats,importChatBundle} from '../src/chat-library.js';

test('chat bundles round-trip branches and attachments using fresh workspace IDs',()=>{
  const state=initial();
  const common={id:'shared-turn',role:'user',text:'Shared turn'};
  state.chats=[
    {id:'original',title:'Original',projectId:'project',choice:{connectionId:'secret-connection'},messages:[common,{id:'base-prompt',role:'user',text:'Original prompt'}]},
    {id:'branch',title:'Branch',branchParent:{chatId:'original',messageId:'base-prompt'},labels:['Design'],pinned:true,messages:[common,{id:'edit',role:'user',text:'Edited prompt'}]},
    {id:'other',title:'Unrelated',messages:[]}
  ];
  state.files=[{id:'attachment',chatId:'branch',name:'evidence.txt',text:'Evidence'},{id:'project-file',projectId:'project',name:'private.txt',text:'Project file'}];
  const selected=exportChatBundle(state,['branch']);
  assert.deepEqual(selected.chats.map(chat=>chat.id),['original','branch']);
  assert.equal(selected.attachments.length,1);
  assert.doesNotMatch(JSON.stringify(selected),/secret-connection|private.txt|projectId/);
  const result=importChatBundle(selected,state);
  const [original,branch]=result.next.chats;
  assert.notEqual(original.id,'original');
  assert.equal(original.messages[0].id,branch.messages[0].id);
  assert.deepEqual(branch.branchParent,{chatId:original.id,messageId:original.messages[1].id});
  assert.equal(result.next.files.at(-1).chatId,branch.id);
  assert.equal(result.next.chats.length,5);
  assert.equal(findChats([original,branch],{query:'edited prompt',status:'pinned',label:'Design'})[0].id,branch.id);
  assert.throws(()=>importChatBundle({...selected,attachments:[{chatId:'missing'}]},state),/invalid attachment/);
});

test('ChatGPT imports only visible text from the active branch',()=>{
  const document=[{id:'external',current_node:'answer',title:'Imported',mapping:{
    start:{parent:null,message:{author:{role:'system'},content:{parts:['hidden instructions']}}},
    prompt:{parent:'start',message:{author:{role:'user'},content:{parts:['question',{}]}}},
    answer:{parent:'prompt',message:{author:{role:'assistant'},content:{parts:['answer']}}},
    sibling:{parent:'prompt',message:{author:{role:'assistant'},content:{parts:['unused sibling']}}}
  }}];
  const result=importChatBundle(document,initial());
  assert.deepEqual(result.next.chats[0].messages.map(m=>m.text),['question','answer']);
  document[0].mapping.start.parent='answer';
  assert.throws(()=>importChatBundle(document,initial()),/invalid message tree/);
});

test('context budget protects recent turns, optional older excerpts and opted-in pinned facts',()=>{
  const state=initial();
  const chat={messages:Array.from({length:6},(_,i)=>({role:i%2?'assistant':'user',text:i+' '.repeat(1)+'x'.repeat(850)})),historyChars:2000,compactHistory:true,pinnedFacts:'Remember this fact'};
  const preview=historyBudget(chat,'next');
  assert.equal(preview.omitted,3);
  assert.equal(preview.compacted,1);
  assert.ok(preview.characters<=2000);
  assert.match(preview.messages[0].text,/Older conversation excerpts/);
  assert.match(preview.messages.at(-1).text,/^5 /);
  const context=assembleContext(state,chat,null,{history:true},'next');
  assert.match(context.instruction,/Remember this fact/);
  const isolated=assembleContext(state,chat,null,{history:false},'next');
  assert.doesNotMatch(isolated.instruction,/Remember this fact/);
  assert.equal(isolated.messages.length,1);
  assert.deepEqual(assembleContext(state,chat,null,{},'next'),isolated);
});
