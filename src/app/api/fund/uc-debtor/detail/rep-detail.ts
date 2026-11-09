// REP ของ visit/admission หนึ่งราย (modal ใน /fund/uc-debtor) helper แบบ pure ไม่มี import จึงรันทดสอบด้วย node ได้ตรง (rep-detail.test.mjs)

export type FundGroup = { group: string; items: { label: string; amount: number }[] };

/** แถวในประวัติการส่ง ล่าสุดก่อน */
export type RepHistoryRow = {
  tran_id: string;
  rep_no: string;
  file_name: string;
  file_date: string | null;
  compensation: number;
  error_codes: string[];
};

export type RepErrorInfo = { code: string; description: string | null; fix: string | null; source: string | null };

/** response ของ /api/fund/uc-debtor/detail */
export type RepDetailResponse = {
  history: RepHistoryRow[];
  /** REP ล่าสุด (tran_id มากสุด) null = ยังไม่มี REP */
  latest: {
    net_nhso: number | null;
    net_affiliation: number | null;
    claim_total: number | null;
    main_fund: string[] | null;
    sub_fund: string[] | null;
    main_inscl: string | null;
    sub_inscl: string | null;
    drg: string | null;
    rw: number | null;
    adjrw: number | null;
    pay_mode: string | null;
    remark: string | null;
    funds: FundGroup[];
  } | null;
  /** รหัส error ของ REP ล่าสุด ไม่พบในตาราง = description/fix/source เป็น null */
  errors: RepErrorInfo[];
};

export const OTHER_GROUP = "อื่นๆ";

/** fund_amounts { "ผู้ป่วยใน (IP) / IPINRGR": n } จัดกลุ่มตามส่วนแรกก่อน " / " คีย์ที่ไม่มี " / " อยู่กลุ่ม "อื่นๆ" ท้ายสุด */
export function groupFundAmounts(amounts: Record<string, number | string> | null): FundGroup[] {
  const groups = new Map<string, FundGroup["items"]>();
  for (const [key, value] of Object.entries(amounts ?? {})) {
    const i = key.indexOf(" / ");
    const group = i < 0 ? OTHER_GROUP : key.slice(0, i);
    let items = groups.get(group);
    if (!items) groups.set(group, (items = []));
    items.push({ label: i < 0 ? key : key.slice(i + 3), amount: Number(value) });
  }
  return [...groups]
    .map(([group, items]) => ({ group, items }))
    .sort((a, b) => Number(a.group === OTHER_GROUP) - Number(b.group === OTHER_GROUP));
}

/** รหัสที่ต้องอธิบาย ไม่ซ้ำ ตามลำดับ: DENY แทนด้วยค่าในคอลัมน์ deny ที่ไม่ใช่ "C" ("C" เป็นแค่ธงว่ามี Deny) ถ้าไม่มีค่าอื่นคง DENY ไว้ */
export function codesToExplain(errorCodes: string[], deny: Record<string, string> | null): string[] {
  const out = new Set<string>();
  for (const code of errorCodes) {
    if (code !== "DENY") {
      out.add(code);
      continue;
    }
    const denyCodes = Object.values(deny ?? {})
      .flatMap((v) => String(v).split(/[\s,]+/))
      .filter((v) => v && v !== "C");
    if (denyCodes.length) for (const d of denyCodes) out.add(d);
    else out.add(code);
  }
  return [...out];
}
