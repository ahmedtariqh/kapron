import {useEffect,useState} from 'react';
import {Folder,Plus} from 'lucide-react';
import {get} from './api.js';

export function Collaboration(){
  const [spaces,setSpaces]=useState([]),[space,setSpace]=useState(null),[document,setDocument]=useState('');
  const [name,setName]=useState(''),[code,setCode]=useState(''),[invite,setInvite]=useState(''),[role,setRole]=useState('viewer');
  const [error,setError]=useState(''),[notice,setNotice]=useState('');
  async function refresh(){setSpaces((await get('spaces')).spaces);}
  async function open(id){const value=await get('spaces/'+id);setSpace(value);setDocument(value.document);setInvite('');}
  async function perform(action){
    setError('');setNotice('');
    try{await action();}catch(error){setError(error.message);}
  }
  useEffect(()=>{perform(refresh);},[]);
  return <><div className="page-heading"><span className="page-icon"><Folder size={22}/></span><div><h1>Shared projects</h1><p>Invite viewers and editors to a shared project document.</p></div></div>
    <section className="workspace-card run-card"><form className="flow-row" onSubmit={e=>{e.preventDefault();perform(async()=>{
      const item=await get('spaces',{method:'POST',body:{name}});setName('');await refresh();await open(item.id);
    });}}>
      <label>Project name<input required maxLength={100} value={name} onChange={e=>setName(e.target.value)}/></label><button className="button primary"><Plus size={15}/>Create shared project</button>
    </form>
    <form className="flow-row" onSubmit={e=>{e.preventDefault();perform(async()=>{
      const item=await get('spaces/join',{method:'POST',body:{code:code.trim()}});setCode('');await refresh();await open(item.id);
    });}}><label>Invitation code<input required maxLength={36} value={code} onChange={e=>setCode(e.target.value)}/></label><button className="button secondary">Join project</button></form>
    <div className="pick-list">{spaces.map(s=><button className={'pick-row'+(space?.id===s.id?' selected':'')} key={s.id} onClick={()=>perform(()=>open(s.id))}><span><strong>{s.name}</strong><small>{s.role}</small></span></button>)}</div>
    {error&&<p role="alert" className="form-error">{error}</p>}{notice&&<p role="status">{notice}</p>}
    {space&&<><h2>{space.name}</h2><label>Shared document<textarea value={document} readOnly={space.role==='viewer'} maxLength={64000} rows={12} onChange={e=>setDocument(e.target.value)}/></label>
      <div className="flow-row"><button className="button secondary" onClick={()=>perform(()=>open(space.id))}>Reload revision</button>
      {space.role!=='viewer'&&<button className="button primary" onClick={()=>perform(async()=>{
        const value=await get('spaces/'+space.id,{method:'PUT',body:{document,revision:space.revision}});
        setSpace(value);setNotice('Revision saved.');
      })}>Save revision</button>}</div>
      {space.role==='owner'&&<><div className="flow-row"><label>Invite role<select value={role} onChange={e=>setRole(e.target.value)}><option value="viewer">Viewer</option><option value="editor">Editor</option></select></label>
        <button className="button secondary" onClick={()=>perform(async()=>setInvite((await get('spaces/'+space.id+'/invites',{method:'POST',body:{role}})).code))}>Create invitation</button>
        <button className="button secondary" onClick={()=>perform(async()=>{await get('spaces/'+space.id+'/invites',{method:'DELETE'});setInvite('');setNotice('Invitations revoked.');})}>Revoke invitations</button></div>
        {invite&&<label>Invitation code (valid for 24 hours)<input readOnly value={invite} onFocus={e=>e.target.select()}/></label>}
        <details className="advanced"><summary>Manage member access</summary>
          <button className="button secondary" onClick={()=>perform(async()=>{await get('spaces/'+space.id+'/invites',{method:'DELETE'});await get('spaces/'+space.id+'/members',{method:'DELETE'});setInvite('');setNotice('Invitations and member access revoked.');})}>Revoke all member access</button>
        </details></>}
    </>}
    </section></>;
}
