import {useState} from 'react';
import {BookOpen,Plus} from 'lucide-react';
import {dueStudyCards,findEvidence,reviewStudyCard} from '../server/notebooks.js';
import {Modal} from './dialogs.jsx';
import {attachmentAccept,attachmentText} from './attachments.js';

const id=()=>crypto.randomUUID();

function NotebookEditor({item,projects,onClose,onSave}){
  const [name,setName]=useState(item?.name??''),[projectId,setProject]=useState(item?.projectId??'');
  const [error,setError]=useState(''),[busy,setBusy]=useState(false);
  return <Modal title={item?'Notebook settings':'New notebook'} onClose={onClose}>
    <form className="modal-form" onSubmit={async event=>{
      event.preventDefault();setBusy(true);
      try{await onSave({...item,name:name.trim(),projectId:projectId||null});onClose();}
      catch(error){setError(error.message);setBusy(false);}
    }}>
      <label>Notebook name<input autoFocus required maxLength={120} value={name} onChange={event=>setName(event.target.value)}/></label>
      <label>Project<select value={projectId} onChange={event=>setProject(event.target.value)}><option value="">No project</option>{projects.map(project=><option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
      {error&&<p role="alert" className="form-error">{error}</p>}
      <div className="modal-actions"><button className="button primary" disabled={busy}>Save notebook</button></div>
    </form>
  </Modal>;
}

function SourceEditor({source,onClose,onSave}){
  const [name,setName]=useState(source?.name??''),[text,setText]=useState(source?.text??''),[notes,setNotes]=useState(source?.notes??'');
  const [error,setError]=useState(''),[busy,setBusy]=useState(false);
  return <Modal title={source?'Edit notebook source':'Add notebook source'} onClose={onClose} wide>
    <form className="modal-form" onSubmit={async event=>{
      event.preventDefault();setBusy(true);setError('');
      try{await onSave({...source,id:source?.id??id(),name:name.trim(),text:text.trim(),notes,enabled:source?.enabled??true,updated:new Date().toISOString()});onClose();}
      catch(error){setError(error.message);setBusy(false);}
    }}>
      <label>Import text from a file<input type="file" accept={attachmentAccept} disabled={busy} onChange={async event=>{
        const file=event.target.files[0];if(!file)return;
        setBusy(true);setError('');
        try{
          if(file.size>(/\.pdf$/i.test(file.name)?12000000:100000))throw new Error('This reference file is too large.');
          setText((await attachmentText(file,24000)).slice(0,24000));
          if(!name)setName(file.name.slice(0,120));
        }
        catch(error){setError(error.message);}finally{setBusy(false);}
      }}/></label>
      <label>Source name<input autoFocus required maxLength={120} value={name} onChange={event=>setName(event.target.value)}/></label>
      <label>Source text<textarea required rows={9} maxLength={24000} value={text} onChange={event=>setText(event.target.value)}/></label>
      <label>Source notes<textarea rows={3} maxLength={2000} value={notes} onChange={event=>setNotes(event.target.value)}/></label>
      {error&&<p role="alert" className="form-error">{error}</p>}
      <div className="modal-actions"><button className="button primary" disabled={busy}>Save source</button></div>
    </form>
  </Modal>;
}

function StudySession({cards,busy,onReview,onClose}){
  const next=dueStudyCards(cards)[0];
  const [revealed,setRevealed]=useState(null);
  return <Modal title="Study review" onClose={onClose}><div className="modal-form">
    {next?<>
      <h3 dir="auto">{next.question}</h3>
      {revealed===next.id?<><blockquote dir="auto">{next.answer}</blockquote><p className="hint">{next.sourceName}</p>
        <div className="modal-actions"><button className="button secondary" disabled={busy} onClick={()=>onReview(reviewStudyCard(next,false))}>Review again</button>
          <button className="button primary" disabled={busy} onClick={()=>onReview(reviewStudyCard(next,true))}>Remembered</button></div></>
        :<button className="button primary" onClick={()=>setRevealed(next.id)}>Reveal answer</button>}
    </>:<p role="status">All due cards reviewed.</p>}
  </div></Modal>;
}

export function Notebooks({state,initialId,onSave,onDelete}){
  const [selected,setSelected]=useState(initialId??null),[dialog,setDialog]=useState(null),[error,setError]=useState('');
  const [question,setQuestion]=useState(''),[busy,setBusy]=useState(false),[tab,setTab]=useState('Evidence');
  const all=state.notebooks??[], current=all.find(item=>item.id===selected);
  async function change(patch){
    setBusy(true);setError('');
    try{await onSave({...current,...patch});}catch(error){setError(error.message);throw error;}
    finally{setBusy(false);}
  }
  const action=fn=>fn().catch(()=>{});
  const close=()=>setDialog(null);
  return <>
    <div className="page-heading"><span className="page-icon"><BookOpen size={23}/></span><div><h1>Notebooks</h1><p>Collect references, find cited excerpts, and save study cards.</p></div><button className="button primary" onClick={()=>setDialog({type:'notebook'})}><Plus size={17}/>New notebook</button></div>
    <label>Open notebook<select value={current?.id??''} onChange={event=>{setSelected(event.target.value);setQuestion('');setError('');setTab('Evidence');}}>
      <option value="">Select a notebook</option>{all.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    {error&&<p role="alert" className="form-error">{error}</p>}
    {current&&<>
      <div className="inline-bar"><span><strong>{current.name}</strong><small>{state.projects.find(project=>project.id===current.projectId)?.name??'Personal notebook'}</small></span>
        <button className="button secondary" onClick={()=>setDialog({type:'notebook',item:current})}>Settings</button>
        <button className="button secondary" onClick={()=>setDialog({type:'delete',item:current})}>Delete notebook</button></div>
      <div className="flow-row">{['Evidence','Sources','Study'].map(value=><button key={value} className={'button '+(tab===value?'primary':'secondary')} aria-pressed={tab===value} onClick={()=>setTab(value)}>{value}</button>)}</div>
      {tab==='Sources'&&<section className="workspace-card">
        <button className="button secondary" disabled={busy||current.sources.length>=12} onClick={()=>setDialog({type:'source'})}>Add source</button>
        {!current.sources.length&&<p className="hint">Add a file or paste reference text.</p>}
        {current.sources.map(source=><div className="inline-bar" key={source.id}><span><strong>{source.name}</strong><small>{source.notes}</small></span>
          <label className="checkbox"><input type="checkbox" checked={source.enabled} disabled={busy} onChange={event=>{const enabled=event.target.checked;action(()=>change({sources:current.sources.map(item=>item.id===source.id?{...item,enabled}:item)}));}}/>Use in evidence</label>
          <button className="button secondary" disabled={busy} onClick={()=>setDialog({type:'source',item:source})}>Edit source</button>
          <button className="button secondary" disabled={busy} onClick={()=>setDialog({type:'remove-source',item:source})}>Remove source</button>
        </div>)}
      </section>}
      {tab==='Evidence'&&<section className="workspace-card">
        <form className="modal-form notebook-form" onSubmit={event=>{
          event.preventDefault();const text=question.trim();if(!text)return;
          const turn={id:id(),question:text,hits:findEvidence(current.sources,text)};
          action(async()=>{await change({history:[turn,...current.history].slice(0,20)});setQuestion('');});
        }}>
          <label>Question about your sources<input required maxLength={1000} value={question} onChange={event=>setQuestion(event.target.value)}/></label>
          <button className="button primary" disabled={busy||!current.sources.some(source=>source.enabled)}>Find evidence</button>
        </form>
        {!current.sources.some(source=>source.enabled)&&<p className="hint">Enable at least one source in the Sources tab.</p>}
        {current.history.map(turn=><article key={turn.id} className="review-card"><h3 dir="auto">{turn.question}</h3>
          {turn.hits.length?turn.hits.map((hit,index)=><div key={hit.sourceId+':'+hit.position} className="review-card"><strong>[{index+1}] {hit.name}</strong><blockquote dir="auto">{hit.quote}</blockquote>
            <button className="button secondary" disabled={busy||current.cards.some(card=>card.question===turn.question&&card.answer===hit.quote)||current.cards.length>=24} onClick={()=>action(()=>change({cards:[{id:id(),question:turn.question,answer:hit.quote,sourceName:hit.name},...current.cards]}))}>Save study card</button>
          </div>):<p className="hint">No matching excerpts in the enabled sources.</p>}
        </article>)}
      </section>}
      {tab==='Study'&&<section className="workspace-card"><h2>Study cards</h2>
        {current.cards.length>0&&<button className="button primary" onClick={()=>setDialog({type:'study'})}>Review due cards</button>}
        {!current.cards.length&&<p className="hint">Save excerpts as study cards from the Evidence tab.</p>}
        {current.cards.map(card=><div className="inline-bar" key={card.id}><details><summary dir="auto">{card.question}</summary><p dir="auto">{card.answer}</p><small>{card.sourceName}{card.review?' · Next review '+new Date(card.review.due).toLocaleString():''}</small></details>
          <button className="button secondary" disabled={busy} onClick={()=>action(()=>change({cards:current.cards.filter(item=>item.id!==card.id)}))}>Remove card</button>
        </div>)}</section>}
    </>}
    {dialog?.type==='study'&&current&&<StudySession cards={current.cards} busy={busy} onClose={close}
      onReview={card=>action(()=>change({cards:current.cards.map(item=>item.id===card.id?card:item)}))}/>}
    {dialog?.type==='notebook'&&<NotebookEditor item={dialog.item} projects={state.projects} onClose={close} onSave={async values=>setSelected((await onSave(values)).id)}/>}
    {dialog?.type==='source'&&<SourceEditor source={dialog.item} onClose={close} onSave={source=>change({sources:current.sources.some(item=>item.id===source.id)?current.sources.map(item=>item.id===source.id?source:item):[...current.sources,source]})}/>}
    {['delete','remove-source'].includes(dialog?.type)&&<Modal title={dialog.type==='delete'?'Delete notebook?':'Remove source?'} onClose={close}><div className="modal-form">
      <p>{dialog.item.name}</p>
      {error&&<p role="alert" className="form-error">{error}</p>}
      <div className="modal-actions"><button type="button" className="button secondary" onClick={close}>Cancel</button>
      <button className="button primary" disabled={busy} onClick={()=>action(async()=>{
        if(dialog.type==='delete'){
          setBusy(true);
          try{await onDelete(current.id);setSelected(null);}
          catch(error){setError(error.message);throw error;}finally{setBusy(false);}
        }else await change({sources:current.sources.filter(item=>item.id!==dialog.item.id)});
        close();
      })}>Confirm removal</button></div>
    </div></Modal>}
  </>;
}
