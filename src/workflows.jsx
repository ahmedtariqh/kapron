import {useEffect,useState} from 'react';
import {ArrowDown,ArrowUp,FileText,GitBranch,Play,Plus,Trash2} from 'lucide-react';
import {get} from './api.js';
import {Modal} from './dialogs.jsx';
import {isGateway} from '../server/providers.js';

const createStep=type=>({
  type,label:'',...(['prompt','gem','notebooklm'].includes(type)?{prompt:''}:{}),
  ...(['condition','loop','parallel'].includes(type)?{nodes:[{type:'prompt',prompt:'',label:''}]}:{}),
  ...(type==='condition'?{contains:''}:{}),...(type==='loop'?{count:2}:{})
});
const nodeTypes={prompt:'Prompt',gem:'Gem',file:'Project file',condition:'Condition',loop:'Repeat',parallel:'Parallel group',workflow:'Nested workflow',notebooklm:'Ask NotebookLM'};

function StepList({nodes,onChange,state,projectId,depth=0,parallel=false,notebooks,notebookError}){
  const patch=(i,value)=>onChange(nodes.map((node,index)=>i===index?{...node,...value}:node));
  function move(i,direction){
    const items=[...nodes], next=i+direction;
    [items[i],items[next]]=[items[next],items[i]];
    onChange(items);
  }
  const allowed=parallel?['prompt','gem','file','notebooklm']:depth>=4?['prompt','gem','file','workflow','notebooklm']:Object.keys(nodeTypes);
  return <div className="workflow-steps">
    {nodes.map((node,i)=><section className="review-card" key={i}>
      <div className="flow-row"><label>Step {i+1}<select value={node.type} onChange={e=>onChange(nodes.map((n,index)=>index===i?createStep(e.target.value):n))}>
        {allowed.map(type=><option key={type} value={type}>{nodeTypes[type]}</option>)}
      </select></label>
      <button type="button" className="icon-button" disabled={i===0} aria-label="Move step up" onClick={()=>move(i,-1)}><ArrowUp size={16}/></button>
      <button type="button" className="icon-button" disabled={i===nodes.length-1} aria-label="Move step down" onClick={()=>move(i,1)}><ArrowDown size={16}/></button>
      <button type="button" className="icon-button" aria-label="Remove step" disabled={nodes.length===1} onClick={()=>onChange(nodes.filter((_,index)=>index!==i))}><Trash2 size={15}/></button></div>
      <label>Step name<input value={node.label??''} placeholder={nodeTypes[node.type]} maxLength={80} onChange={e=>patch(i,{label:e.target.value})}/></label>
      {['prompt','gem'].includes(node.type)&&<label>Prompt<textarea required rows={3} value={node.prompt??''} maxLength={12000} onChange={e=>patch(i,{prompt:e.target.value})}/></label>}
      {node.type==='notebooklm'&&<>
        <label>Notebook<select required value={node.notebookId??''} onChange={e=>patch(i,{notebookId:e.target.value})}>
          <option value="">Choose an approved notebook</option>
          {node.notebookId&&!notebooks.some(n=>n.id===node.notebookId)&&<option value={node.notebookId}>{node.notebookId}</option>}
          {notebooks.map(n=><option key={n.id} value={n.id}>{n.title}</option>)}
        </select></label>
        <label>Question for NotebookLM<textarea required maxLength={6500} rows={3} value={node.prompt??''} onChange={e=>patch(i,{prompt:e.target.value})}/></label>
        <label className="checkbox"><input type="checkbox" checked={node.includeInput===true} onChange={e=>patch(i,{includeInput:e.target.checked})}/>Also send this run’s input to NotebookLM</label>
        {notebookError&&<p className="hint">{notebookError}</p>}
      </>}
      {node.type==='gem'&&<label>Gem<select required value={node.gemId??''} onChange={e=>patch(i,{gemId:e.target.value})}><option value="">Choose Gem</option>{state.gems.map(g=><option key={g.id} value={g.id}>{g.name}</option>)}</select></label>}
      {node.type==='file'&&<label>Project file<select required value={node.fileId??''} onChange={e=>patch(i,{fileId:e.target.value})}><option value="">Choose file</option>{state.files.filter(f=>projectId&&f.projectId===projectId&&!f.chatId).map(f=><option key={f.id} value={f.id}>{f.name}</option>)}</select></label>}
      {node.type==='workflow'&&<label>Workflow<select required value={node.workflowId??''} onChange={e=>patch(i,{workflowId:e.target.value})}><option value="">Choose workflow</option>{(state.workflows??[]).filter(w=>!w.projectId||w.projectId===projectId).map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</select></label>}
      {node.type==='condition'&&<label>Run these steps if the last output contains<input required maxLength={300} value={node.contains??''} onChange={e=>patch(i,{contains:e.target.value})}/></label>}
      {node.type==='loop'&&<label>Iterations<input required type="number" min="1" max="5" value={node.count} onChange={e=>patch(i,{count:Number(e.target.value)})}/></label>}
      {node.nodes&&<StepList nodes={node.nodes} onChange={items=>patch(i,{nodes:items})} depth={depth+1} parallel={node.type==='parallel'} state={state} projectId={projectId} notebooks={notebooks} notebookError={notebookError}/>}
    </section>)}
    <button type="button" className="button secondary" disabled={nodes.length>=(parallel?4:20)} onClick={()=>onChange([...nodes,createStep('prompt')])}><Plus size={16}/>Add step</button>
  </div>;
}

export function WorkflowEditor({entity,state,onClose,onSave,task=false,notebook=null}){
  const gatewayDefault=state.connections.find(c=>c.id===state.settings.defaultChoice?.connectionId&&c.mode==='vault'&&isGateway(c.provider));
  const [values,setValues]=useState({name:'',description:'',kind:task?'task':'workflow',projectId:'',policy:'fixed',connectionId:gatewayDefault?.id??'auto',
    useMemory:false,cloudRouting:false,abliterated:false,files:false,scheduleMinutes:'',nodes:[notebook?{...createStep('notebooklm'),notebookId:notebook.id}:createStep('prompt')],...(notebook?{name:'Ask '+notebook.title.slice(0,95)}:{}),...entity});
  const [error,setError]=useState(''),[busy,setBusy]=useState(false),[planning,setPlanning]=useState(false),[goal,setGoal]=useState('');
  const [notebooks,setNotebooks]=useState(notebook?[notebook]:[]),[notebookError,setNotebookError]=useState('');
  const needsNotebook=nodes=>Array.isArray(nodes)&&nodes.some(n=>n?.type==='notebooklm'||needsNotebook(n?.nodes));
  const usesNotebook=needsNotebook(values.nodes);
  useEffect(()=>{
    if(!usesNotebook)return;
    const controller=new AbortController();
    get('integrations/notebooklm',{signal:controller.signal}).then(result=>setNotebooks(result.notebooks),
      error=>{if(!controller.signal.aborted)setNotebookError(error.message);});
    return ()=>controller.abort();
  },[usesNotebook]);
  async function plan(){
    setError('');setPlanning(true);
    try{
      const result=await get('task-plan',{method:'POST',body:{goal,connectionId:values.connectionId}});
      patch('nodes',result.nodes);
    }catch(error){setError(error.message);}finally{setPlanning(false);}
  }
  const patch=(key,value)=>setValues(v=>({...v,[key]:value}));
  return <Modal wide title={task?'Plan a Cowork task':entity?'Edit workflow':'New workflow'} onClose={onClose}>
    <form className="modal-form" onSubmit={async e=>{
      e.preventDefault();setError('');setBusy(true);
      try{await onSave({...values,name:values.name.trim(),projectId:values.projectId||null,scheduleMinutes:Number(values.scheduleMinutes)||0});}
      catch(error){setError(error.message);setBusy(false);}
    }}>
      <label>{task?'Task name':'Workflow name'}<input required autoFocus maxLength={100} value={values.name} onChange={e=>patch('name',e.target.value)}/></label>
      <label>Project<select value={values.projectId??''} onChange={e=>patch('projectId',e.target.value)}><option value="">No project</option>{state.projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <div className="select-model"><label>Default connection<select value={values.connectionId} onChange={e=>patch('connectionId',e.target.value)}><option value="auto">Auto · vault connections</option><option value="demo">Kapron Demo</option>{state.connections.filter(c=>c.mode==='vault').map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label>Model conflicts<select value={values.policy} onChange={e=>patch('policy',e.target.value)}><option value="fixed">Use this workflow connection</option><option value="prefer-gem">Prefer Gem, then project</option><option value="prefer-project">Prefer project, then Gem</option></select></label></div>
      <div className="scope-grid">{[['useMemory','Include personal memory'],['cloudRouting','Allow Jev to classify step prompts'],['files','Include project files']].map(([key,label])=>
        <label className="checkbox" key={key}><input type="checkbox" checked={values[key]} onChange={e=>patch(key,e.target.checked)}/>{label}</label>)}</div>
      {values.cloudRouting&&<label className="checkbox"><input type="checkbox" checked={values.abliterated===true} onChange={e=>patch('abliterated',e.target.checked)}/>Allow Auto to select a vault Abliterated connection</label>}
      {!task&&<label>Run every (minutes)<input type="number" min="5" max="10080" value={values.scheduleMinutes||''} onChange={e=>patch('scheduleMinutes',e.target.value)} placeholder="Manual or API only"/></label>}
      {task&&<><label>Goal for the planner<textarea rows={4} maxLength={6000} value={goal} onChange={e=>setGoal(e.target.value)}/></label>
        <button type="button" className="button secondary" disabled={planning||!goal.trim()||values.connectionId==='auto'} onClick={plan}>{planning?'Drafting plan…':'Draft plan'}</button>
        <p className="hint">Select a vault connection or Demo to draft a plan, or enter steps directly. Review the steps before starting.</p></>}
      <StepList nodes={values.nodes} onChange={items=>patch('nodes',items)} state={state} projectId={values.projectId} notebooks={notebooks} notebookError={notebookError}/>
      {error&&<p className="form-error" role="alert">{error}</p>}
      <div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={busy||planning}>{task?'Start task':'Save workflow'}</button></div>
    </form>
  </Modal>;
}

export function Jobs({onCreate,onArtifact}){
  const [runs,setRuns]=useState([]),[error,setError]=useState(''),[selected,setSelected]=useState(null);
  useEffect(()=>{
    const controller=new AbortController();
    async function poll(){
      try{const result=await get('jobs',{signal:controller.signal});setRuns(result.runs);setError('');}
      catch(error){if(!controller.signal.aborted)setError(error.message);}
    }
    poll();
    const timer=setInterval(poll,2500);
    return ()=>{clearInterval(timer);controller.abort();};
  },[]);
  const run=runs.find(x=>x.id===selected);
  async function action(action){
    try{const result=await get('jobs/'+run.id,{method:'PATCH',body:{action}});setRuns(r=>r.map(x=>x.id===result.id?result:x));}
    catch(error){setError(error.message);}
  }
  return <><div className="page-heading"><span className="page-icon"><Play size={22}/></span><div><h1>Cowork & runs</h1><p>Check background progress and review completed outputs.</p></div><button className="button primary" onClick={onCreate}><Plus size={17}/>New task</button></div>
    {error&&<p className="form-error" role="alert">{error}</p>}
    {runs.length?<div className="pick-list">{runs.map(r=><button key={r.id} className={'pick-row'+(r.id===selected?' selected':'')} onClick={()=>setSelected(r.id)}><span className="mini-icon"><GitBranch size={16}/></span><span><strong>{r.definition.name}</strong><small>{r.status} · {r.cursor}/{r.definition.steps.length} steps</small></span></button>)}</div>:<p className="hint">No background runs yet.</p>}
    {run&&<section className="workspace-card run-card">
      <h2>{run.definition.name}</h2><p role="status">{run.status} · {run.cursor}/{run.definition.steps.length} steps</p>
      <div className="flow-row">
        {run.status==='queued'&&<button className="button secondary" onClick={()=>action('pause')}>Pause</button>}
        {['paused','blocked'].includes(run.status)&&<button className="button secondary" onClick={()=>action('resume')}>Resume</button>}
        {['queued','running','paused','blocked'].includes(run.status)&&<button className="button secondary" onClick={()=>action('cancel')}>Cancel run</button>}
      </div>
      {run.outputs.map((output,i)=><details className="advanced run-output" key={i} open={!!output.error}><summary>{output.label||'Step'} · {output.model||'Blocked'}</summary>{output.error?<p className="form-error">{output.error}</p>:<>
        <pre>{output.text}</pre><button className="button secondary" onClick={()=>onArtifact(output.label||run.definition.name,output.text)}><FileText size={15}/>Open in Canvas</button></>}</details>)}
    </section>}
  </>;
}
