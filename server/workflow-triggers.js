import {digest,enqueueJob,loadWorkspace,prepareJob,runIdFor} from './jobs.js';

const fail=(status,message)=>Object.assign(new Error(message),{status});
const db=(env,sql,...args)=>env.DB.prepare(sql).bind(...args);
const onceId=(owner,workflow)=>JSON.stringify(['once',owner,workflow]);
export async function savedWorkflow(env,owner,id){
  const state=await loadWorkspace(env,owner);
  const workflow=(state.workflows??[]).find(item=>item.id===id);
  if(!workflow)throw fail(404,'Workflow unavailable.');
  return workflow;
}

export async function triggerStatus(env,owner,workflow){
  const webhook=await db(env,'SELECT id,created FROM kapron_workflow_webhook WHERE owner=? AND workflow=?',owner,workflow).first();
  const once=await db(env,'SELECT due FROM kapron_trigger WHERE id=? AND owner=?',onceId(owner,workflow),owner).first();
  const interval=await db(env,'SELECT due,interval_ms FROM kapron_trigger WHERE id=? AND owner=?',owner+':'+workflow,owner).first();
  return {webhook:webhook??null,oneTimeAt:once?.due??null,interval:interval?{nextAt:interval.due,minutes:interval.interval_ms/60000}:null};
}

export async function rotateWebhook(env,owner,workflow){
  await prepareJob(env,owner,await savedWorkflow(env,owner,workflow));
  const token='kapron_hook_'+crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-','');
  const created=Date.now(), id=crypto.randomUUID();
  await db(env,`INSERT INTO kapron_workflow_webhook(id,owner,workflow,secret_hash,created) VALUES(?,?,?,?,?)
    ON CONFLICT(owner,workflow) DO UPDATE SET id=excluded.id,secret_hash=excluded.secret_hash,created=excluded.created`,
    id,owner,workflow,await digest(token),created).run();
  return {id,token,created};
}

export async function revokeWebhook(env,owner,workflow){
  await db(env,'DELETE FROM kapron_workflow_webhook WHERE owner=? AND workflow=?',owner,workflow).run();
}

export async function authenticateWebhook(env,id,authorization){
  const token=authorization?.match(/^Bearer (kapron_hook_[a-f0-9]{64})$/)?.[1];
  if(!token)throw fail(401,'A valid workflow webhook token is required.');
  const hash=await digest(token);
  const hook=await db(env,'SELECT owner,workflow FROM kapron_workflow_webhook WHERE id=? AND secret_hash=?',id,hash).first();
  if(!hook)throw fail(401,'A valid workflow webhook token is required.');
  return {...hook,id};
}

export async function dispatchWebhook(env,hook,eventKey,input){
  if(typeof input!=='string'||input.length>12000)throw fail(400,'Provide an optional input string up to 12,000 characters.');
  if(eventKey===null)throw fail(400,'Send an Idempotency-Key header.');
  const runId=await runIdFor(JSON.stringify([hook.owner,hook.workflow]),eventKey);
  const workflow=await savedWorkflow(env,hook.owner,hook.workflow);
  return enqueueJob(env,hook.owner,{...workflow,input},runId,{webhookId:hook.id});
}

export async function setOneTimeSchedule(env,owner,workflow,at){
  const id=onceId(owner,workflow);
  if(at===null){
    await db(env,'DELETE FROM kapron_trigger WHERE id=? AND owner=?',id,owner).run();
    return;
  }
  const now=Date.now();
  if(!Number.isSafeInteger(at)||at<=now||at>now+365*86400000)throw fail(400,'Choose a time in the next 365 days.');
  await prepareJob(env,owner,await savedWorkflow(env,owner,workflow));
  await db(env,`INSERT INTO kapron_trigger(id,owner,workflow,interval_ms,due) VALUES(?,?,?,0,?)
    ON CONFLICT(id) DO UPDATE SET due=excluded.due`,id,owner,workflow,at).run();
}
