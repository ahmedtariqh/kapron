import {build} from 'esbuild';
import {mkdir,readFile,copyFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const profile=process.env.KAPRON_BUILD_PROFILE||'standard';
if(!['core','standard'].includes(profile))throw new Error('KAPRON_BUILD_PROFILE must be core or standard.');
const moduleNames=['docx','xlsx','pptx','pdf','javascript','html'];
const enabledModules=new Set(profile==='standard'?moduleNames:[]);
for(const setting of (process.env.KAPRON_BUILD_MODULES||'').split(',').map(x=>x.trim()).filter(Boolean)){
 const name=setting.slice(1);
 if(!['+','-'].includes(setting[0])||!moduleNames.includes(name))throw new Error('Invalid KAPRON_BUILD_MODULES entry: '+setting);
 if(setting[0]==='+')enabledModules.add(name);else enabledModules.delete(name);
}
const buildDefines=Object.fromEntries(moduleNames.map(name=>['KAPRON_MODULE_'+name.toUpperCase(),JSON.stringify(enabledModules.has(name))]));
buildDefines.KAPRON_MODULE_OFFICE=JSON.stringify(['docx','xlsx','pptx'].some(name=>enabledModules.has(name)));
const app=await build({entryPoints:{app:'src/main.jsx'},outdir:'web',entryNames:'[name]',chunkNames:'chunks/[name]-[hash]',splitting:true,bundle:true,minify:true,write:false,format:'esm',target:['es2022'],jsx:'automatic',logLevel:'warning',define:{'process.env.NODE_ENV':'"production"',...buildDefines}});
const webRoot=new URL('../web/',import.meta.url);
const webPath=(await import('node:url')).fileURLToPath(webRoot);
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json'};
const assets={};
const add=(name,data,binary=false)=>{
 const ext=name.slice(name.lastIndexOf('.'));
 assets['/'+name]={type:types[ext],body:binary?data.toString('base64'):data.toString(),binary};
};
for(const f of app.outputFiles) add(f.path.slice(webPath.length).replaceAll('\\','/'),f.text);
for(const name of ['index.html','icon.svg','icon-192.png','icon-512.png','manifest.webmanifest']) add(name,await readFile('public/'+name),name.endsWith('.png'));
if(enabledModules.has('pdf')) add('pdf.worker.mjs',await readFile('node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs'));
if(enabledModules.has('javascript')){
 add('sandbox.html',await readFile('public/sandbox.html'));
 const sandbox=await build({entryPoints:['sandbox/host.js'],bundle:true,write:false,minify:true,target:'es2022'});
 add('sandbox.js',sandbox.outputFiles[0].text);
}
const digest=createHash('sha256').update(JSON.stringify(assets)).digest('hex').slice(0,12);
add('sw.js',(await readFile('public/sw.js','utf8')).replaceAll('BUILD_REVISION',digest).replace('BUILD_CHUNKS',JSON.stringify(Object.keys(assets).filter(path=>path.startsWith('/chunks/')&&assets[path].body.length<200000))));
await mkdir('dist/server',{recursive:true});
await mkdir('dist/.openai',{recursive:true});
const sitesBuild=process.argv.includes('--sites');
if(sitesBuild)await copyFile('.openai/hosting.json','dist/.openai/hosting.json');
await build({entryPoints:['server/worker.js'],outfile:'dist/server/index.js',bundle:true,format:'esm',platform:'neutral',define:{KAPRON_SITES_BUILD:JSON.stringify(sitesBuild)},target:'es2022',plugins:[{
 name:'kapron-assets',setup(b){b.onResolve({filter:/generated-assets\.js$/},()=>({path:'assets',namespace:'kapron'}));b.onLoad({filter:/.*/,namespace:'kapron'},()=>({contents:'export const assets='+JSON.stringify(assets),loader:'js'}));}
}]});
console.log('Built Kapron '+digest+' ('+profile+', '+([...enabledModules].join(', ')||'core only')+', '+
 Object.values(assets).reduce((bytes,asset)=>bytes+Buffer.byteLength(asset.body),0)+' asset bytes)');
