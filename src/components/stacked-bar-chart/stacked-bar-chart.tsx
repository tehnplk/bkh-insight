"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BarController, BarElement, CategoryScale, Chart, LinearScale, Tooltip, type ScriptableContext } from "chart.js";

// legend เป็น HTML ของเราเอง (ขึ้นบรรทัดใหม่ได้ มีข้อความรอง) จึงไม่ register Legend ของ chart.js
Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip);

export type StackedBarSeries = {
  key: string;
  label: string;
  /** สีของ mark: CSS color หรือ token เช่น "var(--chart-1)" (อ่านค่าจริงตอนวาด และอ่านใหม่เมื่อสลับธีม) ข้อความไม่ใช้สีนี้ */
  color: string;
  /** ชื่อย่อในหัวตาราง เช่น รหัส (ไม่ส่ง = label) */
  short?: string;
  /** ข้อความรองใน legend เช่น รายการที่รวมอยู่ใน "อื่นๆ" */
  note?: string;
};
export type StackedBarCategory = {
  key: string;
  /** ป้ายแกน x แบบสั้น */
  label: string;
  /** หัว tooltip และแถวในตาราง */
  title: string;
};
export type StackedBarChartProps = {
  /** ชื่อของกราฟ: aria-label ของ canvas และ caption ของตาราง */
  label: string;
  /** หัวคอลัมน์แรกของตาราง เช่น "วันที่" */
  categoryHeader: string;
  categories: StackedBarCategory[];
  /** เรียงจากล่างขึ้นบนของแท่ง หรือซ้ายไปขวาเมื่อ stacked = false (ลำดับเดียวกับ legend) */
  series: StackedBarSeries[];
  /** values[category][series] ค่าไม่ติดลบ */
  values: number[][];
  /** รูปแบบตัวเลขใน tooltip และตาราง */
  format: (n: number) => string;
  /** ค่าเป็นจำนวนนับ: tick แกน y เป็นจำนวนเต็ม */
  integer?: boolean;
  /** link ของ segment (คลิกในกราฟ และ link ในตาราง) */
  hrefFor?: (category: number, series: number) => string | undefined;
  /** false = แท่งแยกของแต่ละ series วางเรียงกันในแต่ละ category (grouped) ค่าเริ่มต้น true ซ้อนเป็นแท่งเดียว */
  stacked?: boolean;
  /** ความสูงของพื้นที่กราฟ (px) ค่าเริ่มต้น 260 */
  height?: number;
};

const DEFAULT_HEIGHT = 260;
/** ความกว้างต่อ category ขั้นต่ำ แท่งเยอะกว่าที่จอรับได้จะเลื่อนแนวนอนแทนการบีบ */
const MIN_BAND = 18;
/** แบบ grouped: ความกว้างขั้นต่ำต่อแท่งย่อย + ช่องว่างระหว่าง category */
const MIN_GROUPED_BAR = 8;
const GROUP_GAP = 8;
const GAP = 2;
const RADIUS = 4;

const full = new Intl.NumberFormat("th-TH", { maximumFractionDigits: 1 });
const compact = new Intl.NumberFormat("th-TH", { notation: "compact", maximumFractionDigits: 1 });

/** ค่าจริงของสีจาก token บน <html> ("var(--chart-1)" -> "#2a78d6") */
function resolve(color: string, css: CSSStyleDeclaration) {
  const m = /^var\((--[\w-]+)\)$/.exec(color.trim());
  return m ? css.getPropertyValue(m[1]).trim() : color;
}

/** เปลี่ยนเมื่อ <html data-theme> เปลี่ยน (ThemeSwitch) ใช้เป็น dependency ให้วาดใหม่ด้วยสีของธีมนั้น */
function useTheme() {
  const [theme, setTheme] = useState<string | null>(null);
  useEffect(() => {
    const html = document.documentElement;
    const read = () => setTheme(html.dataset.theme ?? "");
    read();
    const mo = new MutationObserver(read);
    mo.observe(html, { attributes: true, attributeFilter: ["data-theme"] });
    return () => mo.disconnect();
  }, []);
  return theme;
}

/**
 * กราฟแท่งซ้อน (stacked column) หรือแท่งเรียงกลุ่ม (stacked = false) ด้วย chart.js กว้างตาม container แท่งเยอะเกินจอเลื่อนแนวนอนได้
 * hover แสดง tooltip ทุก series ของแท่งนั้นพร้อมยอดรวม canvas อ่านด้วย screen reader ไม่ได้ จึงมีตารางข้อมูลให้เปิดดูเสมอ
 */
