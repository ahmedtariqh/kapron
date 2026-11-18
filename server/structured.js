const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const scalars=new Set(['string','number','boolean']);
const problem=message=>Object.assign(new Error(message),{status:400});
const typeFields={
  object:['properties','required','additionalProperties'],
  array:['items','minItems','maxItems'],
  string:['minLength','maxLength'],
  integer:['minimum','maximum'],
  number:['minimum','maximum'],
  boolean:[],
  null:[]
};
const own=(value,key)=>Object.hasOwn(value,key);

export function responseSchema(value){
  if(value===undefined||value===null)return undefined;
  if(!record(value)||value.type!=='object'||new TextEncoder().encode(JSON.stringify(value)).length>8000)
    throw problem('Use a JSON object schema of at most 8 KB.');
  let nodes=0;
  function check(schema,depth){
    if(!record(schema)||!own(typeFields,schema.type)||depth>5||++nodes>100||
      Object.keys(schema).some(key=>!['type','description','enum',...typeFields[schema.type]].includes(key)))
      throw problem('The schema contains an unsupported keyword, type, or nesting level.');
    if(own(schema,'description')&&(typeof schema.description!=='string'||schema.description.length>500))
      throw problem('Schema descriptions must contain at most 500 characters.');
    if(own(schema,'enum')&&(['object','array'].includes(schema.type)||!Array.isArray(schema.enum)||!schema.enum.length||schema.enum.length>30||
      schema.enum.some(item=>item!==null&&!scalars.has(typeof item))))
      throw problem('Schema enums must list one to 30 scalar values.');
    if(schema.type==='object'){
      const properties=schema.properties??{};
      if(!record(properties)||Object.keys(properties).length>30)
        throw problem('Each object can define up to 30 properties.');
      if(own(schema,'required')&&(!Array.isArray(schema.required)||schema.required.some(key=>typeof key!=='string'||!own(properties,key))||
        new Set(schema.required).size!==schema.required.length))
        throw problem('Required fields must be unique names defined under properties.');
      if(own(schema,'additionalProperties')&&typeof schema.additionalProperties!=='boolean')
        throw problem('Use true or false for additionalProperties.');
      for(const child of Object.values(properties))check(child,depth+1);
    }
    if(schema.type==='array')check(schema.items,depth+1);
    for(const [minimum,maximum] of [['minItems','maxItems'],['minLength','maxLength'],['minimum','maximum']]){
      for(const field of [minimum,maximum]){
        if(own(schema,field)&&(!Number.isFinite(schema[field])||
          (field.endsWith('Items')||field.endsWith('Length'))&&(!Number.isSafeInteger(schema[field])||schema[field]<0)))
          throw problem('Use valid numeric schema bounds.');
      }
      if(own(schema,minimum)&&own(schema,maximum)&&schema[minimum]>schema[maximum])
        throw problem('Schema minimums must be less than or equal to maximums.');
    }
  }
  check(value,0);
  return value;
}

export function schemaFromText(text){
  if(!text.trim())return null;
  let value;
  try{value=JSON.parse(text);}catch{throw problem('Enter a valid JSON response schema.');}
  if(value===null)throw problem('Enter a JSON object schema.');
  return responseSchema(value);
}
const valueType=(value,type)=>type==='object'?record(value):type==='array'?Array.isArray(value):type==='null'?value===null:
  type==='integer'?Number.isSafeInteger(value):type==='number'?typeof value==='number'&&Number.isFinite(value):typeof value===type;
function mismatch(value,schema,path=''){
  if(!valueType(value,schema.type)||schema.enum&&!schema.enum.includes(value))return path;
  if(schema.type==='object'){
    const properties=schema.properties??{};
    for(const key of schema.required??[])if(!own(value,key))return path+'/'+pointer(key);
    for(const key of Object.keys(value)){
      const next=path+'/'+pointer(key);
      if(own(properties,key)){const failed=mismatch(value[key],properties[key],next);if(failed!==undefined)return failed;}
      else if(schema.additionalProperties===false)return next;
    }
  }
  if(schema.type==='array'){
    if(value.length<(schema.minItems??0)||value.length>(schema.maxItems??Infinity))return path;
    for(let i=0;i<value.length;i++){
      const failed=mismatch(value[i],schema.items,path+'/'+i);
      if(failed!==undefined)return failed;
    }
  }
  if(schema.type==='string'&&(schema.minLength!==undefined||schema.maxLength!==undefined)){
    const length=Array.from(value).length;
    if(length<(schema.minLength??0)||length>(schema.maxLength??Infinity))return path;
  }
  if(['number','integer'].includes(schema.type)&&(value<(schema.minimum??-Infinity)||value>(schema.maximum??Infinity)))return path;
}
const pointer=key=>key.replaceAll('~','~0').replaceAll('/','~1');

export function parseJsonObject(text,schema){
  let parsed;
  try{parsed=JSON.parse(text);}catch{}
  if(!record(parsed))throw new Error('The model did not return a valid JSON object.');
  if(schema){
    const path=mismatch(parsed,schema);
    if(path!==undefined)throw new Error('The JSON response does not match the schema at '+(path.slice(0,160)||'the root object')+'.');
  }
  return parsed;
}

export function structuredInstruction(options={}){
  if(options.responseFormat!=='json_object')return '';
  const schema=options.responseSchema;
  return 'Return only one valid JSON object. Use JSON without Markdown fences.'+(schema?' Match this JSON schema exactly:\n'+JSON.stringify(schema):'');
}

export const responseFormatValid=value=>value===undefined||value==='text'||value==='json_object';

export function valueAtPath(value,path){
  for(const key of path.split('.')){
    if(value===null||typeof value!=='object'||!Object.hasOwn(value,key))return undefined;
    value=value[key];
  }
  return value;
}
