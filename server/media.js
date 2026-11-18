const problem=(status,message)=>Object.assign(new Error(message),{status});
const destinations={search:'https://api.tavily.com/search',generate:'https://api.openai.com/v1/images/generations',edit:'https://api.openai.com/v1/images/edits',vision:'https://api.openai.com/v1/chat/completions'};
const imageTypes=new Set(['image/png','image/jpeg','image/webp']);
function imageData(image) {
  if(!image||!imageTypes.has(image.mime)||typeof image.data!=='string'||image.data.length>1400000||!/^[-+/=a-zA-Z0-9]+$/.test(image.data))
    throw problem(400,'Choose a PNG, JPEG, or WebP image under 1 MB.');
  return image;
}
async function readProvider(response,limit){
  if(!response.ok){
    await response.body?.cancel();
    throw problem(422,'The upstream service returned HTTP '+response.status+'. Check the connection and provider quota.');
  }
  const reader=response.body?.getReader();
  if(!reader)throw problem(422,'The upstream service returned an empty response.');
  const decoder=new TextDecoder();
  let bytes=0,text='';
  try{
    for(;;){
      const {done,value}=await reader.read();
      if(done)break;
      bytes+=value.byteLength;
      if(bytes>limit)throw problem(422,'The upstream response exceeds the size limit.');
      text+=decoder.decode(value,{stream:true});
    }
    return JSON.parse(text+decoder.decode());
  }catch(error){throw error.status?error:problem(422,'The upstream response was invalid.');}
  finally{await reader.cancel().catch(()=>{});}
}
export async function mediaRequest({operation,prompt,image,key,model,signal,fetcher=fetch}){
  if(!Object.hasOwn(destinations,operation)||typeof prompt!=='string'||!prompt.trim()||prompt.length>(operation==='search'?400:4000))throw problem(400,'Enter a valid prompt for this tool.');
  if(!key)throw problem(400,'Configure an authorized key for this tool.');
  const headers={authorization:'Bearer '+key};
  let body;
  if(operation==='edit'){
    const input=imageData(image);
    let raw;
    try{raw=Uint8Array.from(atob(input.data),c=>c.charCodeAt(0));}catch{throw problem(400,'The image encoding is invalid.');}
    body=new FormData();
    body.set('model',model);
    body.set('prompt',prompt);
    body.set('image',new Blob([raw],{type:input.mime}), 'image.'+input.mime.split('/')[1]);
  }else{
    headers['content-type']='application/json';
    if(operation==='search')body=JSON.stringify({query:prompt,max_results:5,search_depth:'basic'});
    if(operation==='generate')body=JSON.stringify({model,prompt,n:1});
    if(operation==='vision'){
      const input=imageData(image);
      body=JSON.stringify({model,messages:[{role:'user',content:[{type:'text',text:prompt},{type:'image_url',image_url:{url:'data:'+input.mime+';base64,'+input.data}}]}]});
    }
  }
  const deadline=AbortSignal.any([signal,AbortSignal.timeout(operation==='search'?10000:100000)]);
  let response;
  try{response=await fetcher(new Request(destinations[operation],{method:'POST',headers,body,signal:deadline,redirect:'error'}));}
  catch{throw problem(422,'The upstream request timed out or failed.');}
  const result=await readProvider(response,['edit','generate'].includes(operation)?15000000:600000);
  if(operation==='vision'){
    const text=result.choices?.[0]?.message?.content;
    if(typeof text!=='string'||!text.trim())throw problem(422,'The model returned no visible text.');
    return {text:text.slice(0,24000)};
  }
  if(operation==='search')return {sources:(Array.isArray(result.results)?result.results:[]).flatMap(item=>{
    try{
      const url=new URL(item.url);
      if(!['http:','https:'].includes(url.protocol)||url.username||url.password)return [];
      return [{url:url.href,title:String(item.title??url.hostname).slice(0,200),excerpt:String(item.content??'').slice(0,1800),...(typeof item.published_date==='string'&&/^\d{4}-\d{2}-\d{2}/.test(item.published_date)?{date:item.published_date.slice(0,10)}:{})}];
    }catch{return [];}
  }).slice(0,5)};
  const data=result.data?.[0]?.b64_json;
  if(typeof data!=='string'||!data||!/^[-+/=a-zA-Z0-9]+$/.test(data))throw problem(422,'The provider returned no image bytes.');
  return {data,mime:'image/png'};
}
