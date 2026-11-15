import "server-only";
import { insightQuery } from "@/lib/db";

// VN ที่ปิดสิทธิสำเร็จใน Production ผ่าน /fund/close-privilege (nhso_close_log ไม่ย้อนเข้า HOSxP) ส่งเข้ากฎ C305/C349 เป็น closedJson ของ ruleParams()
const BY_RANGE =
  "SELECT DISTINCT vn FROM nhso_close_log WHERE ok AND zone = 'prod' AND request_at >= $1::date AND request_at < $2::date + 1";
const BY_VNS = "SELECT DISTINCT vn FROM nhso_close_log WHERE ok AND zone = 'prod' AND vn = ANY($1::text[])";

/** ปิดสิทธิได้เฉพาะวันรับบริการ จึงกรองด้วยวันที่ยิง (request_at) แทน vstdate ; start/end = ISO ค.ศ. ที่ route ตรวจแล้ว */
export const closedByRange = async (start: string, end: string) =>
  (await insightQuery<{ vn: string }>(BY_RANGE, [start, end])).map((r) => r.vn);

export const closedByVns = async (vns: string[]) =>
  vns.length ? (await insightQuery<{ vn: string }>(BY_VNS, [vns])).map((r) => r.vn) : [];
