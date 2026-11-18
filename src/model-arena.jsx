import {useEffect,useRef,useState} from 'react';
import {GitBranch} from 'lucide-react';
import {demoConnection,getConnection,sameChoice} from '../server/state.js';
import {estimateRun} from '../server/model-policy.js';
import {SelectModel} from './dialogs.jsx';
import {streamRun} from './api.js';

const demo={connectionId:demoConnection.id,model:demoConnection.model};
const titles=['Model A','Model B'];
const idle=()=>[{text:'',status:'idle'},{text:'',status:'idle'}];
const elapsed=value=>value>=1000?(value/1000).toFixed(2)+' s':value+' ms';

export function ModelArena({state,user,offline,chatTitle,onPromote}){
  const first=state.connections[0];
  const [choices,setChoices]=useState(()=>[demo,first?{connectionId:first.id,model:first.model}:demo]);
  const [prompt,setPrompt]=useState(''),[results,setResults]=useState(idle),[selected,setSelected]=useState(null);
  const [running,setRunning]=useState(false),[submitted,setSubmitted]=useState('');
  const [blind,setBlind]=useState(true),[revealed,setRevealed]=useState(false),[promoting,setPromoting]=useState(false),[error,setError]=useState('');
  const active=useRef(null);
  useEffect(()=>()=>active.current?.abort(),[]);
  function update(index,patch){setResults(list=>list.map((item,i)=>i===index?{...item,...patch}:item));}
  async function compare(event){
    event.preventDefault();
    if(active.current||offline||!prompt.trim()||sameChoice(...choices))return;
    const controller=new AbortController();
    active.current=controller;
    setRunning(true);setSelected(null);setRevealed(!blind);setSubmitted(prompt.trim());setError('');
    const order=blind&&crypto.getRandomValues(new Uint8Array(1))[0]%2===1?[choices[1],choices[0]]:choices;
    const context={instruction:'',messages:[{role:'user',text:prompt.trim()}]};
    setResults(order.map(choice=>{
      const connection=getConnection(state,choice.connectionId);
      return {text:'',status:'running',model:choice.model,connectionId:choice.connectionId,provider:connection?.provider,providerName:connection?.name};
    }));
    await Promise.all(order.map(async (choice,index)=>{
      try{
        const connection=getConnection(state,choice.connectionId);
        if(!connection||choice.connectionId==='auto')throw new Error('Choose a specific model connection.');
        const budget={...state.settings.options,maxRunUsd:state.settings.routing?.maxRunUsd};
        const options={maxOutput:Math.min(2048,state.settings.options?.maxOutput??2048),reportUsage:connection.capability?.reportUsage===true};
        const estimate=estimateRun(connection,choice.model,context,options,budget);
        if(connection.provider!=='demo'&&estimate.error)throw new Error(estimate.error);
        const started=performance.now();
        const text=await streamRun({connection,model:choice.model,context,options,user,signal:controller.signal,
          onDelta:text=>update(index,{text}),onMetadata:metadata=>update(index,metadata)});
        update(index,{text,status:'complete',duration:Math.round(performance.now()-started),estimatedUsd:estimate.estimatedUsd});
      }catch(error){update(index,controller.signal.aborted?{status:'stopped'}:{status:'error',error:error.message});}
    }));
    active.current=null;setRunning(false);
  }
  async function promote(){
    if(promoting||selected===null||results[selected].status!=='complete')return;
    setPromoting(true);setError('');
    try{await onPromote(submitted,results[selected]);}
    catch(error){setError(error.message);setPromoting(false);}
  }
  return <>
    <div className="page-heading"><span className="page-icon"><GitBranch size={23}/></span><div><h1>Model arena</h1><p>Send the same prompt to two models and compare their replies.</p></div></div>
    <form className="modal-form arena-form" onSubmit={compare}>
      <div className="card-grid">
        {choices.map((choice,index)=><fieldset className="workspace-card" disabled={running} key={index}><legend>{titles[index]}</legend>
          <SelectModel state={state} value={choice} onChange={value=>setChoices(items=>items.map((item,i)=>i===index?value:item))}
            inherit={false} allowAuto={false}/>
        </fieldset>)}
      </div>
      <label className="checkbox"><input type="checkbox" checked={blind} disabled={running} onChange={event=>setBlind(event.target.checked)}/>Hide and shuffle model identities for the comparison</label>
      <label>Comparison prompt<textarea dir="auto" required maxLength={12000} rows={4} value={prompt} disabled={running} onChange={event=>setPrompt(event.target.value)}/></label>
      <p className="hint">Both selected providers receive this prompt. Project context, attachments, memory and skills stay out of the request. Results stay in this tab.</p>
      <div className="flow-row"><button className="button primary" disabled={running||offline||!prompt.trim()||sameChoice(...choices)}>Compare responses</button>
        {running&&<button className="button secondary" type="button" onClick={()=>active.current?.abort()}>Stop comparison</button>}</div>
    </form>
    {submitted&&<section aria-label="Comparison results">
      <h2>Results</h2><p dir="auto">{submitted}</p>
      <div className="flow-row">
        {!revealed&&!running&&<button className="button secondary" onClick={()=>setRevealed(true)}>Reveal models</button>}
        {selected!==null&&!running&&<button className="button primary" disabled={promoting||offline} onClick={promote}>
          {chatTitle?'Add preferred reply to current chat':'Start chat with preferred reply'}
        </button>}
      </div>
      {error&&<p className="form-error" role="alert">{error}</p>}
      <div className="card-grid">{results.map((result,index)=><article className="workspace-card" aria-label={titles[index]+' result'} key={index}>
        <h3>{titles[index]}{revealed?' · '+result.providerName:''}</h3>
        {revealed&&<code>{result.upstreamModel??result.model}</code>}
        {result.error&&<p className="form-error" role="alert">{result.error}</p>}
        <p role="status">{result.status==='complete'?(revealed?elapsed(result.duration)+' · '+(result.usage?.total==null?'Tokens unavailable':result.usage.total+' tokens'):'Complete'):result.status==='stopped'?'Stopped':result.status==='running'?'Waiting for model…':''}</p>
        {revealed&&result.estimatedUsd!=null&&<p className="hint">Estimated USD {result.estimatedUsd.toFixed(6)}</p>}
        {result.text&&<pre className="file-preview" dir="auto">{result.text}</pre>}
        {result.status==='complete'&&<button className="button secondary" aria-pressed={selected===index} onClick={()=>setSelected(index)}>Prefer {titles[index]}</button>}
      </article>)}</div>
    </section>}
  </>;
}
