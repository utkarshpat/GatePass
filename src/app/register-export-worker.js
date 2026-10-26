"use strict";
const crcTable=(()=>{const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;t[n]=c>>>0;}return t;})();
function crc32(bytes){let c=0xffffffff;for(const b of bytes)c=crcTable[(c^b)&255]^(c>>>8);return(c^0xffffffff)>>>0;}
async function zipStore(files){
 const enc=new TextEncoder(),parts=[],central=[],u16=v=>[v&255,v>>>8&255],u32=v=>[v&255,v>>>8&255,v>>>16&255,v>>>24&255];let offset=0;
 for(const [name,text] of files){
  const nameBytes=enc.encode(name),original=enc.encode(text),crc=crc32(original);let data=original,method=0;
  if(typeof CompressionStream==='function'){try{data=new Uint8Array(await new Response(new Blob([original]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());method=8;}catch{data=original;}}
  const local=new Uint8Array([0x50,0x4b,3,4,...u16(20),...u16(0x0800),...u16(method),...u16(0),...u16(0x21),...u32(crc),...u32(data.length),...u32(original.length),...u16(nameBytes.length),...u16(0)]);
  parts.push(local,nameBytes,data);
  central.push(new Uint8Array([0x50,0x4b,1,2,...u16(20),...u16(20),...u16(0x0800),...u16(method),...u16(0),...u16(0x21),...u32(crc),...u32(data.length),...u32(original.length),...u16(nameBytes.length),...u16(0),...u16(0),...u16(0),...u16(0),...u32(0),...u32(offset)]),nameBytes);
  offset+=local.length+nameBytes.length+data.length;
 }
 const size=central.reduce((n,p)=>n+p.length,0),end=new Uint8Array([0x50,0x4b,5,6,...u16(0),...u16(0),...u16(files.length),...u16(files.length),...u32(size),...u32(offset),...u16(0)]);
 return new Blob([...parts,...central,end],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
}
const xmlText=s=>String(s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/gu,'').replace(/[&<>"]/gu,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]);
const colName=i=>{let n=i+1,s='';while(n){const m=(n-1)%26;s=String.fromCharCode(65+m)+s;n=Math.floor((n-1)/26);}return s;};
function sheetXml(header,rows){
 const cell=(r,c,v,style)=>'<c r="'+colName(c)+r+'"'+(style?' s="1"':'')+' t="inlineStr"><is><t xml:space="preserve">'+xmlText(v)+'</t></is></c>';
 const lines=[header,...rows].map((row,r)=>'<row r="'+(r+1)+'">'+row.map((v,c)=>cell(r+1,c,v,r===0)).join('')+'</row>');
 const widths=header.map((h,c)=>rows.slice(0,200).reduce((w,row)=>Math.max(w,String(row[c]).length+2),Math.max(10,h.length+2))).map(w=>Math.min(48,w));
 return'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>'+widths.map((w,i)=>'<col min="'+(i+1)+'" max="'+(i+1)+'" width="'+w+'" customWidth="1"/>').join('')+'</cols><sheetData>'+lines.join('')+'</sheetData><autoFilter ref="A1:'+colName(header.length-1)+(rows.length+1)+'"/></worksheet>';
}
async function xlsxBlob(header,rows){
 const ns='http://schemas.openxmlformats.org/',head='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
 return zipStore([
  ['[Content_Types].xml',head+'<Types xmlns="'+ns+'package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'],
  ['_rels/.rels',head+'<Relationships xmlns="'+ns+'package/2006/relationships"><Relationship Id="rId1" Type="'+ns+'officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
  ['xl/workbook.xml',head+'<workbook xmlns="'+ns+'spreadsheetml/2006/main" xmlns:r="'+ns+'officeDocument/2006/relationships"><sheets><sheet name="Visit register" sheetId="1" r:id="rId1"/></sheets></workbook>'],
  ['xl/_rels/workbook.xml.rels',head+'<Relationships xmlns="'+ns+'package/2006/relationships"><Relationship Id="rId1" Type="'+ns+'officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="'+ns+'officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'],
  ['xl/styles.xml',head+'<styleSheet xmlns="'+ns+'spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF1F5F9"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>'],
  ['xl/worksheets/sheet1.xml',sheetXml(header,rows)]
 ]);
}

self.onmessage=async event=>{try{const {header,rows}=event.data;if(!Array.isArray(header)||header.length!==26||!Array.isArray(rows)||rows.length>10000||!rows.every(r=>Array.isArray(r)&&r.length===header.length))throw Error('INVALID_WORKBOOK');const blob=await xlsxBlob(header,rows);self.postMessage({blob});}catch{self.postMessage({error:'Excel file could not be generated. Retry the export.'});}};
