let runner;
const send=(id,kind,text='')=>parent.postMessage({source:'kapron-sandbox',id,kind,text:String(text).slice(0,6000)},'*');
addEventListener('message',event=>{
  const input=event.data;
  if(event.source!==parent||input?.source!=='kapron-canvas'||typeof input.code!=='string'||input.code.length>80000)return;
  runner?.terminate();
  let url;
  const setup=`
const send=(kind,text='')=>postMessage({kind,text});
const format=value=>{try{return typeof value==='string'?value:JSON.stringify(value);}catch{return String(value);}};
const console=Object.fromEntries(['log','warn','error','info'].map(key=>[key,(...values)=>send(key,values.map(format).join(' '))]));
`;
  // A dedicated worker is terminated after a fixed deadline and inherits this frame's network policy.
  const source=setup+'\n(async()=>{\n'+input.code+'\n})().then(()=>send("done"),error=>send("error",String(error)));';
  try{
    url=URL.createObjectURL(new Blob([source],{type:'text/javascript'}));
    runner=new Worker(url);
    const current=runner;
    const stop=()=>{clearTimeout(timer);current.terminate();URL.revokeObjectURL(url);if(runner===current)runner=null;};
    let events=0;
    const timer=setTimeout(()=>{send(input.id,'error','Execution timed out.');stop();},2200);
    current.onmessage=e=>{
      const {kind,text}=e.data??{};
      if(++events>50){send(input.id,'error','Output limit reached.');stop();return;}
      if(['log','warn','info','error','done'].includes(kind))send(input.id,kind,text);
      if(kind==='done'||kind==='error')stop();
    };
    current.onerror=e=>{send(input.id,'error',e.message||'Script could not run.');stop();};
  }catch(error){if(url)URL.revokeObjectURL(url);send(input.id,'error',error.message);}
});
addEventListener('pagehide',()=>runner?.terminate());
