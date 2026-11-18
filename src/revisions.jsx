import {useState} from 'react';
import {Modal} from './dialogs.jsx';
import {revisionConfig} from '../server/revisions.js';

const titleCase=value=>value.replace(/([a-z])([A-Z])/g,'$1 $2').replace(/^./,first=>first.toUpperCase());
const display=value=>typeof value==='string'?value:value===undefined?'—':JSON.stringify(value,null,2);

export function RevisionHistory({kind,entity,onRestore,onClone,onExport,onClose}){
  const [version,setVersion]=useState(entity.versions?.[0]?.version??''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const snapshot=entity.versions?.find(item=>item.version===Number(version));
  const current=revisionConfig(kind,entity);
  const changed=snapshot?Array.from(new Set([...Object.keys(current),...Object.keys(snapshot.config)])).filter(key=>display(current[key])!==display(snapshot.config[key])):[];
  async function action(fn){
    setBusy(true);setError('');
    try{await fn();}catch(error){setError(error.message);setBusy(false);}
  }
  return <Modal title={entity.name+' versions'} wide onClose={onClose}>
    <div className="modal-form">
      <p>Current version {entity.version??1}</p>
      {entity.versions?.length?<label>Compare version<select value={version} onChange={event=>setVersion(event.target.value)}>
        {entity.versions.map(item=><option key={item.version} value={item.version}>Version {item.version}</option>)}
      </select></label>:<p className="hint">Earlier versions will appear after you edit this configuration.</p>}
      {snapshot&&!changed.length&&<p className="hint">The configurations match.</p>}
      {changed.map(field=><details className="advanced" key={field} open><summary>{titleCase(field)}</summary>
        <div className="card-grid"><div><strong>Version {snapshot.version}</strong><pre className="file-preview">{display(snapshot.config[field])}</pre></div>
          <div><strong>Current version</strong><pre className="file-preview">{display(current[field])}</pre></div></div></details>)}
      {error&&<p className="form-error" role="alert">{error}</p>}
      <div className="modal-actions">
        {onExport&&<button className="button secondary" disabled={busy} onClick={()=>onExport(snapshot?.config??current)}>Export package</button>}
        {onClone&&<button className="button secondary" disabled={busy} onClick={()=>action(()=>onClone(snapshot?.config??current))}>Clone configuration</button>}
        {snapshot&&<button className="button primary" disabled={busy} onClick={()=>action(()=>onRestore(snapshot.config))}>Restore as new version</button>}
      </div>
    </div>
  </Modal>;
}
