import {useEffect,useRef,useState} from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {Download,FileText,Play,Plus} from 'lucide-react';
import {Modal} from './dialogs.jsx';
import {get} from './api.js';

function saveBlob(blob,name){
  const url=URL.createObjectURL(blob), link=document.createElement('a');
  link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1500);
}
function CodeRun({code}){
  const sandbox=useRef(null),run=useRef(null),timeout=useRef(null);
  const [output,setOutput]=useState([]),[ready,setReady]=useState(false),[running,setRunning]=useState(false);
  useEffect(()=>{
    const handler=event=>{
      const value=event.data;
      if(event.source!==sandbox.current?.contentWindow||value?.source!=='kapron-sandbox'||!run.current||value.id!==run.current)return;
      if(value.kind!=='done')setOutput(out=>[...out,value.text].slice(0,51));
      if(value.kind==='done'||value.kind==='error'){
        clearTimeout(timeout.current);run.current=null;setRunning(false);
      }
    };
    window.addEventListener('message',handler);
    return()=>{window.removeEventListener('message',handler);clearTimeout(timeout.current);};
  },[]);
  function execute(){
    run.current=crypto.randomUUID();setOutput([]);setRunning(true);
    sandbox.current.contentWindow.postMessage({source:'kapron-canvas',id:run.current,code},'*');
    timeout.current=setTimeout(()=>{run.current=null;setRunning(false);setOutput(out=>[...out,'Sandbox did not finish.']);},3500);
  }
  return <div className="canvas-run"><iframe ref={sandbox} title="JavaScript sandbox" src="/sandbox.html" sandbox="allow-scripts" hidden onLoad={()=>setReady(true)}/>
    <button type="button" className="button secondary" disabled={!ready||running} onClick={execute}><Play size={15}/>{running?'Running…':'Run JavaScript'}</button>
    {output.length>0&&<pre role="status">{output.join('\n')}</pre>}</div>;
}

export function ArtifactEditor({entity,onClose,onSave}){
  const [doc,setDoc]=useState({name:'',kind:'markdown',text:'',...entity});
  const [preview,setPreview]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const name=doc.name.replace(/[^\p{L}\p{N}_ -]/gu,'-').trim()||'kapron-artifact';
  async function exportAs(type){
    setError('');
    try{
      let blob;
      if(['md','csv','js','html','txt'].includes(type))blob=new Blob([doc.text],{type:'text/plain'});
      else if(KAPRON_MODULE_OFFICE)blob=await (await import('./formats.js')).exportOffice(doc,type);
      else throw new Error('This export format is disabled in this build.');
      saveBlob(blob,name+'.'+type);
    }catch(error){setError(error.message);}
  }
  const update=(key,value)=>setDoc(doc=>({...doc,[key]:value}));
  return <Modal wide title="Canvas" onClose={onClose}>
    <form className="modal-form" onSubmit={async e=>{e.preventDefault();setBusy(true);setError('');
      try{await onSave({...doc,name:doc.name.trim()||'Untitled artifact'});}catch(error){setError(error.message);setBusy(false);}
    }}>
      <div className="select-model"><label>Title<input autoFocus required maxLength={120} value={doc.name} onChange={e=>update('name',e.target.value)}/></label>
      <label>Format<select value={doc.kind} onChange={e=>{setPreview(false);update('kind',e.target.value);}}><option value="markdown">Markdown</option><option value="csv">CSV table</option><option value="javascript">JavaScript</option><option value="html">HTML</option><option value="text">Plain text</option></select></label></div>
      <div className="flow-row"><button type="button" className="button secondary" onClick={()=>setPreview(v=>!v)}>{preview?'Back to editor':'Preview'}</button>
        <label>Export<select aria-label="Export file" value="" onChange={e=>{if(e.target.value)exportAs(e.target.value);}}><option value="">Choose format</option>
        <option value={{markdown:'md',csv:'csv',javascript:'js',html:'html',text:'txt'}[doc.kind]}>Source file</option>
        {KAPRON_MODULE_DOCX&&<option value="docx">Word (.docx)</option>}{KAPRON_MODULE_XLSX&&<option value="xlsx">Excel from CSV (.xlsx)</option>}{KAPRON_MODULE_PPTX&&<option value="pptx">PowerPoint (.pptx)</option>}</select></label></div>
      {!preview?<label>Content<textarea className="canvas-editor" rows={15} maxLength={80000} value={doc.text} onChange={e=>update('text',e.target.value)}/></label>:
        KAPRON_MODULE_HTML&&doc.kind==='html'?<iframe className="html-preview" title="Read-only HTML preview" sandbox="" srcDoc={'<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src data:; form-action \'none\'; base-uri \'none\'">'+doc.text}/>:
        doc.kind==='markdown'?<div className="canvas-preview"><ReactMarkdown skipHtml remarkPlugins={[remarkGfm]} components={{img:()=>null}}>{doc.text}</ReactMarkdown></div>:<pre>{doc.text}</pre>}
      {KAPRON_MODULE_JAVASCRIPT&&doc.kind==='javascript'&&<CodeRun code={doc.text}/>}
      {error&&<p className="form-error" role="alert">{error}</p>}
      <div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>Close</button><button className="button primary" disabled={busy}>Save artifact</button></div>
    </form>
  </Modal>;
}

