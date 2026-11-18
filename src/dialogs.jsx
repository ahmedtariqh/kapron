import {useEffect,useRef,useState} from 'react';
import {ArrowRight,Check,Gem,GitBranch,KeyRound,Layers3,MessageSquare,Settings2,X} from 'lucide-react';
import {autoConnection,taskFamilies} from '../server/routing.js';
import {providers,isGateway} from '../server/providers.js';
import {get} from './api.js';
import {defaultContext,demoConnection,getConnection,modelOptions,sameChoice} from '../server/state.js';

export function Modal({title,eyebrow,children,onClose,wide=false}){
  const ref=useRef(null);
  useEffect(()=>{const node=ref.current;node.showModal();return()=>node.close();},[]);
  return <dialog className={'modal'+(wide?' wide':'')} ref={ref} onCancel={e=>{e.preventDefault();onClose();}} onClick={e=>{if(e.target===e.currentTarget){const b=e.currentTarget.getBoundingClientRect();if(e.clientX<b.left||e.clientX>b.right||e.clientY<b.top||e.clientY>b.bottom)onClose();}}}>
    <div className="modal-head"><div>{eyebrow&&<p className="eyebrow">{eyebrow}</p>}<h2>{title}</h2></div><button className="icon-button" aria-label="Close dialog" onClick={onClose}><X size={18}/></button></div>
    {children}
  </dialog>;
}
export function SelectModel({state,value,onChange,inherit=true}){
  const id=value?.connectionId??'';
  const selected=getConnection(state,id);
  return <div className="select-model">
    <label>Connection<select value={id} onChange={e=>{
      const c=getConnection(state,e.target.value);
      onChange(c?{connectionId:c.id,model:c.model}:null);
    }}>{inherit&&<option value="">Inherit model</option>}{[autoConnection,demoConnection,...state.connections].map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
    {selected&&!['demo','auto'].includes(selected.provider)&&<label>Model ID<input required maxLength={160} value={value.model} onChange={e=>onChange({...value,model:e.target.value})} placeholder={selected.model}/></label>}
  </div>;
}
function FormActions({onClose,children='Save',busy=false}){
  return <div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={busy}>{busy?'Saving…':children}</button></div>;
}
export function EntityEditor({type,entity,state,onSave,onClose}){
  const [name,setName]=useState(entity?.name||entity?.title||'');
  const [description,setDescription]=useState(entity?.description||'');
  const [instructions,setInstructions]=useState(entity?.instructions||'');
  const [knowledge,setKnowledge]=useState(entity?.knowledge||'');
  const [choice,setChoice]=useState(entity?.choice??null);
  const [memory,setMemory]=useState(entity?.memoryEnabled!==false);
  const [projectId,setProjectId]=useState(entity?.projectId??'');
  const [temperature,setTemp]=useState(entity?.options?.temperature??'');
  const [maxOutput,setMax]=useState(entity?.options?.maxOutput??'');
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const chat=type==='chat', project=type==='project',gem=type==='gem';
  const label=project?'project':gem?'Gem':'chat';
  const submit=async e=>{
    e.preventDefault();if(!name.trim())return;setBusy(true);setError('');
    try{
      const options={...(temperature!==''?{temperature:Number(temperature)}:{}),...(maxOutput!==''?{maxOutput:Number(maxOutput)}:{})};
      await onSave(chat?{title:name.trim(),projectId:projectId||null,choice,options}:project?{name:name.trim(),description,instructions,choice,memoryEnabled:memory,options}:{name:name.trim(),description,instructions,knowledge,choice,options});
    }catch(e){setError(e.message);setBusy(false);}
  };
  return <Modal title={(entity?'Edit ':'New ')+label} eyebrow={project?'WORKSPACE':gem?'REUSABLE ASSISTANT':'CONVERSATION'} onClose={onClose}>
    <form className="modal-form" onSubmit={submit}>
      <label>{chat?'Chat title':label[0].toUpperCase()+label.slice(1)+' name'}<input autoFocus required maxLength={80} value={name} onChange={e=>setName(e.target.value)} placeholder={project?'e.g. Product research':gem?'e.g. Research partner':'New chat'}/></label>
      {!chat&&<label>Description<input value={description} maxLength={180} onChange={e=>setDescription(e.target.value)} placeholder="What is it for?"/></label>}
      {!chat&&<label>Instructions<textarea rows={3} maxLength={8000} value={instructions} onChange={e=>setInstructions(e.target.value)} placeholder={gem?'Give this Gem a role, style, and constraints.':'Instructions shared by chats in this project.'}/></label>}
      {gem&&<label>Reference material<textarea rows={3} maxLength={10000} value={knowledge} onChange={e=>setKnowledge(e.target.value)} placeholder="Optional notes to bring to any chat."/></label>}
      {chat&&<label>Project<select value={projectId} onChange={e=>setProjectId(e.target.value)}><option value="">No project</option>{state.projects.map(p=><option value={p.id} key={p.id}>{p.name}</option>)}</select></label>}
      <div className="form-divider"/><SelectModel state={state} value={choice} onChange={setChoice}/>
      <details className="advanced"><summary>Generation settings</summary><div className="select-model">
        <label>Temperature<input type="number" min="0" max="2" step=".1" placeholder="Inherit" value={temperature} onChange={e=>setTemp(e.target.value)}/></label>
        <label>Output token limit<input type="number" min="16" max="32768" step="1" placeholder="Inherit" value={maxOutput} onChange={e=>setMax(e.target.value)}/></label>
      </div></details>
      {project&&<label className="checkbox"><input type="checkbox" checked={memory} onChange={e=>setMemory(e.target.checked)}/>Use account memory in this project</label>}
      {error&&<p className="form-error" role="alert">{error}</p>}
      <FormActions onClose={onClose} busy={busy}>{entity?'Save changes':'Create '+label}</FormActions>
    </form>
  </Modal>;
}

export function ConnectionEditor({entity,vaultAvailable,gatewayProvider,onSave,onClose}){
  const preferred=entity?.provider||(vaultAvailable&&gatewayProvider)||'openai';
  const [provider,setProvider]=useState(preferred);
  const [name,setName]=useState(entity?.name||providers[preferred].name);
  const [model,setModel]=useState(entity?.model??providers[preferred].model);
  const [endpoint,setEndpoint]=useState(entity?.endpoint||'');
  const [mode,setMode]=useState(entity?.mode||'device');
  const [relay,setRelay]=useState(entity?.relay||false);
  const [key,setKey]=useState('');
  const [routing,setRouting]=useState({enabled:true,specialties:[],quality:2,economy:2,contextChars:240000,...entity?.routing});
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const [models,setModels]=useState(null),[loadingModels,setLoadingModels]=useState(false);
  const custom=provider==='custom';
  const gateway=isGateway(provider);
  const storage=gateway?'vault':custom?'device':mode;
  const endpointChanged=custom&&!!entity&&endpoint.trim()!==entity.endpoint;
  async function discoverModels(){
    setError('');setLoadingModels(true);setModels(null);
    try{
      const result=await get('gateway-models',{method:'POST',body:{provider,connectionId:entity?.id,key:key.trim()}});
      setModels(result.models);
    }catch(e){setError(e.message);}finally{setLoadingModels(false);}
  }
  async function submit(e){
    e.preventDefault();setError('');
    if(!/^[\w.:/\-]{1,160}$/.test(model.trim())){setError('Enter a valid provider model ID.');return;}
    if(custom){
      try{
        const u=new URL(endpoint);
        if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.search||u.hash||(u.protocol==='http:'&&!['localhost','127.0.0.1','[::1]'].includes(u.hostname)))throw Error();
      }catch{setError('Use an HTTPS base URL or a loopback HTTP URL.');return;}
    }
    const changesCredential=entity && (entity.mode!==storage||entity.provider!==provider);
    if(!custom&&!key.trim()&&(!entity||changesCredential)){setError('Enter an API key for this connection.');return;}
    setBusy(true);
    try{await onSave({provider,name:name.trim(),model:model.trim(),endpoint:custom?endpoint.trim():undefined,mode:storage,routing,relay:!custom&&storage==='device'&&relay},key.trim());}
    catch(e){setError(e.message);setBusy(false);}
  }
  return <Modal title={entity?'Edit connection':'Add a connection'} eyebrow="MODEL PROVIDERS" onClose={onClose}>
    <form className="modal-form" onSubmit={submit}>
      <label>Provider<select value={provider} disabled={!!entity||loadingModels} onChange={e=>{const p=e.target.value;setProvider(p);setName(providers[p].name);setModel(providers[p].model);setModels(null);if(p==='custom'){setMode('device');setRelay(false);}}}>
        {Object.entries(providers).filter(([p])=>p!=='demo'&&(!isGateway(p)||p===entity?.provider||(vaultAvailable&&p===gatewayProvider))).map(([p,v])=><option key={p} value={p}>{v.name}</option>)}
      </select></label>
      <label>Connection name<input required maxLength={80} value={name} onChange={e=>setName(e.target.value)}/></label>
      {custom&&<label>API base URL<input type="url" required maxLength={300} value={endpoint} onChange={e=>setEndpoint(e.target.value)} placeholder="https://your-provider.example/v1"/><small>The endpoint must allow requests from this browser.</small></label>}
      <label>Default model ID<input required maxLength={160} value={model} onChange={e=>setModel(e.target.value)} placeholder="Provider model ID"/></label>
      {gateway&&<div className="flow-row"><button type="button" className="button secondary" onClick={discoverModels} disabled={loadingModels||(!entity&&!key.trim())||provider!==gatewayProvider}>{loadingModels?'Loading models…':'Load gateway models'}</button>
        {models?.length>0&&<label>Discovered model<select value={models.includes(model)?model:''} onChange={e=>{if(e.target.value)setModel(e.target.value);}}><option value="">Select a model</option>{models.map(id=><option key={id}>{id}</option>)}</select></label>}
        {models?.length===0&&<small>No models were returned for this key.</small>}</div>}
      <label>Key storage<select value={storage} disabled={custom||gateway} onChange={e=>setMode(e.target.value)}><option value="device">On this device</option><option value="vault" disabled={!vaultAvailable}>Encrypted server vault{vaultAvailable?'':' · unavailable'}</option></select></label>
      <label>API key{custom?' (optional)':''}<input type="password" maxLength={4000} autoComplete="off" value={key} onChange={e=>setKey(e.target.value)} placeholder={entity&&!endpointChanged?'Leave blank to keep the current key':'Enter your provider key'}/></label>
      {!custom&&storage==='device'&&<label className="checkbox"><input type="checkbox" checked={relay} onChange={e=>setRelay(e.target.checked)}/>Allow one-request relay when sending a message <span className="sr-only">The server reads the key for that request.</span></label>}
      <p className="hint">{gateway?'Use a virtual key issued by the configured gateway. Vault connections also work in background runs.':custom?(endpointChanged?'Changing the endpoint clears the old key unless you enter a replacement.':'Direct connection. Endpoint and key are used from this browser.'):storage==='vault'?'The key is encrypted on the server and can be used from your other devices.':relay?'The key is saved on this device. Kapron receives it only while relaying a request.':'The key is saved on this device and sent directly to the provider. Browser access depends on the provider’s CORS policy.'}</p>
      <details className="advanced"><summary>Auto model profile</summary>
        <label className="checkbox"><input type="checkbox" checked={routing.enabled} onChange={e=>setRouting({...routing,enabled:e.target.checked})}/>Eligible for Auto</label>
        <label>Model routing profile<select aria-label="Model routing profile" value={routing.profile??'standard'} onChange={e=>setRouting({...routing,profile:e.target.value})}>
          <option value="standard">Standard</option><option value="abliterated">Abliterated</option>
        </select><small>Mark an existing model you have configured. Auto reserves this profile for likely false refusals of clearly benign requests.</small></label>
        <div className="scope-grid">{Object.keys(taskFamilies).map(family=><label className="checkbox" key={family}><input type="checkbox" checked={routing.specialties.includes(family)} onChange={e=>setRouting({...routing,specialties:e.target.checked?[...routing.specialties,family]:routing.specialties.filter(x=>x!==family)})}/>{family}</label>)}</div>
        <div className="select-model">{[['quality','Quality score',5],['economy','Economy score',5],['contextChars','Approximate context characters',10000000]].map(([key,label,max])=><label key={key}>{label}<input required type="number" min={key==='contextChars'?1000:0} max={max} value={routing[key]} onChange={e=>setRouting({...routing,[key]:Number(e.target.value)})}/></label>)}</div>
      </details>
      {error&&<p className="form-error" role="alert">{error}</p>}
      <FormActions busy={busy} onClose={onClose}>{entity?'Save connection':'Add connection'}</FormActions>
    </form>
  </Modal>;
}

