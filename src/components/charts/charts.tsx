"use client";

import {
  useCallback,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  ArcElement,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Filler,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
  type Chart,
  type ChartOptions,
  type Plugin,
} from "chart.js";
import { Bar, Doughnut, Line } from "react-chartjs-2";

// Line/Bar ของ react-chartjs-2 register controller ให้เอง ที่นี่ register เฉพาะ scale/element/plugin ที่ใช้
ChartJS.register(
  CategoryScale,
  LinearScale,
  ArcElement,
  BarElement,
  LineElement,
  PointElement,
  Filler,
  Tooltip,
);

/* ---------- สีและฟอนต์จาก design token (อ่านตอน runtime, เปลี่ยนตาม data-theme) ---------- */

export type ChartTheme = {
  key: string;
  fg: string;
  muted: string;
  line: string;
  surface: string;
  accent: string;
  accentText: string;
  font: string;
};

function subscribeTheme(cb: () => void) {
  const mo = new MutationObserver(cb);
  mo.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
  return () => mo.disconnect();
}
const getThemeKey = () => document.documentElement.dataset.theme ?? "light";
const getServerThemeKey = () => null;

/** null ระหว่าง SSR / ก่อน hydrate (ยังอ่าน CSS ไม่ได้) */
export function useChartTheme(): ChartTheme | null {
  const key = useSyncExternalStore(
    subscribeTheme,
    getThemeKey,
    getServerThemeKey,
  );
  return useMemo(() => {
    if (key === null) return null;
    const css = getComputedStyle(document.documentElement);
    const v = (name: string) => css.getPropertyValue(name).trim();
    return {
      key,
      fg: v("--foreground"),
      muted: v("--muted"),
      line: v("--line"),
      surface: v("--surface"),
      accent: v("--accent"),
      accentText: v("--accent-text"),
      font: getComputedStyle(document.body).fontFamily,
    };
  }, [key]);
}

/** token เป็น #rrggbb -> rgba สำหรับ area wash */
function withAlpha(hex: string, alpha: number) {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return hex;
  return `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${alpha})`;
}

export const tooltipStyle = (t: ChartTheme) => ({
  backgroundColor: t.surface,
  borderColor: t.line,
  borderWidth: 1,
  titleColor: t.muted,
  bodyColor: t.fg,
  titleFont: { family: t.font, size: 11, weight: 400 as const },
  bodyFont: { family: t.font, size: 12, weight: 600 as const },
  padding: 8,
  cornerRadius: 6,
  displayColors: false,
});

/* ---------- keyboard: ลูกศรเลื่อนจุดที่เลือก แสดง tooltip เดียวกับ hover ---------- */

export function useKeyboardActive(count: number, onEnter?: (i: number) => void) {
  const chartRef = useRef<Chart | null>(null);
  const [active, setActive] = useState<number | null>(null);

  function show(i: number | null) {
    const chart = chartRef.current;
    setActive(i);
    if (!chart) return;
    if (i === null) {
      chart.setActiveElements([]);
      chart.tooltip?.setActiveElements([], { x: 0, y: 0 });
    } else {
      const el = chart.getDatasetMeta(0).data[i];
      // ทุก dataset ที่ index นี้ (กราฟซ้อน) tooltip จึงแสดงครบเหมือน hover
      const els = chart.data.datasets.map((_, datasetIndex) => ({ datasetIndex, index: i }));
      chart.setActiveElements(els);
      chart.tooltip?.setActiveElements(els, { x: el?.x ?? 0, y: el?.y ?? 0 });
    }
    chart.update();
  }

  function onKeyDown(e: KeyboardEvent) {
    if (count === 0) return;
    const cur = active ?? -1;
    let next: number | null = null;
    if (e.key === "ArrowRight" || e.key === "ArrowDown")
      next = Math.min(count - 1, cur + 1);
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp")
      next = Math.max(0, cur < 0 ? 0 : cur - 1);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = count - 1;
    else if (e.key === "Enter" && active !== null && onEnter) {
      e.preventDefault();
      onEnter(active);
      return;
    } else if (e.key === "Escape") {
      show(null);
      return;
    } else return;
    e.preventDefault();
    show(next);
  }

  return { chartRef, active, onKeyDown, onBlur: () => show(null) };
}

