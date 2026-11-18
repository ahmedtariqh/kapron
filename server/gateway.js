import {isGateway, modelIdPattern} from './providers.js';
import {catalogModel} from './model-policy.js';

// Gateway destinations come from deployment configuration only.
export function gatewayConfig(env) {
  const provider = env.KAPRON_GATEWAY_PROVIDER;
  if (!isGateway(provider) || !env.KAPRON_GATEWAY_URL) return null;
  let url;
  try { url = new URL(env.KAPRON_GATEWAY_URL); } catch { return null; }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && env.LOCAL_USER && loopback)) return null;
  if (url.username || url.password || url.search || url.hash) return null;
  const base = url.href.replace(/\/+$/, '');
  return {provider, endpoint: url.pathname === '/' ? base + '/v1' : base};
}

export async function gatewayModels(config, key, fetcher = fetch, signal, details = false) {
  const abort = AbortSignal.any([AbortSignal.timeout(10000), ...(signal ? [signal] : [])]);
  const response = await fetcher(new Request(config.endpoint + '/models', {
    headers: {...(key?{authorization:'Bearer '+key}:{}),accept:'application/json'},
    credentials:'omit',redirect:'error',signal:abort
  }));
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    return {status: response.status};
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = '';
  try {
    while (true) {
      const {value, done} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 1_000_000) throw new Error('Gateway model catalog is too large.');
      text += decoder.decode(value, {stream: true});
    }
    const {data} = JSON.parse(text + decoder.decode());
    if (!Array.isArray(data)) throw new Error('Gateway model catalog is invalid.');
    const eligible = new Map();
    for (const model of data) {
      if (typeof model?.id === 'string' && modelIdPattern.test(model.id) && !eligible.has(model.id)) eligible.set(model.id,model);
    }
    const models = [...eligible.keys()].sort().slice(0,250);
    return {models,...(details?{catalog:models.map(id=>catalogModel(eligible.get(id)))}:{})};
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
