import {structuredInstruction} from './structured.js';
const encoder = new TextEncoder();
const count = value => Number.isSafeInteger(value) && value >= 0 && value <= 100_000_000 ? value : undefined;
const price = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100_000 ? value : undefined;

export function catalogModel(record) {
  const info = record.model_info ?? record;
  const architecture = record.architecture;
  const modalities = values => Array.isArray(values)
    ? [...new Set(values.filter(value => ['text','image','audio','video','file'].includes(value)))].sort()
    : undefined;
  const input = modalities(architecture?.input_modalities ?? record.input_modalities);
  const output = modalities(architecture?.output_modalities ?? record.output_modalities);
  const perMillion = value => typeof value === 'number' ? price(value * 1_000_000) : undefined;
  return {
    id:record.id,
    input:input ?? (info.supports_vision === true ? ['text','image'] : undefined),
    output,
    contextTokens:count(record.context_length ?? info.max_input_tokens),
    maxOutput:count(info.max_output_tokens),
    tools:typeof info.supports_function_calling === 'boolean' ? info.supports_function_calling : undefined,
    structured:typeof info.supports_response_schema === 'boolean' ? info.supports_response_schema : undefined,
    inputPrice:perMillion(info.input_cost_per_token),
    outputPrice:perMillion(info.output_cost_per_token)
  };
}

function modelPricing(connection, model) {
  const metadata = model === connection.model ? connection.capability : null;
  const input = price(metadata?.inputPrice);
  const output = price(metadata?.outputPrice);
  return input === undefined || output === undefined ? null : {input,output};
}

export function estimateRun(connection, model, context, options = {}, workspaceOptions = {}) {
  const caps = [price(options.maxRunUsd),price(workspaceOptions.maxRunUsd)].filter(value=>value !== undefined);
  const cap = caps.length ? Math.min(...caps) : undefined;
  const requested = Number.isInteger(options.maxOutput) ? Math.min(32768, Math.max(16, options.maxOutput)) : undefined;
  const limits = [requested ?? (cap === undefined ? undefined : 2048), count(workspaceOptions.maxOutput), count(connection.model === model ? connection.capability?.maxOutput : undefined)]
    .filter(limit => limit !== undefined && limit >= 16);
  const maxOutput = limits.length ? Math.min(...limits) : undefined;
  const promptAddition=structuredInstruction(options);
  const inputBytes = encoder.encode(context.instruction || '').length + (promptAddition?2+encoder.encode(promptAddition).length:0) + context.messages.reduce((total,message)=>total + encoder.encode(message.text).length + 16, 16);
  const pricing = modelPricing(connection,model);
  const estimatedUsd = pricing && maxOutput !== undefined ? (inputBytes * pricing.input + maxOutput * pricing.output) / 1_000_000 : undefined;
  const error = connection.provider !== 'demo' && cap !== undefined && (estimatedUsd === undefined || estimatedUsd > cap)
    ? estimatedUsd === undefined ? 'A run spending limit requires model pricing and an output token limit.' : 'Estimated cost exceeds the per-call spending limit.'
    : undefined;
  return {inputBytes,maxOutput,estimatedUsd,cap,error};
}

export function reportedUsage(provider, event) {
  const raw = provider === 'gemini' ? event.usageMetadata : event.usage;
  if (!raw) return undefined;
  const input = count(raw.prompt_tokens ?? raw.promptTokenCount);
  const output = count(raw.completion_tokens ?? raw.candidatesTokenCount);
  const total = count(raw.total_tokens ?? raw.totalTokenCount);
  const costUsd = price(raw.cost);
  const fields=Object.entries({input,output,total,costUsd}).filter(([,value])=>value!==undefined);
  return fields.length?Object.fromEntries(fields):undefined;
}
