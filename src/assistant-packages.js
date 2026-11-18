import {taskFamilies} from '../server/routing.js';

const bounded=(value,limit,label,required=false)=>{
  if(typeof value!=='string'||value.length>limit||(required&&!value.trim()))throw new Error('Invalid '+label+' in the package.');
  return value;
};

export function parseAssistantPackage(kind,pack){
  if(pack?.format!=='kapron-'+kind+'-v1'||!pack.config||typeof pack.config!=='object')throw new Error('Choose a Kapron '+kind+' package.');
  const value=pack.config;
  const common={name:bounded(value.name,80,'name',true),description:bounded(value.description??'',kind==='skill'?240:180,'description')};
  if(kind==='gem')return {...common,instructions:bounded(value.instructions??'',8000,'instructions'),knowledge:bounded(value.knowledge??'',10000,'reference material'),choice:null,options:{}};
  if(kind!=='skill'||!Object.hasOwn(taskFamilies,value.family))throw new Error('Choose a supported skill task family.');
  return {...common,family:value.family,text:bounded(value.text,40000,'instructions',true),projectId:null,enabled:false};
}

export function exportAssistantPackage(kind,config){
  return {format:'kapron-'+kind+'-v1',config:parseAssistantPackage(kind,{format:'kapron-'+kind+'-v1',config})};
}
