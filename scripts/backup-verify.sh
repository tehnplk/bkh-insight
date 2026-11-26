#!/usr/bin/env bash
# ทดสอบไฟล์สำรองล่าสุดใน BACKUP_DIR: ตรวจ SHA-256 กับ sidecar, ถอดรหัส, pg_restore --list ต้องมีข้อมูลตารางหลัก
# แล้วถ้า role ของ INSIGHT_USER มี CREATEDB (และมี psql) กู้ลงฐานชั่วคราว นับแถวเทียบฐานจริง แล้ว DROP (mode restore)
# ไม่มีสิทธิ์ = ตรวจโครง archive อย่างเดียว ไม่ได้กู้จริง (mode list) ; ผลเขียน BACKUP_DIR/verify.json (แสดงที่ /admin/backup)
# Run: bash scripts/backup-verify.sh (deploy/bkh-insight-backup-verify.timer) ; exit 0 = ผ่าน, 75 = มีรอบอื่นรันอยู่, อื่นๆ = ไม่ผ่าน
set -euo pipefail
umask 077
export TZ=Asia/Bangkok

# shellcheck source=scripts/backup-lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/backup-lib.sh"
DIR=$BACKUP_DIR_RESOLVED
MAIN_TABLES="ar_ledger stm_row rep_row users"
STARTED=$(date -Iseconds)
FILE="" MODE="" SHA_OK="" TABLES_JSON="" WORK="" TMPDB=""

write_verify() {
  local extra=""
  [ -z "$FILE" ] || extra+=",\"file\":$(json_str "$FILE")"
  [ -z "$MODE" ] || extra+=",\"mode\":\"$MODE\""
  [ -z "$SHA_OK" ] || extra+=",\"sha256_ok\":$SHA_OK"
  [ -z "$TABLES_JSON" ] || extra+=",\"tables\":{${TABLES_JSON#,}}"
  [ -z "${2:-}" ] || extra+=",\"error\":$(json_str "$2")"
  printf '{"started_at":"%s","finished_at":"%s","ok":%s%s}\n' "$STARTED" "$(date -Iseconds)" "$1" "$extra" >"$DIR/.verify.json.tmp" &&
    mv -f "$DIR/.verify.json.tmp" "$DIR/verify.json"
}
fail() {
  echo "backup-verify: $1" >&2
  write_verify false "$1" || true
  exit 1
}
cleanup() {
  [ -z "$TMPDB" ] || psql -XAtq -c "DROP DATABASE IF EXISTS $TMPDB" >/dev/null 2>&1 || echo "backup-verify: DROP DATABASE $TMPDB ไม่สำเร็จ ลบเอง" >&2
  [ -z "$WORK" ] || rm -rf -- "$WORK"
}
trap cleanup EXIT

[ -d "$DIR" ] && [ -w "$DIR" ] || { echo "backup-verify: ไม่พบหรือเขียนโฟลเดอร์ $DIR ไม่ได้" >&2; exit 1; }
command -v flock >/dev/null || { echo "backup-verify: ไม่พบคำสั่ง flock" >&2; exit 1; }
exec 8>"$DIR/.verify.lock"
flock -n 8 || { echo "backup-verify: กำลังทดสอบอยู่" >&2; exit 75; }

PASS=$(conf BACKUP_PASSWORD)
[ -n "$PASS" ] || fail "ไม่ได้ตั้ง BACKUP_PASSWORD ใน .env"
export_pg || fail "ไม่ได้ตั้ง$MISSING"
for c in gpg pg_restore sha256sum; do command -v "$c" >/dev/null || fail "ไม่พบคำสั่ง $c"; done

shopt -s nullglob
files=("$DIR"/bkh-insight-*.dump.gpg)
[ ${#files[@]} -gt 0 ] || fail "ไม่มีไฟล์สำรองให้ทดสอบ"
f=${files[-1]} # ชื่อมีวันเวลา เรียงตามตัวอักษร = ล่าสุดอยู่ท้าย
FILE=$(basename "$f")

expected=$(grep -o '"sha256":"[0-9a-f]*"' "$f.json" 2>/dev/null | cut -d'"' -f4) || true
[ -n "$expected" ] || fail "ไม่มี sha256 ใน sidecar ของไฟล์"
if [ "$(sha256sum "$f" | cut -d' ' -f1)" = "$expected" ]; then SHA_OK=true; else SHA_OK=false; fail "SHA-256 ไม่ตรงกับตอนสำรอง ไฟล์เสียหรือถูกแก้"; fi

WORK=$(mktemp -d "$DIR/.verify.XXXXXX")
gpg --batch --no-symkey-cache --pinentry-mode loopback --passphrase-fd 3 -o "$WORK/db.dump" --decrypt "$f" 3<<<"$PASS" 2>"$WORK/err" ||
  fail "ถอดรหัสไม่สำเร็จ (BACKUP_PASSWORD ไม่ตรงกับตอนสำรอง?): $(tail -n 2 "$WORK/err" | tr '\n' ' ')"
unset PASS
pg_restore --list "$WORK/db.dump" >"$WORK/list" 2>"$WORK/err" || fail "อ่านไฟล์ dump ไม่ได้: $(tail -n 2 "$WORK/err" | tr '\n' ' ')"
for t in $MAIN_TABLES; do
  grep -q " TABLE DATA public $t " "$WORK/list" || fail "ไม่พบข้อมูลตาราง $t ในไฟล์สำรอง"
done

can=""
if command -v psql >/dev/null; then can=$(psql -XAtq -c "SELECT rolcreatedb OR rolsuper FROM pg_roles WHERE rolname = current_user" 2>/dev/null) || can=""; fi
if [ "$can" != t ]; then
  MODE=list
  write_verify true
  echo "backup-verify: $FILE ผ่าน (ตรวจโครงไฟล์เท่านั้น ไม่ได้กู้จริง: role ไม่มี CREATEDB หรือไม่มี psql)"
  exit 0
fi

MODE=restore
TMPDB="bkh_insight_verify_$(date +%Y%m%d%H%M%S)" # ชื่อสร้างเองจากวันเวลา จึงใส่ใน SQL ตรงได้
psql -XAtq -v ON_ERROR_STOP=1 -c "CREATE DATABASE $TMPDB" >/dev/null 2>"$WORK/err" || { TMPDB=""; fail "สร้างฐานชั่วคราวไม่ได้: $(tail -n 1 "$WORK/err")"; }
pg_restore --no-owner --no-acl -d "$TMPDB" "$WORK/db.dump" 2>"$WORK/err" || fail "กู้คืนลงฐานชั่วคราวไม่สำเร็จ: $(tail -n 3 "$WORK/err" | tr '\n' ' ')"
for t in $MAIN_TABLES; do
  restored=$(PGDATABASE=$TMPDB psql -XAtq -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM public.$t") || fail "นับแถว $t ในฐานชั่วคราวไม่ได้"
  live=$(psql -XAtq -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM public.$t") || fail "นับแถว $t ในฐานจริงไม่ได้"
  TABLES_JSON+=",\"$t\":{\"restored\":$restored,\"live\":$live}"
done
write_verify true
echo "backup-verify: $FILE ผ่าน (กู้ลงฐานชั่วคราวแล้ว)"
