import {useEffect,useState} from 'react';
import {get} from './api.js';
import {Modal} from './dialogs.jsx';

const collections = [
  ['chat','chats','Chat'],['project','projects','Project'],['gem','gems','Gem'],
  ['workflow','workflows','Workflow'],['artifact','artifacts','Canvas'],['file','files','File'],
  ['skill','skills','Skill'],['notebook','notebooks','Notebook'],['knowledge','knowledge','Knowledge'],['connection','connections','Model connection']
];
const searchable=value=>String(value??'').normalize('NFKC').toLocaleLowerCase();
const timestamp=value=>typeof value==='number'?value:Date.parse(value);

function entries(state, runs){
  const local=collections.flatMap(([kind,key,category])=>(state[key]??[]).map(item=>({
    item,kind,category,title:item.title??item.name??'Untitled',projectId:item.projectId??'',
    date:item.updated??item.created,body:[item.text,item.description,item.instructions,item.knowledge,...(kind==='notebook'?item.sources.map(source=>source.name+' '+source.notes):[]),...(item.labels??[]),...(item.messages??[]).map(message=>message.text)].filter(Boolean).join('\n')
  })));
  return [...local,...runs.map(item=>({item,kind:'run',category:'Run',title:item.definition.name,projectId:item.definition.projectId??'',
    date:item.updated??item.created,body:item.outputs.map(output=>output.text??'').join('\n')}))];
}

export function WorkspaceSearch({state,onOpen,onClose}){
  const [query,setQuery]=useState(''),[kind,setKind]=useState(''),[project,setProject]=useState(''),[since,setSince]=useState('');
  const [runs,setRuns]=useState([]),[runStatus,setRunStatus]=useState('Loading runs…');
  useEffect(()=>{
    const controller=new AbortController();
    get('jobs',{signal:controller.signal}).then(result=>{setRuns(result.runs);setRunStatus('');})
      .catch(()=>{if(!controller.signal.aborted)setRunStatus('Background runs are temporarily unavailable.');});
    return ()=>controller.abort();
  },[]);
  const terms=searchable(query).trim().split(/\s+/).filter(Boolean);
  const matches=entries(state,runs).filter(entry=>{
    if(kind&&entry.kind!==kind)return false;
    if(project&&entry.projectId!==project&&!(entry.kind==='project'&&entry.item.id===project))return false;
    if(since&&!(timestamp(entry.date)>=Date.parse(since)))return false;
    const title=searchable(entry.title),body=searchable(entry.body);
    return terms.every(term=>title.includes(term)||body.includes(term));
  }).sort((a,b)=>Number(searchable(b.title).includes(searchable(query).trim()))-Number(searchable(a.title).includes(searchable(query).trim()))
    || (timestamp(b.date)||0)-(timestamp(a.date)||0));
  return <Modal title="Search workspace" wide onClose={onClose}>
    <div className="modal-form">
      <label>Search workspace<input autoFocus value={query} onChange={event=>setQuery(event.target.value)} placeholder="Search chats, files, workflows and more"/></label>
      <div className="select-model">
        <label>Type<select value={kind} onChange={event=>setKind(event.target.value)}><option value="">All types</option>{collections.map(([key,,label])=><option key={key} value={key}>{label}</option>)}<option value="run">Run</option></select></label>
        <label>Project<select value={project} onChange={event=>setProject(event.target.value)}><option value="">All projects</option>{state.projects.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label>Updated since<input type="date" value={since} onChange={event=>setSince(event.target.value)}/></label>
      </div>
      {runStatus&&(!kind||kind==='run')&&<p className="hint">{runStatus}</p>}
      <div className="pick-list">
        {matches.slice(0,40).map(entry=><button type="button" className="pick-row" key={entry.kind+':'+entry.item.id} onClick={()=>onOpen(entry.kind,entry.item)}>
          <span><strong>{entry.title}</strong><small>{entry.category}{entry.item.archived?' · Archived':''}</small></span>
        </button>)}
        {!matches.length&&<p className="hint">No matches.</p>}
        {matches.length>40&&<p className="hint">Showing 40 of {matches.length} matches. Use filters to narrow the results.</p>}
      </div>
    </div>
  </Modal>;
}