export const focusRing =
  "rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring";

/* ---------- แนวโน้มรายวัน: เส้น + area wash, crosshair ---------- */

const crosshair: Plugin<"line"> = {
  id: "crosshair",
  beforeDatasetsDraw(chart, _args, opts: { color?: string }) {
    const active = chart.tooltip?.getActiveElements();
    if (!active?.length) return;
    const x = Math.round(active[0].element.x) + 0.5;
    const { top, bottom } = chart.chartArea;
    const ctx = chart.ctx;
    ctx.save();
    ctx.strokeStyle = opts.color ?? "#888";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
    ctx.stroke();
    ctx.restore();
  },
};

export type TrendPoint = {
  label: string;
  title: string;
  value: number;
  valueText: string;
};

export function TrendChart({
  points,
  tickFormat,
  unit,
  ariaLabel,
}: {
  points: TrendPoint[];
  tickFormat: (n: number) => string;
  /** หน่วยของแกน y แสดงเหนือแกน เช่น "ล้านบาท" */
  unit: string;
  ariaLabel: string;
}) {
  const theme = useChartTheme();
  const { chartRef, active, onKeyDown, onBlur } = useKeyboardActive(
    points.length,
  );
  const single = points.length === 1;

  const data = useMemo(
    () => ({
      labels: points.map((p) => p.label),
      datasets: [
        {
          data: points.map((p) => p.value),
          borderColor: theme?.accentText,
          backgroundColor: theme ? withAlpha(theme.accent, 0.12) : undefined,
          borderWidth: 2,
          fill: "origin" as const,
          tension: 0,
          borderJoinStyle: "round" as const,
          borderCapStyle: "round" as const,
          pointRadius: single ? 4 : 0,
          pointHoverRadius: 5,
          pointBackgroundColor: theme?.accentText,
          pointBorderColor: theme?.surface,
          pointBorderWidth: 2,
          pointHoverBorderWidth: 2,
          pointHitRadius: 12,
        },
      ],
    }),
    [points, theme, single],
  );

  const options = useMemo<ChartOptions<"line">>(() => {
    if (!theme) return {};
    const tick = { color: theme.muted, font: { family: theme.font, size: 11 } };
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: false, // วาดทันทีทั้งตอนเปลี่ยนธีมและเปลี่ยนช่วงวันที่
      interaction: { mode: "index", intersect: false },
      layout: { padding: { top: 4, right: 8 } },
      scales: {
        x: {
          offset: single, // วันเดียว: วางจุดกลางกราฟ ไม่ชิดขอบซ้าย
          grid: { display: false },
          border: { color: theme.line },
          ticks: {
            ...tick,
            autoSkip: true,
            autoSkipPadding: 16,
            maxRotation: 0,
            maxTicksLimit: 8,
          },
        },
        y: {
          beginAtZero: true,
          grid: { color: theme.line },
          border: { display: false },
          ticks: {
            ...tick,
            maxTicksLimit: 5,
            padding: 6,
            callback: (v) => tickFormat(Number(v)),
          },
        },
      },
      plugins: {
        legend: { display: false },
        crosshair: { color: theme.muted },
        tooltip: {
          ...tooltipStyle(theme),
          callbacks: {
            title: (items) => points[items[0].dataIndex]?.title ?? "",
            label: (item) => points[item.dataIndex]?.valueText ?? "",
          },
        },
      } as ChartOptions<"line">["plugins"],
    };
  }, [theme, points, tickFormat, single]);

  const current = active !== null ? points[active] : null;

  return (
    <>
      <p aria-hidden="true" className="mb-1 text-xs text-muted">
        {unit}
      </p>
      <div
        tabIndex={0}
        role="group"
        aria-label={`${ariaLabel} (${unit}) ใช้ลูกศรซ้ายขวาเพื่ออ่านค่ารายวัน`}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
        className={`relative h-60 ${focusRing}`}
      >
        {theme ? (
          <Line
            key={theme.key} // เปลี่ยนธีม = สร้างกราฟใหม่ด้วยสีชุดใหม่ (react-chartjs-2 ไม่ redraw สีเดิมให้ครบ)
            ref={(c) => {
              chartRef.current = (c as Chart | null | undefined) ?? null;
            }}
            data={data}
            options={options}
            plugins={[crosshair]}
            role="img"
            aria-label={ariaLabel}
          />
        ) : (
          <div className="h-full animate-pulse rounded-md bg-surface-sunken" />
        )}
        <p aria-live="polite" className="sr-only">
          {current ? `${current.title} ${current.valueText}` : ""}
        </p>
      </div>
    </>
  );
}