export function SharedView({id}){
  const [value,setValue]=useState(null),[error,setError]=useState('');
  useEffect(()=>{
    const controller=new AbortController();
    get('public-share/'+encodeURIComponent(id),{signal:controller.signal}).then(setValue,error=>{if(!controller.signal.aborted)setError(error.message);});
    return ()=>controller.abort();
  },[id]);
  return <main className="shared-view"><h1>{value?.title||'Shared from Kapron'}</h1>{error&&<p role="alert">{error}</p>}
    {value?.messages?.map((m,i)=><article key={i}><h2>{m.role==='user'?'User':'Assistant'}</h2><pre>{m.text}</pre></article>)}
    {value?.text!=null&&<pre>{value.text}</pre>}</main>;
}

export function ShareControls({onError}){
  const [keys,setKeys]=useState([]),[shares,setShares]=useState([]),[newKey,setNewKey]=useState(''),[busy,setBusy]=useState(false);
  async function refresh(){
    const [k,s]=await Promise.all([get('access-keys'),get('shares')]);setKeys(k.keys);setShares(s.shares);
  }
  useEffect(()=>{refresh().catch(onError);},[]);
  async function operation(fn){
    setBusy(true);try{await fn();await refresh();}catch(error){onError(error);}finally{setBusy(false);}
  }
  return <div className="modal-form"><h3>Read-only shares</h3>
    {shares.length?shares.map(s=><div className="inline-bar" key={s.id}><a href={'/?share='+s.id} target="_blank" rel="noreferrer">Open snapshot</a><button className="button secondary" disabled={busy} onClick={()=>operation(()=>get('shares/'+s.id,{method:'DELETE'}))}>Revoke</button></div>):<p className="hint">No active shares.</p>}
    <h3>Integration API keys</h3><p className="hint">A key can enqueue runs, spend through your approved connections, and read background run outputs. It expires after 30 days.</p>
    <button className="button secondary" disabled={busy} onClick={()=>operation(async()=>setNewKey((await get('access-keys',{method:'POST'})).value))}><Plus size={15}/>Create API key</button>
    {newKey&&<label>Copy this key now<input readOnly value={newKey} onFocus={e=>e.target.select()}/></label>}
    {keys.map(k=><div className="inline-bar" key={k.id}><code>{k.id.slice(0,12)}</code><button className="button secondary" disabled={busy} onClick={()=>operation(()=>get('access-keys/'+k.id,{method:'DELETE'}))}>Revoke</button></div>)}
  </div>;
}
