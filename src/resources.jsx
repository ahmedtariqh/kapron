import {useEffect,useState} from 'react';
import {attachmentAccept,attachmentText,isPdf} from './attachments.js';
import {Modal} from './dialogs.jsx';
import {chooseModel,rulesDecision,taskFamilies} from '../server/routing.js';
import {estimateRun} from '../server/model-policy.js';
import {get} from './api.js';

export function RoutingSettings({state,settings,onClose,onSave,vaultAvailable}){
  const [cloud,setCloud]=useState(!!settings?.cloud),[laya,setLaya]=useState(settings?.laya??'');
  const [preference,setPreference]=useState(settings?.preference??'balanced');
  const [maxRunUsd,setMaxRunUsd]=useState(settings?.maxRunUsd?.toString()??'');
  const [cases,setCases]=useState(settings?.evaluationCases??[]),[results,setResults]=useState(null);
  const [quota,setQuota]=useState(null);
  const [key,setKey]=useState(''),[remove,setRemove]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  useEffect(()=>{
    const controller=new AbortController();
    get('model-quota',{signal:controller.signal}).then(setQuota).catch(()=>{});
    return ()=>controller.abort();
  },[]);
  return <Modal title="Auto routing" onClose={onClose}><form className="modal-form" onSubmit={async e=>{
    e.preventDefault();setError('');setBusy(true);
    try{
      if(laya.trim()){
        const url=new URL(laya.trim());
        if(url.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||url.pathname!=='/decide'||url.search||url.hash||url.username||url.password)
          throw new Error('Use the Laya companion’s loopback /decide URL.');
      }
      const budget=maxRunUsd===''?undefined:Number(maxRunUsd);
      if(budget!==undefined&&(!Number.isFinite(budget)||budget<0||budget>1000))throw new Error('Enter a per-call estimate limit from USD 0 to 1,000.');
      await onSave({...settings,cloud,preference,laya:laya.trim(),maxRunUsd:budget,evaluationCases:cases},key.trim(),remove);
    }catch(error){setError(error.message);setBusy(false);}
  }}>
    <label>Model preference<select value={preference} onChange={e=>{setPreference(e.target.value);setResults(null);}}>
      <option value="balanced">Balanced</option><option value="quality">Quality</option><option value="economy">Economy</option><option value="latency">Low latency</option>
    </select></label>
    <label>Maximum estimated USD per model call<input type="number" min="0" max="1000" step="0.000001" value={maxRunUsd} onChange={e=>{setMaxRunUsd(e.target.value);setResults(null);}} placeholder="No preflight limit"/></label>
    <p className="hint">Kapron checks the estimate before sending model context. Enter input and output prices on each connection you want to use. Provider billing can differ from estimates.</p>
    {quota?.limit!=null&&<p className="hint">Daily server model quota · {quota.used.toLocaleString()} of {quota.limit.toLocaleString()} request units reserved · {quota.day} UTC</p>}
    <details className="advanced"><summary>Routing evaluations</summary><p className="hint">Save test prompts and expected routes in this workspace. The dry run uses local rules and connection settings. It makes no provider calls.</p>
      {cases.map((item,index)=>{
        const update=patch=>{setCases(cases.map((entry,i)=>i===index?{...entry,...patch}:entry));setResults(null);};
        return <div className="modal-form" key={index}><label>Evaluation prompt {index+1}<textarea maxLength={1400} rows={2} value={item.prompt} onChange={e=>update({prompt:e.target.value})}/></label>
          <div className="select-model"><label>Expected family<select value={item.family} onChange={e=>update({family:e.target.value})}>{Object.keys(taskFamilies).map(name=><option key={name}>{name}</option>)}</select></label>
            <label>Expected connection<select value={item.connectionId} onChange={e=>update({connectionId:e.target.value})}><option value="">Any</option>{state.connections.map(connection=><option key={connection.id} value={connection.id}>{connection.name}</option>)}</select></label></div>
          {results?.[index]&&<p role="status">{results[index]}</p>}
          <button type="button" className="button secondary" onClick={()=>{setCases(cases.filter((_,i)=>i!==index));setResults(null);}}>Remove case {index+1}</button>
        </div>;
      })}
      <div className="flow-row"><button type="button" className="button secondary" disabled={cases.length>=10} onClick={()=>{setCases([...cases,{prompt:'',family:'general',connectionId:''}]);setResults(null);}}>Add evaluation case</button>
        <button type="button" className="button secondary" disabled={!cases.length} onClick={()=>setResults(cases.map(item=>{
          if(!item.prompt.trim())return 'Enter an evaluation prompt.';
          const {family}=rulesDecision(item.prompt,{skills:[],knowledge:[]});
          const context={messages:[{role:'user',text:item.prompt}],instruction:''};
          const limits={...state.settings.options,maxRunUsd:maxRunUsd===''?undefined:Number(maxRunUsd)};
          const options={...state.settings.options,maxOutput:state.settings.options?.maxOutput??2048};
          const available=state.connections.filter(c=>!estimateRun(c,c.model,context,options,limits).error);
          const connection=chooseModel(available,family,item.prompt.length+options.maxOutput*4,preference);
          const estimate=connection&&estimateRun(connection,connection.model,context,options,limits);
          const pass=family===item.family&&(!item.connectionId||connection?.id===item.connectionId);
          return (pass?'Pass':'Mismatch')+' · '+family+' · '+(connection?.model??'No matching connection')+(estimate?.estimatedUsd!==undefined?' · USD '+estimate.estimatedUsd.toFixed(6):'')+(connection?.capability?.latencyMs?' · reference '+connection.capability.latencyMs+' ms':'');
        }))}>Run routing evaluation</button></div>
    </details>
    <label className="checkbox"><input type="checkbox" checked={cloud} disabled={!vaultAvailable} onChange={e=>setCloud(e.target.checked)}/>Allow Jev via BeatAPI</label>
    <p className="hint">When enabled, BeatAPI receives a short excerpt of the current prompt and descriptions of eligible resources. File contents and saved memory stay out of this decision request.</p>
    <label>BeatAPI key<input type="password" autoComplete="off" disabled={!vaultAvailable||remove} value={key} maxLength={4000} onChange={e=>setKey(e.target.value)} placeholder="Leave blank to keep the saved key"/></label>
    <label className="checkbox"><input type="checkbox" checked={remove} disabled={!vaultAvailable} onChange={e=>setRemove(e.target.checked)}/>Remove saved BeatAPI key</label>
    <label>Local Laya URL<input type="url" value={laya} onChange={e=>setLaya(e.target.value)} placeholder="http://127.0.0.1:8765/decide"/></label>
    {error&&<p role="alert" className="form-error">{error}</p>}
    <div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={busy}>Save routing settings</button></div>
  </form></Modal>;
}

