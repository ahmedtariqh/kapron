export const liveModel='gpt-realtime-2';
const formats={'audio/webm':'webm','audio/ogg':'ogg','audio/mp4':'mp4','audio/wav':'wav','audio/mpeg':'mp3'};
const problem=(status,message)=>Object.assign(new Error(message),{status});

export async function voiceRequest({kind,input,key,request,fetcher=fetch}){
  const form=new FormData();
  const realtime=kind==='live';
  const languages={ar:'Reply in Egyptian Arabic unless the speaker asks for another language.',en:'Reply in English unless asked otherwise.',auto:'Reply in the language the speaker uses.'};
  if(!Object.hasOwn(languages,input?.language))throw problem(400,'Choose a speech language.');
  if(realtime){
    if(typeof input.sdp!=='string'||input.sdp.length>60000||!input.sdp.startsWith('v=0')||!/^m=audio /m.test(input.sdp)||!/^m=application /m.test(input.sdp)||/^m=video /m.test(input.sdp))
      throw problem(400,'Invalid voice connection offer.');
    form.set('sdp',input.sdp);
    form.set('session',JSON.stringify({type:'realtime',model:liveModel,instructions:languages[input.language],
      audio:{input:{transcription:{model:'gpt-transcribe',...(input.language==='auto'?{}:{language:input.language})},
        turn_detection:{type:'server_vad',create_response:true,interrupt_response:true}},output:{voice:'marin'}}}));
  }else{
    if(!Object.hasOwn(formats,input.mime)||typeof input.audio!=='string'||input.audio.length>2800000)
      throw problem(400,'Record supported audio under 2 MB.');
    let bytes;
    try{bytes=Uint8Array.from(atob(input.audio),c=>c.charCodeAt(0));}catch{throw problem(400,'Invalid audio data.');}
    if(!bytes.length||bytes.length>2097152)throw problem(400,'Record supported audio under 2 MB.');
    form.set('file',new Blob([bytes],{type:input.mime}),'prompt.'+formats[input.mime]);
    form.set('model','gpt-transcribe');
    if(input.language!=='auto')form.set('language',input.language);
  }
  let response;
  try{
    response=await fetcher(new Request('https://api.openai.com/v1/'+(realtime?'realtime/calls':'audio/transcriptions'),{
      method:'POST',headers:{authorization:'Bearer '+key},body:form,redirect:'error',
      signal:AbortSignal.any([request.signal,AbortSignal.timeout(35000)])
    }));
    if(!response.ok){
      await response.body?.cancel();
      throw problem(response.status===429?429:422,'OpenAI could not start '+(realtime?'live voice':'transcription')+' (HTTP '+response.status+'). Check model access and quota.');
    }
    const reader=response.body.getReader(), decoder=new TextDecoder();
    let data='',size=0;
    try{
      for(;;){
        const item=await reader.read();
        if(item.done)break;
        if((size+=item.value.byteLength)>100000)throw Error();
        data+=decoder.decode(item.value,{stream:true});
      }
      data+=decoder.decode();
    }finally{await reader.cancel().catch(()=>{});}
    if(realtime){
      if(!data.startsWith('v=0'))throw Error();
      return {sdp:data,model:liveModel};
    }
    const transcript=JSON.parse(data).text;
    if(typeof transcript!=='string')throw Error();
    return {text:transcript.trim().slice(0,24000)};
  }catch(error){
    if(error.status)throw error;
    throw problem(422,'The voice provider did not return a usable response.');
  }
}
