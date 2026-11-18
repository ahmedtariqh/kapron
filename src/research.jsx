import {useState} from 'react';
import {Plus,Search,Trash2} from 'lucide-react';
import {researchNodes} from '../server/research.js';

const fields=[['allow','Allowed domains'],['block','Blocked domains'],['prefer','Preferred domains']];
const split=value=>value.split(/[\s,]+/).filter(Boolean);

export function Research({state,onQueue,onSearchSettings}){
  const [question,setQuestion]=useState(''),[queries,setQueries]=useState(['']),[projectId,setProjectId]=useState('');
  const [rules,setRules]=useState({allow:'',block:'',prefer:''}),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const setQuery=(index,value)=>setQueries(current=>current.map((query,item)=>item===index?value:query));
  async function submit(event){
    event.preventDefault();setError('');setBusy(true);
    const domains=Object.fromEntries(fields.map(([key])=>[key,split(rules[key])]));
    const plan={kind:'research',question:question.trim(),queries,projectId:projectId||null,domains};
    try{researchNodes(plan);await onQueue(plan);}
    catch(error){setError(error.message);setBusy(false);}
  }
  return <section className="workspace-card">
    <div className="page-heading"><span className="page-icon"><Search size={23}/></span><div><h1>Research</h1><p>Review search queries, compare sources, and save the evidence in Canvas.</p></div></div>
    <form className="modal-form" onSubmit={submit}>
      <label>Research question<input required maxLength={300} value={question} onChange={event=>setQuestion(event.target.value)}/></label>
      <label>Project<select value={projectId} onChange={event=>setProjectId(event.target.value)}>
        <option value="">No project</option>{state.projects.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label>
      <fieldset className="modal-form">
        <legend>Search plan</legend>
        {queries.map((query,index)=><div className="flow-row" key={index}>
          <label>Query {index+1}<input required maxLength={400} value={query} onChange={event=>setQuery(index,event.target.value)}/></label>
          <button type="button" className="icon-button" aria-label={'Remove query '+(index+1)} disabled={queries.length===1}
            onClick={()=>setQueries(current=>current.filter((_,item)=>item!==index))}><Trash2 size={15}/></button>
        </div>)}
        <div className="flow-row">
          <button type="button" className="button secondary" disabled={!question.trim()} onClick={()=>setQueries(current=>current.map((query,index)=>index===0?question.trim():query))}>Use question as first query</button>
          <button type="button" className="button secondary" disabled={queries.length>=4} onClick={()=>setQueries(current=>[...current,''])}><Plus size={15}/>Add query</button>
        </div>
      </fieldset>
      <details className="advanced"><summary>Source rules</summary>
        {fields.map(([key,label])=><label key={key}>{label}<input maxLength={400} value={rules[key]} onChange={event=>setRules(current=>({...current,[key]:event.target.value}))} placeholder="example.org, example.edu"/></label>)}
        <small>Rules apply to results. Preferred domains appear first. Blocked domains take precedence.</small>
      </details>
      <p className="hint">Tavily receives the queries you enter. The run saves source excerpts and links in Cowork.</p>
      {error&&<p className="form-error" role="alert">{error}</p>}
      <div className="flow-row">
        <button type="button" className="button secondary" onClick={onSearchSettings}>Configure search key in Studio</button>
        <button className="button primary" disabled={busy}>{busy?'Queuing…':'Run research plan'}</button>
      </div>
    </form>
  </section>;
}