/* ---------- donut: สัดส่วนของทั้งหมด, ข้อความกลางวง, legend/ตารางเป็นของผู้เรียก ---------- */

export type DonutSegment = {
  label: string;
  value: number;
  /** ชื่อ token สี เช่น "--chart-1" ผูกกับ entity (ไม่ใช่อันดับ) กรองแล้วสีไม่เปลี่ยน */
  color: string;
  /** ข้อความใน tooltip และ screen reader */
  valueText: string;
};

/**
 * segment ค่า 0 ไม่วาด (สีของที่เหลือคงเดิมเพราะผูกกับ segment)
 * canvas อ่านด้วย screen reader ไม่ได้ ผู้เรียกต้องแสดงค่าเป็น legend/ตารางข้างวงเสมอ
 */
export function DonutChart({
  segments,
  center,
  ariaLabel,
}: {
  segments: DonutSegment[];
  /** ข้อความกลางวง เช่น ยอดรวม + คำอธิบายสั้น */
  center: ReactNode;
  ariaLabel: string;
}) {
  const theme = useChartTheme();
  const shown = useMemo(() => segments.filter((s) => s.value > 0), [segments]);
  const { chartRef, active, onKeyDown, onBlur } = useKeyboardActive(shown.length);

  const data = useMemo(() => {
    const css = theme ? getComputedStyle(document.documentElement) : null;
    const colors = shown.map((s) => css?.getPropertyValue(s.color).trim());
    return {
      labels: shown.map((s) => s.label),
      datasets: [
        {
          data: shown.map((s) => s.value),
          backgroundColor: colors,
          hoverBackgroundColor: colors,
          // ช่องว่าง 2px สีพื้นระหว่าง segment
          borderColor: theme?.surface,
          borderWidth: shown.length > 1 ? 2 : 0,
          hoverOffset: 4,
        },
      ],
    };
  }, [shown, theme]);

  const options = useMemo<ChartOptions<"doughnut">>(() => {
    if (!theme) return {};
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      cutout: "72%",
      layout: { padding: 4 },
      plugins: {
        legend: { display: false },
        tooltip: {
          ...tooltipStyle(theme),
          callbacks: {
            title: (it) => shown[it[0].dataIndex]?.label ?? "",
            label: (it) => shown[it.dataIndex]?.valueText ?? "",
          },
        },
      },
    };
  }, [theme, shown]);

  const current = active !== null ? shown[active] : null;

  return (
    <div
      tabIndex={0}
      role="group"
      aria-label={`${ariaLabel} ใช้ลูกศรเพื่ออ่านค่า`}
      onKeyDown={onKeyDown}
      onBlur={onBlur}
      className={`relative mx-auto aspect-square w-full max-w-48 ${focusRing} rounded-full`}
    >
      {theme ? (
        <Doughnut
          key={theme.key}
          ref={(c) => {
            chartRef.current = (c as Chart | null | undefined) ?? null;
          }}
          data={data}
          options={options}
          role="img"
          aria-label={`${ariaLabel}: ${shown.map((s) => `${s.label} ${s.valueText}`).join(", ")}`}
          className="relative z-10" // tooltip (วาดใน canvas) ต้องอยู่เหนือข้อความกลางวง
        />
      ) : (
        <div className="size-full animate-pulse rounded-full bg-surface-sunken" />
      )}
      <div className="pointer-events-none absolute inset-0 grid place-content-center text-center">{center}</div>
      <p aria-live="polite" className="sr-only">
        {current ? `${current.label} ${current.valueText}` : ""}
      </p>
    </div>
  );
}

