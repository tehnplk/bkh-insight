"use client";

import { useSyncExternalStore } from "react";

const TZ = "Asia/Bangkok";
const dateFmt = new Intl.DateTimeFormat("th-TH-u-ca-buddhist", {
  timeZone: TZ,
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
}); // "พ. 4 พ.ย. 2569"
const timeFmt = new Intl.DateTimeFormat("th-TH", {
  timeZone: TZ,
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
}); // "14:05:32"
const fullFmt = new Intl.DateTimeFormat("th-TH-u-ca-buddhist", {
  timeZone: TZ,
  dateStyle: "full",
  timeStyle: "medium",
});

// tick ตรงต้นวินาทีถัดไป (setInterval จะค่อยๆ เลื่อน)
function subscribe(onTick: () => void) {
  let id: ReturnType<typeof setTimeout>;
  const schedule = () => {
    id = setTimeout(() => {
      onTick();
      schedule();
    }, 1000 - (Date.now() % 1000));
  };
  schedule();
  return () => clearTimeout(id);
}

// ค่าคงที่ภายในวินาทีเดียวกัน จึงเป็น snapshot ที่ useSyncExternalStore ยอมรับ
const getSecond = () => Math.floor(Date.now() / 1000);
// server ไม่อ่านเวลา (กัน hydration mismatch และค่าไม่คงที่ของ cacheComponents)
const getServerSecond = () => null;

/** นาฬิกาเวลาไทย พ.ศ. เดินทุกวินาที แสดงเฉพาะฝั่ง client */
export function Clock({ className = "" }: { className?: string }) {
  const second = useSyncExternalStore(subscribe, getSecond, getServerSecond);
  if (second === null) return null;
  const now = new Date(second * 1000);
  return (
    <time
      dateTime={now.toISOString()}
      aria-label={fullFmt.format(now)}
      className={`text-sm whitespace-nowrap tabular-nums ${className}`}
    >
      <span className="text-muted">{dateFmt.format(now)}</span>{" "}
      <span className="font-medium">{timeFmt.format(now)}</span>
    </time>
  );
}
