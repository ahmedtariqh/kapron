import {structuredInstruction} from './structured.js';
export const providers = {
  demo: { name: 'Kapron Demo', model: 'local-demo', caption: 'Offline sample · no key needed' },
  openai: { name: 'OpenAI', model: 'gpt-4.1-mini', caption: 'Native streaming chat API' },
  gemini: { name: 'Google Gemini', model: 'gemini-2.5-flash', caption: 'Native Gemini streaming API' },
  openrouter: { name: 'OpenRouter', model: 'openai/gpt-4.1-mini', caption: 'Model gateway' },
  litellm: { name: 'LiteLLM Proxy', model: '', caption: 'Deployment gateway · vault key' },
  omniroute: { name: 'OmniRoute', model: '', caption: 'Deployment gateway · vault key' },
  custom: { name: 'OpenAI compatible', model: '', caption: 'Connect directly from this browser' },
};

export const isGateway = provider => provider === 'litellm' || provider === 'omniroute';
export const modelIdPattern = /^[\w.:/\-]{1,160}$/;

export function customBase(endpoint){
  const target=new URL(endpoint);
  const local=['localhost','127.0.0.1','[::1]'].includes(target.hostname);
  if((target.protocol!=='https:'&&!(local&&target.protocol==='http:'))||target.username||target.password||target.search||target.hash){
    throw new Error('Use an HTTPS base URL or a loopback HTTP URL without credentials, query, or fragment.');
  }
  return target.href.replace(/\/+$/,'').replace(/\/chat\/completions$/,'');
}

export function providerRequest({ provider, model, endpoint, messages, instruction, key, options = {}, signal }) {
  if (typeof model !== 'string' || !modelIdPattern.test(model)) throw new Error('Enter a valid model ID.');
  const headers = { 'content-type': 'application/json', accept: 'text/event-stream' };
  const config = {};
  const jsonObject=options.responseFormat==='json_object';
  if(jsonObject)instruction=[instruction,structuredInstruction(options)].filter(Boolean).join('\n\n');
  if (Number.isFinite(options.temperature)) config.temperature = Math.min(2, Math.max(0, options.temperature));
  if (Number.isInteger(options.maxOutput)) config.maxOutput = Math.min(32768, Math.max(16, options.maxOutput));
  if (provider === 'gemini') {
    if(options.reasoningEffort)throw new Error('This connection does not support the configured reasoning effort.');
    if (!/^[\w.\-]{1,160}$/.test(model)) throw new Error('Use the Gemini model ID without a path prefix.');
    headers['x-goog-api-key'] = key;
    const contents = [];
    for (const item of messages) {
      const role = item.role === 'assistant' ? 'model' : 'user';
      if (contents.at(-1)?.role === role) contents.at(-1).parts.push({text:item.text});
      else contents.push({role, parts:[{text:item.text}]});
    }
    return new Request('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':streamGenerateContent?alt=sse', {
      method:'POST', headers, signal, redirect:'error',
      body:JSON.stringify({ contents, ...(instruction ? { systemInstruction:{ parts:[{text:instruction}] } } : {}),
        generationConfig: { ...(config.temperature != null ? {temperature:config.temperature} : {}),
          ...(config.maxOutput ? {maxOutputTokens:config.maxOutput} : {}),
          ...(jsonObject?{responseMimeType:'application/json'}:{}) } })
    });
  }
  let url;
  if (provider === 'openai') url = 'https://api.openai.com/v1/chat/completions';
  else if (provider === 'openrouter') url = 'https://openrouter.ai/api/v1/chat/completions';
  else if (isGateway(provider)) url = new URL(endpoint).href + '/chat/completions';
  else if (provider === 'custom') url=customBase(endpoint)+'/chat/completions';
  else throw new Error('Choose a supported provider.');
  if (key) headers.authorization = 'Bearer ' + key;
  return new Request(url, {
    method:'POST', headers, signal, redirect:'error', credentials:'omit',
    body:JSON.stringify({ model, stream:true,
      ...(jsonObject?{response_format:{type:'json_object'}}:{}),
      ...(options.reportUsage && provider!=='custom' ? {stream_options:{include_usage:true}} : {}),
      ...(['low','medium','high'].includes(options.reasoningEffort)?{reasoning_effort:options.reasoningEffort}:{}),
      messages:[...(instruction ? [{role:'system',content:instruction}] : []),
        ...messages.map(x=>({role:x.role,content:x.text}))],
      ...(config.temperature != null ? {temperature:config.temperature} : {}),
      ...(config.maxOutput ? {[provider === 'openai' ? 'max_completion_tokens' : 'max_tokens']:config.maxOutput} : {}) })
  });
}

export async function* sse(response) {
  if (!response.body) throw new Error('The model returned an empty response.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const {done,value} = await reader.read();
      buffer += decoder.decode(value,{stream:!done});
      if (buffer.length > 1_048_576) throw new Error('Provider event exceeded the size limit.');
      const events = buffer.split(/\r?\n\r?\n/);
      buffer = events.pop();
      if (done && buffer.trim()) events.push(buffer);
      for (const event of events) {
        const data = event.split(/\r?\n/).filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n');
        if (!data) continue;
        if (data === '[DONE]') return;
        try { yield JSON.parse(data); } catch (error) { if (!(error instanceof SyntaxError)) throw error; }
      }
      if (done) return;
    }
  } finally { await reader.cancel().catch(()=>{}); reader.releaseLock(); }
}

export function extractText(provider, event) {
  if (event.error) throw new Error('The provider ended the stream with an error.');
  if (provider === 'gemini') return event.candidates?.[0]?.content?.parts?.filter(p=>!p.thought).map(p=>p.text ?? '').join('') ?? '';
  const value = event.choices?.[0]?.delta?.content;
  return typeof value === 'string' ? value : '';
}

export function providerError(status) {
  if (status === 401 || status === 403) return 'The provider rejected this key or model permission.';
  if (status === 429) return 'The provider rate limit or account quota was reached.';
  if (status === 404) return 'This model or endpoint could not be found.';
  if (status === 400) return 'The provider rejected these inputs. Check the model ID and generation settings.';
  return 'The provider returned an error (' + status + ').';
}
