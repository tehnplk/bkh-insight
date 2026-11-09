import type { NextRequest } from "next/server";
import { insightQuery } from "@/lib/db";
import { badRequest, isAuthed, unauthorized } from "../../_lib/fund";
import { compensationOf } from "../debtor";
import { codesToExplain, groupFundAmounts, type RepDetailResponse, type RepErrorInfo } from "./rep-detail";

// OPD จับคู่ด้วย seq_no (= HOSxP vn 12 หลัก) IPD ด้วย an (9 หลัก) col เป็นค่าคงที่ ไม่ใช่ input
const KEY = {
  opd: { col: "seq_no", re: /^\d{12}$/, error: "key (VN) ต้องเป็นตัวเลข 12 หลัก" },
  ipd: { col: "an", re: /^\d{9}$/, error: "key (AN) ต้องเป็นตัวเลข 9 หลัก" },
} as const;

type Num = string | null;
type RepRow = {
  tran_id: string; rep_no: string; net_nhso: Num; net_affiliation: Num; claim_total: Num; error_codes: string[];
  main_fund: string[] | null; sub_fund: string[] | null; main_inscl: string | null; sub_inscl: string | null;
  drg: string | null; rw: Num; adjrw: Num; fund_amounts: Record<string, number> | null; deny: Record<string, string> | null;
  remark: string | null; pay_mode: string | null; file_name: string; file_date: string | null;
};
const num = (v: Num) => (v == null ? null : Number(v));

export async function GET(request: NextRequest) {
  if (!(await isAuthed())) return unauthorized();
  const params = request.nextUrl.searchParams;
  const type = params.get("type") ?? "";
  if (type !== "opd" && type !== "ipd") return badRequest("type ต้องเป็น opd หรือ ipd");
  const { col, re, error } = KEY[type];
  const key = params.get("key") ?? "";
  if (!re.test(key)) return badRequest(error);

  const rows = await insightQuery<RepRow>(
    `SELECT r.tran_id, r.rep_no, r.net_nhso, r.net_affiliation, r.claim_total, r.error_codes, r.main_fund, r.sub_fund,
       r.main_inscl, r.sub_inscl, r.drg, r.rw, r.adjrw, r.fund_amounts, r.deny, r.remark, r.pay_mode, f.file_name, f.file_date
     FROM rep_row r JOIN rep_file f ON f.id = r.rep_file_id
     WHERE r.${col} = $1
     ORDER BY r.tran_id::bigint DESC`,
    [key],
  );
  const last = rows[0];
  const codes = last ? codesToExplain(last.error_codes, last.deny) : [];
  const found = codes.length
    ? await insightQuery<RepErrorInfo>(
        "SELECT code, description, fix, source FROM rep_error_code WHERE code = ANY($1::text[])",
        [codes],
      )
    : [];
  const byCode = new Map(found.map((e) => [e.code, e]));

  const body: RepDetailResponse = {
    history: rows.map((r) => ({
      tran_id: r.tran_id, rep_no: r.rep_no, file_name: r.file_name, file_date: r.file_date,
      compensation: compensationOf(r), error_codes: r.error_codes,
    })),
    latest: last
      ? {
          net_nhso: num(last.net_nhso), net_affiliation: num(last.net_affiliation), claim_total: num(last.claim_total),
          main_fund: last.main_fund, sub_fund: last.sub_fund, main_inscl: last.main_inscl, sub_inscl: last.sub_inscl,
          drg: last.drg, rw: num(last.rw), adjrw: num(last.adjrw), pay_mode: last.pay_mode, remark: last.remark,
          funds: groupFundAmounts(last.fund_amounts),
        }
      : null,
    errors: codes.map((code) => byCode.get(code) ?? { code, description: null, fix: null, source: null }),
  };
  return Response.json(body);
}
