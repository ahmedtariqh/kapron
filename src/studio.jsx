import {useState} from 'react';
import {Image,Search} from 'lucide-react';
import {api,get,getDeviceKey} from './api.js';

export async function searchSources(query,signal){
  return (await get('tools',{method:'POST',body:{operation:'search',prompt:query},signal})).sources;
}
export function formatSources(sources){
  return sources.map((source,i)=>'['+(i+1)+'] '+source.title+'\n'+source.url+'\n'+source.excerpt).join('\n\n');
}
function readImage(file){
  return new Promise((resolve,reject)=>{
    if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>1048576){reject(new Error('Choose a PNG, JPEG, or WebP under 1 MB.'));return;}
    const reader=new FileReader();
    reader.onerror=()=>reject(new Error('Cannot read this image.'));
    reader.onload=()=>resolve({mime:file.type,data:reader.result.split(',')[1]});
    reader.readAsDataURL(file);
  });
}
export function Studio({state,user,onArtifact,vaultAvailable}){
  const [operation,setOperation]=useState('search'),[prompt,setPrompt]=useState(''),[connectionId,setConnection]=useState('');
  const [file,setFile]=useState(null),[searchKey,setSearchKey]=useState(''),[model,setModel]=useState('gpt-image-2.5-flare');
  const [result,setResult]=useState(null),[status,setStatus]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const openai=state.connections.filter(c=>c.provider==='openai'&&(c.mode==='vault'||c.relay));
  async function launch(e){
    e.preventDefault();setBusy(true);setError('');setStatus('');setResult(null);
    try{
      if(operation==='search'){setResult({sources:await searchSources(prompt.trim())});return;}
      const connection=openai.find(c=>c.id===connectionId);
      if(!connection)throw new Error('Select a compatible OpenAI connection.');
      if(['edit','vision'].includes(operation)&&!file)throw new Error('Add an input image.');
      const image=['edit','vision'].includes(operation)?await readImage(file):undefined;
      const deviceKey=connection.mode==='device'?await getDeviceKey(user,connection.id):undefined;
      setResult(await get('tools',{method:'POST',body:{operation,prompt:prompt.trim(),connectionId,model,image,deviceKey}}));
    }catch(error){setError(error.message);}finally{setBusy(false);}
  }
  async function saveKey(remove=false){
    setError('');setStatus('');
    try{
      await api('vault/search-tavily',remove?{method:'DELETE'}:{method:'PUT',body:{provider:'tavily',key:searchKey.trim()}});
      setSearchKey('');setStatus(remove?'Search key removed.':'Search key saved.');
    }catch(error){setError(error.message);}
  }
  return <><div className="page-heading"><span className="page-icon"><Image size={23}/></span><div><h1>Studio</h1><p>Find sources and work with images.</p></div></div>
  <section className="workspace-card run-card"><form className="modal-form" onSubmit={launch}>
    <label>Tool<select value={operation} onChange={e=>{setOperation(e.target.value);setResult(null);setError('');}}>
      <option value="search">Web search</option><option value="vision">Analyze an image</option><option value="generate">Generate an image</option><option value="edit">Edit an image</option>
    </select></label>
    <label>{operation==='search'?'Search query':'Prompt'}<textarea required rows="4" maxLength={operation==='search'?400:4000} value={prompt} onChange={e=>setPrompt(e.target.value)}/></label>
    {operation!=='search'&&<label>OpenAI connection<select required value={connectionId} onChange={e=>setConnection(e.target.value)}>
      <option value="">Select a relay or vault connection</option>{openai.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
    {['edit','generate'].includes(operation)&&<label>Image model<input required maxLength={65} value={model} onChange={e=>setModel(e.target.value)}/></label>}
    {['edit','vision'].includes(operation)&&<label>Input image<input type="file" accept="image/png,image/jpeg,image/webp" required onChange={e=>setFile(e.target.files[0]??null)}/></label>}
    <button className="button primary" disabled={busy}>{busy?'Working…':operation==='search'?'Search':'Run tool'}</button>
  </form>
  {operation==='search'&&<details className="advanced"><summary>Search connection</summary>
    <label>Tavily API key<input type="password" value={searchKey} maxLength={4000} disabled={!vaultAvailable} onChange={e=>setSearchKey(e.target.value)}/></label>
    <div className="flow-row"><button className="button secondary" disabled={!searchKey.trim()} onClick={()=>saveKey()}><Search size={15}/>Save key</button><button className="button secondary" disabled={!vaultAvailable} onClick={()=>saveKey(true)}>Remove key</button></div>
  </details>}
  {status&&<p role="status">{status}</p>}
  {error&&<p role="alert" className="form-error">{error}</p>}
  {result?.sources&&<><div className="research-results">{result.sources.map((s,i)=><article key={s.url+i}><a href={s.url} rel="noreferrer" target="_blank">[{i+1}] {s.title}</a><p>{s.excerpt}</p></article>)}</div>
    {result.sources.length>0?<button className="button secondary" onClick={()=>onArtifact(prompt,formatSources(result.sources))}>Open sources in Canvas</button>:<p>No sources returned.</p>}</>}
  {result?.text&&<><pre>{result.text}</pre><button className="button secondary" onClick={()=>onArtifact('Image analysis',result.text)}>Open in Canvas</button></>}
  {result?.data&&<><img className="studio-image" alt="Generated result" src={'data:'+result.mime+';base64,'+result.data}/><a className="button secondary" download="kapron-image.png" href={'data:'+result.mime+';base64,'+result.data}>Download image</a></>}
  </section></>;
}
