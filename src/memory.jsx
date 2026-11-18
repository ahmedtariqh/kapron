import {useState} from 'react';
import {ArrowDown,Bookmark,Brain,Plus} from 'lucide-react';
import {Modal} from './dialogs.jsx';

export function MemoryManager({state,onEdit,onRemove,onMerge,onExport,onOpen}){
  const [scope,setScope]=useState('all'),[selection,select]=useState([]),[merge,setMerge]=useState(false);
  const [text,setText]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const entries=state.memory.filter(item=>scope==='all'||(item.projectId??'')===scope);
  const selected=entries.filter(item=>selection.includes(item.id));
  const projectName=projectId=>state.projects.find(item=>item.id===projectId)?.name??'Personal';
  const possible=selected.length>=2&&selected.every(item=>(item.projectId??'')===(selected[0].projectId??''));
  function toggle(id){
    select(list=>list.includes(id)?list.filter(item=>item!==id):[...list,id]);
  }
  return <>
    <div className="page-heading"><span className="page-icon"><Brain size={23}/></span><div><h1>Memory</h1><p>Manage the facts and preferences available to future chats.</p></div><button className="button primary" onClick={()=>onEdit()}><Plus size={17}/>Add memory</button></div>
    <div className="flow-row">
      <label>Scope<select value={scope} onChange={event=>{setScope(event.target.value);select([]);}}><option value="all">All scopes</option><option value="">Personal</option>{state.projects.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <button className="button secondary" disabled={!entries.length} onClick={()=>onExport(selected.length?selected:entries)}><ArrowDown size={16}/>Export memory</button>
      <button className="button secondary" disabled={!possible} onClick={()=>{setText(selected.map(item=>item.text).join('\n').slice(0,2000));setError('');setMerge(true);}}>Merge selected</button>
    </div>
    {!entries.length&&<p className="hint">No memory in this scope.</p>}
    <div className="card-grid">{entries.map((item,index)=>{
      const refs=new Set([item.id,...(item.mergedFrom??[])]);
      const uses=state.chats.flatMap(chat=>chat.messages.filter(message=>message.memoryIds?.some(id=>refs.has(id))).map(message=>({chat,message})));
      const usedChats=[...new Map(uses.map(use=>[use.chat.id,use.chat])).values()];
      const origins=(item.origins??[]).flatMap(origin=>{const chat=state.chats.find(chat=>chat.id===origin.id);return chat?[chat]:[];});
      return <article className="workspace-card" key={item.id}>
        <div className="card-head"><label className="checkbox"><input aria-label={'Select memory '+(index+1)} type="checkbox" checked={selection.includes(item.id)} onChange={()=>toggle(item.id)}/>{projectName(item.projectId)}</label>{item.pinned&&<Bookmark size={15} aria-label="Pinned"/>}</div>
        <p dir="auto">{item.text}</p>
        <small>{item.reason||'Saved manually'} · {uses.length} recorded chat {uses.length===1?'use':'uses'}</small>
        {origins.length>0&&<details><summary>Original chats</summary>{[...new Map(origins.map(chat=>[chat.id,chat])).values()].map(chat=><button key={chat.id} className="card-link" onClick={()=>onOpen('chat',chat)}>{chat.title}</button>)}</details>}
        {usedChats.length>0&&<details><summary>Chats that used this memory</summary>{usedChats.map(chat=><button key={chat.id} className="card-link" onClick={()=>onOpen('chat',chat)}>{chat.title}</button>)}</details>}
        <div className="flow-row"><button className="button secondary" onClick={()=>onEdit(item)}>Edit memory</button><button className="button secondary" onClick={()=>onRemove(item)}>Forget</button></div>
      </article>;
    })}</div>
    {merge&&<Modal title="Merge memory" onClose={()=>setMerge(false)}><form className="modal-form" onSubmit={async event=>{
      event.preventDefault();setBusy(true);setError('');
      try{await onMerge(selected,text.trim());select([]);setMerge(false);}
      catch(error){setError(error.message);}finally{setBusy(false);}
    }}>
      <label>Combined memory<textarea maxLength={2000} value={text} required autoFocus rows={6} onChange={event=>setText(event.target.value)}/></label>
      {error&&<p className="form-error" role="alert">{error}</p>}
      <div className="modal-actions"><button className="button primary" disabled={busy||!text.trim()}>Save combined memory</button></div>
    </form></Modal>}
  </>;
}
