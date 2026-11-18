export function projectHierarchyValid(projects){
  const byId=new Map(projects.map(project=>[project.id,project]));
  if(byId.size!==projects.length)return false;
  for(const project of projects){
    let cursor=project;
    const seen=new Set();
    while(cursor.parentId){
      if(typeof cursor.parentId!=='string'||seen.has(cursor.id)||seen.size>=8)return false;
      seen.add(cursor.id);
      cursor=byId.get(cursor.parentId);
      if(!cursor)return false;
    }
  }
  return true;
}
