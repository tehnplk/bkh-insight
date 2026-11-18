import { hisQuery, insightQuery } from "@/lib/db";
import { LAB_TMLT_HIS_SQL, LAB_TMLT_INSIGHT_SQL, applyLabTmlt, type FileRow } from "./sql";

type CatRow = { lab_code: string; tmlt_code: string };

/** แฟ้ม ADP: เติม TMLTCODE และลบคอลัมน์ช่วย icode ; แฟ้มอื่นคืนแถวเดิม */
export async function fillLabTmlt(file: string, rows: FileRow[]) {
  if (file !== "ADP" || !rows.length) return rows;
  const [cat, his] = await Promise.all([
    // catalog อ่านไม่ได้ (ยังไม่ migrate/ยังไม่นำเข้า) ต้องไม่ทำให้ส่งออก 16 แฟ้มล้ม: ถือว่าว่างแล้วใช้ lab_items
    insightQuery<CatRow>(LAB_TMLT_INSIGHT_SQL).catch((e) => {
      console.error("fdh lab tmlt catalog", (e as Error).message);
      return [] as CatRow[];
    }),
    hisQuery<{ icode: string; tmlt_code: string }>(LAB_TMLT_HIS_SQL),
  ]);
  return applyLabTmlt(rows, cat, his);
}
