// Minimal single-sheet XLSX writer (store-only ZIP, no compression and no
// external deps). Ported from supabase/functions/generate-export/index.ts so
// the Express pipeline can produce the same workbook format as the Edge path.

export function buildSimpleXlsx(headers, rows) {
  const all = [headers, ...rows];
  const sheetXml = sheetXmlFor(all);
  const files = {
    "[Content_Types].xml":
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`,
    "_rels/.rels":
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
    "xl/_rels/workbook.xml.rels":
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`,
    "xl/workbook.xml":
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
          xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Export" sheetId="1" r:id="rId1"/></sheets>
</workbook>`,
    "xl/worksheets/sheet1.xml": sheetXml,
  };
  return zipStore(files);
}

function sheetXmlFor(rows) {
  const colLetter = (i) => {
    let s = "";
    let n = i;
    while (n >= 0) {
      s = String.fromCharCode(65 + (n % 26)) + s;
      n = Math.floor(n / 26) - 1;
    }
    return s;
  };
  const escape = (s) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  let xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>`;
  rows.forEach((row, r) => {
    xml += `<row r="${r + 1}">`;
    row.forEach((cell, c) => {
      const ref = `${colLetter(c)}${r + 1}`;
      if (typeof cell === "number" && Number.isFinite(cell)) {
        xml += `<c r="${ref}"><v>${cell}</v></c>`;
      } else {
        const s = escape(String(cell ?? ""));
        xml += `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${s}</t></is></c>`;
      }
    });
    xml += `</row>`;
  });
  xml += `</sheetData></worksheet>`;
  return xml;
}

function zipStore(files) {
  const enc = new TextEncoder();
  const fileEntries = [];
  const out = [];

  const push = (arr) => { for (const b of arr) out.push(b); };
  const u16 = (n) => [n & 0xff, (n >> 8) & 0xff];
  const u32 = (n) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];

  for (const [path, content] of Object.entries(files)) {
    const name = enc.encode(path);
    const data = enc.encode(content);
    const crc = crc32(data);
    const offset = out.length;
    push(u32(0x04034b50));
    push(u16(20));
    push(u16(0));
    push(u16(0));
    push(u16(0));
    push(u16(0));
    push(u32(crc));
    push(u32(data.length));
    push(u32(data.length));
    push(u16(name.length));
    push(u16(0));
    push(name);
    push(data);
    fileEntries.push({ name, data, crc, offset });
  }

  const centralStart = out.length;
  for (const f of fileEntries) {
    push(u32(0x02014b50));
    push(u16(20));
    push(u16(20));
    push(u16(0));
    push(u16(0));
    push(u16(0));
    push(u16(0));
    push(u32(f.crc));
    push(u32(f.data.length));
    push(u32(f.data.length));
    push(u16(f.name.length));
    push(u16(0));
    push(u16(0));
    push(u16(0));
    push(u16(0));
    push(u32(0));
    push(u32(f.offset));
    push(f.name);
  }
  const centralSize = out.length - centralStart;
  push(u32(0x06054b50));
  push(u16(0));
  push(u16(0));
  push(u16(fileEntries.length));
  push(u16(fileEntries.length));
  push(u32(centralSize));
  push(u32(centralStart));
  push(u16(0));

  return new Uint8Array(out);
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (c ^ 0xffffffff) >>> 0;
}
