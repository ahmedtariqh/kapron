import {useState} from 'react';
import {BookOpen} from 'lucide-react';
import {get} from './api.js';

export function Integrations({configured,onTask}){
  const [list,setList]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  async function check(){
    setBusy(true);setError('');setList(null);
    try{setList((await get('integrations/notebooklm')).notebooks);}
    catch(error){setError(error.message);}
    finally{setBusy(false);}
  }
  return <><div className="page-heading"><span className="page-icon"><BookOpen size={22}/></span><div><h1>Integrations</h1></div></div>
    <section className="workspace-card run-card"><h2>Gemini Notebook (NotebookLM)</h2>
      <p>Ask a question about the sources in an approved notebook and use the answer and citations in a Cowork task. Questions can appear in your NotebookLM chat history.</p>
      <p>{configured?'Companion configured':'Companion not configured. Follow the NotebookLM setup in the README and restart Kapron.'}</p>
      <button className="button secondary" disabled={busy||!configured} onClick={check}>{busy?'Checking…':'Check connection and list notebooks'}</button>
      {error&&<p role="alert" className="form-error">{error}</p>}
      {list&&<><p role="status">{list.length?list.length+' approved notebook(s) available.':'Connected. No approved notebooks found for this profile.'}</p>
        <div className="pick-list">{list.map(item=><button className="pick-row" key={item.id} onClick={()=>onTask(item)}><span><strong>{item.title}</strong><small>Ask in Cowork</small></span></button>)}</div></>}
    </section></>;
}