export function StackedBarChart({
  label,
  categoryHeader,
  categories,
  series,
  values,
  format,
  integer = false,
  hrefFor,
  stacked = true,
  height = DEFAULT_HEIGHT,
}: StackedBarChartProps) {
  const router = useRouter();
  const id = useId();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [showTable, setShowTable] = useState(false);
  const theme = useTheme();
  // ฟังก์ชันที่ส่งมาใหม่ทุก render ไม่ควรทำให้สร้างกราฟใหม่ จึงอ่านผ่าน ref
  const fns = useRef({ format, hrefFor, push: router.push });
  useEffect(() => {
    fns.current = { format, hrefFor, push: router.push };
  });

  const totals = values.map((row) => row.reduce((a, b) => a + b, 0));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || theme === null) return;
    const css = getComputedStyle(document.documentElement);
    const token = (name: string) => css.getPropertyValue(name).trim();
    const surface = token("--surface");
    const font = { family: getComputedStyle(document.body).fontFamily, size: 12 };
    // segment บนสุดของแต่ละแท่ง: ปลายมนและไม่มีช่องว่างด้านบน (grouped: ทุกแท่งเป็นแท่งเดี่ยว มนน้อยลงเพราะแท่งแคบ)
    const topOf = values.map((row) => row.findLastIndex((v) => v > 0));
    const isTop = (c: ScriptableContext<"bar">) => !stacked || topOf[c.dataIndex] === c.datasetIndex;
    const radius = stacked ? RADIUS : 2;
    const max = Math.max(0, ...values.map((row) => (stacked ? row.reduce((a, b) => a + b, 0) : Math.max(0, ...row))));
    const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

    const chart = new Chart(canvas, {
      type: "bar",
      data: {
        labels: categories.map((c) => c.label),
        datasets: series.map((s, i) => ({
          label: s.label,
          data: values.map((row) => row[i]),
          backgroundColor: resolve(s.color, css),
          hoverBackgroundColor: resolve(s.color, css),
          // ช่องว่าง 2px สีพื้นระหว่าง segment (วาดเป็นขอบบนสีเดียวกับพื้น) ไม่ใช่เส้นขอบรอบ mark
          borderColor: surface,
          borderWidth: (c: ScriptableContext<"bar">) => (isTop(c) ? 0 : { top: GAP, right: 0, bottom: 0, left: 0 }),
          borderRadius: (c: ScriptableContext<"bar">) =>
            isTop(c) ? { topLeft: radius, topRight: radius, bottomLeft: 0, bottomRight: 0 } : 0,
          borderSkipped: false,
          inflateAmount: 0,
          // grouped: แท่งย่อยเว้นช่องแคบ ระหว่าง category เว้นกว้างกว่าให้เห็นเป็นกลุ่ม
          ...(stacked
            ? { maxBarThickness: 24, barPercentage: 0.64, categoryPercentage: 1 }
            : { maxBarThickness: 28, barPercentage: 0.9, categoryPercentage: 0.85 }),
        })),
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: reduceMotion ? false : { duration: 200 },
        interaction: { mode: "index", intersect: false },
        layout: { padding: { top: 8 } },
        font,
        scales: {
          x: {
            stacked,
            grid: { display: false },
            border: { color: token("--line") },
            ticks: { color: token("--muted"), font, maxRotation: 0, autoSkip: true, autoSkipPadding: 12 },
          },
          y: {
            stacked,
            beginAtZero: true,
            suggestedMax: max > 0 ? undefined : 1,
            grid: { color: token("--line") },
            border: { display: false },
            ticks: {
              color: token("--muted"),
              font,
              maxTicksLimit: 6,
              precision: integer ? 0 : undefined,
              callback: (v) => (max >= 10_000 ? compact : full).format(Number(v)),
            },
          },
        },
        plugins: {
          tooltip: {
            backgroundColor: surface,
            borderColor: token("--line"),
            borderWidth: 1,
            titleColor: token("--muted"),
            bodyColor: token("--foreground"),
            footerColor: token("--foreground"),
            titleFont: { ...font, size: 12, weight: "normal" },
            bodyFont: { ...font, size: 12 },
            footerFont: { ...font, size: 12, weight: 600 },
            padding: 10,
            boxWidth: 12,
            boxHeight: 2,
            boxPadding: 6,
            caretSize: 0,
            // ลำดับตรงกับที่เห็น: stacked บนสุดของแท่งขึ้นก่อน, grouped ซ้ายไปขวา
            itemSort: (a, b) => (stacked ? b.datasetIndex - a.datasetIndex : a.datasetIndex - b.datasetIndex),
            callbacks: {
              title: (items) => (items[0] ? categories[items[0].dataIndex].title : ""),
              label: (item) => `${fns.current.format(Number(item.raw))}  ${item.dataset.label}`,
              footer: (items) => (items[0] ? `รวม ${fns.current.format(totals[items[0].dataIndex])}` : ""),
              labelColor: (item) => {
                const c = String(item.dataset.backgroundColor);
                return { borderColor: c, backgroundColor: c, borderWidth: 0 };
              },
            },
          },
        },
        onHover: (e, _els, ch) => {
          const hit = e.native ? ch.getElementsAtEventForMode(e.native, "nearest", { intersect: true }, true)[0] : undefined;
          ch.canvas.style.cursor = hit && fns.current.hrefFor?.(hit.index, hit.datasetIndex) ? "pointer" : "";
        },
        onClick: (e, _els, ch) => {
          const hit = e.native ? ch.getElementsAtEventForMode(e.native, "nearest", { intersect: true }, true)[0] : undefined;
          const href = hit && fns.current.hrefFor?.(hit.index, hit.datasetIndex);
          if (href) fns.current.push(href);
        },
      },
    });
    return () => chart.destroy();
    // totals มาจาก values
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categories, series, values, integer, stacked, theme]);

  return (
    <div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm" aria-label="คำอธิบายสี">
        {series.map((s) => (
          <li key={s.key} className="flex items-center gap-1.5">
            <span aria-hidden="true" className="size-2.5 shrink-0 rounded-sm" style={{ background: s.color }} />
            <span>{s.label}</span>
            {s.note && <span className="text-muted">{s.note}</span>}
          </li>
        ))}
      </ul>

      <div className="mt-3 overflow-x-auto">
        <div className="relative" style={{ height, minWidth: categories.length * (stacked ? MIN_BAND : series.length * MIN_GROUPED_BAR + GROUP_GAP) + 56 }}>
          <canvas ref={canvasRef} role="img" aria-label={`${label} รายละเอียดอยู่ในตารางข้อมูลด้านล่าง`} />
        </div>
      </div>

      <button
        type="button"
        aria-expanded={showTable}
        aria-controls={`${id}-table`}
        onClick={() => setShowTable((v) => !v)}
        className="mt-2 rounded-md px-1.5 py-1 text-sm text-muted outline-none hover:bg-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        {showTable ? "ซ่อนตารางข้อมูล" : "แสดงตารางข้อมูล"}
      </button>
      <div id={`${id}-table`} hidden={!showTable} className="mt-2 overflow-x-auto rounded-md border border-line bg-surface">
        <table className="w-full border-collapse">
          <caption className="sr-only">{label}</caption>
          <thead className="bg-surface-sunken text-muted">
            <tr className="border-b border-line">
              <th scope="col" className="px-3 py-2 text-left font-medium whitespace-nowrap">
                {categoryHeader}
              </th>
              {series.map((s) => (
                <th key={s.key} scope="col" title={s.label} className="px-3 py-2 text-right font-medium whitespace-nowrap">
                  {s.short ?? s.label}
                </th>
              ))}
              <th scope="col" className="px-3 py-2 text-right font-medium">
                รวม
              </th>
            </tr>
          </thead>
          <tbody>
            {categories.map((cat, c) => (
              <tr key={cat.key} className="border-t border-line first:border-t-0">
                <th scope="row" className="px-3 py-1.5 text-left font-normal whitespace-nowrap">
                  {cat.title}
                </th>
                {series.map((s, i) => {
                  const v = values[c][i];
                  const href = v > 0 ? hrefFor?.(c, i) : undefined;
                  return (
                    <td key={s.key} className={`px-3 py-1.5 text-right tabular-nums whitespace-nowrap ${v > 0 ? "" : "text-muted"}`}>
                      {href ? (
                        <Link
                          href={href}
                          className="underline-offset-2 hover:underline focus-visible:rounded focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                        >
                          {format(v)}
                        </Link>
                      ) : v > 0 ? (
                        format(v)
                      ) : (
                        "–"
                      )}
                    </td>
                  );
                })}
                <td className="px-3 py-1.5 text-right font-medium tabular-nums whitespace-nowrap">{format(totals[c])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
