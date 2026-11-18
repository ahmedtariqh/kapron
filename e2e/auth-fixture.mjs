import {createServer} from 'node:http';
import {Readable} from 'node:stream';
import worker from '../dist/server/index.js';

const origin='http://127.0.0.1:4188';
const account={id:'8a103fae-f607-48bd-bbf4-4690d505a321',email:'fixture@example.test'};
const access='browser.access.fixture';
const refresh='browser-refresh-fixture';
const session={access_token:access,refresh_token:refresh,expires_in:3600};
const invalid=()=>Response.json({error_code:'invalid_credentials'},{status:400});
const env={
  SUPABASE_URL:'https://kapron-auth-fixture.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fixture',
  KAPRON_PUBLIC_URL:origin,KAPRON_AUTH_GOOGLE:'1',
  DB:{prepare(){return {bind(){return {async first(){return null;}};}};}},
  async AUTH_FETCH(request){
    const url=new URL(request.url);
    if(url.pathname.endsWith('/user'))return request.headers.get('authorization')==='Bearer '+access?Response.json(account):invalid();
    if(url.pathname.endsWith('/logout'))return new Response(null,{status:204});
    if(url.pathname.endsWith('/signup'))return (await request.json()).email===account.email?Response.json(account):invalid();
    const body=await request.json();
    switch(url.searchParams.get('grant_type')){
      case 'password': return body.email===account.email&&body.password==='test-password'?Response.json(session):invalid();
      case 'pkce': return ['test-google-code','test-email-code'].includes(body.auth_code)&&body.code_verifier?.length===43?Response.json(session):invalid();
      case 'refresh_token': return body.refresh_token===refresh?Response.json(session):invalid();
      default: return invalid();
    }
  }
};

createServer(async (req,res)=>{
  try{
    const response=await worker.fetch(new Request(new URL(req.url,origin),{method:req.method,headers:req.headers,
      ...(req.method!=='GET'&&req.method!=='HEAD'?{body:Readable.toWeb(req),duplex:'half'}:{})}),env);
    const headers=Object.fromEntries(response.headers);
    if(response.headers.getSetCookie().length)headers['set-cookie']=response.headers.getSetCookie();
    res.writeHead(response.status,headers);
    if(response.body)Readable.fromWeb(response.body).pipe(res);else res.end();
  }catch{res.writeHead(500).end('Authentication fixture failed');}
}).listen(4188,'127.0.0.1');
