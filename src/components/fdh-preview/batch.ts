// แบ่งรายที่เลือกเป็นชุดต่อ request แล้วรวมผลกลับเป็นก้อนเดียว (pure ไม่มี import ค่า ; test ที่ batch.test.mjs)
import type { CheckResult } from "@/app/api/ipd/fdh-check/check";
import type { FdhPreview } from "./fdh-preview";

/** เรียงก่อนแบ่ง: VN ขึ้นต้นด้วยวันที่ (yymmdd พ.ศ.) ชุดของผู้ป่วยนอกจึงอยู่ในช่วงวันสั้น SQL อ่าน opitemrece น้อย */
export function chunkIds(ids: string[], size: number): string[][] {
  const sorted = [...new Set(ids)].sort();
  const out: string[][] = [];
  for (let i = 0; i < sorted.length; i += size) out.push(sorted.slice(i, i + size));
  return out;
}

/** counts[file][i] = จำนวนแถวที่ชุด i ใส่ลงในแฟ้มที่รวมแล้ว (ใช้เลื่อน row ของผลตรวจ DRU) */
export type MergedPreview = FdhPreview & { counts: Record<string, number[]> };

/** ต่อแถวแต่ละแฟ้มตามลำดับชุด ; PAT หนึ่งแถวต่อ HN เพราะ HN เดียวมีได้หลาย visit/AN ที่ตกคนละชุด */
export function mergePreviews(parts: FdhPreview[]): MergedPreview {
  const files = new Map<string, FdhPreview["files"][number]>();
  const counts: Record<string, number[]> = {};
  const seenHn = new Set<string>();
  parts.forEach((part, i) => {
    for (const f of part.files) {
      const rows =
        f.file === "PAT"
          ? f.rows.filter((r) => {
              const hn = String(r.HN ?? "");
              if (seenHn.has(hn)) return false;
              seenHn.add(hn);
              return true;
            })
          : f.rows;
      const cur = files.get(f.file);
      files.set(f.file, cur ? { ...cur, rows: cur.rows.concat(rows) } : { ...f, rows });
      (counts[f.file] ??= Array<number>(parts.length).fill(0))[i] = rows.length;
    }
  });
  return { files: [...files.values()], counts };
}

/** รวมผลตรวจ C ของแฟ้มเดียวจากทุกชุด: row (DRU เทียบ Drug Catalog) เป็นลำดับในชุด จึงเลื่อนด้วยจำนวนแถวของชุดก่อนหน้า */
export function mergeChecks(results: CheckResult[], counts: number[] = []): CheckResult {
  let offset = 0;
  const seen = new Set<string>();
  const findings = results.flatMap((r, i) => {
    const out = r.findings.map((f) => (f.row == null ? f : { ...f, row: f.row + offset }));
    offset += counts[i] ?? 0;
    // PAT: HN เดียวอยู่ได้หลายชุด กฎจึงคืนรายการเดิมซ้ำ
    return out.filter((f) => {
      const k = JSON.stringify([f.row, f.an, f.hn, f.seq, f.codes, f.found]);
      return !seen.has(k) && !!seen.add(k);
    });
  });
  return {
    file: results[0]?.file ?? "",
    rules: [...new Set(results.flatMap((r) => r.rules))],
    findings,
    info: Object.assign({}, ...results.map((r) => r.info)),
    note: results.find((r) => r.note)?.note,
    truncated: results.some((r) => r.truncated),
  };
}
