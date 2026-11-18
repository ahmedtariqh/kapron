import {providerRequest,sse,extractText,providerError} from '../server/providers.js';
import {reportedUsage} from '../server/model-policy.js';

export async function api(path,{method='GET',body,signal}={}) {
  let response;
  try{response=await fetch('/api/'+path,{method,signal,headers:{'x-kapron-request':'1',...(body===undefined?{}:{'content-type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});}
  catch(e){if(e.name==='AbortError')throw e;throw new Error('Kapron could not reach the server.');}
  if(!response.ok){
    const payload=await response.json().catch(()=>({}));
    const error=new Error(payload.error || 'Kapron could not complete this request.');
    error.status=response.status;throw error;
  }
  return response;
}
export async function get(path,options) { return (await api(path,options)).json(); }

function keyDatabase(){
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open('kapron-device-keys',1);
    request.onupgradeneeded=()=>request.result.createObjectStore('connections');
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(new Error('Device key storage is unavailable.'));
  });
}
async function deviceOperation(user,id,operation,value){
  const db=await keyDatabase();
  try{return await new Promise((resolve,reject)=>{
    const tx=db.transaction('connections',operation==='get'?'readonly':'readwrite');
    const store=tx.objectStore('connections'), key=user+':'+id;
    const request=operation==='put'?store.put(value,key):store[operation](key);
    tx.oncomplete=()=>resolve(request.result);
    tx.onabort=tx.onerror=()=>reject(new Error('Device key storage operation failed.'));
  });}finally{db.close();}
}
export const getDeviceKey=(user,id)=>deviceOperation(user,id,'get');
export const saveDeviceKey=(user,id,value)=>deviceOperation(user,id,'put',value);
export const removeDeviceKey=(user,id)=>deviceOperation(user,id,'delete');

export async function streamRun({connection,model,context,options,user,signal,onDelta,onMetadata}){
  const input={connectionId:connection.id,model,...context,options};
  let response, direct=false, key;
  if(connection.mode==='device'){
    key=await getDeviceKey(user,connection.id);
    if(!key && connection.provider!=='custom') throw new Error('Add this connection’s key on this device, or switch it to the vault.');
    direct=!connection.relay || connection.provider==='custom';
  }
  if(direct){
    const request=providerRequest({provider:connection.provider,endpoint:connection.endpoint,key,...input,signal});
    try{response=await fetch(request);}
    catch(e){if(e.name==='AbortError')throw e;throw new Error('The browser could not reach the endpoint. Check the URL, network, and endpoint CORS settings.');}
    if(!response.ok){await response.body?.cancel();throw new Error(providerError(response.status));}
  } else {
    response=await api('runs',{method:'POST',body:{...input,...(key?{deviceKey:key}:{})},signal});
  }
  let text='',done=false,usage,upstreamModel;
  for await(const event of sse(response)){
    if(event.error) throw new Error(typeof event.error==='string'?event.error:'The provider ended the stream with an error.');
    if(event.done) done=true;
    const observed=direct?reportedUsage(connection.provider,event):event.usage;
    if(observed)usage={...usage,...observed};
    const identity=direct?(event.model??event.modelVersion):event.upstreamModel;
    if(typeof identity==='string'&&/^[\w.:/\-]{1,160}$/.test(identity))upstreamModel=identity;
    const part=direct?extractText(connection.provider,event):event.delta;
    if(typeof part!=='string' || !part)continue;
    text+=part;
    if(text.length>60_000)throw new Error('The reply exceeded the response size limit.');
    onDelta(text);
  }
  if(!direct&&!done)throw new Error('The reply stream disconnected before completion.');
  if(!text)throw new Error('The provider returned no visible text.');
  onMetadata?.({usage,upstreamModel});
  return text;
}
