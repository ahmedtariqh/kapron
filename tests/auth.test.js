import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import worker from '../dist/server/index.js';

const origin='https://kapron.example';
const upstream='https://test.supabase.co/auth/v1';
const account={id:'8a103fae-f607-48bd-bbf4-4690d505a321',email:'person@example.test'};
const tokens={access_token:'access.token.fixture',refresh_token:'supabase-refresh-fixture',expires_in:3600};
const env={SUPABASE_URL:'https://test.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_example',KAPRON_AUTH_GOOGLE:'1',
  DB:{prepare(){throw new Error('This test should not query the workspace.');}}};
const request=(path,{method='GET',body,headers={},settings=env,base=origin}={})=>worker.fetch(new Request(base+'/api/'+path,{
  method,headers:{'x-kapron-request':'1',...headers,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})
}),settings);
const value=(response,name)=>response.headers.getSetCookie().find(item=>item.startsWith(name+'='))?.split(';')[0];
const digest=verifier=>createHash('sha256').update(verifier).digest('base64url');

test('database password only gives a configuration error and does not use trusted proxy identity',async()=>{
  const settings={SUPABASE_DATABASE_PASSWORD:'database-password',KAPRON_TRUST_SITES_IDENTITY:'1',AUTH_FETCH:()=>{throw new Error('Unexpected request');}};
  const config=await request('auth-config',{settings});
  assert.deepEqual(await config.json(),{mode:'email',ready:false,google:false});
  const session=await request('session',{settings,headers:{'oai-authenticated-user-id':'untrusted'}});
  assert.equal(session.status,503);
  const output=await session.text();
  assert.match(output,/project URL and publishable or anon key/);
  assert.doesNotMatch(output,/database-password/);
  for(const key of ['sb_secret_fixture','password','eyJhbGciOiJIUzI1NiJ9.'+Buffer.from('{"role":"service_role"}').toString('base64url')+'.fake']){
    const checked=await request('auth-config',{settings:{...env,SUPABASE_PUBLISHABLE_KEY:key}});
    assert.equal((await checked.json()).ready,false);
  }
  const anon='eyJhbGciOiJIUzI1NiJ9.'+Buffer.from('{"role":"anon"}').toString('base64url')+'.fake';
  assert.equal((await (await request('auth-config',{settings:{...env,SUPABASE_PUBLISHABLE_KEY:undefined,SUPABASE_ANON_KEY:anon}})).json()).ready,true);
});