export function GemPicker({state,initial=[],onPick,onActive,onCreate,onClose}){
  const [mode,setMode]=useState(initial.length>1?'compare':'once');
  const [selected,setSelected]=useState(initial);
  const modes=[['once','One reply',MessageSquare],['active','Switch active',Gem],['compare','Compare',Layers3],['collaborate','Collaborate',GitBranch]];
  const multi=mode==='compare'||mode==='collaborate';
  return <Modal title="Choose a Gem" eyebrow="ASSISTANT ROUTING" onClose={onClose}>
    <div className="modal-form">
      <div className="mode-grid">{modes.map(([id,label,Icon])=><button type="button" className={'mode-option'+(mode===id?' selected':'')} key={id} aria-pressed={mode===id} onClick={()=>{setMode(id);if(id==='once'||id==='active')setSelected(s=>s.slice(0,1));}}><Icon size={17}/>{label}</button>)}</div>
      {state.gems.length?<div className="pick-list">{state.gems.map(g=><button key={g.id} className={'pick-row'+(selected.includes(g.id)?' selected':'')} aria-pressed={selected.includes(g.id)} onClick={()=>setSelected(s=>s.includes(g.id)?s.filter(x=>x!==g.id):multi?[...s,g.id].slice(0,4):[g.id])}><span className="mini-icon"><Gem size={17}/></span><span><strong>{g.name}</strong><small>{g.description||'Reusable assistant'} · v{g.version}</small></span>{selected.includes(g.id)&&<Check size={16} className="push"/>}</button>)}</div>:<p className="hint">Create a reusable Gem with its own instructions and model settings.</p>}
      <div className="modal-actions split"><button className="button secondary" onClick={onCreate}>Create Gem</button><button className="button primary" disabled={selected.length<(multi?2:1)} onClick={()=>mode==='active'?onActive(selected[0]):onPick({mode,ids:selected})}>{mode==='active'?'Switch assistant':'Use '+(multi?'Gems':'Gem')}<ArrowRight size={15}/></button></div>
    </div>
  </Modal>;
}

