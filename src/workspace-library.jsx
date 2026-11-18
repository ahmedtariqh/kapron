import {useState} from 'react';
import {BookOpen} from 'lucide-react';
import {Modal} from './dialogs.jsx';
import {attachmentAccept,attachmentText,isPdf} from './attachments.js';
import {normalizeLabels} from './chat-library.js';

export function referenceUrl(value){
  if(!value)return '';
  const url=new URL(value);
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw new Error('Enter an HTTP or HTTPS link without credentials.');
  return url.href;
}

export function WorkspaceLibrary({state,onOpen,onAdd,onOrganize,onOrigin}){
  const [query,setQuery]=useState(''),[type,setType]=useState(''),[folder,setFolder]=useState(''),[label,setLabel]=useState('');
  const [editor,setEditor]=useState(null);
  const entries=[...(state.artifacts??[]).map(item=>({item,type:'artifact'})),...state.files.map(item=>({item,type:item.url?'reference':'file'}))];
  const folders=[...new Set(entries.map(({item})=>item.folder).filter(Boolean))].sort();
  const tags=[...new Set(entries.flatMap(({item})=>item.labels??[]))].sort();
  const needle=query.trim().toLocaleLowerCase();
  const visible=entries.filter(entry=>
    (!type||entry.type===type)&&(!folder||entry.item.folder===folder)&&(!label||entry.item.labels?.includes(label))
    &&[entry.item.name,entry.item.text,entry.item.url].some(value=>value?.toLocaleLowerCase().includes(needle)));
  const names={artifact:'Canvas',file:'File',reference:'Reference'};
  return <>
    <div className="page-heading"><span className="page-icon"><BookOpen size={22}/></span><div><h1>Workspace library</h1><p>Find saved Canvas work, text attachments, and references.</p></div><button className="button primary" onClick={()=>setEditor({})}>Add to library</button></div>
    <div className="select-model">
      <label>Search library<input value={query} onChange={event=>setQuery(event.target.value)}/></label>
      <label>Library type<select value={type} onChange={event=>setType(event.target.value)}><option value="">All items</option>{Object.entries(names).map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label>
      <label>Library folder<select value={folder} onChange={event=>setFolder(event.target.value)}><option value="">All folders</option>{folders.map(value=><option key={value}>{value}</option>)}</select></label>
      <label>Library tag<select value={label} onChange={event=>setLabel(event.target.value)}><option value="">All tags</option>{tags.map(value=><option key={value}>{value}</option>)}</select></label>
    </div>
    <div className="card-grid">
      {visible.map(({item,type})=><article className="workspace-card" key={type+':'+item.id}>
        <h2 dir="auto">{item.name}</h2><small>{[names[type],item.folder,...(item.labels??[])].filter(Boolean).join(' · ')}</small>
        <div className="flow-row"><button className="button secondary" onClick={()=>onOpen(type==='artifact'?'artifact':'file',item)}>Open</button>
          <button className="plain-button" onClick={()=>setEditor({item,type})}>Organize</button>
          {(item.origin||item.chatId)&&<button className="plain-button" onClick={()=>onOrigin(item.origin??{kind:'chat',id:item.chatId})}>Open source</button>}
        </div>
      </article>)}
    </div>
    {!visible.length&&<p className="hint">No matching library items.</p>}
    {editor&&<LibraryEntry entry={editor} onClose={()=>setEditor(null)} onSave={async values=>{
      if(editor.item)await onOrganize(editor.type,editor.item.id,values);
      else await onAdd(values);
      setEditor(null);
    }}/>}
  </>;
}

function LibraryEntry({entry,onClose,onSave}){
  const editing=!!entry.item;
  const [kind,setKind]=useState('file'),[name,setName]=useState(entry.item?.name??''),[link,setLink]=useState('');
  const [folder,setFolder]=useState(entry.item?.folder??''),[tags,setTags]=useState(entry.item?.labels?.join(', ')??'');
  const [file,setFile]=useState(null),[description,setDescription]=useState('');
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  return <Modal title={editing?'Organize library item':'Add to library'} onClose={onClose}>
    <form className="modal-form" onSubmit={async event=>{
      event.preventDefault();setBusy(true);setError('');
      try{
        const metadata={folder:folder.trim(),labels:normalizeLabels(tags.split(','))};
        if(editing)await onSave(metadata);
        else if(kind==='reference'){
          const url=referenceUrl(link.trim());
          if(!url||!name.trim())throw new Error('Enter a title and URL.');
          await onSave({...metadata,name:name.trim(),url,text:description.trim()});
        }else{
          if(!file||(!isPdf(file)&&(!/\.(txt|md|csv|json|log)$/i.test(file.name)||file.size>40000))||(isPdf(file)&&file.size>12000000))throw new Error('Choose a supported text file under 40 KB or PDF under 12 MB.');
          await onSave({...metadata,name:file.name.slice(0,120),text:await attachmentText(file,40000)});
        }
      }catch(failure){setError(failure.message);setBusy(false);}
    }}>
      {!editing&&<label>Entry type<select value={kind} onChange={event=>setKind(event.target.value)}><option value="file">Upload file</option><option value="reference">Save a reference link</option></select></label>}
      {!editing&&(kind==='reference'?<>
        <label>Reference title<input required maxLength={120} value={name} onChange={event=>setName(event.target.value)}/></label>
        <label>Reference URL<input required type="url" maxLength={1000} value={link} onChange={event=>setLink(event.target.value)}/></label>
        <label>Reference notes<textarea maxLength={5000} value={description} onChange={event=>setDescription(event.target.value)}/></label>
      </>:<label>Library file<input type="file" required accept={attachmentAccept} onChange={event=>setFile(event.target.files[0])}/></label>)}
      <label>Folder<input maxLength={80} value={folder} onChange={event=>setFolder(event.target.value)}/></label>
      <label>Tags<input maxLength={400} value={tags} onChange={event=>setTags(event.target.value)} placeholder="Separate tags with commas"/></label>
      {error&&<p role="alert" className="form-error">{error}</p>}
      <button className="button primary" disabled={busy}>Save library item</button>
    </form>
  </Modal>;
}
