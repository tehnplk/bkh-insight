// เขียนไฟล์ dBase III (.dbf) แบบไฟล์ส่งออก e-Claim ของ HOSxP (pure ไม่มี import ; test ที่ dbf.test.mjs)
// หัว: version 0x03, วันที่แก้ไข = วันนี้, ไม่มี language driver (0) ; ทุกระเบียนขึ้นต้น ' ' (ไม่ลบ) ; ปิดท้ายไฟล์ 0x1A ; ข้อความเป็น TIS-620

export type DbfField = { name: string; type: "C" | "N" | "D"; length: number; decimals: number };

/** ข้อความเป็นไบต์ TIS-620 (cp874): ASCII คงเดิม, ไทย U+0E01–U+0E5B = codepoint − 0x0D60, อักขระอื่น = ? */
export const tis620 = (s: string) =>
  Uint8Array.from(s, (ch) => {
    const c = ch.codePointAt(0)!;
    return c < 0x80 ? c : c >= 0x0e01 && c <= 0x0e5b ? c - 0x0d60 : 0x3f;
  });

/** ค่าหนึ่งช่อง: N ชิดขวา ทศนิยมตามหัว ค่าว่างเป็น 0 แบบไฟล์ของ HOSxP (ยาวเกินช่อง = * แบบ dBase) ; C/D ชิดซ้ายเติมช่องว่าง ตัดตามจำนวนไบต์ */
function cellBytes(f: DbfField, v: string) {
  if (f.type === "N") {
    const n = Number(v || 0);
    const s = (Number.isFinite(n) ? n : 0).toFixed(f.decimals);
    return tis620(s.length > f.length ? "*".repeat(f.length) : s.padStart(f.length));
  }
  const b = new Uint8Array(f.length).fill(0x20);
  b.set(tis620(v).subarray(0, f.length));
  return b;
}

/** ไฟล์ DBF ทั้งไฟล์ ; records[i][j] = ค่าของช่อง fields[j] เป็นข้อความ (วันที่ YYYYMMDD) ; ไม่มีระเบียน = หัวไฟล์อย่างเดียว */
export function writeDbf(fields: DbfField[], records: string[][], date = new Date()) {
  const headerLength = 32 + 32 * fields.length + 1;
  const recordLength = 1 + fields.reduce((n, f) => n + f.length, 0);
  const out = new Uint8Array(headerLength + records.length * recordLength + 1);
  const view = new DataView(out.buffer);
  out.set([0x03, date.getFullYear() - 1900, date.getMonth() + 1, date.getDate()]);
  view.setUint32(4, records.length, true);
  view.setUint16(8, headerLength, true);
  view.setUint16(10, recordLength, true);
  fields.forEach((f, i) => {
    const o = 32 + 32 * i;
    out.set(tis620(f.name).subarray(0, 10), o); // ชื่อไม่เกิน 10 ไบต์ ไบต์ที่ 11 เป็น 0
    out[o + 11] = f.type.charCodeAt(0);
    out[o + 16] = f.length;
    out[o + 17] = f.decimals;
  });
  out[headerLength - 1] = 0x0d;
  records.forEach((r, i) => {
    let o = headerLength + i * recordLength;
    out[o++] = 0x20;
    fields.forEach((f, j) => {
      out.set(cellBytes(f, r[j] ?? ""), o);
      o += f.length;
    });
  });
  out[out.length - 1] = 0x1a;
  return out;
}
