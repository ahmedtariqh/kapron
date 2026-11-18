import {abliteratedEligible,chooseModel,makeDecision,parseDecision,requestDecision,routingCandidates,rulesDecision} from '../server/routing.js';
import {assembleContext,getConnection} from '../server/state.js';
import {get,getDeviceKey} from './api.js';

export async function resolveRoute({state,chat,row,prompt,prior,user,options,signal}){
  const routeState=state.settings.routing??{};
  const candidates=routingCandidates(state,chat,row.scope,prompt);
  const auto=row.choice.connectionId==='auto';
  const checkProfile=auto&&abliteratedEligible(state,row.scope,prompt);
  const resolveResources=candidates.skills.length||candidates.knowledge.length;
  let decision, engine='manual', reason='';
  if(auto||resolveResources){
    if(routeState.cloud&&row.scope.routingCloud!==false){
      const result=await get('routing',{method:'POST',body:{chatId:chat.id,scope:{...row.scope,abliterated:checkProfile},prompt:prompt.slice(0,1400)},signal})
        .catch(error=>{if(signal.aborted)throw error;return {reason:'Decision service unavailable'};});
      reason=result.reason??'';
      if(result.decision){decision=result.decision;engine='jev';}
    }
    if(!decision&&routeState.laya){
      const target=URL.canParse(routeState.laya)?new URL(routeState.laya):null;
      if(target?.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(target.hostname)&&!target.username&&!target.password&&!target.search&&!target.hash&&target.pathname==='/decide'){
        const result=await requestDecision(new Request(target,{method:'POST',headers:{'content-type':'application/json'},credentials:'omit',redirect:'error',
          signal:AbortSignal.any([signal,AbortSignal.timeout(2200)]),body:JSON.stringify(makeDecision(prompt,candidates,checkProfile))}));
        decision=parseDecision(result.decision,candidates,checkProfile);
        if(decision)engine='laya';
        else reason=[reason,result.reason??'Laya decision uncertain'].filter(Boolean).join('. ');
      }
    }
    if(!decision){decision=rulesDecision(prompt,candidates);engine='rules';}
  }
  decision??={family:'general',skills:[],knowledge:[]};
  const selected={family:decision.family};
  for(const group of ['skills','knowledge'])selected[group]=candidates[group].filter(c=>decision[group].includes(c.id)).map(c=>c.id);
  const context=assembleContext(state,chat,row.gem,row.scope,prompt,prior,selected);
  let connection=getConnection(state,row.choice.connectionId);
  if(auto){
    const length=context.instruction.length+context.messages.reduce((total,m)=>total+m.text.length,0)+(options.maxOutput??0)*4;
    const ready=new Set(state.connections.some(c=>c.mode==='vault')?(await get('connection-readiness',{signal})).ready:[]);
    const eligible=await Promise.all(state.connections.map(async c=>{
      if(c.mode==='vault')return ready.has(c.id+':'+c.provider)?c:null;
      return c.provider==='custom'||await getDeviceKey(user,c.id).catch(()=>null)?c:null;
    }));
    connection=chooseModel(eligible.filter(Boolean),selected.family,length,routeState.preference,checkProfile?decision.profile:undefined);
    if(!connection && state.connections.length===0)connection=getConnection(state,'demo');
  }
  if(!connection)throw new Error('No available connection fits this request. Check your keys and Auto routing settings.');
  return {connection,model:auto?connection.model:row.choice.model,context,trace:{engine,family:selected.family,reason,
    ...(auto&&connection.routing?.profile==='abliterated'?{profile:'abliterated'}:{}),
    skills:(state.skills??[]).filter(x=>selected.skills.includes(x.id)).map(x=>x.name+' v'+x.version),
    knowledge:(state.knowledge??[]).filter(x=>selected.knowledge.includes(x.id)).map(x=>x.name)}};
}
