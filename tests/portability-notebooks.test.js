import test from 'node:test';
import assert from 'node:assert/strict';
import {initial} from '../server/state.js';
import {dueStudyCards,findEvidence,notebookValid,reviewStudyCard} from '../server/notebooks.js';
import {exportWorkspace,restoreWorkspaceBackup} from '../src/workspace-backup.js';

test('workspace restore copies linked records without activating credentials, schedules, or cloud routing',()=>{
  const state=initial();
  state.connections=[{id:'gateway',provider:'litellm',name:'Gateway',mode:'vault',endpoint:'https://private.example'}];
  state.settings.defaultChoice={connectionId:'gateway',model:'alias'};
  state.projects=[{id:'project',name:'Project'}];
  state.gems=[{id:'gem',name:'Gem',choice:state.settings.defaultChoice}];
  state.chats=[{id:'chat',projectId:'project',messages:[{id:'message',role:'assistant',text:'Reply',gemId:'gem'}]},
    {id:'branch',projectId:'project',branchParent:{chatId:'chat',messageId:'message'},activeGemId:'gem',messages:[]}];
  state.files=[{id:'file',projectId:'project',name:'A file',text:'text'}];
  state.artifacts=[{id:'artifact',origin:{kind:'chat',id:'chat',messageId:'message'}}];
  state.goals=[{id:'goal',links:[{kind:'artifact',id:'artifact'},{kind:'run',id:'unavailable'}]}];
  state.workflows=[{id:'flow',projectId:'project',connectionId:'gateway',scheduleMinutes:60,cloudRouting:true,abliterated:true,
    nodes:[{type:'parallel',nodes:[{type:'file',fileId:'file'},{type:'gem',gemId:'gem'}]}]}];
  const archive=JSON.parse(JSON.stringify(exportWorkspace(state)));
  assert(!JSON.stringify(archive).includes('private.example'));
  let sequence=0;
  const copied=restoreWorkspaceBackup(state,archive,{restoreSettings:true,connectionMap:{gateway:'gateway'},id:()=> 'copy-'+ ++sequence});
  assert.equal(copied.projects.length,2);
  assert.notEqual(copied.projects[0].id,state.projects[0].id);
  assert.equal(copied.chats[0].projectId,copied.projects[0].id);
  assert.equal(copied.chats[1].branchParent.chatId,copied.chats[0].id);
  assert.equal(copied.chats[1].activeGemId,copied.gems[0].id);
  assert.equal(copied.chats[0].messages[0].gemId,copied.gems[0].id);
  assert.equal(copied.artifacts[0].origin.id,copied.chats[0].id);
  assert.equal(copied.artifacts[0].origin.messageId,'message');
  assert.deepEqual(copied.goals[0].links,[{kind:'artifact',id:copied.artifacts[0].id}]);
  assert.equal(copied.workflows[0].nodes[0].nodes[0].fileId,copied.files[0].id);
  assert.equal(copied.workflows[0].nodes[0].nodes[1].gemId,copied.gems[0].id);
  assert.equal(copied.workflows[0].scheduleMinutes,0);
  assert.equal(copied.workflows[0].cloudRouting,false);
  assert.equal(copied.settings.defaultChoice.connectionId,'gateway');
  assert.deepEqual(copied.connections,state.connections);
  assert.equal(restoreWorkspaceBackup(initial(),archive,{restoreSettings:true}).settings.defaultChoice.connectionId,'demo');
});

test('backup validation rejects ambiguous IDs, missing project dependencies and credential fields',()=>{
  const state=initial();
  const backup=exportWorkspace(state);
  assert.throws(()=>restoreWorkspaceBackup(state,{...backup,secret:'private'}),/credential/);
  assert.throws(()=>restoreWorkspaceBackup(state,{...backup,records:{projects:[{id:'same'},{id:'same'}]}}),/Invalid backup collection/);
  assert.throws(()=>restoreWorkspaceBackup(state,{...backup,records:{notebooks:[{id:'note',projectId:'other'}]}}),/missing project/);
  assert.equal(state.notebooks.length,0);
});

test('notebook evidence preserves verbatim multilingual quotes and excludes disabled sources',()=>{
  const sources=[
    {id:'a',name:'Included',enabled:true,text:'Heading.   القمر مرئي في المساء. The moon orbits Earth.',notes:''},
    {id:'b',name:'Disabled',enabled:false,text:'The Moon is purple.',notes:''}
  ];
  const result=findEvidence(sources,'أين القمر؟');
  assert.equal(result.length,1);
  assert.equal(result[0].quote,'القمر مرئي في المساء.');
  assert.equal(sources[0].text.slice(result[0].position,result[0].position+result[0].quote.length),result[0].quote);
  assert.deepEqual(findEvidence(sources,'purple'),[]);
  assert.deepEqual(findEvidence(sources,'please tell me'),[]);
  const notebook={id:'n',name:'Moon study',sources,history:[{id:'turn',question:'أين القمر؟',hits:result}],cards:[]};
  assert.equal(notebookValid(notebook),true);
  assert.equal(notebookValid({...notebook,sources:[...sources,sources[0]]}),false);
});

test('notebook card review schedules a sooner retry for missed excerpts',()=>{
  const time=1700000000000;
  const one={id:'one',question:'What changed?',answer:'The quarter changed.',sourceName:'Notes'};
  const passed=reviewStudyCard(one,true,time);
  const missed=reviewStudyCard({...one,id:'two'},false,time);
  assert.equal(passed.review.streak,1);
  assert.deepEqual(dueStudyCards([missed,passed],time),[]);
  assert.deepEqual(dueStudyCards([missed,passed],time+600000),[missed]);
  assert.equal(reviewStudyCard(passed,true,time).review.due,time+172800000);
});
