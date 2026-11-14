// ตรวจรายการค่าใช้จ่าย OPD สิทธิ STP (HOSxP opitemrece) กับรายการเบิกกองทุน STP (insight fund_claim_item)
// pure ไม่มี import จึงรันทดสอบด้วย node ได้ตรง (check.test.mjs)

/** แถวจาก opitemrece + รหัสของรายการ (ค่า decimal จาก mysql เป็น string) */
export type HisItem = {
  hos_guid: string;
  vn: string;
  hn: string;
  vstdate: string;
  icode: string;
  item_name: string | null;
  qty: string | number;
  unitprice: string | number;
  sum_price: string | number;
  paidst: string | null;
  nhso_adp_code: string | null;
  nhso_adp_type_id: string | number | null;
  tpu_code_list: string | null;
  tmt_tp_code: string | null;
};

/** รายการ STP ชุดล่าสุด หนึ่งแถวต่อ (code, is_tmt) ; ยา code = GPU ; rate จาก pg numeric เป็น string */
export type StpEntry = {
  code: string;
  is_tmt: boolean;
  rate: string | number | null;
  opd: boolean;
  ipd: boolean;
  adp_type: string | null;
  rate_variants: number;
};

export type StpCatalog = { drug: Map<string, StpEntry>; nondrug: Map<string, StpEntry> };
/** TMT ของ HOSxP: tpu -> gpu (tmt_gpu_to_tpu), tp -> tpu (tmt_tp_to_tpu) */
export type TmtMaps = { gpuOfTpu: Map<string, string[]>; tpuOfTp: Map<string, string[]> };

// เรียงตามความรุนแรง (ลำดับในแถบสรุป)
export const CHECK_RESULTS = ["not_in_stp", "no_opd", "no_code", "adp_type", "over_rate", "manual", "ok", "not_fund"] as const;
export type CheckResult = (typeof CHECK_RESULTS)[number];
export const RESULT_LABEL: Record<CheckResult, string> = {
  not_in_stp: "ไม่อยู่ในรายการเบิก STP",
  no_opd: "เบิก OPD ไม่ได้",
  no_code: "ไม่มีรหัสเบิก",
  adp_type: "ประเภท ADP ไม่ตรง",
  over_rate: "ราคาเกินอัตรา STP",
  manual: "ยาไม่มีรหัส TMT (ตรวจเอง)",
  ok: "ผ่าน",
  not_fund: "ไม่เบิกกองทุน",
};
export const RESULT_TONE: Record<CheckResult, "danger" | "warning" | "success" | "muted"> = {
  not_in_stp: "danger",
  no_opd: "danger",
  no_code: "danger",
  adp_type: "danger",
  over_rate: "warning",
  manual: "warning",
  ok: "success",
  not_fund: "muted",
};
/** ต้องแก้หรือตรวจก่อนส่งเคลม (ค่าเริ่มต้นของหน้า) */
export const needsFix = (r: CheckResult) => r !== "ok" && r !== "not_fund";