export function ResourceEditor({kind,entity,seed,state,onClose,onSave}){
  const [values,setValues]=useState({name:'',description:'',family:'general',projectId:'',text:'',enabled:true,...seed,...entity});
  const [error,setError]=useState(''),[busy,setBusy]=useState(false);
  const patch=(key,value)=>setValues(v=>({...v,[key]:value}));
  const skill=kind==='skill', title=skill?'skill':'knowledge source';
  return <Modal title={(entity?'Edit ':'Add ')+title} onClose={onClose}><form className="modal-form" onSubmit={async e=>{
    e.preventDefault();setBusy(true);setError('');
    try{
      if(!values.name.trim()||!values.text.trim())throw new Error('Enter a name and content.');
      await onSave({...values,name:values.name.trim(),projectId:values.projectId||null,version:(entity?.version??0)+1});
    }catch(err){setError(err.message);setBusy(false);}
  }}>
    <label>Name<input autoFocus required maxLength={80} value={values.name} onChange={e=>patch('name',e.target.value)}/></label>
    <label>Routing description<input maxLength={240} value={values.description} onChange={e=>patch('description',e.target.value)} placeholder="Describe when this resource applies"/></label>
    <label>Task family<select value={values.family} onChange={e=>patch('family',e.target.value)}>{Object.keys(taskFamilies).map(key=><option key={key}>{key}</option>)}</select></label>
    <label>Scope<select value={values.projectId??''} onChange={e=>patch('projectId',e.target.value)}><option value="">Workspace</option>{state.projects.map(x=><option value={x.id} key={x.id}>{x.name}</option>)}</select></label>
    <label>{skill?'Instructions':'Source text'}<textarea required rows={8} maxLength={40000} value={values.text} onChange={e=>patch('text',e.target.value)}/></label>
    {!skill&&<label>{KAPRON_MODULE_PDF?'Import text or PDF':'Import text'}<input type="file" accept={attachmentAccept} onChange={async e=>{
      const file=e.target.files?.[0];if(!file)return;
      try{
        if(!isPdf(file)&&file.size>40000)throw new Error(KAPRON_MODULE_PDF?'Choose a text file under 40 KB or a PDF under 12 MB.':'Choose a text file under 40 KB.');
        const text=await attachmentText(file,40000);
        setValues(v=>({...v,name:v.name||file.name.slice(0,80),text}));setError('');
      }catch(error){setError(error.message);}
    }}/></label>}
    <label className="checkbox"><input type="checkbox" checked={values.enabled} onChange={e=>patch('enabled',e.target.checked)}/>Eligible for automatic selection</label>
    {error&&<p role="alert" className="form-error">{error}</p>}
    <div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={busy}>Save {title}</button></div>
  </form></Modal>;
}
