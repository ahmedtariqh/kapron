import {abliteratedEligible,makeDecision,parseDecision,requestDecision,routingCandidates} from './routing.js';

const backoff=new Map();
export async function decideWithJev({env,owner,state,chat,scope,prompt,request,key}){
  const candidates=routingCandidates(state,chat,scope,prompt);
  if(state.settings.routing?.cloud!==true || !key)return {reason:'BeatAPI routing disabled or key missing'};
  if((backoff.get(owner.id)??0)>Date.now())return {reason:'BeatAPI rate limit cooldown'};
  const signal=AbortSignal.any([request.signal,AbortSignal.timeout(2500)]);
  const checkProfile=abliteratedEligible(state,scope,prompt);
  const body=makeDecision(prompt,candidates,checkProfile);
  const result=await requestDecision(new Request('https://api.beatapi.io/v1/systemone',{
    method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+key},redirect:'error',signal,
    body:JSON.stringify({model:env.KAPRON_JEV_MODEL||'jev-1.14',...body})
  }),env.DECISION_FETCH??fetch);
  if(result.reason==='HTTP 429'){
    const seconds=result.retryAfter==null?60:Number(result.retryAfter);
    const delay=Number.isFinite(seconds)?seconds*1000:Date.parse(result.retryAfter)-Date.now();
    for(const [id,until] of backoff)if(until<=Date.now())backoff.delete(id);
    if(backoff.size>=1000)backoff.delete(backoff.keys().next().value);
    backoff.set(owner.id,Date.now()+Math.min(3600000,Math.max(1000,delay||60000)));
  }
  const decision=parseDecision(result.decision,candidates,checkProfile);
  return decision?{decision,engine:'jev'}:{reason:result.reason||'Jev decision incomplete or uncertain'};
}
