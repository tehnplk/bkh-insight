"use client";

import { useMemo } from "react";
import type { Chart, ChartOptions, Plugin } from "chart.js";
import { Bar } from "react-chartjs-2";
import { focusRing, tooltipStyle, truncate, useChartTheme, useKeyboardActive } from "@/components/charts/charts";

/** สีเป็นชื่อ CSS variable ของ token เช่น "--accent" อ่านค่าจริงตามธีม */
export type StackSeries = { label: string; color: string; values: number[] };

export type StackedBarProps = {
  labels: string[];
  series: StackSeries[];
  /** แท่งแนวนอน (รายการ) หรือแนวตั้ง (รายวัน) */
  horizontal?: boolean;
  ariaLabel: string;
  tooltipTitle: (i: number) => string;
  tooltipLabel: (series: number, i: number) => string;
  tooltipFooter?: (i: number) => string;
  /** แนวนอน: ป้ายที่ปลายแท่ง (สีตัวอักษร token) */
  endLabels?: string[];
  /** แนวตั้ง: ป้ายแกนค่า + หน่วยเหนือแกน */
  tickFormat?: (n: number) => string;
  unit?: string;
  onSelect?: (i: number) => void;
};

/** แท่งซ้อนตามสถานะ: legend เป็น HTML, คีย์บอร์ดเลื่อนด้วยลูกศร Enter = onSelect */
export function StackedBarChart({
  labels,
  series,
  horizontal,
  ariaLabel,
  tooltipTitle,
  tooltipLabel,
  tooltipFooter,
  endLabels,
  tickFormat,
  unit,
  onSelect,
}: StackedBarProps) {
  const theme = useChartTheme();
  const { chartRef, active, onKeyDown, onBlur } = useKeyboardActive(labels.length, onSelect);

  // สีของแต่ละชุดจาก token (คำนวณใหม่เมื่อธีมเปลี่ยน)
  const colors = useMemo(() => {
    if (!theme) return [];
    const css = getComputedStyle(document.documentElement);
    return series.map((s) => css.getPropertyValue(s.color).trim());
  }, [theme, series]);

  const data = useMemo(
    () => ({
      labels,
      datasets: series.map((s, d) => ({
        label: s.label,
        data: s.values,
        backgroundColor: colors[d],
        // ช่องว่าง 2px สีพื้นระหว่างส่วนของแท่ง (1px ต่อข้าง)
        borderColor: theme?.surface,
        borderWidth: 1,
        borderRadius: d === series.length - 1 ? 4 : 0,
        borderSkipped: "start" as const,
        maxBarThickness: horizontal ? 18 : 24,
        categoryPercentage: 0.8,
        barPercentage: 1,
      })),
    }),
    [labels, series, colors, theme?.surface, horizontal],
  );

  const labelSpace = useMemo(() => {
    if (!theme || !endLabels?.length) return 8;
    const ctx = document.createElement("canvas").getContext("2d");
    if (!ctx) return 160;
    ctx.font = `500 11px ${theme.font}`;
    return Math.ceil(Math.max(0, ...endLabels.map((t) => ctx.measureText(t).width))) + 12;
  }, [endLabels, theme]);

  const endLabelPlugin = useMemo<Plugin<"bar">>(
    () => ({
      id: "endLabels",
      afterDatasetsDraw(chart) {
        if (!theme || !endLabels) return;
        const last = chart.getDatasetMeta(chart.data.datasets.length - 1);
        const ctx = chart.ctx;
        ctx.save();
        ctx.font = `500 11px ${theme.font}`;
        ctx.fillStyle = theme.fg;
        ctx.textBaseline = "middle";
        last.data.forEach((bar, i) => {
          const { x, y } = bar.getProps(["x", "y"], true) as { x: number; y: number };
          ctx.fillText(endLabels[i] ?? "", x + 6, y);
        });
        ctx.restore();
      },
    }),
    [endLabels, theme],
  );

  const options = useMemo<ChartOptions<"bar">>(() => {
    if (!theme) return {};
    const tick = { color: theme.muted, font: { family: theme.font, size: 11 } };
    const categoryAxis = {
      stacked: true,
      grid: { display: false },
      border: { color: theme.line },
      ticks: horizontal
        ? {
            color: theme.fg,
            font: { family: theme.font, size: 12 },
            callback(this: { getLabelForValue: (v: number) => string; chart: Chart }, v: string | number) {
              // จอแคบตัดชื่อให้สั้น ไม่งั้น chart.js ตัดป้ายทิ้งที่ขอบซ้าย (ชื่อเต็มอยู่ใน tooltip และตาราง)
              return truncate(this.getLabelForValue(Number(v)), this.chart.width < 480 ? 12 : 22);
            },
          }
        : { ...tick, autoSkip: true, autoSkipPadding: 16, maxRotation: 0, maxTicksLimit: 8 },
    };
    const valueAxis = horizontal
      ? { stacked: true, display: false, beginAtZero: true }
      : {
          stacked: true,
          beginAtZero: true,
          grid: { color: theme.line },
          border: { display: false },
          ticks: { ...tick, maxTicksLimit: 5, padding: 6, callback: (v: string | number) => (tickFormat ? tickFormat(Number(v)) : String(v)) },
        };
    return {
      indexAxis: horizontal ? "y" : "x",
      responsive: true,
      maintainAspectRatio: false,
      animation: false, // วาดทันทีทั้งตอนเปลี่ยนธีมและเปลี่ยนช่วงวันที่
      interaction: { mode: "index", axis: horizontal ? "y" : "x", intersect: false },
      layout: { padding: { right: horizontal ? labelSpace : 8, top: 4 } },
      scales: horizontal ? { y: categoryAxis, x: valueAxis } : { x: categoryAxis, y: valueAxis },
      onClick: (_e, els) => {
        if (els[0] && onSelect) onSelect(els[0].index);
      },
      onHover: (e, els) => {
        const t = e.native?.target as HTMLElement | undefined;
        if (t) t.style.cursor = els[0] && onSelect ? "pointer" : "default";
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          ...tooltipStyle(theme),
          callbacks: {
            title: (items) => tooltipTitle(items[0].dataIndex),
            label: (item) => tooltipLabel(item.datasetIndex, item.dataIndex),
            footer: (items) => (tooltipFooter ? tooltipFooter(items[0].dataIndex) : ""),
          },
        },
      },
    } as ChartOptions<"bar">;
  }, [theme, horizontal, labelSpace, tickFormat, onSelect, tooltipTitle, tooltipLabel, tooltipFooter]);

  const describe = (i: number) =>
    [tooltipTitle(i), ...series.map((_, d) => tooltipLabel(d, i)), tooltipFooter?.(i) ?? ""].filter(Boolean).join(" · ");
  const keyHint = horizontal ? "ใช้ลูกศรขึ้นลงเพื่ออ่านค่า" : "ใช้ลูกศรซ้ายขวาเพื่ออ่านค่ารายวัน";

  return (
    <div>
      <ul className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted" aria-label="คำอธิบายสี">
        {series.map((s) => (
          <li key={s.label} className="flex items-center gap-1.5">
            <span aria-hidden="true" className="size-2.5 rounded-sm" style={{ background: `var(${s.color})` }} />
            {s.label}
          </li>
        ))}
        {unit && <li className="ml-auto">{unit}</li>}
      </ul>
      <div
        tabIndex={0}
        role="group"
        aria-label={`${ariaLabel} ${keyHint}${onSelect ? " กด Enter เพื่อกรองรายการ" : ""}`}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
        className={`relative ${horizontal ? "" : "h-60"} ${focusRing}`}
        style={horizontal ? { height: labels.length * 32 + 8 } : undefined}
      >
        {theme ? (
          <Bar
            key={theme.key} // เปลี่ยนธีม = สร้างกราฟใหม่ด้วยสีชุดใหม่
            ref={(c) => {
              chartRef.current = (c as Chart | null | undefined) ?? null;
            }}
            data={data}
            options={options}
            plugins={[endLabelPlugin]}
            role="img"
            aria-label={`${ariaLabel}: ${labels.map((_, i) => describe(i)).join("; ")}`}
          />
        ) : (
          <div className="h-full animate-pulse rounded-md bg-surface-sunken" />
        )}
        <p aria-live="polite" className="sr-only">
          {active !== null ? describe(active) : ""}
        </p>
      </div>
    </div>
  );
}
