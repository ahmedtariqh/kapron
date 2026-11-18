import {getDocument,GlobalWorkerOptions} from 'pdfjs-dist/legacy/build/pdf.mjs';

GlobalWorkerOptions.workerSrc='/pdf.worker.mjs';
export async function pdfText(file,limit){
  if(file.size>12000000)throw new Error('Choose a PDF under 12 MB.');
  const document=await getDocument({data:new Uint8Array(await file.arrayBuffer()),useSystemFonts:false,isEvalSupported:false,stopAtErrors:true}).promise;
  try {
    const sections=[];
    let length=0;
    for(let n=1;n<=Math.min(document.numPages,60)&&length<limit;n++){
      const page=await document.getPage(n);
      const content=await page.getTextContent();
      const text=content.items.map(item=>item.str??'').join(' ').trim();
      if(!text)continue;
      const section='[Page '+n+']\n'+text;
      sections.push(section);length+=section.length+2;
    }
    if(!sections.length)throw new Error('This PDF has no readable text layer. Use an OCR copy.');
    return sections.join('\n\n').slice(0,limit);
  } finally {await document.destroy();}
}
