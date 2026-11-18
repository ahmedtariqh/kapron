import {useEffect,useState} from 'react';
import {Target} from 'lucide-react';
import {get} from './api.js';
import {Modal} from './dialogs.jsx';

const statuses={active:'Active',paused:'Paused',done:'Completed'};
const newMilestone=()=>({id:crypto.randomUUID(),title:'',date:'',done:false});

function availableLinks(state,runs){
  return [
    ['chat',state.chats,'Chat'],['artifact',state.artifacts??[],'Canvas'],['workflow',state.workflows??[],'Workflow'],
    ['run',runs.map(run=>({...run,name:run.definition.name,projectId:run.definition.projectId})),'Run']
  ].flatMap(([kind,items,label])=>items.map(item=>({kind,item,label,name:item.title??item.name,key:kind+':'+item.id})));
}

export function Goals({state,onOpen,onSave}){
  const [scope,setScope]=useState(''),[draft,setDraft]=useState(null),[runs,setRuns]=useState([]);
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  useEffect(()=>{
    const controller=new AbortController();
    get('jobs',{signal:controller.signal}).then(result=>setRuns(result.runs)).catch(()=>{});
    return ()=>controller.abort();
  },[]);
  const goals=(state.goals??[]).filter(goal=>!scope||goal.projectId===scope);
  const links=availableLinks(state,runs);
  const displayLink=link=>links.find(entry=>entry.kind===link.kind&&entry.item.id===link.id);
  function open(goal){
    setError('');
    setDraft(goal??{title:'',description:'',status:'active',projectId:scope,due:'',milestones:[],links:[]});
  }
  function patch(values){setDraft(current=>({...current,...values}));}
  async function persist(goal){
    setBusy(true);setError('');
    try{await onSave(goal);setDraft(null);}
    catch(failure){setError(failure.message);}
    finally{setBusy(false);}
  }
  return <>
    <div className="page-heading"><span className="page-icon"><Target size={22}/></span><div><h1>Goals</h1><p>Track objectives, milestones, and related work.</p></div>
      <button className="button primary" onClick={()=>open(null)}>New goal</button>
    </div>
    <label>Filter goals by project<select value={scope} onChange={event=>setScope(event.target.value)}><option value="">All projects</option>{state.projects.map(project=><option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
    {!goals.length&&<p className="hint">No goals yet.</p>}
    {error&&!draft&&<p role="alert" className="form-error">{error}</p>}
    <div className="card-grid">{goals.map(goal=>{
      const done=goal.milestones.filter(milestone=>milestone.done).length;
      return <article key={goal.id} className="workspace-card">
        <h2>{goal.title}</h2><p>{goal.description}</p>
        <div className="flow-row"><small>{statuses[goal.status]}{goal.due?' · Due '+goal.due:''}</small><button className="plain-button" onClick={()=>open(goal)}>Edit goal</button></div>
        {!!goal.milestones.length&&<><progress aria-label={goal.title+' progress'} value={done} max={goal.milestones.length}/><small>{done} of {goal.milestones.length} milestones complete</small>
          {goal.milestones.map(milestone=><label key={milestone.id} className="checkbox"><input type="checkbox" checked={milestone.done} disabled={busy} onChange={event=>persist({id:goal.id,toggleMilestone:{id:milestone.id,done:event.target.checked}})}/>{milestone.title}{milestone.date?' · '+milestone.date:''}</label>)}</>}
        {goal.links.map(link=>{
          const entry=displayLink(link);
          return entry?<button className="plain-button" key={entry.key} onClick={()=>onOpen(entry.kind,entry.item)}>{entry.label} · {entry.name}</button>:<small key={link.kind+':'+link.id}>Linked {link.kind} unavailable</small>;
        })}
      </article>;
    })}</div>
    {draft&&<Modal title={draft.id?'Edit goal':'New goal'} wide onClose={()=>setDraft(null)}>
      <form className="modal-form" onSubmit={event=>{event.preventDefault();persist({...draft,title:draft.title.trim(),milestones:draft.milestones.map(item=>({...item,title:item.title.trim()}))});}}>
        <label>Goal title<input autoFocus required maxLength={120} value={draft.title} onChange={event=>patch({title:event.target.value})}/></label>
        <label>Outcome<textarea rows={3} maxLength={4000} value={draft.description} onChange={event=>patch({description:event.target.value})}/></label>
        <div className="select-model">
          <label>Project<select value={draft.projectId??''} onChange={event=>patch({projectId:event.target.value})}><option value="">No project</option>{state.projects.map(project=><option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
          <label>Goal status<select value={draft.status} onChange={event=>patch({status:event.target.value})}>{Object.entries(statuses).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
          <label>Due date<input type="date" value={draft.due} onChange={event=>patch({due:event.target.value})}/></label>
        </div>
        {draft.milestones.map((milestone,index)=>{
          const update=values=>patch({milestones:draft.milestones.map(item=>item.id===milestone.id?{...item,...values}:item)});
          return <div className="select-model" key={milestone.id}><label>Milestone {index+1}<input required maxLength={120} value={milestone.title} onChange={event=>update({title:event.target.value})}/></label>
            <label>Checkpoint date<input type="date" value={milestone.date} onChange={event=>update({date:event.target.value})}/></label>
            <button type="button" className="plain-button" onClick={()=>patch({milestones:draft.milestones.filter(item=>item.id!==milestone.id)})}>Remove milestone {index+1}</button></div>;
        })}
        <button type="button" className="button secondary" disabled={draft.milestones.length>=25} onClick={()=>patch({milestones:[...draft.milestones,newMilestone()]})}>Add milestone</button>
        <label>Link work<select value="" disabled={draft.links.length>=25} onChange={event=>{
          const entry=links.find(item=>item.key===event.target.value);
          if(entry)patch({links:[...draft.links,{kind:entry.kind,id:entry.item.id}]});
        }}><option value="">Choose work</option>{links.filter(entry=>!draft.links.some(link=>link.kind===entry.kind&&link.id===entry.item.id)).map(entry=><option key={entry.key} value={entry.key}>{entry.label} · {entry.name}</option>)}</select></label>
        {draft.links.map(link=><button type="button" className="plain-button" key={link.kind+':'+link.id} onClick={()=>patch({links:draft.links.filter(item=>item!==link)})}>Unlink {displayLink(link)?.name??link.kind}</button>)}
        {error&&<p role="alert" className="form-error">{error}</p>}
        <button className="button primary" disabled={busy||!draft.title.trim()||draft.milestones.some(item=>!item.title.trim())}>Save goal</button>
      </form>
    </Modal>}
  </>;
}
