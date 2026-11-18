export const attachmentAccept = '.txt,.md,.csv,.json,.log' + (KAPRON_MODULE_PDF ? ',.pdf' : '');
export const isPdf = file => /\.pdf$/i.test(file.name);

export async function attachmentText(file, limit) {
  if(KAPRON_MODULE_PDF){
    if(isPdf(file))return (await import('./pdf.js')).pdfText(file,limit);
  }
  if(isPdf(file))throw new Error('PDF parsing is disabled in this build.');
  return file.text();
}
