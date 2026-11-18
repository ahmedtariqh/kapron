const cookieName='__Host-kapron-session';
const sessionAge=3600;
const problem=(status,message)=>Object.assign(new Error(message),{status});

function config(env){
  const url=new URL(env.KAPRON_SUPABASE_URL);
  if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash||!env.KAPRON_SUPABASE_KEY)
    throw problem(503,'Authentication service is not configured.');
  return {base:url.origin+'/auth/v1',key:env.KAPRON_SUPABASE_KEY};
}
async function authCall(env,path,{method='GET',body,access}={}){
  const {base,key}=config(env);
  try{
    const response=await (env.AUTH_FETCH??fetch)(new Request(base+path,{method,redirect:'error',signal:AbortSignal.timeout(8000),
      headers:{apikey:key,'content-type':'application/json',...(access?{authorization:'Bearer '+access}:{})},
      ...(body?{body:JSON.stringify(body)}:{})}));
    return {ok:response.ok,status:response.status,data:await response.json().catch(()=>null)};
  }catch{throw problem(503,'Authentication service is temporarily unavailable.');}
}
export function sessionCookie(value,maxAge){
  return cookieName+'='+value+'; Max-Age='+maxAge+'; Path=/; Secure; HttpOnly; SameSite=Lax';
}
export async function authenticatedOwner(request,env){
  const access=request.headers.get('cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName+'='))?.slice(cookieName.length+1);
  if(!access||!/^[\w.-]{16,4096}$/.test(access))return null;
  const {ok,data,status}=await authCall(env,'/user',{access});
  if(status>=500)throw problem(503,'Authentication service is temporarily unavailable.');
  if(!ok||typeof data?.id!=='string'||!/^[a-f0-9-]{36}$/i.test(data.id))return null;
  return {id:data.id,email:data.email??'',local:false};
}
export async function authenticate(env,action,values){
  if(action==='logout')return {data:{signedOut:true},cookie:sessionCookie('',0)};
  if(!['login','signup'].includes(action)||typeof values?.email!=='string'||typeof values?.password!=='string'||values.email.length>254||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)||values.password.length<8||values.password.length>128)
    throw problem(400,'Enter a valid email address and a password between 8 and 128 characters.');
  const {ok,status,data}=await authCall(env,action==='signup'?'/signup':'/token?grant_type=password',{
    method:'POST',body:{email:values.email,password:values.password}
  });
  if(status===429)throw problem(429,'Too many sign-in requests. Try again later.');
  if(!ok)throw problem(status>=500?503:401,status>=500?'Authentication service unavailable.':'Sign-in failed. Check your credentials and confirm your email.');
  if(!data?.access_token&&action==='signup')return {data:{confirmEmail:true}};
  if(!/^[\w.-]{16,4096}$/.test(data?.access_token??''))throw problem(502,'Authentication response invalid.');
  return {data:{signedIn:true},cookie:sessionCookie(data.access_token,Math.min(sessionAge,Number(data.expires_in)||sessionAge))};
}
