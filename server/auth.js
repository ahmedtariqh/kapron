const accessCookie='__Host-kapron-session';
const refreshCookie='__Host-kapron-refresh';
const flowCookie=provider=>'__Host-kapron-pkce-'+provider;
const refreshAge=30*86400;
const problem=(status,message)=>Object.assign(new Error(message),{status,publicAuth:true});
const authUnavailable=()=>problem(503,'Supabase Auth is temporarily unavailable.');
const invalidConfig=()=>problem(503,'Configure the Supabase project URL and publishable or anon key on the Kapron server.');
const tokenValid=value=>typeof value==='string'&&/^[\w.-]{16,3800}$/.test(value);
const refreshValid=value=>typeof value==='string'&&/^[\w.-]{8,3800}$/.test(value);

function publicKey(key){
  if(typeof key!=='string'||key.length>4096)return false;
  if(/^sb_publishable_[\w-]+$/.test(key))return true;
  const parts=key.split('.');
  if(parts.length!==3||!parts.every(part=>/^[\w-]+$/.test(part)))return false;
  try{return JSON.parse(atob(parts[1].replaceAll('-','+').replaceAll('_','/'))).role==='anon';}
  catch{return false;}
}
function settings(env){
  const origin=(env.KAPRON_SUPABASE_URL||env.SUPABASE_URL||'').trim();
  const key=(env.KAPRON_SUPABASE_KEY||env.SUPABASE_PUBLISHABLE_KEY||env.SUPABASE_ANON_KEY||'').trim();
  const url=URL.canParse(origin)?new URL(origin):null;
  return url?.protocol==='https:'&&!url.username&&!url.password&&url.pathname==='/'&&!url.search&&!url.hash&&publicKey(key)
    ?{base:url.origin+'/auth/v1',key}:null;
}
export function authConfig(env){
  if(env.LOCAL_USER)return {mode:'local',ready:true,google:false};
  if(env.KAPRON_SUPABASE_URL||env.SUPABASE_URL||env.KAPRON_SUPABASE_KEY||env.SUPABASE_PUBLISHABLE_KEY||env.SUPABASE_ANON_KEY||
    env.SUPABASE_DATABASE_PASSWORD||env.KAPRON_AUTH_GOOGLE==='1'){
    const ready=!!settings(env);
    return {mode:'email',ready,google:ready&&env.KAPRON_AUTH_GOOGLE==='1'};
  }
  return {mode:'sites',ready:env.KAPRON_TRUST_SITES_IDENTITY==='1',google:false};
}
async function authCall(env,path,{method='GET',body,access}={}){
  const config=settings(env);
  if(!config)throw invalidConfig();
  try{
    const response=await (env.AUTH_FETCH??fetch)(new Request(config.base+path,{method,redirect:'error',signal:AbortSignal.timeout(8000),
      headers:{apikey:config.key,'content-type':'application/json',...(access?{authorization:'Bearer '+access}:{})},
      ...(body?{body:JSON.stringify(body)}:{})}));
    return {ok:response.ok,status:response.status,data:await response.json().catch(()=>null)};
  }catch{throw authUnavailable();}
}
const cookie=(name,value,age)=>name+'='+value+'; Max-Age='+age+'; Path=/; Secure; HttpOnly; SameSite=Lax';
function cookieValue(request,name){
  const values=request.headers.get('cookie')?.split(';').map(item=>item.trim()).filter(item=>item.startsWith(name+'='))??[];
  return values.length===1?values[0].slice(name.length+1):'';
}
const clearSession=()=>[cookie(accessCookie,'',0),cookie(refreshCookie,'',0),cookie(flowCookie('google'),'',0),cookie(flowCookie('email'),'',0)];
function signedIn(data){
  if(!tokenValid(data?.access_token)||!refreshValid(data?.refresh_token))throw problem(502,'Supabase returned an invalid session.');
  const expires=Number(data.expires_in);
  const accessAge=Number.isFinite(expires)&&expires>0?Math.min(86400,Math.floor(expires)):3600;
  return [cookie(accessCookie,data.access_token,accessAge),cookie(refreshCookie,data.refresh_token,refreshAge)];
}
export async function authenticatedOwner(request,env){
  if(!settings(env))throw invalidConfig();
  const access=cookieValue(request,accessCookie);
  if(!tokenValid(access))return null;
  const {ok,data,status}=await authCall(env,'/user',{access});
  if(status>=500)throw authUnavailable();
  if(status===429)throw problem(429,'Too many authentication requests. Try again shortly.');
  if(!ok||typeof data?.id!=='string'||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(data.id))return null;
  return {id:data.id,email:typeof data.email==='string'?data.email:'',local:false};
}
function appOrigin(request,env){
  const incoming=new URL(request.url);
  const configured=(env.KAPRON_PUBLIC_URL||incoming.origin).trim();
  const origin=URL.canParse(configured)?new URL(configured):null;
  const loopback=origin&&['localhost','127.0.0.1','[::1]'].includes(origin.hostname);
  if(!origin||origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash||
    (origin.protocol!=='https:'&&!(loopback&&origin.protocol==='http:'))||origin.origin!==incoming.origin)
    throw problem(400,'Open Kapron on its configured public URL to continue.');
  return origin.origin;
}
const callbackPath=provider=>'/api/auth/callback/'+provider;
const encode=bytes=>btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
async function proof(){
  const verifier=encode(crypto.getRandomValues(new Uint8Array(32)));
  const challenge=encode(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))));
  return {verifier,challenge};
}
export async function startGoogle(request,env){
  const config=settings(env);
  if(!config)throw invalidConfig();
  if(!authConfig(env).google)throw problem(404,'Google sign-in is unavailable.');
  const {verifier,challenge}=await proof();
  const url=new URL(config.base+'/authorize');
  url.search=new URLSearchParams({provider:'google',redirect_to:appOrigin(request,env)+callbackPath('google'),
    code_challenge:challenge,code_challenge_method:'s256'}).toString();
  return {data:{url:url.href},cookies:[cookie(flowCookie('google'),verifier,600)]};
}
export async function completeAuth(request,env,provider){
  const origin=appOrigin(request,env);
  const redirect=status=>origin+'/?auth='+status;
  const expired=cookie(flowCookie(provider),'',0);
  const params=new URL(request.url).searchParams;
  const code=params.get('code');
  const verifier=cookieValue(request,flowCookie(provider));
  const failure=provider==='email'?'email-finish':'google-failed';
  if(provider==='google'&&!authConfig(env).google)return {url:redirect(failure),cookies:[expired]};
  if(params.has('error')||!code||!/^[\w.-]{8,512}$/.test(code)||!/^[\w-]{43}$/.test(verifier))
    return {url:redirect(failure),cookies:[expired]};
  try{
    const result=await authCall(env,'/token?grant_type=pkce',{method:'POST',body:{auth_code:code,code_verifier:verifier}});
    if(!result.ok)return {url:redirect(failure),cookies:[expired]};
    return {url:origin+'/',cookies:[expired,...signedIn(result.data)]};
  }catch{
    return {url:redirect(failure),cookies:[expired]};
  }
}
function authFailure(result,action){
  if(result.status===429)throw problem(429,'Too many authentication requests. Try again later.');
  if(result.status>=500||result.data?.error_code==='unexpected_failure')throw authUnavailable();
  switch(result.data?.error_code){
    case 'email_not_confirmed': throw problem(401,'Confirm your email before signing in.');
    case 'signup_disabled': throw problem(403,'New account registration is disabled in Supabase.');
    case 'email_provider_disabled': throw problem(403,'Email authentication is disabled in Supabase.');
    case 'email_address_not_authorized': throw problem(403,'The configured email service cannot send to this address.');
    case 'weak_password': throw problem(400,'This password does not meet the project’s password requirements.');
  }
  if(result.status===401&&result.data?.message==='Invalid API key')throw invalidConfig();
  throw problem(action==='login'?401:400,action==='login'?'Sign-in failed. Check your email and password.':'Account creation failed. Check your details or try signing in.');
}
export async function authenticate(request,env,action,values){
  if(action==='logout'){
    const access=cookieValue(request,accessCookie);
    if(tokenValid(access))await authCall(env,'/logout?scope=local',{method:'POST',access}).catch(()=>{});
    return {data:{signedOut:true},cookies:clearSession()};
  }
  if(action==='refresh'){
    const refresh=cookieValue(request,refreshCookie);
    if(!refreshValid(refresh))return {data:{signedIn:false},status:401};
    const result=await authCall(env,'/token?grant_type=refresh_token',{method:'POST',body:{refresh_token:refresh}});
    if(!result.ok){
      if(result.status>=500)throw authUnavailable();
      if(result.status===429)throw problem(429,'Too many authentication requests. Try again shortly.');
      return {data:{signedIn:false},status:401,cookies:clearSession().slice(0,2)};
    }
    return {data:{signedIn:true},cookies:signedIn(result.data)};
  }
  const email=typeof values?.email==='string'?values.email.trim():'';
  const password=values?.password;
  if(!email||email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||
    typeof password!=='string'||password.length<(action==='signup'?8:1)||password.length>128)
    throw problem(400,action==='signup'?'Enter a valid email and a password between 8 and 128 characters.':'Enter a valid email address and your password.');
  if(action==='login'){
    const result=await authCall(env,'/token?grant_type=password',{method:'POST',body:{email,password}});
    if(!result.ok)authFailure(result,action);
    return {data:{signedIn:true},cookies:signedIn(result.data)};
  }
  const {verifier,challenge}=await proof();
  const redirect=encodeURIComponent(appOrigin(request,env)+callbackPath('email'));
  const result=await authCall(env,'/signup?redirect_to='+redirect,{method:'POST',body:{email,password,code_challenge:challenge,code_challenge_method:'s256'}});
  if(!result.ok)authFailure(result,action);
  if(result.data?.access_token)return {data:{signedIn:true},cookies:signedIn(result.data)};
  if(!result.data?.id&&!result.data?.user?.id)throw problem(502,'Supabase returned an invalid signup response.');
  return {data:{confirmEmail:true},cookies:[cookie(flowCookie('email'),verifier,86400)]};
}
