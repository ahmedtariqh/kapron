const first=(env,sql,...values)=>env.DB.prepare(sql).bind(...values).first();
const run=(env,sql,...values)=>env.DB.prepare(sql).bind(...values).run();
const problem=(status,message)=>Object.assign(new Error(message),{status});

async function spaceRole(env,user,id){
  const row=await first(env,'SELECT s.id,s.name,s.revision,s.document,CASE WHEN s.owner=? THEN \'owner\' ELSE m.role END AS role FROM kapron_project_space s LEFT JOIN kapron_project_member m ON m.space=s.id AND m.member=? WHERE s.id=?',user,user,id);
  if(!row?.role)throw problem(404,'Shared project unavailable.');
  return row;
}
export async function collaboration(env,user,method,id,action,body){
  if(!id&&method==='GET'){
    const {results}=await env.DB.prepare("SELECT s.id,s.name,s.revision,CASE WHEN s.owner=? THEN 'owner' ELSE m.role END AS role FROM kapron_project_space s LEFT JOIN kapron_project_member m ON m.space=s.id AND m.member=? WHERE s.owner=? OR m.member=? ORDER BY s.updated DESC LIMIT 80").bind(user,user,user,user).all();
    return {spaces:results};
  }
  if(!id&&method==='POST'){
    if(typeof body?.name!=='string'||!body.name.trim()||body.name.length>100)throw problem(400,'Enter a project name.');
    const key=crypto.randomUUID();
    await run(env,'INSERT INTO kapron_project_space(id,owner,name,updated) VALUES(?,?,?,?)',key,user,body.name.trim(),Date.now());
    return {id:key};
  }
  if(id==='join'&&method==='POST'){
    if(typeof body?.code!=='string'||!/^[a-zA-Z0-9-]{36}$/.test(body.code))throw problem(400,'Enter a valid invitation code.');
    const invite=await first(env,'SELECT i.space,i.role FROM kapron_project_invite i JOIN kapron_project_space s ON s.id=i.space WHERE i.code=? AND i.expires>?',body.code,Date.now());
    if(!invite)throw problem(404,'Invitation expired or unavailable.');
    await run(env,'INSERT OR IGNORE INTO kapron_project_member(space,member,role) VALUES(?,?,?)',invite.space,user,invite.role);
    return {id:invite.space};
  }
  if(!id)throw problem(404,'Shared project unavailable.');
  const space=await spaceRole(env,user,id);
  if(!action&&method==='GET')return space;
  if(!action&&method==='PUT'){
    if(space.role==='viewer')throw problem(403,'Viewers cannot edit this project.');
    if(typeof body?.document!=='string'||body.document.length>64000||!Number.isInteger(body.revision))throw problem(400,'Enter a valid shared document.');
    const changed=await run(env,`UPDATE kapron_project_space SET document=?,revision=revision+1,updated=?
      WHERE id=? AND revision=? AND (owner=? OR EXISTS(SELECT 1 FROM kapron_project_member WHERE space=? AND member=? AND role='editor'))`,
      body.document,Date.now(),id,body.revision,user,id,user);
    if(changed.meta.changes!==1)throw problem(409,'This project changed. Reload the latest revision before saving.');
    return spaceRole(env,user,id);
  }
  if(action==='invites'&&method==='POST'){
    if(space.role!=='owner')throw problem(403,'Only the owner can invite people.');
    if(!['viewer','editor'].includes(body?.role))throw problem(400,'Choose a member role.');
    const code=crypto.randomUUID(),expires=Date.now()+86400000;
    await run(env,'INSERT INTO kapron_project_invite VALUES(?,?,?,?)',code,id,body.role,expires);
    return {code,expires};
  }
  if(action==='invites'&&method==='DELETE'){
    if(space.role!=='owner')throw problem(403,'Only the owner can revoke invitations.');
    await run(env,'DELETE FROM kapron_project_invite WHERE space=?',id);
    return {revoked:true};
  }
  if(action==='members'&&method==='DELETE'){
    if(space.role!=='owner')throw problem(403,'Only the owner can revoke member access.');
    await run(env,'DELETE FROM kapron_project_member WHERE space=?',id);
    return {revoked:true};
  }
  throw problem(404,'Shared project action unavailable.');
}
