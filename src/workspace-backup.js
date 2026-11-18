const format='kapron-workspace-v1';
const fields=['projects','chats','gems','memory','files','skills','knowledge','workflows','artifacts','goals','notebooks'];
const safeId=value=>typeof value==='string'&&/^[a-zA-Z0-9-]{1,80}$/.test(value);
const sensitive=/"(?:apiKey|api_key|token|deviceKey|secret|authorization)"\s*:/i;

export function exportWorkspace(state){
  return {
    format,
    exportedAt:new Date().toISOString(),
    records:Object.fromEntries(fields.map(field=>[field,state[field]??[]])),
    settings:{memoryEnabled:state.settings.memoryEnabled!==false,defaultChoice:state.settings.defaultChoice},
    connections:state.connections.map(({id,provider,name})=>({id,provider,name}))
  };
}

export function inspectWorkspaceBackup(backup){
  if(backup?.format!==format||!backup.records||typeof backup.records!=='object'||!Array.isArray(backup.connections)||backup.connections.length>250)
    throw new Error('Choose a Kapron workspace backup.');
  if(sensitive.test(JSON.stringify(backup)))throw new Error('The backup contains credential fields.');
  const counts={};
  for(const field of fields){
    const entries=backup.records[field]??[];
    if(!Array.isArray(entries)||entries.length>250||entries.some(entry=>!safeId(entry?.id))||new Set(entries.map(entry=>entry.id)).size!==entries.length)
      throw new Error('Invalid backup collection '+field+'.');
    counts[field]=entries.length;
  }
  if(backup.connections.some(connection=>!safeId(connection?.id)||typeof connection.provider!=='string')||
    new Set(backup.connections.map(connection=>connection.id)).size!==backup.connections.length)
    throw new Error('Invalid backup connection references.');
  return counts;
}

export function restoreWorkspaceBackup(state,backup,{restoreSettings=false,connectionMap={},id=()=>crypto.randomUUID()}={}){
  const counts=inspectWorkspaceBackup(backup);
  const maps=Object.fromEntries(fields.map(field=>[field,new Map((backup.records[field]??[]).map(entry=>[entry.id,id()]))]));
  const refs=new Map(backup.connections.map(connection=>[connection.id,connection.provider]));
  const ref=(field,value)=>(Object.hasOwn(maps,field)?maps[field].get(value):null)??null;
  const connection=value=>{
    if(value==='demo'||value==='auto')return value;
    const target=Object.hasOwn(connectionMap,value)?connectionMap[value]:null;
    return refs.has(value)&&state.connections.some(entry=>entry.id===target&&entry.provider===refs.get(value))?target:null;
  };
  const choice=value=>{
    const connectionId=connection(value?.connectionId);
    return connectionId&&typeof value.model==='string'?{connectionId,model:value.model}:null;
  };
  const kinds={chat:'chats',artifact:'artifacts',workflow:'workflows'};
  const link=value=>value&&Object.hasOwn(kinds,value.kind)&&ref(kinds[value.kind],value.id)?{...value,id:ref(kinds[value.kind],value.id)}:null;
  function node(value,depth=0){
    if(!value||typeof value!=='object'||depth>6)throw new Error('Invalid workflow steps in the backup.');
    const result={...value};
    for(const [property,field] of [['gemId','gems'],['fileId','files'],['workflowId','workflows']]){
      if(value[property])result[property]=ref(field,value[property]);
    }
    for(const field of ['nodes','otherwise']){
      if(Array.isArray(value[field]))result[field]=value[field].map(item=>node(item,depth+1));
    }
    return result;
  }
  function record(field,value,snapshot=false){
    const result={...value};
    if(!snapshot)result.id=ref(field,value.id);
    if(!snapshot&&['gems','workflows','skills'].includes(field)&&Array.isArray(value.versions)){
      result.versions=value.versions.map(revision=>({...revision,config:record(field,revision.config,true)}));
    }
    if(value.projectId){
      result.projectId=ref('projects',value.projectId);
      if(!result.projectId)throw new Error('A backup record refers to a missing project. Restore a complete backup.');
    }
    if('choice' in value)result.choice=choice(value.choice);
    if('origin' in value)result.origin=link(value.origin);
    if(field==='projects'){
      if(value.parentId)result.parentId=ref('projects',value.parentId);
      if(Array.isArray(value.gemIds))result.gemIds=value.gemIds.map(gemId=>ref('gems',gemId)).filter(Boolean);
    }
    if(field==='files'&&value.chatId){
      result.chatId=ref('chats',value.chatId);
      if(!result.chatId)throw new Error('An attachment refers to a missing chat.');
    }
    if(field==='memory'){
      if(Array.isArray(value.origins))result.origins=value.origins.map(link).filter(Boolean);
      if(Array.isArray(value.mergedFrom))result.mergedFrom=value.mergedFrom.map(memoryId=>ref('memory',memoryId)).filter(Boolean);
    }
    if(field==='chats'){
      result.activeGemId=ref('gems',value.activeGemId);
      if(value.contextPrefs&&typeof value.contextPrefs==='object')result.contextPrefs=Object.fromEntries(Object.entries(value.contextPrefs).flatMap(([key,settings])=>{
        const gem=key==='main'?key:ref('gems',key);
        return gem?[[gem,settings]]:[];
      }));
      const parent=ref('chats',value.branchParent?.chatId);
      result.branchParent=parent?{chatId:parent,messageId:value.branchParent.messageId}:null;
      if(Array.isArray(value.messages))result.messages=value.messages.map(message=>{
        const next={...message};
        if(message?.gemId)next.gemId=ref('gems',message.gemId);
        if(message?.choice)next.choice=choice(message.choice);
        if(message?.connectionId)next.connectionId=connection(message.connectionId);
        if(Array.isArray(message?.memoryIds))next.memoryIds=message.memoryIds.map(memoryId=>ref('memory',memoryId)).filter(Boolean);
        return next;
      });
    }
    if(field==='goals')result.links=(value.links??[]).map(link).filter(Boolean);
    if(field==='workflows'){
      const mapped=connection(value.connectionId);
      result.connectionId=mapped&&state.connections.some(entry=>entry.id===mapped&&entry.mode==='vault')?mapped:'demo';
      if(!snapshot)result.scheduleMinutes=0;
      result.cloudRouting=false;
      result.abliterated=false;
      if(Array.isArray(value.nodes))result.nodes=value.nodes.map(item=>node(item));
    }
    return result;
  }
  const next={...state};
  for(const field of fields){
    const existing=state[field]??[];
    if(existing.length+counts[field]>250)throw new Error('Restoring this backup would exceed the '+field+' limit.');
    next[field]=[...(backup.records[field]??[]).map(value=>record(field,value)),...existing];
  }
  if(restoreSettings){
    next.settings={...state.settings,memoryEnabled:backup.settings?.memoryEnabled!==false,
      defaultChoice:choice(backup.settings?.defaultChoice)??{connectionId:'demo',model:'local-demo'}};
  }
  if(new TextEncoder().encode(JSON.stringify(next)).length>799900)throw new Error('Restoring this backup would exceed the workspace storage limit.');
  return next;
}