const scopeLabels={history:'Recent chat history',project:'Project instructions',memory:'Personal memory',gem:'Gem instructions and references',files:'Attached and project files',skills:'Auto-select skills',knowledge:'Auto-select knowledge',routingCloud:'Allow Jev to classify this prompt',abliterated:'Allow Auto to select an Abliterated connection'};
export function RunReview({state,chat,gems,mode,onRun,onClose}){
  const project=state.projects.find(x=>x.id===chat.projectId);
  const usableFiles=state.files.filter(x=>x.chatId===chat.id||(chat.projectId&&x.projectId===chat.projectId&&!x.chatId));
  const available={history:chat.messages.length>0,project:!!project?.instructions,memory:state.settings.memoryEnabled&&project?.memoryEnabled!==false&&state.memory.length>0,files:usableFiles.length>0,skills:!!state.skills?.length,knowledge:!!state.knowledge?.length,routingCloud:!!state.settings.routing?.cloud,abliterated:state.connections.some(c=>c.routing?.profile==='abliterated'&&c.routing?.enabled!==false)};
  const [rows,setRows]=useState(()=>gems.map(g=>{
    const candidates=modelOptions(state,chat,g);
    return {gem:g,candidates,choice:candidates.length===1?candidates[0].choice:null,scope:{...defaultContext,files:usableFiles.length>0,routingCloud:true,abliterated:available.abliterated,...chat.contextPrefs?.[g?.id??'main']},remember:!!chat.contextPrefs?.[g?.id??'main']};
  }));
  function update(i,patch){setRows(rows=>rows.map((r,j)=>i===j?{...r,...patch}:r));}
  const conflict=rows.some(r=>r.candidates.length>1);
  return <Modal title={conflict?'Resolve model choices':'Review run context'} eyebrow={mode==='compare'?'COMPARE GEMS':mode==='collaborate'?'COLLABORATE':'BEFORE SENDING'} wide onClose={onClose}>
    <form className="modal-form" onSubmit={e=>{e.preventDefault();onRun(rows.map(r=>({...r,preferences:r.scope,scope:Object.fromEntries(Object.entries(r.scope).map(([k,v])=>[k,v&&(k==='gem'?!!r.gem:available[k])]))})));}}>
      {conflict&&<p className="hint">Different explicit settings apply to this run. Choose the model for each affected reply.</p>}
      {mode==='collaborate'&&<p className="hint">Later Gems receive earlier replies as reference, including across providers.</p>}
      {rows.map((r,i)=>{
        const connection=getConnection(state,r.choice?.connectionId);
        return <section className="review-card" key={r.gem?.id??'main'}>
          <h3>{r.gem?.name??'Chat assistant'}</h3>
          {r.candidates.length>1&&<div className="radio-list">{r.candidates.map(c=><label className="checkbox radio" key={c.source}><input type="radio" name={'choice'+i} checked={sameChoice(r.choice,c.choice)} onChange={()=>update(i,{choice:c.choice})}/><span>{c.source} · {getConnection(state,c.choice.connectionId)?.name}<small>{c.choice.model}</small></span></label>)}</div>}
          {r.candidates.some(candidate=>candidate.choice.connectionId==='auto')&&<SelectModel state={state} value={r.choice} inherit={false} onChange={choice=>update(i,{choice})}/>}
          <div className="review-destination">{connection?<><span>{connection.name}</span><code>{r.choice.connectionId==='auto'?'Selected from eligible connections':r.choice.model}</code></>:<span>Choose a destination above</span>}</div>
          <div className="scope-grid">{Object.entries(scopeLabels).map(([k,label])=>{
            const enabled=k==='gem'?!!r.gem:k==='abliterated'?available[k]&&r.choice?.connectionId==='auto':available[k];
            return <label className={'checkbox'+(enabled?'':' muted')} key={k}><input type="checkbox" checked={enabled&&!!r.scope[k]} disabled={!enabled} onChange={e=>update(i,{scope:{...r.scope,[k]:e.target.checked}})}/>{label}</label>;
          })}</div>
          {!!usableFiles.length&&r.scope.files&&<p className="hint">Files: {usableFiles.map(x=>x.name).join(', ')}</p>}
          <label className="checkbox remember"><input type="checkbox" checked={r.remember} onChange={e=>update(i,{remember:e.target.checked})}/>Remember context choices in this chat</label>
        </section>;
      })}
      <div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>Back to chat</button><button className="button primary" disabled={rows.some(r=>!r.choice)}>Send {rows.length>1?'to '+rows.length+' Gems':'message'}<ArrowRight size={16}/></button></div>
    </form>
  </Modal>;
}
