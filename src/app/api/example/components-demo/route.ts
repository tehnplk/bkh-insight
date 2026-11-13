import type { NextRequest } from "next/server";
import { facetRows, filterRows, parseColumnFilters, parseGridQuery, type GridPage, type RowGetters } from "@/lib/grid-query";
import { xlsxResponse } from "@/lib/xlsx";
import { PATIENTS, type Patient } from "./patients";

const SORTABLE = ["hn", "name", "age", "ward", "admitDate", "status"] as const;
const SEARCHABLE = ["hn", "name", "ward", "diagnosis"] as const;
// ตัวอย่างตัวกรองหัวคอลัมน์ (meta.filter ของคอลัมน์ + cf/facet) แบบกรองในหน่วยความจำ
const FILTER_GET = {
  hn: (p) => p.hn,
  name: (p) => p.name,
  age: (p) => p.age,
  ward: (p) => p.ward,
  admitDate: (p) => p.admitDate,
  diagnosis: (p) => p.diagnosis,
  status: (p) => p.status,
} satisfies RowGetters<Patient, string>;
type FilterKey = keyof typeof FILTER_GET;

export async function GET(request: NextRequest) {
  const parsed = parseGridQuery(request.nextUrl.searchParams, SORTABLE);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });
  const { page, pageSize, sort, dir, q, format } = parsed.query;
  const cf = parseColumnFilters<FilterKey>(request.nextUrl.searchParams, Object.keys(FILTER_GET) as FilterKey[]);
  if (!cf.ok) return Response.json({ error: cf.error }, { status: 400 });

  // mock ทำในหน่วยความจำ ของจริงให้แปลงเป็น WHERE ... LIKE ? / ORDER BY <sort> <dir> / LIMIT ? OFFSET ?
  const needle = q.toLowerCase();
  let rows = needle ? PATIENTS.filter((p) => SEARCHABLE.some((k) => p[k].toLowerCase().includes(needle))) : PATIENTS;
  const { filters, facet, facetQ } = cf.query;
  if (facet) return Response.json(facetRows(filterRows(rows, filters, FILTER_GET, facet), FILTER_GET[facet], facetQ));
  rows = filterRows(rows, filters, FILTER_GET);
  if (sort) {
    const sign = dir === "desc" ? -1 : 1;
    rows = rows.toSorted((a, b) => {
      const x = a[sort];
      const y = b[sort];
      return sign * (typeof x === "number" ? x - (y as number) : String(x).localeCompare(String(y), "th"));
    });
  }

  if (format === "xlsx") {
    return xlsxResponse<Patient>("patients.xlsx", [
      { key: "hn", header: "HN", width: 12 },
      { key: "name", header: "ชื่อ-สกุล", width: 24 },
      { key: "sex", header: "เพศ", width: 8 },
      { key: "age", header: "อายุ", width: 8, type: "count" },
      { key: "ward", header: "หอผู้ป่วย", width: 18 },
      { key: "admitDate", header: "วันที่รับไว้", width: 14 },
      { key: "diagnosis", header: "การวินิจฉัย", width: 32 },
      { key: "status", header: "สถานะ", width: 12 },
      { key: "doctor", header: "แพทย์", width: 14 },
    ], rows);
  }

  const body: GridPage<Patient> = { rows: rows.slice((page - 1) * pageSize, page * pageSize), total: rows.length };
  return Response.json(body);
}
