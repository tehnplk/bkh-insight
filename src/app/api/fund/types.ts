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

/** ตัวเลือกแบ่งกลุ่มของ MultiSelect (เฉพาะรหัสที่เปิดใช้) */
export type CodeOptionGroup = { value: string; label: string; options: { value: string; label: string; hint?: string }[] };

/** GET /api/fund/opd-fund/summary?start&end[&pttypes=<code,code>]  (funds เรียงตาม amount มากไปน้อย)
 *  pttypes กรองทั้งจำนวน visit (ovst.pttype) และมูลค่า (opitemrece.pttype) รหัสผิดรูปแบบ -> 400 */
export type FundSummaryResponse = {
  start: string;
  end: string;
  totals: { visits: number; patients: number; amount: number };
  categories: CategoryAmount[];
  funds: FundSummary[];
  /** สิทธิที่เปิดใช้ทั้งหมด (รวมที่ไม่มีในช่วง) แบ่งตามกองทุน สำหรับตัวเลือกสิทธิ */
  pttypeOptions: CodeOptionGroup[];
};

/**
 * GET /api/fund/opd-fund/visits?start&end[&fund=<FundCode>][&pttype=<code>][&income=<code>][&dep=<dep_code>][&pttypes=<code,…>][&deps=<dep_code,…>]
 *   + DataGrid params (page, pageSize, sort, dir, q, format=xlsx) -> { rows: FundVisitRow[], total }
 * sort: vstdate, hn, full_name, pttype_name, dep_name, amount / q = HN หรือชื่อ
 * ส่ง income แล้ว amount = เฉพาะหมวดนั้น และแสดงเฉพาะ visit ที่มีหมวดนั้น
 * pttypes/deps (หลายค่า คั่นด้วย ",") AND กับ pttype/dep ตัวเดียว
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

/** queued/queuedAmount/queuedCategories ตาม opd_dep_queue: จำนวนตาม ovst.pttype, มูลค่าตาม opitemrece.pttype */
export type DepartmentFund = {
  fund_code: FundCode;
  fund_name: string;
  visits: number;
  queued: number;
  queuedAmount: number;
  queuedCategories: CategoryAmount[];
  amount: number;
  categories: CategoryAmount[];
};

export type DepartmentSummary = {
  dep_code: string;
  dep_name: string;
  visits: number;
  patients: number;
  /** visit ที่ถูกส่งเข้าคิวของแผนก (opd_dep_queue) ไม่ใช่ตาม main_dep และรวมข้ามแผนกไม่ได้ */
  queued: number;
  /** มูลค่าทั้ง visit ของ visit ใน queued (ซ้ำข้ามแผนกได้ รวมข้ามแผนกไม่ได้) */
  queuedAmount: number;
  /** หมวดของ queuedAmount */
  queuedCategories: CategoryAmount[];
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

// ภาพรวมการเคลม: สถานะต่อ visit (ovst) closed = ปิดสิทธิแล้ว, authen_only = มี authen (PP) แต่ยังไม่ปิด, none = ไม่มีทั้งคู่
// มูลค่า = ยอดรวม opitemrece ทั้ง visit กองทุน/แผนกอิงสิทธิหลัก (ovst.pttype) และแผนกหลัก (ovst.main_dep)

export type ClaimStatus = "closed" | "authen_only" | "none";
export type StatusAmounts = { visits: number; amount: number };
export type ClaimTotals = { visits: number; amount: number; closed: StatusAmounts; authen_only: StatusAmounts; none: StatusAmounts };

/** GET /api/fund/claim-overview?start&end */
export type ClaimOverviewResponse = {
  start: string;
  end: string;
  totals: ClaimTotals;
  /** ช่วงยาวเท่ากันที่อยู่ก่อน start ทันที ไม่มี visit เลย = null */
  previous: ClaimTotals | null;
  /** เรียงตาม amount มากไปน้อย */
  by_fund: ({ fund_code: string; fund_name: string; prev_visits: number; prev_amount: number } & ClaimTotals)[];
  /** เรียงตาม amount มากไปน้อย main_dep ว่าง = "UNKNOWN"/"ไม่ระบุ" */
  by_department: ({ dep_code: string; dep_name: string } & ClaimTotals)[];
  /** ทุกวันในช่วง เติม 0 วันที่ไม่มีข้อมูล */
  daily: ({ date: string } & ClaimTotals)[];
};

/**
 * GET /api/fund/claim-overview/pending?start&end[&status=pending|authen_only|none][&fund][&dep]
 *   + DataGrid params (sort: amount (ค่าเริ่มต้น desc), vstdate, hn, full_name, dep_name; q = HN/ชื่อ; format=xlsx)
 *   -> { rows: PendingRow[], total }  status ค่าเริ่มต้น pending = authen_only + none
 */
export type PendingRow = {
  vn: string;
  vstdate: string;
  hn: string;
  full_name: string;
  pttype_name: string;
  fund_code: string;
  fund_name: string;
  dep_name: string;
  authen_code: string | null;
  /** มีค่าเฉพาะ status = closed */
  close_code: string | null;
  status: ClaimStatus;
  amount: number;
};
