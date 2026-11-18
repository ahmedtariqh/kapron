import {createServer} from 'node:http';
import {once} from 'node:events';

const id='a64a7a73-3f65-4cd6-8ca7-ceb725e77e0a';
const server=createServer(async(req,res)=>{
  res.setHeader('content-type','application/json');
  if(['/v1/models','/v1/chat/completions'].includes(req.url)){
    if(req.headers.authorization!=='Bearer mock-browser-gateway-key'){
      res.writeHead(401).end('{}');return;
    }
    if(req.url==='/v1/models'&&req.method==='GET'){
      res.end(JSON.stringify({data:[{id:'fixture/text'}]}));return;
    }
    if(req.url==='/v1/chat/completions'&&req.method==='POST'){
      let body='';
      for await(const chunk of req)body+=chunk;
      const {model}=JSON.parse(body);
      if(model!=='fixture/text'){res.writeHead(400).end('{}');return;}
      res.writeHead(200,{'content-type':'text/event-stream'}).end('data: '+JSON.stringify({choices:[{delta:{content:'Gateway fixture streamed the answer.'}}]})+'\n\ndata: [DONE]\n\n');return;
    }
  }
  if(req.headers.authorization!=='Bearer test-notebooklm-token'){
    res.writeHead(401).end('{}');return;
  }
  if(req.url==='/v1/notebooks'&&req.method==='GET'){
    res.end(JSON.stringify({notebooks:[{id,title:'Kapron research fixture'}]}));return;
  }
  if(req.url==='/v1/ask'&&req.method==='POST'){
    let text='';
    for await(const chunk of req)text+=chunk;
    const payload=JSON.parse(text);
    if(payload.notebookId!==id||payload.question!=='What did the approved source conclude?'){
      res.writeHead(400).end('{}');return;
    }
    res.end(JSON.stringify({answer:'NotebookLM fixture answer [1]',citations:[{sourceId:id,number:1,quote:'Approved source excerpt'}]}));return;
  }
  res.writeHead(404).end('{}');
}).listen(0,'127.0.0.1');
await once(server,'listening');
process.env.KAPRON_NOTEBOOKLM_URL='http://127.0.0.1:'+server.address().port;
process.env.KAPRON_NOTEBOOKLM_TOKEN='test-notebooklm-token';
process.env.KAPRON_GATEWAY_PROVIDER='litellm';
process.env.KAPRON_GATEWAY_URL='http://127.0.0.1:'+server.address().port+'/v1';
await import('../scripts/local.mjs');
