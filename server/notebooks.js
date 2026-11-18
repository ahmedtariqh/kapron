const words=value=>[...new Set(value.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]{2,}/gu)??[])];
const common=new Set('are can did does for from how into its the was were what when where which who why will with would that this about tell please give summarize help me'.split(' '));
const identifier=value=>typeof value==='string'&&/^[a-zA-Z0-9-]{1,80}$/.test(value);
const string=(value,limit,required=false)=>typeof value==='string'&&value.length<=limit&&(!required||!!value.trim());
const list=(value,length,check)=>Array.isArray(value)&&value.length<=length&&value.every(check);

export const notebookValid=notebook=>notebook&&identifier(notebook.id)&&string(notebook.name,120,true)&&
  (!notebook.projectId||identifier(notebook.projectId))&&list(notebook.sources,12,source=>source&&identifier(source.id)&&
    string(source.name,120,true)&&string(source.text,24000,true)&&string(source.notes,2000)&&typeof source.enabled==='boolean')&&
  new Set(notebook.sources.map(source=>source.id)).size===notebook.sources.length&&
  list(notebook.history,20,turn=>turn&&identifier(turn.id)&&string(turn.question,1000,true)&&
    list(turn.hits,6,hit=>hit&&identifier(hit.sourceId)&&string(hit.name,120,true)&&string(hit.quote,500,true)&&Number.isSafeInteger(hit.position)&&hit.position>=0))&&
  list(notebook.cards,24,card=>card&&identifier(card.id)&&string(card.question,1000,true)&&string(card.answer,2000,true)&&string(card.sourceName,120,true)&&
    (card.review===undefined||card.review&&Number.isSafeInteger(card.review.streak)&&card.review.streak>=0&&card.review.streak<=10&&
      Number.isSafeInteger(card.review.due)&&card.review.due>=0));

export function findEvidence(sources,question){
  const query=words(question).filter(token=>!common.has(token)).slice(0,30);
  if(!query.length)return [];
  const hits=[];
  for(const source of sources.filter(item=>item.enabled)){
    const snippets=source.text.matchAll(/[^\r\n.!?。！？]+[.!?。！？]?/gu);
    for(const snippet of snippets){
      const raw=snippet[0];
      for(let index=0;index<raw.length;index+=440){
        const part=raw.slice(index,index+500);
        const quote=part.trim();
        if(!quote)continue;
        const tokens=new Set(words(quote));
        const score=query.filter(token=>tokens.has(token)).length;
        if(score)hits.push({score,sourceId:source.id,name:source.name,quote,position:snippet.index+index+part.indexOf(quote)});
      }
    }
  }
  const used=new Map(), seen=new Set(), evidence=[];
  for(const {score,...hit} of hits.sort((a,b)=>b.score-a.score||a.position-b.position)){
    const key=hit.sourceId+'\n'+hit.quote;
    if((used.get(hit.sourceId)??0)>=2||seen.has(key))continue;
    evidence.push(hit);
    used.set(hit.sourceId,(used.get(hit.sourceId)??0)+1);
    seen.add(key);
    if(evidence.length===6)break;
  }
  return evidence;
}

export function dueStudyCards(cards,now=Date.now()){
  return cards.filter(card=>(card.review?.due??0)<=now).sort((a,b)=>(a.review?.due??0)-(b.review?.due??0));
}
export function reviewStudyCard(card,remembered,now=Date.now()){
  const streak=remembered?Math.min(10,(card.review?.streak??0)+1):0;
  const delay=remembered?Math.min(30,2**(streak-1))*86400000:600000;
  return {...card,review:{streak,due:now+delay}};
}
