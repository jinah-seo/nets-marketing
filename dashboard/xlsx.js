/* 외부 라이브러리 없이 Excel(.xlsx)과 CSV를 만든다.
 * - xlsx = 압축 없는(STORE) zip 안에 Office Open XML 시트. Excel·한셀·구글 시트에서 열린다.
 * - 브라우저에서는 window.NetsXlsx, Node에서는 require('./xlsx.js')로 쓴다 (파일 검증용).
 * 시트 형식: { name, cols: [{ label, type, width }], rows: [{ v: [값...], b: 굵게 }] }
 *   type: 't' 글자 · 'w' 긴 글(줄바꿈) · 'n' 숫자 · 'won' 금액(#,##0) · 'd' 날짜(YYYY-MM-DD) · 'p' 비율(0~1, 0.0%)
 */
(function (root) {
  'use strict';
  const enc = new TextEncoder();
  const esc = s => String(s).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const colName = i => { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
  const isNum = v => v !== null && v !== '' && v !== undefined && Number.isFinite(Number(v));
  // 엑셀 날짜 일련번호 (1900 날짜 체계)
  function dateSerial(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
    return m ? (Date.UTC(+m[1], +m[2] - 1, +m[3]) - Date.UTC(1899, 11, 30)) / 86400000 : null;
  }

  /* ---------- zip (STORE) ---------- */
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = b => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  function zip(files) {
    const d = new Date();
    const time = ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xFFFF;
    const date = (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xFFFF;
    const local = [], central = [];
    let off = 0;
    files.forEach(f => {
      const name = enc.encode(f.name), data = typeof f.data === 'string' ? enc.encode(f.data) : f.data, crc = crc32(data), n = data.length;
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
      h.setUint16(10, time, true); h.setUint16(12, date, true); h.setUint32(14, crc, true); h.setUint32(18, n, true); h.setUint32(22, n, true);
      h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
      local.push(new Uint8Array(h.buffer), name, data);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true);
      c.setUint16(12, time, true); c.setUint16(14, date, true); c.setUint32(16, crc, true); c.setUint32(20, n, true); c.setUint32(24, n, true);
      c.setUint16(28, name.length, true); c.setUint32(42, off, true);
      central.push(new Uint8Array(c.buffer), name);
      off += 30 + name.length + n;
    });
    const cSize = central.reduce((a, b) => a + b.length, 0);
    const e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, cSize, true); e.setUint32(16, off, true);
    const parts = [...local, ...central, new Uint8Array(e.buffer)];
    const out = new Uint8Array(parts.reduce((a, b) => a + b.length, 0));
    let p = 0; parts.forEach(b => { out.set(b, p); p += b.length; });
    return out;
  }

  /* ---------- xlsx ---------- */
  // 스타일 번호: 0 기본 · 1 머리글 · 2 금액 · 3 날짜 · 4 비율 · 5 긴 글 · 6 굵게 · 7 굵은 금액 · 8 굵은 비율
  const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/><numFmt numFmtId="165" formatCode="0.0%"/></numFmts>
<fonts count="2"><font><sz val="10"/><name val="맑은 고딕"/><family val="3"/><charset val="129"/></font><font><b/><sz val="10"/><name val="맑은 고딕"/><family val="3"/><charset val="129"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF1F1EF"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top/><bottom style="thin"><color rgb="FFBFBFBF"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="9">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top"/></xf>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="left" vertical="top"/></xf>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="top"/></xf>
<xf numFmtId="3" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top"/></xf>
<xf numFmtId="165" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
  const W = { t: 14, w: 40, n: 10, won: 14, d: 12, p: 9 };
  function cellXml(ref, v, type, bold) {
    if (v === null || v === undefined || v === '') return '';
    if ((type === 'n' || type === 'won' || type === 'p') && isNum(v)) {
      const s = type === 'won' ? (bold ? 7 : 2) : type === 'p' ? (bold ? 8 : 4) : (bold ? 6 : 0);
      return `<c r="${ref}" s="${s}"><v>${Number(v)}</v></c>`;
    }
    if (type === 'd') { const n = dateSerial(v); if (n != null) return `<c r="${ref}" s="3"><v>${n}</v></c>`; }
    const s = bold ? 6 : type === 'w' ? 5 : 0;
    const t = String(v).slice(0, 32767);
    return `<c r="${ref}" t="inlineStr" s="${s}"><is><t xml:space="preserve">${esc(t)}</t></is></c>`;
  }
  function sheetXml(sh) {
    const nc = Math.max(1, sh.cols.length), last = colName(nc - 1);
    const cols = sh.cols.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width || W[c.type] || 14}" customWidth="1"/>`).join('');
    const head = `<row r="1">` + sh.cols.map((c, i) => cellXml(colName(i) + 1, c.label, 't').replace(/s="\d+"/, 's="1"')).join('') + `</row>`;
    const body = sh.rows.map((r, ri) => `<row r="${ri + 2}">` + sh.cols.map((c, i) => cellXml(colName(i) + (ri + 2), r.v[i], c.type, r.b)).join('') + `</row>`).join('');
    const filter = sh.rows.length && sh.filter !== false ? `<autoFilter ref="A1:${last}${sh.rows.length + 1}"/>` : '';
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
      `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
      `<sheetFormatPr defaultRowHeight="16.5"/><cols>${cols}</cols><sheetData>${head}${body}</sheetData>${filter}</worksheet>`;
  }
  // 시트 이름: 31자, []:*?/\ 불가, 중복 불가
  function sheetNames(sheets) {
    const used = new Set();
    return sheets.map((s, i) => {
      let n = String(s.name || 'Sheet' + (i + 1)).replace(/[\[\]:*?\/\\]/g, ' ').trim().slice(0, 31) || 'Sheet' + (i + 1), k = 2;
      const base = n; while (used.has(n.toLowerCase())) n = (base.slice(0, 28) + ' ' + k++);
      used.add(n.toLowerCase()); return n;
    });
  }
  function workbook(sheets) {
    const names = sheetNames(sheets);
    const files = [
      { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
        sheets.map((s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') + `</Types>` },
      { name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
      { name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets>` +
        names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') + `</sheets>` +
        // 필터 범위 이름 (엑셀이 autoFilter를 인식하려면 필요)
        `<definedNames>` + sheets.map((s, i) => s.rows.length && s.filter !== false ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${esc(names[i]).replace(/'/g, "''")}'!$A$1:$${colName(Math.max(1, s.cols.length) - 1)}$${s.rows.length + 1}</definedName>` : '').join('') + `</definedNames></workbook>` },
      { name: 'xl/_rels/workbook.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        sheets.map((s, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
        `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
      { name: 'xl/styles.xml', data: STYLES },
      ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s) }))
    ];
    return zip(files);
  }

  /* ---------- CSV (엑셀에서 한글이 깨지지 않게 BOM) ---------- */
  function csv(sh) {
    const q = v => { if (v === null || v === undefined) return ''; const s = String(v); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const val = (v, t) => t === 'p' && isNum(v) ? (Number(v) * 100).toFixed(1) + '%' : v;
    return '﻿' + [sh.cols.map(c => q(c.label)).join(','), ...sh.rows.map(r => sh.cols.map((c, i) => q(val(r.v[i], c.type))).join(','))].join('\r\n') + '\r\n';
  }

  root.NetsXlsx = { workbook, csv, dateSerial, zip };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.NetsXlsx;
})(typeof window !== 'undefined' ? window : globalThis);
