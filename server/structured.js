export function parseJsonObject(text){
  try{
    const parsed=JSON.parse(text);
    if(parsed!==null&&typeof parsed==='object'&&!Array.isArray(parsed))return parsed;
  }catch{}
  throw new Error('The model did not return a valid JSON object.');
}

export const responseFormatValid=value=>value===undefined||value==='text'||value==='json_object';

export function valueAtPath(value,path){
  for(const key of path.split('.')){
    if(value===null||typeof value!=='object'||!Object.hasOwn(value,key))return undefined;
    value=value[key];
  }
  return value;
}
