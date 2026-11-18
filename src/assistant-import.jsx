import {useState} from 'react';
import {Modal} from './dialogs.jsx';
import {parseAssistantPackage} from './assistant-packages.js';

export function AssistantImport({kind,onClose,onReview}){
  const [error,setError]=useState(''),[draft,setDraft]=useState(null);
  return <Modal title={'Import '+(kind==='gem'?'Gem':'skill')} onClose={onClose}>
    <div className="modal-form">
      <label>Package file<input type="file" accept=".json,application/json" onChange={async event=>{
        const file=event.target.files[0];setDraft(null);setError('');
        if(!file)return;
        try{
          if(file.size>200000)throw new Error('Choose a package under 200 KB.');
          setDraft(parseAssistantPackage(kind,JSON.parse(await file.text())));
        }catch(error){setError(error instanceof SyntaxError?'This file is invalid JSON.':error.message);}
      }}/></label>
      {draft&&<><strong>{draft.name}</strong><p>{draft.description}</p></>}
      {error&&<p className="form-error" role="alert">{error}</p>}
      <div className="modal-actions"><button className="button primary" disabled={!draft} onClick={()=>onReview(draft)}>Review and edit</button></div>
    </div>
  </Modal>;
}
