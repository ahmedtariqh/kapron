import {useState} from 'react';
import {Modal} from './dialogs.jsx';
import {findChats} from './chat-library.js';

export function ChatHistory({chats, onOpen, onArchive, onPin, onImport, onExport, onClose}) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('active');
  const [folder, setFolder] = useState('');
  const [label, setLabel] = useState('');
  const [selected, setSelected] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const folders = [...new Set(chats.map(chat => chat.folder).filter(Boolean))].sort();
  const labels = [...new Set(chats.flatMap(chat => chat.labels ?? []))].sort();
  const visible = findChats(chats,{query,folder,label,status});
  const selectedVisible = visible.filter(chat => selected.includes(chat.id));
  async function action(callback) {
    setBusy(true);
    setError('');
    try { await callback(); }
    catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
  return <Modal title="Chat history" wide onClose={onClose}>
    <div className="modal-form">
      <label>Search history<input autoFocus value={query} onChange={event=>setQuery(event.target.value)} placeholder="Search titles, labels, and messages"/></label>
      <div className="select-model">
        <label>View<select value={status} onChange={event=>{setStatus(event.target.value);setSelected([]);}}>
          <option value="active">Active</option><option value="archived">Archived</option><option value="pinned">Pinned</option><option value="all">All chats</option>
        </select></label>
        <label>Folder<select value={folder} onChange={event=>setFolder(event.target.value)}><option value="">All folders</option>{folders.map(item=><option key={item}>{item}</option>)}</select></label>
        <label>Label<select value={label} onChange={event=>setLabel(event.target.value)}><option value="">All labels</option>{labels.map(item=><option key={item}>{item}</option>)}</select></label>
      </div>
      <div className="flow-row">
        <button className="button secondary" disabled={!selectedVisible.some(chat=>!chat.archived)||busy} onClick={()=>action(async()=>{await onArchive(selectedVisible.filter(chat=>!chat.archived).map(chat=>chat.id),true);setSelected([]);})}>Archive selected</button>
        <button className="button secondary" disabled={!selectedVisible.some(chat=>chat.archived)||busy} onClick={()=>action(async()=>{await onArchive(selectedVisible.filter(chat=>chat.archived).map(chat=>chat.id),false);setSelected([]);})}>Restore selected</button>
        <button className="button secondary" disabled={!chats.length||busy} onClick={()=>onExport(selectedVisible.length?selectedVisible.map(chat=>chat.id):undefined)}>{selectedVisible.length?'Export selected chats':'Export all chats'}</button>
        <button className="button secondary" onClick={onImport}>Import chats</button>
      </div>
      {error&&<p role="alert" className="form-error">{error}</p>}
      <div className="pick-list">
        {visible.map(chat=><div className="flow-row" key={chat.id}>
          <input type="checkbox" aria-label={'Select '+chat.title} checked={selected.includes(chat.id)} onChange={event=>setSelected(current=>event.target.checked?[...current,chat.id]:current.filter(id=>id!==chat.id))}/>
          <button className="pick-row" onClick={()=>onOpen(chat)}><span><strong>{chat.title}</strong><small>{[chat.folder,...(chat.labels??[]),chat.archived?'Archived':null].filter(Boolean).join(' · ')}</small></span></button>
          <button className="button secondary" disabled={busy} aria-label={(chat.pinned?'Unpin ':'Pin ')+chat.title} onClick={()=>action(()=>onPin(chat.id,!chat.pinned))}>{chat.pinned?'Unpin':'Pin'}</button>
        </div>)}
        {!visible.length&&<p className="hint">No chats match these filters.</p>}
      </div>
    </div>
  </Modal>;
}

export function ChatImport({preview, onImport, onClose}) {
  const [document, setDocument] = useState(null);
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return <Modal title="Import chats" onClose={onClose}>
    <form className="modal-form" onSubmit={async event=>{
      event.preventDefault();
      if(!document)return;
      setBusy(true);setError('');
      try {await onImport(document);}
      catch(failure){setError(failure.message);}
      finally{setBusy(false);}
    }}>
      <label>Chat export file<input type="file" accept=".json,application/json" disabled={busy} onChange={async event=>{
        setDocument(null);setSummary(null);setError('');setBusy(true);
        try{
          const file=event.target.files[0];
          if(!file)return;
          if(file.size>15*1024*1024)throw new Error('Choose a JSON export smaller than 15 MB.');
          const candidate=JSON.parse(await file.text());
          setSummary(preview(candidate));setDocument(candidate);
        }catch(failure){setError(failure instanceof SyntaxError?'This is not a valid JSON file.':failure.message);}
        finally{setBusy(false);}
      }}/></label>
      <p className="hint">Kapron JSON bundles and ChatGPT conversations.json are supported. Imported chats are added to this workspace.</p>
      {summary&&<p role="status">{summary.chats} chats and {summary.files} text attachments ready to import.</p>}
      {error&&<p role="alert" className="form-error">{error}</p>}
      <button className="button primary" disabled={!document||busy}>Import to workspace</button>
    </form>
  </Modal>;
}