test('email signup confirms through PKCE, credential sign-in accepts legacy passwords, and cookies rotate and clear',async()=>{
  let emailChallenge;
  const calls=[];
  const settings={...env,AUTH_FETCH:async req=>{
    const url=new URL(req.url), route=url.pathname+url.search;
    calls.push(route);
    assert.equal(url.origin+url.pathname.split('/').slice(0,3).join('/'),upstream);
    assert.equal(req.headers.get('apikey'),'sb_publishable_example');
    if(url.pathname.endsWith('/signup')){
      const values=await req.json();
      assert.equal(url.searchParams.get('redirect_to'),origin+'/api/auth/callback/email');
      assert.equal(values.email,account.email);
      assert.equal(values.code_challenge_method,'s256');
      emailChallenge=values.code_challenge;
      return Response.json(account);
    }
    if(url.searchParams.get('grant_type')==='pkce'){
      const values=await req.json();
      assert.equal(values.auth_code,'email-fixture-code');
      assert.equal(digest(values.code_verifier),emailChallenge);
      return Response.json(tokens);
    }
    if(url.searchParams.get('grant_type')==='password'){
      const values=await req.json();
      assert.equal(values.password,'abc123');
      return Response.json(tokens);
    }
    if(url.searchParams.get('grant_type')==='refresh_token'){
      assert.deepEqual(await req.json(),{refresh_token:tokens.refresh_token});
      return Response.json({...tokens,refresh_token:'rotated-refresh-fixture'});
    }
    assert.equal(req.headers.get('authorization'),'Bearer '+tokens.access_token);
    return url.pathname.endsWith('/user')?Response.json(account):new Response(null,{status:204});
  }};
  const create=await request('auth/signup',{settings,method:'POST',body:{email:' '+account.email+' ',password:'password123'}});
  assert.equal(create.status,200);
  assert.deepEqual(await create.json(),{confirmEmail:true});
  assert.ok(value(create,'__Host-kapron-pkce-email'));
  const otherBrowser=await request('auth/callback/email?code=email-fixture-code',{settings});
  assert.equal(otherBrowser.headers.get('location'),origin+'/?auth=email-finish');
  assert.equal(calls.length,1);
  const confirm=await request('auth/callback/email?code=email-fixture-code',{settings,headers:{cookie:value(create,'__Host-kapron-pkce-email')}});
  assert.equal(confirm.headers.get('location'),origin+'/');
  assert.equal(confirm.headers.getSetCookie().length,3);
  const password=await request('auth/login',{settings,method:'POST',body:{email:account.email,password:'abc123'}});
  assert.deepEqual(await password.json(),{signedIn:true});
  assert.ok(password.headers.getSetCookie().every(c=>c.includes('Secure; HttpOnly; SameSite=Lax')));
  const session=await request('session',{settings,headers:{cookie:value(password,'__Host-kapron-session')}});
  assert.equal((await session.json()).user.id,account.id);
  assert.equal((await request('session',{settings})).headers.get('x-kapron-session'),'required');
  const rotated=await request('auth/refresh',{settings,method:'POST',headers:{cookie:value(password,'__Host-kapron-refresh')}});
  assert.equal(value(rotated,'__Host-kapron-refresh'),'__Host-kapron-refresh=rotated-refresh-fixture');
  const signout=await request('auth/logout',{settings,method:'POST',headers:{cookie:value(password,'__Host-kapron-session')}});
  assert.ok(signout.headers.getSetCookie().every(item=>item.includes('Max-Age=0')));
  assert.ok(calls.includes('/auth/v1/logout?scope=local'));
});

test('Google OAuth uses the configured callback and browser proof, and blocks forged callbacks and cross-origin starts',async()=>{
  let calls=0, challenge;
  const settings={...env,KAPRON_PUBLIC_URL:origin,AUTH_FETCH:async req=>{
    calls++;
    assert.equal(req.url,upstream+'/token?grant_type=pkce');
    const data=await req.json();
    assert.equal(data.auth_code,'google-fixture-code');
    if(digest(data.code_verifier)!==challenge)return Response.json({error_code:'bad_code_verifier'},{status:400});
    return Response.json(tokens);
  }};
  const disabled=await request('auth/google',{settings:{...settings,KAPRON_AUTH_GOOGLE:'0'},method:'POST'});
  assert.equal(disabled.status,404);
  assert.equal((await request('auth/google',{settings,method:'POST',headers:{origin:'https://wrong.example'}})).status,403);
  assert.equal((await request('auth/google',{settings,method:'POST',base:'https://wrong.example'})).status,400);
  const begin=await request('auth/google',{settings,method:'POST',body:{redirect_to:'https://wrong.example'}});
  const url=new URL((await begin.json()).url);
  assert.equal(url.origin+url.pathname,upstream+'/authorize');
  assert.equal(url.searchParams.get('provider'),'google');
  assert.equal(url.searchParams.get('redirect_to'),origin+'/api/auth/callback/google');
  assert.equal(url.searchParams.get('code_challenge_method'),'s256');
  challenge=url.searchParams.get('code_challenge');
  const route='auth/callback/google?code=google-fixture-code&next=https://wrong.example';
  const missing=await request(route,{settings});
  assert.equal(missing.headers.get('location'),origin+'/?auth=google-failed');
  assert.equal(calls,0);
  const cookie=value(begin,'__Host-kapron-pkce-google');
  assert.equal(digest(cookie.split('=')[1]),challenge);
  const forged=await request(route,{settings,headers:{cookie:'__Host-kapron-pkce-google='+('A'.repeat(43))}});
  assert.equal(forged.headers.get('location'),origin+'/?auth=google-failed');
  assert.equal(forged.headers.getSetCookie().length,1);
  const callback=await request(route,{settings,headers:{cookie}});
  assert.equal(callback.status,303);
  assert.equal(callback.headers.get('location'),origin+'/');
  assert.ok(value(callback,'__Host-kapron-refresh'));
  assert.equal(calls,2);
});
