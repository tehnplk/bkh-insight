// สัญญา API ของโมดูล fund (กองทุน = pttype.hipdata_code) ใช้ร่วมกันระหว่าง route กับหน้า UI
// มูลค่า = ราคาที่เรียกเก็บ (opitemrece.sum_price) ช่วงวันที่ start..end อิงวันรับบริการ (vstdate)

export type FundCode = string; // hipdata_code หรือ "UNKNOWN"

export type CategoryAmount = { income_code: string; income_name: string; amount: number };

export type FundSummary = {
  fund_code: FundCode;
  fund_name: string;
  visits: number;
  patients: number;
  amount: number;
  categories: CategoryAmount[];
  /** categories ของสิทธิย่อย = ยอดตามหมวดที่เรียกเก็บด้วย pttype นั้น เรียงตาม amount มากไปน้อย */
  pttypes: { pttype: string; pttype_name: string; visits: number; amount: number; categories: CategoryAmount[] }[];
};

/** GET /api/fund/opd-fund/summary?start&end  (funds เรียงตาม amount มากไปน้อย) */
export type FundSummaryResponse = {
  start: string;
  end: string;
  totals: { visits: number; patients: number; amount: number };
  categories: CategoryAmount[];
  funds: FundSummary[];
};

/**
 * GET /api/fund/opd-fund/visits?start&end[&fund=<FundCode>][&pttype=<code>][&income=<code>][&dep=<dep_code>]
 *   + DataGrid params (page, pageSize, sort, dir, q, format=xlsx) -> { rows: FundVisitRow[], total }
 * sort: vstdate, hn, full_name, pttype_name, dep_name, amount / q = HN หรือชื่อ
 * ส่ง income แล้ว amount = เฉพาะหมวดนั้น และแสดงเฉพาะ visit ที่มีหมวดนั้น
 */
export type FundVisitRow = {
  vn: string;
  vstdate: string;
  hn: string;
  full_name: string;
  pttype: string;
  pttype_name: string;
  fund_code: FundCode;
  /** แผนกหลักของ visit (ovst.main_dep) ว่าง/NULL = "UNKNOWN" */
  dep_code: string;
  dep_name: string;
  amount: number;
};

export type VisitItem = { icode: string; name: string; qty: number; unitprice: number; amount: number };

/** GET /api/fund/opd-fund/visit-items?vn=<vn>  (ไม่พบ -> 404 { error }) categories เรียงตาม amount มากไปน้อย */
export type VisitItemsResponse = {
  vn: string;
  hn: string;
  full_name: string;
  vstdate: string;
  pttype_name: string;
  fund_code: FundCode;
  fund_name: string;
  total: number;
  categories: (CategoryAmount & { items: VisitItem[] })[];
};

/** GET /api/fund/dashboard?start&end */
export type FundDashboardResponse = {
  start: string;
  end: string;
  totals: { visits: number; patients: number; amount: number; avg_per_visit: number };
  /** ช่วงยาวเท่ากันที่อยู่ก่อน start ทันที */
  previous: { visits: number; amount: number } | null;
  by_fund: { fund_code: FundCode; fund_name: string; visits: number; amount: number }[];
  by_category: CategoryAmount[];
  fund_category: { fund_code: FundCode; income_code: string; amount: number }[];
  /** ทุกวันในช่วง เติม 0 วันที่ไม่มีข้อมูล */
  daily: { date: string; visits: number; amount: number }[];
  /** 10 อันดับตาม amount */
  top_items: { icode: string; name: string; income_name: string; qty: number; amount: number }[];
};

// มูลค่าตามแผนก: แผนก = ovst.main_dep (ว่าง/NULL = "UNKNOWN") มูลค่าทุกรายการของ visit นับเข้าแผนกหลักของ visit
// กองทุนภายในแผนกใช้หลักเดียวกับหน้ากองทุน (มูลค่าตาม opitemrece.pttype, จำนวน visit ตาม ovst.pttype)

export type DepartmentFund = { fund_code: FundCode; fund_name: string; visits: number; amount: number; categories: CategoryAmount[] };

export type DepartmentSummary = {
  dep_code: string;
  dep_name: string;
  visits: number;
  patients: number;
  amount: number;
  categories: CategoryAmount[];
  /** เรียงตาม amount มากไปน้อย */
  funds: DepartmentFund[];
};

/** GET /api/fund/opd-department/summary?start&end  (departments เรียงตาม amount มากไปน้อย) */
export type DepartmentSummaryResponse = {
  start: string;
  end: string;
  totals: { visits: number; patients: number; amount: number };
  categories: CategoryAmount[];
  departments: DepartmentSummary[];
};
