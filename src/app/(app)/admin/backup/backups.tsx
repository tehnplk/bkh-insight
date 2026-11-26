"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { CopyButton } from "@/components/copy-button/copy-button";
import { formatThaiDate } from "@/lib/thai-date";
import type { BackupAlert, BackupFile, BackupKind, BackupRun, BackupVerify } from "@/lib/backup-status";
import { Notice, Skeleton, btn, focusRing, num, useJson } from "@/app/(app)/fund/_components/ui";
import type { BackupData } from "@/app/api/admin/backup/route";

const TH = "px-3 py-2.5 font-medium";
const TD = "px-3 py-1.5 align-top";
const primary = `inline-flex h-9 items-center justify-center rounded-md bg-accent px-3 text-sm font-medium text-accent-fg hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-60 ${focusRing}`;
const KIND: Record<BackupKind, string> = { nightly: "อัตโนมัติ", manual: "สำรองเอง", premigrate: "ก่อน migration" };
const dateTime = (iso: string) => `${formatThaiDate(iso)} ${iso.slice(11, 16)} น.`;
const mb = (bytes: number) => (bytes / 1_048_576).toLocaleString("th-TH", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-3">
      <dt className="w-20 shrink-0 text-muted">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

const Result = ({ ok, yes, no }: { ok: boolean; yes: string; no: string }) => <span className={`font-medium ${ok ? "text-success" : "text-danger"}`}>{ok ? yes : no}</span>;

function LastRun({ status, alert }: { status: BackupRun | null; alert: BackupAlert | null }) {
  return (
    <section aria-labelledby="last-run" className="flex flex-col gap-2 p-4">
      <h2 id="last-run" className="text-title">สำรองล่าสุด</h2>
      {status ? (
        <dl className="flex flex-col gap-1.5 text-sm">
          <Fact label="ผล"><Result ok={status.ok} yes="สำเร็จ" no="ไม่สำเร็จ" /></Fact>
          <Fact label="เมื่อ">{dateTime(status.finished_at || status.started_at)}</Fact>
          <Fact label="ชนิด">{KIND[status.kind] ?? status.kind}</Fact>
          {status.error && <Fact label="สาเหตุ"><span className="break-words text-danger">{status.error}</span></Fact>}
        </dl>
      ) : (
        <p className="text-sm text-muted">ยังไม่มีบันทึกการสำรอง</p>
      )}
      {alert && <p className={`text-sm font-medium ${alert.level === "danger" ? "text-danger" : "text-accent-text"}`}>{alert.reason}</p>}
    </section>
  );
}

function LastVerify({ verify }: { verify: BackupVerify | null }) {
  const tables = Object.entries(verify?.tables ?? {});
  return (
    <section aria-labelledby="last-verify" className="flex flex-col gap-2 p-4">
      <h2 id="last-verify" className="text-title">ทดสอบกู้คืนล่าสุด</h2>
      {verify ? (
        <>
          <dl className="flex flex-col gap-1.5 text-sm">
            <Fact label="ผล"><Result ok={verify.ok} yes="ผ่าน" no="ไม่ผ่าน" /></Fact>
            <Fact label="เมื่อ">{dateTime(verify.finished_at || verify.started_at)}</Fact>
            {verify.mode && <Fact label="วิธีตรวจ">{verify.mode === "restore" ? "กู้ลงฐานชั่วคราวแล้วนับแถว" : "ตรวจโครงไฟล์เท่านั้น ไม่ได้กู้จริง"}</Fact>}
            {verify.file && <Fact label="ไฟล์"><span className="break-all">{verify.file}</span></Fact>}
            {verify.sha256_ok !== undefined && <Fact label="SHA-256"><Result ok={verify.sha256_ok} yes="ตรง" no="ไม่ตรง" /></Fact>}
            {verify.error && <Fact label="สาเหตุ"><span className="break-words text-danger">{verify.error}</span></Fact>}
          </dl>
          {tables.length > 0 && (
            <table className="mt-1 w-full max-w-sm border-collapse text-sm">
              <thead className="text-left text-grid-head text-muted">
                <tr>
                  <th scope="col" className="py-1 pr-3 font-medium">ตาราง</th>
                  <th scope="col" className={`py-1 pr-3 font-medium ${num}`}>ในไฟล์ (แถว)</th>
                  <th scope="col" className={`py-1 font-medium ${num}`}>ฐานจริง (แถว)</th>
                </tr>
              </thead>
              <tbody>
                {tables.map(([t, c]) => (
                  <tr key={t} className="border-t border-line">
                    <td className="py-1 pr-3">{t}</td>
                    <td className={`py-1 pr-3 ${num}`}>{c.restored?.toLocaleString("th-TH") ?? <span className="text-muted">–</span>}</td>
                    <td className={`py-1 ${num}`}>{c.live?.toLocaleString("th-TH") ?? <span className="text-muted">–</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      ) : (
        <p className="text-sm text-muted">ยังไม่เคยทดสอบกู้คืน</p>
      )}
    </section>
  );
}

function LastDownload({ file }: { file: BackupFile }) {
  const list = file.meta?.downloads ?? [];
  const last = list.at(-1);
  if (!last) return <span className="text-muted">ยังไม่ดาวน์โหลด</span>;
  return (
    <span className="whitespace-nowrap">
      {last.by} <span className="text-muted">· {dateTime(last.at)}{list.length > 1 && ` · ${list.length} ครั้ง`}</span>
    </span>
  );
}

export function Backups() {
  const router = useRouter();
  const { data, error, retry } = useJson<BackupData>("/api/admin/backup");
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; text: string }>();
  // หลังสำรอง/ดาวน์โหลด โหลดรายการใหม่และ refresh จุดแจ้งเตือนในเมนูโปรไฟล์ (server component)
  const refresh = () => {
    retry();
    router.refresh();
  };

  function runNow() {
    setResult(undefined);
    startTransition(async () => {
      const res = await fetch("/api/admin/backup", { method: "POST" }).catch(() => null);
      const body = await res?.json().catch(() => null);
      setResult(res?.ok ? { ok: true, text: "สำรองข้อมูลแล้ว" } : { ok: false, text: body?.error ?? `สำรองข้อมูลไม่สำเร็จ${res ? ` (HTTP ${res.status})` : ""}` });
      refresh();
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-title text-balance">สำรองข้อมูล</h1>
        <div className="flex flex-wrap items-center gap-3">
          {result && <p role={result.ok ? "status" : "alert"} className={`text-sm ${result.ok ? "text-success" : "text-danger"}`}>{result.text}</p>}
          <button type="button" onClick={runNow} disabled={pending || !data?.configured} className={primary}>
            {pending ? "กำลังสำรอง…" : "สำรองตอนนี้"}
          </button>
        </div>
      </div>

      {error ? (
        <Notice title={`โหลดข้อมูลสำรองไม่สำเร็จ: ${error}`} action={<button type="button" className={btn} onClick={retry}>ลองอีกครั้ง</button>} />
      ) : !data ? (
        <Skeleton rows={4} />
      ) : !data.configured ? (
        <Notice title="เครื่องนี้ยังไม่ได้ตั้งค่าการสำรองข้อมูล" detail={`ไม่พบโฟลเดอร์ ${data.dir}`} />
      ) : (
        <>
          <div className="grid rounded-lg border border-line md:grid-cols-2 md:divide-x md:divide-line max-md:divide-y max-md:divide-line">
            <LastRun status={data.status} alert={data.alert} />
            <LastVerify verify={data.verify} />
          </div>

          <section aria-labelledby="files" className="flex flex-col gap-2">
            <h2 id="files" className="text-title">ไฟล์สำรอง</h2>
            <p className="text-sm text-muted">
              ไฟล์เข้ารหัสด้วย BACKUP_PASSWORD ใน .env ของ server เก็บรหัสผ่านไว้นอก server ด้วย ไม่มีรหัสผ่านจะกู้คืนไม่ได้ ไฟล์บน server เก็บ 5 วัน
            </p>
            {data.files.length === 0 ? (
              <p className="rounded-lg border border-line px-4 py-6 text-center text-sm text-muted">ยังไม่มีไฟล์สำรอง</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-line">
                <table className="w-full border-collapse text-sm">
                  <thead className="bg-surface text-left text-grid-head text-muted">
                    <tr>
                      <th scope="col" className={TH}>วันที่สำรอง</th>
                      <th scope="col" className={TH}>ชนิด</th>
                      <th scope="col" className={`${TH} ${num}`}>ขนาด (MB)</th>
                      <th scope="col" className={TH}>SHA-256</th>
                      <th scope="col" className={TH}>สถานะ</th>
                      <th scope="col" className={TH}>ดาวน์โหลดล่าสุด</th>
                      <th scope="col" className={TH}><span className="sr-only">ดาวน์โหลด</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.files.map((f) => (
                      <tr key={f.name} className="border-t border-line hover:bg-surface-sunken">
                        <td className={`${TD} whitespace-nowrap`}>{dateTime(f.meta?.finished_at || f.created_at)}</td>
                        <td className={`${TD} whitespace-nowrap`}>{KIND[f.kind]}</td>
                        <td className={`${TD} ${num}`}>{f.meta ? mb(f.meta.size) : <span className="text-muted">–</span>}</td>
                        <td className={TD}>
                          {f.meta?.sha256 ? (
                            <span className="inline-flex items-center gap-1">
                              <span className="font-mono tabular-nums" title={f.meta.sha256}>{f.meta.sha256.slice(0, 12)}…</span>
                              <CopyButton value={f.meta.sha256} label="SHA-256" />
                            </span>
                          ) : (
                            <span className="text-muted">–</span>
                          )}
                        </td>
                        <td className={`${TD} whitespace-nowrap`}>
                          {f.meta ? <Result ok={f.meta.ok} yes="สมบูรณ์" no="ไม่สมบูรณ์" /> : <span className="text-muted">ไม่มีไฟล์สถานะ</span>}
                        </td>
                        <td className={TD}><LastDownload file={f} /></td>
                        <td className={`${TD} text-right`}>
                          <a
                            href={`/api/admin/backup/download?name=${encodeURIComponent(f.name)}`}
                            download
                            onClick={() => setTimeout(refresh, 1500)}
                            aria-label={`ดาวน์โหลด ${f.name}`}
                            className={`${btn} h-8`}
                          >
                            ดาวน์โหลด
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
