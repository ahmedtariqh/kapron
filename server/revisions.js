const fields={
  gem:['name','description','instructions','knowledge','choice','options'],
  workflow:['name','description','kind','projectId','policy','connectionId','useMemory','cloudRouting','abliterated','files','nodes'],
  skill:['name','description','family','projectId','text','enabled']
};

export function revisionConfig(kind,record){
  return Object.fromEntries(fields[kind].filter(field=>Object.hasOwn(record,field)).map(field=>[field,record[field]]));
}

export function nextRevision(kind,previous,values,updated){
  const config=revisionConfig(kind,values);
  const prior=previous&&revisionConfig(kind,previous);
  const changed=previous&&JSON.stringify(prior)!==JSON.stringify(config);
  const version=previous?(previous.version??1)+Number(changed):1;
  const versions=(changed?[{version:previous.version??1,updated:previous.updated,config:prior},...(previous.versions??[])]:previous?.versions??[]).slice(0,5);
  while(versions.length&&JSON.stringify(versions).length>90000)versions.pop();
  const remainder=Object.fromEntries(Object.entries(previous??{}).filter(([field])=>!fields[kind].includes(field)));
  return {...remainder,...config,version,updated,versions};
}

export function revisionAt(kind,record,version){
  if(!record)return null;
  if(version===undefined||version===(record.version??1))return {...revisionConfig(kind,record),id:record.id,version:record.version??1};
  const snapshot=Array.isArray(record.versions)&&record.versions.find(entry=>entry.version===version);
  return snapshot?.config?{...revisionConfig(kind,snapshot.config),id:record.id,version:snapshot.version}:null;
}

export function revisionHistoryValid(record){
  const history=record.versions;
  if(history===undefined)return true;
  return Array.isArray(history)&&history.length<=5&&JSON.stringify(history).length<=90000&&
    history.every(item=>item&&Number.isSafeInteger(item.version)&&item.version>0&&item.version<(record.version??1)&&
      item.config&&typeof item.config==='object'&&!Array.isArray(item.config))&&
    new Set(history.map(item=>item.version)).size===history.length;
}
