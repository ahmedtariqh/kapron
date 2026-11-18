import {useState} from 'react';
import {inspectWorkspaceBackup} from './workspace-backup.js';
import {Modal} from './dialogs.jsx';

export function WorkspacePortability({state,onExport,onRestore,onClose}){
  const [backup,setBackup]=useState(null),[counts,setCounts]=useState(null),[error,setError]=useState('');
  const [busy,setBusy]=useState(false),[restoreSettings,setRestoreSettings]=useState(false),[mapping,setMapping]=useState({});
  async function read(file){
    setBackup(null);setCounts(null);setError('');setMapping({});
    if(!file)return;
    try{
      if(file.size>850000)throw new Error('Choose a workspace backup under 850 KB.');
      const data=JSON.parse(await file.text());
      setCounts(inspectWorkspaceBackup(data));
      setBackup(data);
    }catch(error){setError(error instanceof SyntaxError?'This file is invalid JSON.':error.message);}
  }
  async function restore(event){
    event.preventDefault();setBusy(true);setError('');
    try{await onRestore(backup,{restoreSettings,connectionMap:mapping});}
    catch(error){setError(error.message);setBusy(false);}
  }
  return <Modal title="Workspace backup" onClose={onClose} wide>
    <form className="modal-form" onSubmit={restore}>
      <p className="hint">The backup includes private workspace records. Store it somewhere you trust. Reconnect providers, regenerate share links, and enable schedules after a move.</p>
      <div><button type="button" className="button secondary" onClick={onExport}>Download workspace backup</button></div>
      <label>Choose backup file<input type="file" accept=".json,application/json" disabled={busy} onChange={event=>read(event.target.files[0])}/></label>
      {backup&&<>
        <p>{Object.entries(counts).filter(([,count])=>count).map(([field,count])=>count+' '+field).join(' · ')||'Settings only'}</p>
        <p className="hint">Restore adds copies with their relationships intact. Current records stay available.</p>
        {backup.connections.map(connection=><label key={connection.id}>Map {connection.name||connection.provider}<select value={mapping[connection.id]??''} onChange={event=>setMapping({...mapping,[connection.id]:event.target.value})}>
          <option value="">Use inherited model or Demo</option>{state.connections.filter(item=>item.provider===connection.provider).map(item=><option key={item.id} value={item.id}>{item.name}</option>)}
        </select></label>)}
        <label className="checkbox"><input type="checkbox" checked={restoreSettings} onChange={event=>setRestoreSettings(event.target.checked)}/>Restore memory preference and default model</label>
      </>}
      {error&&<p className="form-error" role="alert">{error}</p>}
      <div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>Close</button><button className="button primary" disabled={!backup||busy}>{busy?'Restoring…':'Restore copies'}</button></div>
    </form>
  </Modal>;
}
