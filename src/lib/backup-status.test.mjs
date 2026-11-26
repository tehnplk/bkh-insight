// รัน: node --test src/lib/backup-status.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { backupAlert, parseBackupName } from "./backup-status.ts";

test("parseBackupName รับเฉพาะชื่อที่สคริปต์สร้าง", () => {
  assert.deepEqual(parseBackupName("bkh-insight-20261126-003001-nightly.dump.gpg"), { kind: "nightly", created_at: "2026-11-26T00:30:01+07:00" });
  assert.equal(parseBackupName("bkh-insight-20261126-003001-premigrate.dump.gpg")?.kind, "premigrate");
  for (const bad of [
    "../bkh-insight-20261126-003001-nightly.dump.gpg",
    "bkh-insight-20261126-003001-nightly.dump.gpg.json",
    "bkh-insight-20261126-003001-other.dump.gpg",
    ".bkh-insight-20261126-003001-nightly.dump.gpg.part",
    "bkh-insight-20261126-003001-nightly.dump.gpg/../../etc/passwd",
    "status.json",
  ]) assert.equal(parseBackupName(bad), null, bad);
});

const now = Date.parse("2026-11-26T12:00:00+07:00");
const file = (at, downloads = []) => ({
  name: "x",
  kind: "nightly",
  created_at: at,
  meta: { kind: "nightly", started_at: at, finished_at: at, size: 1, sha256: "a", ok: true, downloads: downloads.map((d) => ({ by: "a", at: d })) },
});
const ok = { kind: "nightly", started_at: "", finished_at: "", ok: true };

test("backupAlert", () => {
  assert.equal(backupAlert({ ...ok, ok: false, error: "x" }, [file("2026-11-26T00:30:00+07:00")], now)?.level, "danger");
  assert.equal(backupAlert(null, [], now)?.level, "danger");
  // ล่าสุดเกิน 26 ชม.
  assert.match(backupAlert(ok, [file("2026-11-25T09:00:00+07:00", ["2026-11-25T10:00:00+07:00"])], now).reason, /26/);
  // ไม่เคยดาวน์โหลด แต่ไฟล์เก่าสุดยังไม่ถึง 3 วัน = แจ้งปกติ
  assert.equal(backupAlert(ok, [file("2026-11-24T00:30:00+07:00"), file("2026-11-26T00:30:00+07:00")], now)?.level, "notice");
  // ไม่เคยดาวน์โหลด ไฟล์เก่าสุดเกิน 3 วัน
  assert.match(backupAlert(ok, [file("2026-11-22T00:30:00+07:00"), file("2026-11-26T00:30:00+07:00")], now).reason, /3 วัน/);
  // ดาวน์โหลดล่าสุดเกิน 3 วัน แม้ไฟล์ใหม่ยังไม่ดาวน์โหลด
  assert.equal(backupAlert(ok, [file("2026-11-22T00:30:00+07:00", ["2026-11-22T08:00:00+07:00"]), file("2026-11-26T00:30:00+07:00")], now)?.level, "danger");
  // ไฟล์ล่าสุดยังไม่ดาวน์โหลด
  assert.equal(backupAlert(ok, [file("2026-11-25T00:30:00+07:00", ["2026-11-25T08:00:00+07:00"]), file("2026-11-26T00:30:00+07:00")], now)?.level, "notice");
  // ดาวน์โหลดไฟล์ล่าสุดแล้ว
  assert.equal(backupAlert(ok, [file("2026-11-26T00:30:00+07:00", ["2026-11-26T08:00:00+07:00"])], now), null);
  // ไม่มี sidecar ใช้เวลาจากชื่อไฟล์
  assert.equal(backupAlert(null, [{ name: "x", kind: "manual", created_at: "2026-11-26T08:00:00+07:00", meta: null }], now)?.level, "notice");
});