/* ---------- ปุ่มเปิด/ปิดตารางข้อมูลใต้กราฟ (canvas อ่านด้วย screen reader ไม่ได้) ---------- */

/** children = <thead>/<tbody> ของตาราง ตารางมี caption จาก prop caption */
export function DataTableToggle({ caption, children }: { caption: string; children: ReactNode }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
        className="mt-2 rounded-md px-1.5 py-1 text-sm text-muted outline-none hover:bg-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        {open ? "ซ่อนตารางข้อมูล" : "แสดงตารางข้อมูล"}
      </button>
      <div id={id} hidden={!open} className="mt-2 overflow-x-auto rounded-md border border-line">
        <table className="w-full border-collapse text-sm tabular-nums [&_td]:px-3 [&_td]:py-1.5 [&_td]:text-right [&_th]:px-3 [&_th]:py-1.5 [&_th]:whitespace-nowrap [&_thead]:bg-surface-sunken [&_thead_th]:font-medium [&_thead_th]:text-muted [&_tr]:border-t [&_tr]:border-line [&_tbody_th]:text-left [&_tbody_th]:font-normal">
          <caption className="sr-only">{caption}</caption>
          {children}
        </table>
      </div>
    </>
  );
}

/* ---------- ranked horizontal bars: ค่าที่ปลายแท่ง, คลิก/Enter เพื่อ drill-down ---------- */

export type RankedItem = {
  label: string;
  value: number;
  valueText: string;
  tooltip: string;
  href?: string;
};

export const truncate = (s: string, n: number) =>
  s.length > n ? `${s.slice(0, n - 1)}…` : s;

/**
 * ข้อความที่ปลายแท่ง (สีตัวอักษรเป็น text token ไม่ใช่สีแท่ง) อ่านจาก options.plugins.valueLabels
 * ไม่ใช่ closure เพราะ react-chartjs-2 รับ prop `plugins` ครั้งเดียวตอนสร้างกราฟ แต่ส่ง options ใหม่ทุกครั้ง
 * (closure ทำให้ป้ายค้างค่าของช่วงวันที่แรก ขณะที่แท่งและ tooltip เปลี่ยนตามข้อมูลใหม่)
 */
const valueLabels: Plugin<"bar"> = {
  id: "valueLabels",
  afterDatasetsDraw(chart, _args, opts: { texts?: string[]; font?: string; color?: string }) {
    if (!opts.texts) return;
    const ctx = chart.ctx;
    ctx.save();
    if (opts.font) ctx.font = opts.font;
    if (opts.color) ctx.fillStyle = opts.color;
    ctx.textBaseline = "middle";
    chart.getDatasetMeta(0).data.forEach((bar, i) => {
      const { x, y } = bar.getProps(["x", "y"], true) as { x: number; y: number };
      ctx.fillText(opts.texts?.[i] ?? "", x + 6, y);
    });
    ctx.restore();
  },
};

