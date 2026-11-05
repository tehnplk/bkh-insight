"use client";

import { useState } from "react";
import { StackedBarChart, type StackedBarCategory, type StackedBarSeries } from "@/components/stacked-bar-chart/stacked-bar-chart";
import { homeQuery, type TrendBy, type TrendMetric } from "./home-params";
import { Segmented } from "./segmented";

export type TrendBucket = StackedBarCategory & { from: string; to: string };
/** series = กลุ่มสิทธิ (hipdata_code) หรือ "other" */
export type TrendSeries = StackedBarSeries & { group: string | null };
export type TrendData = {
  by: TrendBy;
  buckets: TrendBucket[];
  series: TrendSeries[];
  /** [bucket][series] */
  visits: number[][];
  income: number[][];
};

const METRICS = [
  { value: "income", label: "ค่าใช้จ่าย" },
  { value: "visits", label: "จำนวนครั้ง" },
] as const;

const baht = new Intl.NumberFormat("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const count = new Intl.NumberFormat("th-TH");

/** link ไปรายชื่อผู้รับบริการของวัน/เดือนนั้นในกลุ่มสิทธินั้น ตาม convention ของ /visit/opd-visit (วันนี้ไม่ใส่ from/to) */
function listHref(b: TrendBucket, group: string, today: string) {
  const sp = new URLSearchParams();
  if (b.from !== today) sp.set("from", b.from);
  if (b.to !== today) sp.set("to", b.to);
  sp.set("group", group);
  return `/visit/opd-visit?${sp}`;
}

/**
 * ตัวชี้วัดสลับฝั่ง client (ข้อมูลมาทั้งสองค่าในครั้งเดียว ไม่ต้อง query HIS ซ้ำ) และเขียน ?metric= ด้วย history.replaceState
 * linkable = false เมื่อกรองสิทธิอยู่ (หน้ารายชื่อกรองได้แค่กลุ่ม ตัวเลขจะไม่ตรงกับแท่ง)
 */
export function TrendChart({
  data,
  metric: initial,
  linkable,
  today,
}: {
  data: TrendData;
  metric: TrendMetric;
  linkable: boolean;
  /** วันนี้ (ISO) จาก server */
  today: string;
}) {
  const [metric, setMetric] = useState(initial);
  const values = data[metric];
  const total = { visits: sum(data.visits), income: sum(data.income) };

  function changeMetric(m: TrendMetric) {
    setMetric(m);
    const qs = homeQuery(new URLSearchParams(window.location.search), { metric: m }, today);
    window.history.replaceState(null, "", `${window.location.pathname}${qs}`);
  }

  return (
    <>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <dl className="flex flex-wrap gap-x-6 gap-y-1">
          <div className="flex items-baseline gap-2">
            <dt className="text-muted">ค่าใช้จ่ายรวม</dt>
            <dd className="text-title tabular-nums">{baht.format(total.income)} บาท</dd>
          </div>
          <div className="flex items-baseline gap-2">
            <dt className="text-muted">จำนวนครั้ง</dt>
            <dd className="text-title tabular-nums">{count.format(total.visits)}</dd>
          </div>
        </dl>
        <Segmented label="ตัวชี้วัด" options={METRICS} value={metric} onChange={changeMetric} />
      </div>
      <div className="mt-4 rounded-md border border-line bg-surface p-3">
        <StackedBarChart
          label={`${metric === "income" ? "ค่าใช้จ่าย (บาท)" : "จำนวนครั้ง"} ${data.by === "month" ? "รายเดือน" : "รายวัน"} แยกตามกลุ่มสิทธิ`}
          categoryHeader={data.by === "month" ? "เดือน" : "วันที่"}
          categories={data.buckets}
          series={data.series}
          values={values}
          format={(n) => (metric === "income" ? baht : count).format(n)}
          integer={metric === "visits"}
          stacked={false}
          height={360}
          hrefFor={
            linkable
              ? (c, s) => {
                  const g = data.series[s].group;
                  return g ? listHref(data.buckets[c], g, today) : undefined;
                }
              : undefined
          }
        />
      </div>
    </>
  );
}

const sum = (m: number[][]) => m.reduce((a, row) => a + row.reduce((x, y) => x + y, 0), 0);
