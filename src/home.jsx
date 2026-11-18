import {useEffect,useState} from 'react';
import {ArrowRight,Folder} from 'lucide-react';
import {get} from './api.js';

const actions={awaiting_approval:'Approval requested',blocked:'Review blocked run',failed:'Inspect failed run',paused:'Review paused run'};
const last=(items,limit=6)=>[...items].sort((a,b)=>new Date(b.updated??b.created??0)-new Date(a.updated??a.created??0)).slice(0,limit);

function List({title,items,empty,onOpen}){
  return <section className="workspace-card">
    <h2>{title}</h2>
    <div className="pick-list">{items.map(({kind,item,title,detail})=><button key={kind+':'+item.id} type="button" className="pick-row" onClick={()=>onOpen(kind,item)}>
      <span><strong>{title}</strong>{detail&&<small>{detail}</small>}</span><ArrowRight size={16}/>
    </button>)}</div>
    {!items.length&&<p className="hint">{empty}</p>}
  </section>;
}

export function Home({state,onOpen,onNewChat}){
  const [runs,setRuns]=useState([]),[error,setError]=useState(''),[loading,setLoading]=useState(true);
  useEffect(()=>{
    const controller=new AbortController();
    async function refresh(){
      try{const value=await get('jobs',{signal:controller.signal});setRuns(value.runs);setError('');}
      catch(error){if(!controller.signal.aborted)setError(error.message);}
      finally{if(!controller.signal.aborted)setLoading(false);}
    }
    refresh();
    const interval=setInterval(refresh,10000);
    return ()=>{clearInterval(interval);controller.abort();};
  },[]);
  const runEntry=item=>({kind:'run',item,title:item.definition.name,detail:actions[item.status]??item.status});
  const chats=last(state.chats.filter(item=>!item.archived)).map(item=>({kind:'chat',item,title:item.title}));
  const work=last([
    ...state.files.filter(item=>!item.chatId).map(item=>({kind:'file',item,title:item.name,detail:'File'})),
    ...(state.artifacts??[]).map(item=>({kind:'artifact',item,title:item.name,detail:'Canvas'})),
    ...(state.workflows??[]).map(item=>({kind:'workflow',item,title:item.name,detail:'Workflow'}))
  ].map(entry=>({...entry,created:entry.item.created,updated:entry.item.updated})));
  const emptyRuns=loading?'Loading runs…':error?'Runs are temporarily unavailable.':'No runs yet.';
  return <>
    <div className="page-heading"><span className="page-icon"><Folder size={23}/></span><div><h1>Home</h1><p>Pick up recent work and check background runs.</p></div><button className="button primary" onClick={onNewChat}>Start a chat</button></div>
    {error&&<p role="alert" className="form-error">{error}</p>}
    <div className="card-grid">
      <List title="Needs attention" items={runs.filter(item=>actions[item.status]).map(runEntry)} empty={loading||error?emptyRuns:'You’re caught up.'} onOpen={onOpen}/>
      <List title="Recent chats" items={chats} empty="Your saved chats will appear here." onOpen={onOpen}/>
      <List title="Recent work" items={work} empty="Saved files, artifacts, and workflows will appear here." onOpen={onOpen}/>
      <List title="Recent runs" items={runs.slice(0,6).map(runEntry)} empty={emptyRuns} onOpen={onOpen}/>
    </div>
  </>;
}