export function RankedBarChart({
  items,
  ariaLabel,
  onSelect,
}: {
  items: RankedItem[];
  ariaLabel: string;
  onSelect: (item: RankedItem) => void;
}) {
  const theme = useChartTheme();
  const select = useCallback(
    (i: number) => {
      const it = items[i];
      if (it?.href) onSelect(it);
    },
    [items, onSelect],
  );
  const { chartRef, active, onKeyDown, onBlur } = useKeyboardActive(
    items.length,
    select,
  );

  const data = useMemo(
    () => ({
      labels: items.map((i) => i.label),
      datasets: [
        {
          data: items.map((i) => i.value),
          backgroundColor: theme?.accent,
          hoverBackgroundColor: theme?.accentText,
          borderRadius: 4,
          borderSkipped: "start" as const,
          maxBarThickness: 18,
          categoryPercentage: 0.8,
          barPercentage: 1,
        },
      ],
    }),
    [items, theme],
  );

  // เว้นขวาให้พอกับป้ายที่ยาวที่สุด ป้ายจึงไม่ถูกตัด
  const labelSpace = useMemo(() => {
    if (!theme) return 0;
    const ctx = document.createElement("canvas").getContext("2d");
    if (!ctx) return 160;
    ctx.font = `500 11px ${theme.font}`;
    return (
      Math.ceil(
        Math.max(0, ...items.map((i) => ctx.measureText(i.valueText).width)),
      ) + 12
    );
  }, [items, theme]);

  const options = useMemo<ChartOptions<"bar">>(() => {
    if (!theme) return {};
    return {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      animation: false, // วาดทันทีทั้งตอนเปลี่ยนธีมและเปลี่ยนช่วงวันที่
      interaction: { mode: "y", intersect: false },
      layout: { padding: { right: labelSpace } },
      scales: {
        x: { display: false, beginAtZero: true },
        y: {
          grid: { display: false },
          border: { color: theme.line },
          ticks: {
            color: theme.fg,
            font: { family: theme.font, size: 12 },
            callback(v) {
              // จอแคบตัดชื่อให้สั้นลง ไม่งั้น chart.js ตัดป้ายทิ้งที่ขอบซ้าย (ชื่อเต็มอยู่ใน tooltip และตาราง)
              return truncate(
                this.getLabelForValue(Number(v)),
                this.chart.width < 480 ? 12 : 22,
              );
            },
          },
        },
      },
      onClick: (_e, els) => {
        if (els[0]) select(els[0].index);
      },
      onHover: (e, els) => {
        const t = e.native?.target as HTMLElement | undefined;
        if (t)
          t.style.cursor =
            els[0] && items[els[0].index]?.href ? "pointer" : "default";
      },
      plugins: {
        legend: { display: false },
        valueLabels: {
          texts: items.map((i) => i.valueText),
          font: `500 11px ${theme.font}`,
          color: theme.fg,
        },
        tooltip: {
          ...tooltipStyle(theme),
          callbacks: {
            title: (it) => items[it[0].dataIndex]?.label ?? "",
            label: (it) => items[it.dataIndex]?.tooltip ?? "",
          },
        },
      } as ChartOptions<"bar">["plugins"],
    };
  }, [theme, items, select, labelSpace]);

  const current = active !== null ? items[active] : null;

  return (
    <div
      tabIndex={0}
      role="group"
      aria-label={`${ariaLabel} ใช้ลูกศรขึ้นลงเพื่ออ่านค่า กด Enter เพื่อดูรายการ`}
      onKeyDown={onKeyDown}
      onBlur={onBlur}
      className={`relative ${focusRing}`}
      style={{ height: items.length * 30 + 8 }}
    >
      {theme ? (
        <Bar
          key={theme.key}
          ref={(c) => {
            chartRef.current = (c as Chart | null | undefined) ?? null;
          }}
          data={data}
          options={options}
          plugins={[valueLabels]}
          role="img"
          aria-label={`${ariaLabel}: ${items.map((i) => `${i.label} ${i.tooltip}`).join(", ")}`}
        />
      ) : (
        <div className="h-full animate-pulse rounded-md bg-surface-sunken" />
      )}
      <p aria-live="polite" className="sr-only">
        {current ? `${current.label} ${current.tooltip}` : ""}
      </p>
    </div>
  );
}
