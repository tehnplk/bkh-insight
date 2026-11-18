import { hisQuery, insightQuery } from "@/lib/db";
import { LAB_TMLT_HIS_SQL, LAB_TMLT_INSIGHT_SQL, applyLabTmlt, resolvedLabIcodes, type FileRow } from "./sql";

type CatRow = { lab_code: string; tmlt_code: string };

const loadLabTmlt = () =>
  Promise.all([
    // catalog อ่านไม่ได้ (ยังไม่ migrate/ยังไม่นำเข้า) ต้องไม่ทำให้ส่งออก 16 แฟ้มล้ม: ถือว่าว่างแล้วใช้ lab_items
    insightQuery<CatRow>(LAB_TMLT_INSIGHT_SQL).catch((e) => {
      console.error("fdh lab tmlt catalog", (e as Error).message);
      return [] as CatRow[];
    }),
    hisQuery<{ icode: string; tmlt_code: string }>(LAB_TMLT_HIS_SQL),
  ]);

/** แฟ้ม ADP: เติม TMLTCODE และลบคอลัมน์ช่วย icode ; แฟ้มอื่นคืนแถวเดิม */
export async function fillLabTmlt(file: string, rows: FileRow[]) {
  if (file !== "ADP" || !rows.length) return rows;
  const [cat, his] = await loadLabTmlt();
  return applyLabTmlt(rows, cat, his);
}

/** params 5–6 ของ ruleParams(): labCsv = icode ที่ได้ TMLT (C914), catCsv = lab_code ใน Lab Catalog FDH (C190) */
export async function labRuleCsv() {
  const [cat, his] = await loadLabTmlt();
  return { labCsv: resolvedLabIcodes(cat, his).join(","), catCsv: [...new Set(cat.map((r) => r.lab_code))].join(",") };
}
