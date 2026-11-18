const problem=(status,message)=>Object.assign(new Error(message),{status});
export const notebookIdPattern=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;

export function notebookAvailable(env,owner){
  return !!(env.KAPRON_NOTEBOOKLM_URL && env.KAPRON_NOTEBOOKLM_TOKEN &&
    (env.LOCAL_USER ? owner==='local-owner' : !!env.KAPRON_NOTEBOOKLM_OWNER && owner===env.KAPRON_NOTEBOOKLM_OWNER));
}

export async function notebookCall(env,owner,operation,input={},signal){
  if(!notebookAvailable(env,owner))throw problem(409,'NotebookLM is not connected for this workspace.');
  if(operation==='ask'&&(!notebookIdPattern.test(input.notebookId)||typeof input.question!=='string'||!input.question.trim()||input.question.length>8000))
    throw problem(400,'Choose a notebook and enter a question of up to 8,000 characters.');
  let url;
  try{
    url=new URL(env.KAPRON_NOTEBOOKLM_URL);
    if(url.username||url.password||url.hash||url.search||url.pathname!=='/'||
       !(url.protocol==='https:'||(env.LOCAL_USER&&url.protocol==='http:'&&['127.0.0.1','[::1]','localhost'].includes(url.hostname))))throw Error();
    url.pathname=operation==='ask'?'/v1/ask':'/v1/notebooks';
  }catch{throw problem(409,'NotebookLM connector endpoint is misconfigured.');}
  let response;
  try{
    response=await (env.NOTEBOOK_FETCH??fetch)(new Request(url,{method:operation==='ask'?'POST':'GET',redirect:'error',
      headers:{authorization:'Bearer '+env.KAPRON_NOTEBOOKLM_TOKEN,'content-type':'application/json'},
      ...(operation==='ask'?{body:JSON.stringify({notebookId:input.notebookId,question:input.question})}:{}),
      signal:AbortSignal.any([AbortSignal.timeout(55000),...(signal?[signal]:[])])}));
  }catch{throw problem(422,'NotebookLM companion is unavailable or timed out. Check it and resume the run.');}
  if(!response.ok){
    await response.body?.cancel().catch(()=>{});
    if(response.status===409)throw problem(409,'NotebookLM sign-in expired or is missing. Sign in again on the companion.');
    if(response.status===404)throw problem(409,'This notebook is unavailable or outside the companion allowlist.');
    if(response.status===429)throw problem(429,'NotebookLM is busy or rate-limited. Resume the run later.');
    if(response.status===401)throw problem(409,'NotebookLM companion token does not match the app configuration.');
    throw problem(422,'NotebookLM could not complete the request. Check the companion and resume.');
  }
  const reader=response.body?.getReader();
  if(!reader)throw problem(422,'NotebookLM returned an empty response.');
  const decoder=new TextDecoder();
  let text='',length=0,result;
  try{
    for(;;){
      const {value,done}=await reader.read();
      if(done)break;
      if((length+=value.byteLength)>200000)throw Error();
      text+=decoder.decode(value,{stream:true});
    }
    result=JSON.parse(text+decoder.decode());
  }catch{throw problem(422,'NotebookLM returned an invalid response.');}
  finally{await reader.cancel().catch(()=>{});}
  if(operation==='list'){
    if(!Array.isArray(result?.notebooks))throw problem(422,'NotebookLM returned an invalid notebook list.');
    return {notebooks:result.notebooks.filter(x=>typeof x?.id==='string'&&notebookIdPattern.test(x.id)&&typeof x.title==='string')
      .slice(0,100).map(x=>({id:x.id,title:x.title.slice(0,200)}))};
  }
  if(typeof result?.answer!=='string'||!result.answer.trim())throw problem(422,'NotebookLM returned no answer.');
  const citations=(Array.isArray(result.citations)?result.citations:[]).slice(0,20).flatMap(item=>{
    if(typeof item?.sourceId!=='string'||!notebookIdPattern.test(item.sourceId))return [];
    return [{sourceId:item.sourceId,number:Number.isSafeInteger(item.number)?item.number:null,
      quote:typeof item.quote==='string'?item.quote.slice(0,600):''}];
  });
  return {answer:result.answer.slice(0,8000),citations};
}
