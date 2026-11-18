export const officeTypes={
  docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation'
};

export function csvRows(text){
  const rows=[];
  let row=[], cell='', quoted=false;
  for(let i=0;i<text.length;i++){
    const ch=text[i];
    if(quoted && ch==='"' && text[i+1]==='"'){cell+='"';i++;}
    else if(ch==='"'&&(quoted||!cell))quoted=!quoted;
    else if(!quoted&&ch===','){row.push(cell);cell='';}
    else if(!quoted&&ch==='\n'){row.push(cell.replace(/\r$/,''));rows.push(row);row=[];cell='';}
    else cell+=ch;
  }
  if(quoted)throw new Error('A CSV field has an unclosed quote.');
  if(cell||row.length)rows.push([...row,cell.replace(/\r$/,'')]);
  return rows;
}

export async function exportOffice(artifact,type){
  const {name,text}=artifact;
  if(KAPRON_MODULE_DOCX)if(type==='docx'){
    const {Document,Paragraph,Packer,HeadingLevel}=await import('docx');
    const children=[new Paragraph({text:name,heading:HeadingLevel.TITLE})];
    for(const line of text.split('\n')){
      const heading=line.match(/^(#{1,3})\s+(.*)$/);
      const level=[HeadingLevel.HEADING_1,HeadingLevel.HEADING_2,HeadingLevel.HEADING_3];
      children.push(new Paragraph(heading?{text:heading[2],heading:level[heading[1].length-1]}:{text:line}));
    }
    return Packer.toBlob(new Document({sections:[{children}]}));
  }
  if(KAPRON_MODULE_XLSX)if(type==='xlsx'){
    const {default:ExcelJS}=await import('exceljs');
    const workbook=new ExcelJS.Workbook();
    const sheet=workbook.addWorksheet('Data');
    const rows=csvRows(text).slice(0,2000);
    const formula=/^=(?:SUM|AVERAGE|COUNT|MAX|MIN)\([A-Z]{1,3}\d{1,4}:[A-Z]{1,3}\d{1,4}\)$/i;
    rows.forEach(row=>sheet.addRow(row.slice(0,80).map(value=>{
      if(formula.test(value))return {formula:value.slice(1)};
      return /^-?(?:0|[1-9]\d{0,11})(?:\.\d+)?$/.test(value)?Number(value):value;
    })));
    if(rows.length)sheet.getRow(1).font={bold:true};
    sheet.columns.forEach(c=>{c.width=22;});
    return new Blob([await workbook.xlsx.writeBuffer()],{type:officeTypes.xlsx});
  }
  if(KAPRON_MODULE_PPTX)if(type==='pptx'){
    const {default:PptxGenJS}=await import('pptxgenjs');
    const pptx=new PptxGenJS();
    pptx.layout='LAYOUT_WIDE';
    const sections=text.split(/^\s*---\s*$|(?=^#{1,2}\s)/m).filter(s=>s.trim()).slice(0,30);
    for(const section of sections.length?sections:[text]){
      const slide=pptx.addSlide();
      slide.background={color:'121728'};
      const [first,...lines]=section.trim().split('\n');
      const titled=/^#{1,2}\s/.test(first);
      slide.addText(titled?first.replace(/^#+\s*/,''):name,{x:.6,y:.45,w:12.1,h:1.05,fontSize:29,bold:true,color:'F3F3FC',fit:'shrink'});
      slide.addText((titled?lines:[first,...lines]).join('\n').slice(0,3000),{x:.65,y:1.65,w:11.9,h:5.05,fontSize:19,color:'E2E7FB',valign:'top',fit:'shrink'});
    }
    return new Blob([await pptx.write({outputType:'arraybuffer'})],{type:officeTypes.pptx});
  }
  throw new Error('This export format is disabled in this build.');
}
