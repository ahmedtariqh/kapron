import {ArrowLeft,ArrowRight,Folder,Plus} from 'lucide-react';

export function ProjectOverview({project,state,onOpen,onBack,onChat,onEdit,onChild,onFile,onManageGems}){
  const {id}=project;
  const gems=new Set(project.gemIds??[]);
  const groups=[
    ['Subprojects','project',state.projects.filter(item=>item.parentId===id)],
    ['Conversations','chat',state.chats.filter(item=>item.projectId===id&&!item.archived)],
    ['Files and links','file',state.files.filter(item=>item.projectId===id&&!item.chatId)],
    ['Notebooks','notebook',(state.notebooks??[]).filter(item=>item.projectId===id)],
    ['Knowledge','knowledge',(state.knowledge??[]).filter(item=>item.projectId===id)],
    ['Skills','skill',(state.skills??[]).filter(item=>item.projectId===id)],
    ['Workflows','workflow',(state.workflows??[]).filter(item=>item.projectId===id)],
    ['Gems','gem',state.gems.filter(item=>gems.has(item.id))]
  ];
  return <>
    <button className="card-link" onClick={onBack}><ArrowLeft size={16}/>All projects</button>
    <div className="page-heading"><span className="page-icon"><Folder size={23}/></span>
      <div><h1>{project.name}</h1>{project.description&&<p dir="auto">{project.description}</p>}</div>
      <button className="button primary" onClick={onChat}><Plus size={17}/>New project chat</button>
    </div>
    <div className="flow-row">
      <button className="button secondary" onClick={onEdit}>Edit project</button>
      <button className="button secondary" onClick={onChild}>New subproject</button>
      <button className="button secondary" onClick={onFile}>Add project file</button>
      <button className="button secondary" onClick={onManageGems}>Choose project Gems</button>
    </div>
    {project.instructions&&<section className="workspace-card"><details><summary>Project instructions</summary><p className="message-text" dir="auto">{project.instructions}</p></details></section>}
    <div className="card-grid">{groups.map(([heading,kind,items])=><section className="workspace-card" key={heading}><h2>{heading}</h2>
      {items.length?<div className="pick-list">{items.map(item=><button type="button" key={item.id} className="pick-row" onClick={()=>onOpen(kind,item)}>
        <span dir="auto">{item.title??item.name}</span><ArrowRight size={15}/>
      </button>)}</div>:<p className="hint">None yet.</p>}
    </section>)}</div>
  </>;
}