export type StpCheckRow = {
  id: string;
  vstdate: string;
  hn: string;
  vn: string;
  icode: string;
  item_name: string;
  is_drug: boolean;
  /** รหัสเบิก: ADP (ไม่ใช่ยา) หรือ GPU (ยา) */
  code: string | null;
  qty: number;
  unitprice: number;
  sum_price: number;
  rate: number | null;
  excess: number | null;
  result: CheckResult;
  fix: string;
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const clean = (s: string | null | undefined) => s?.trim() || null;
const adpCode = (s: string | null) => {
  const c = clean(s)?.toUpperCase();
  return c && c !== "XXXXXX" ? c : null;
};
const rateOf = (e: StpEntry) => (e.rate == null ? null : Number(e.rate));

/** GPU ของยาจาก tpu_code_list (ค่าเดียว ตรวจกับ HOSxP แล้ว) ถ้าว่างใช้ tmt_tp_code -> tpu */
export function gpusOf(item: Pick<HisItem, "tpu_code_list" | "tmt_tp_code">, tmt: TmtMaps): string[] {
  const tpu = clean(item.tpu_code_list);
  const tp = clean(item.tmt_tp_code);
  const tpus = tpu ? [tpu] : tp ? (tmt.tpuOfTp.get(tp) ?? []) : [];
  return [...new Set(tpus.flatMap((t) => tmt.gpuOfTpu.get(t) ?? []))];
}

export function checkItem(item: HisItem, stp: StpCatalog, tmt: TmtMaps): StpCheckRow {
  // icode ยาใน HOSxP ขึ้นต้นด้วย 1 ทุกตัว (drugitems) ส่วน nondrugitems ไม่มีตัวไหนขึ้นต้นด้วย 1
  const is_drug = item.icode.startsWith("1");
  const qty = Number(item.qty);
  const unitprice = Number(item.unitprice);
  const base = {
    id: item.hos_guid, vstdate: String(item.vstdate).slice(0, 10), hn: item.hn, vn: item.vn, icode: item.icode,
    item_name: item.item_name ?? item.icode, is_drug, qty, unitprice, sum_price: Number(item.sum_price),
  };
  const row = (result: CheckResult, fix: string, code: string | null = null, entry?: StpEntry, excess: number | null = null): StpCheckRow => ({
    ...base, code, rate: entry ? rateOf(entry) : null, excess, result, fix,
  });

  if (item.paidst !== "02") return row("not_fund", "");

  let code: string | null;
  let entry: StpEntry | undefined;
  if (is_drug) {
    const gpus = gpusOf(item, tmt);
    if (!gpus.length) return row("manual", "ตรวจกับรายการยาพิเศษ STP หรือผูกรหัส TMT ในรายการยา");
    // GPU ใดอยู่ใน STP ก็ถือว่าตรง (TP หนึ่งตัวได้หลาย GPU) เลือกตัวที่เบิก OPD ได้และอัตราต่ำสุด
    const hits = gpus.flatMap((g) => stp.drug.get(g) ?? []);
    hits.sort((a, b) => Number(!a.opd) - Number(!b.opd) || (rateOf(a) ?? Infinity) - (rateOf(b) ?? Infinity));
    entry = hits[0];
    code = entry?.code ?? gpus.join(", ");
    if (!entry) return row("not_in_stp", "ตรวจรหัส TMT ของยา หรือเรียกเก็บนอกกองทุน STP", code);
  } else {
    code = adpCode(item.nhso_adp_code);
    if (!code) return row("no_code", "ผูกรหัส ADP ในรายการค่าบริการ");
    entry = stp.nondrug.get(code);
    if (!entry) return row("not_in_stp", "ตรวจรหัส ADP หรือเรียกเก็บนอกกองทุน STP", code);
  }

  if (!entry.opd) return row("no_opd", entry.ipd ? "รหัสนี้เบิกได้เฉพาะผู้ป่วยใน" : "รหัสนี้ไม่เปิดให้เบิกผู้ป่วยนอก", code, entry);
  // adp_type ของ STP เป็นข้อความ ('15', 'DRU', '-', ว่าง) เทียบเฉพาะที่เป็นตัวเลข
  const adpType = clean(entry.adp_type);
  if (!is_drug && adpType && /^\d+$/.test(adpType) && String(item.nhso_adp_type_id ?? "").trim() !== adpType) {
    return row("adp_type", `ตั้งประเภท ADP เป็น ${adpType}`, code, entry);
  }
  const rate = rateOf(entry);
  if (rate != null && unitprice > rate) {
    const many = entry.rate_variants > 1 ? ` (รหัสนี้มี ${entry.rate_variants} อัตรา ใช้อัตราสูงสุด)` : "";
    return row("over_rate", `ส่วนเกินเบิกไม่ได้ ตรวจราคาต่อหน่วย${many}`, code, entry, round2((unitprice - rate) * qty));
  }
  return row("ok", "", code, entry);
}

export type StpCheckSummary = {
  visits: number;
  items: number;
  amount: number;
  excess: number;
  groups: Record<CheckResult, { count: number; amount: number }>;
};

export function summarize(rows: StpCheckRow[]): StpCheckSummary {
  const groups = Object.fromEntries(CHECK_RESULTS.map((k) => [k, { count: 0, amount: 0 }])) as StpCheckSummary["groups"];
  let amount = 0, excess = 0;
  for (const r of rows) {
    groups[r.result].count++;
    groups[r.result].amount += r.sum_price;
    amount += r.sum_price;
    excess += r.excess ?? 0;
  }
  for (const g of Object.values(groups)) g.amount = round2(g.amount);
  return { visits: new Set(rows.map((r) => r.vn)).size, items: rows.length, amount: round2(amount), excess: round2(excess), groups };
}

/** response ของ /api/fund/stp-check ; notice: no_pttype = ไม่มีสิทธิที่ผูก STP, no_catalog = ยังไม่นำเข้ารายการ STP */
export type StpCheckPage = { rows: StpCheckRow[]; total: number; summary: StpCheckSummary; notice: "no_pttype" | "no_catalog" | null };

/** ค้นหา HN/VN/icode/ชื่อรายการ/รหัสเบิก แบบมีคำนั้นอยู่ */
export function matches(r: StpCheckRow, q: string) {
  const needle = q.toLowerCase();
  return [r.hn, r.vn, r.icode, r.item_name, r.code].some((v) => v?.toLowerCase().includes(needle));
}

/** ค่าว่าง (null) อยู่ท้ายเสมอทั้งสองทิศ แล้วเรียงตามวันที่/VN/icode ให้ผลคงที่ */
export function sortRows(rows: StpCheckRow[], key: keyof StpCheckRow, dir: "asc" | "desc"): StpCheckRow[] {
  const sign = dir === "desc" ? -1 : 1;
  const value = (r: StpCheckRow) => (key === "result" ? RESULT_LABEL[r.result] : r[key]);
  return rows.sort((a, b) => {
    const x = value(a);
    const y = value(b);
    if ((x == null) !== (y == null)) return x == null ? 1 : -1;
    const c =
      x == null || y == null ? 0
      : typeof x === "number" && typeof y === "number" ? x - y
      : String(x).localeCompare(String(y), "th", { numeric: true });
    return sign * c || a.vstdate.localeCompare(b.vstdate) || a.vn.localeCompare(b.vn) || a.icode.localeCompare(b.icode);
  });
}
