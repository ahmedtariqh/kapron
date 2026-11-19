import {useEffect,useState} from 'react';
import {get} from './api.js';
import {Modal} from './dialogs.jsx';

const showTime=timestamp=>new Date(timestamp).toLocaleString();

export function WorkflowTriggers({workflow,onClose}){
  const [status,setStatus]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [notice,setNotice]=useState(''),[newHook,setNewHook]=useState(null),[localTime,setLocalTime]=useState(''),[preview,setPreview]=useState(null);
  const path='workflow-triggers/'+workflow.id;
  async function reload(signal){
    setStatus(await get(path,{signal}));
  }
  useEffect(()=>{
    const controller=new AbortController();
    reload(controller.signal).catch(failure=>{if(!controller.signal.aborted)setError(failure.message);});
    return ()=>controller.abort();
  },[path]);
  async function apply(fn){
    setBusy(true);setError('');setNotice('');
    try{await fn();}catch(failure){setError(failure.message);}finally{setBusy(false);}
  }
  async function schedule(at){
    await get(path+'/once',{method:'PUT',body:{at}});
    setLocalTime('');
    await reload();
    setNotice(at===null?'One-time schedule canceled.':'One-time schedule saved.');
  }
  async function saveWebhook(){
    const created=await get(path+'/webhook',{method:'POST'});
    setNewHook(created);
    await reload();
    setNotice('Webhook created.');
  }
  return <Modal title="Workflow triggers" onClose={onClose}>
    <div className="modal-form">
      <h3>{workflow.name}</h3>
      {status?.interval&&<p>Every {status.interval.minutes} minutes. Next run {showTime(status.interval.nextAt)}.</p>}
      <form className="modal-form" onSubmit={event=>{event.preventDefault();apply(()=>schedule(new Date(localTime).getTime()));}}>
        <label>One-time run (local time)<input type="datetime-local" required value={localTime} onChange={event=>setLocalTime(event.target.value)}/></label>
        <div className="modal-actions">
          {status?.oneTimeAt&&<button type="button" className="button secondary" disabled={busy} onClick={()=>apply(()=>schedule(null))}>Cancel one-time run</button>}
          <button className="button primary" disabled={busy||!status}>Schedule once</button>
        </div>
      </form>
      {status?.oneTimeAt&&<p>One-time run scheduled for {showTime(status.oneTimeAt)}.</p>}
      <div className="form-divider"/>
      <h4>Webhook</h4>
      <p className="hint">This token can start this workflow and use its configured tools and model credits.</p>
      {status?.webhook&&<label>Webhook URL<input readOnly value={new URL('/api/hooks/'+status.webhook.id,location.origin).href}/></label>}
      {newHook&&<label>Webhook token · shown once<input readOnly value={newHook.token} onFocus={event=>event.target.select()}/></label>}
      <div className="modal-actions">
        {status?.webhook&&<button type="button" className="button secondary" disabled={busy} onClick={()=>apply(async()=>{
          await get(path+'/webhook',{method:'DELETE'});setNewHook(null);await reload();setNotice('Webhook revoked.');
        })}>Revoke webhook</button>}
        {!status?.webhook?<button type="button" className="button primary" disabled={busy||!status} onClick={()=>apply(saveWebhook)}>Create webhook</button>:
        <button type="button" className="button secondary" disabled={busy} onClick={()=>apply(saveWebhook)}>Rotate webhook</button>}
      </div>
      <div className="form-divider"/>
      <div className="modal-actions"><button type="button" className="button secondary" disabled={busy||!status} onClick={()=>apply(async()=>{
        setPreview(await get(path+'/preview',{method:'POST'}));
      })}>Dry-run plan</button></div>
      {preview&&<div><p>Connection {preview.connectionId} · {preview.policy} policy</p>
        <ol>{preview.steps.map((step,index)=><li key={index}>{step.label}{step.parallel?' · '+step.parallel+' parallel steps':''}</li>)}</ol></div>}
      {notice&&<p role="status">{notice}</p>}
      {error&&<p role="alert" className="form-error">{error}</p>}
    </div>
  </Modal>;
}
