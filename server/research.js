const domainPattern=/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const invalid=message=>Object.assign(new Error(message),{status:400});
const covers=(host,domain)=>host===domain||host.endsWith('.'+domain);
const plain=value=>typeof value==='string'?value.trim():'';
const tidy=value=>String(value??'').replace(/\s+/g,' ').trim();
const escape=value=>tidy(value).replace(/[\\`*_[\]<>]/g,'\\$&');

function domains(values){
  if(values===undefined)return [];
  if(!Array.isArray(values)||values.length>12)throw invalid('Enter up to 12 domains per list.');
  return Array.from(new Set(values.map(value=>{
    const domain=plain(value).toLowerCase().replace(/\.$/,'');
    if(domain.length>253||!domainPattern.test(domain))throw invalid('Use domain names without a protocol, path, or wildcard.');
    return domain;
  })));
}

export function domainPolicy(input){
  return {allow:domains(input?.allow),block:domains(input?.block),prefer:domains(input?.prefer)};
}

export function researchNodes(input){
  const question=plain(input?.question);
  if(!question||question.length>300)throw invalid('Enter a research question up to 300 characters.');
  if(!Array.isArray(input.queries)||input.queries.length<1||input.queries.length>4)throw invalid('Enter one to four research queries.');
  const queries=input.queries.map(plain);
  if(queries.some(query=>!query||query.length>400)||new Set(queries.map(query=>query.toLowerCase())).size!==queries.length)
    throw invalid('Use distinct research queries up to 400 characters each.');
  const policy=domainPolicy(input.domains);
  return [
    {type:'parallel',nodes:queries.map(query=>({type:'research-search',label:query.slice(0,80),query,domains:policy}))},
    {type:'research-report',label:'Evidence report',question,domains:policy}
  ];
}

export function selectSources(sources,policy){
  const seen=new Set();
  const selected=[];
  for(const source of sources){
    const raw=source?.url;
    if(typeof raw!=='string'||raw.length>1800||!URL.canParse(raw))continue;
    const url=new URL(raw),host=url.hostname.toLowerCase().replace(/\.$/,'');
    if(!['http:','https:'].includes(url.protocol)||url.username||url.password||
      policy.block.some(domain=>covers(host,domain))||(policy.allow.length&&!policy.allow.some(domain=>covers(host,domain))))continue;
    url.hash='';
    for(const key of [...url.searchParams.keys()])if(/^utm_|^(fbclid|gclid)$/i.test(key))url.searchParams.delete(key);
    if(url.href.length>1800||seen.has(url.href))continue;
    seen.add(url.href);
    selected.push({url:url.href,title:tidy(source.title).slice(0,200)||url.hostname,
      excerpt:tidy(source.excerpt).slice(0,900),...(typeof source.date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(source.date)?{date:source.date}:{})});
  }
  const priority=source=>{
    const host=new URL(source.url).hostname.toLowerCase().replace(/\.$/,'');
    const index=policy.prefer.findIndex(domain=>covers(host,domain));
    return index===-1?policy.prefer.length:index;
  };
  return selected.sort((a,b)=>priority(a)-priority(b));
}

export function evidenceReport(question,receipts,policy){
  const queries=receipts.map(receipt=>receipt.query);
  const sources=[];
  const sections=['# '+escape(question),'## Search queries',...queries.map(query=>'- '+escape(query)),'## Evidence excerpts'];
  let length=sections.join('\n\n').length;
  for(const source of selectSources(receipts.flatMap(receipt=>receipt.sources),policy).slice(0,10)){
    const reference='### ['+(sources.length+1)+'] '+escape(source.title)+'\n\n'+
      '<'+source.url.replace(/[<>]/g,character=>character==='<'?'%3C':'%3E')+'>'+(source.date?' · '+source.date:'')+'\n\n'+escape(source.excerpt);
    if(length+reference.length+2>12000)continue;
    length+=reference.length+2;sections.push(reference);sources.push(source);
  }
  if(!sources.length)sections.push('No results matched the selected source rules.');
  return {sources,queries,text:sections.join('\n\n')};
}
