#!/usr/bin/env bash
# สำรองฐาน insight (PostgreSQL) แบบเข้ารหัส: pg_dump -Fc | gpg AES256 -> BACKUP_DIR/bkh-insight-YYYYMMDD-HHMMSS-<ชนิด>.dump.gpg
# Run: bash scripts/backup-db.sh nightly|manual|premigrate
#   nightly = deploy/bkh-insight-backup.timer, manual = ปุ่ม "สำรองตอนนี้" ที่ /admin/backup, premigrate = scripts/migrate.mjs
# อ่าน INSIGHT_*, BACKUP_PASSWORD, BACKUP_DIR (ค่าเริ่มต้น /var/backups/bkh-insight) จาก environment ก่อน แล้วจาก .env ของ repo
# เขียน sidecar <ไฟล์>.json และ status.json (รอบล่าสุด รวมรอบที่ล้มเหลว) ใน BACKUP_DIR ไม่ใช่ในฐาน เพื่อดูได้แม้ฐานล่ม
# ลบไฟล์สำรองเก่ากว่า 5 วันหลังสำรองสำเร็จ ; exit 0 = สำเร็จ, 75 = มีรอบอื่นรันอยู่, อื่นๆ = ล้มเหลว ; วิธีกู้คืน: deploy/RESTORE.md
set -euo pipefail
umask 077
export TZ=Asia/Bangkok

KIND=${1:-}
case $KIND in nightly | manual | premigrate) ;; *) echo "usage: backup-db.sh nightly|manual|premigrate" >&2; exit 64 ;; esac

# shellcheck source=scripts/backup-lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/backup-lib.sh"
DIR=$BACKUP_DIR_RESOLVED
RETENTION_MIN=$((5 * 24 * 60))
STARTED=$(date -Iseconds)
STATUS_WRITABLE=0

# status.json ของรอบนี้ ; $1 = ok true/false, $2 = ชื่อไฟล์ (ว่างได้), $3 = error (ว่างได้)
write_status() {
  [ "$STATUS_WRITABLE" = 1 ] || return 0
  local extra=""
  [ -z "$2" ] || extra+=",\"file\":$(json_str "$2")"
  [ -z "$3" ] || extra+=",\"error\":$(json_str "$3")"
  printf '{"kind":"%s","started_at":"%s","finished_at":"%s","ok":%s%s}\n' "$KIND" "$STARTED" "$(date -Iseconds)" "$1" "$extra" >"$DIR/.status.json.tmp" &&
    mv -f "$DIR/.status.json.tmp" "$DIR/status.json"
}
fail() {
  echo "backup-db: $1" >&2
  write_status false "" "$1" || true
  exit 1
}

mkdir -p "$DIR" 2>/dev/null || { echo "backup-db: สร้างโฟลเดอร์ $DIR ไม่ได้" >&2; exit 1; }
chmod 700 "$DIR" 2>/dev/null || true
[ -w "$DIR" ] || { echo "backup-db: เขียนโฟลเดอร์ $DIR ไม่ได้" >&2; exit 1; }
command -v flock >/dev/null || { echo "backup-db: ไม่พบคำสั่ง flock" >&2; exit 1; }
exec 9>"$DIR/.lock"
flock -n 9 || { echo "backup-db: กำลังสำรองข้อมูลอยู่ รอให้รอบเดิมเสร็จก่อน" >&2; exit 75; }
STATUS_WRITABLE=1
rm -f "$DIR"/.*.part "$DIR"/.*.err

PASS=$(conf BACKUP_PASSWORD)
[ -n "$PASS" ] || fail "ไม่ได้ตั้ง BACKUP_PASSWORD ใน .env จึงไม่สำรอง (ไม่สำรองแบบไม่เข้ารหัส)"
export_pg || fail "ไม่ได้ตั้ง$MISSING"
for c in pg_dump gpg sha256sum; do command -v "$c" >/dev/null || fail "ไม่พบคำสั่ง $c"; done

NAME="bkh-insight-$(date +%Y%m%d-%H%M%S)-$KIND.dump.gpg"
TMP="$DIR/.$NAME.part"
ERR="$DIR/.$NAME.err"
# รหัสผ่านเข้า gpg ทาง fd 3 (here-string) ไม่อยู่ใน argv/ps ; -Fc บีบอัดแล้ว gpg จึงไม่บีบซ้ำ
if ! pg_dump -Fc 2>"$ERR" |
  gpg --batch --yes --no-symkey-cache --symmetric --cipher-algo AES256 --compress-algo none \
    --pinentry-mode loopback --passphrase-fd 3 -o "$TMP" 3<<<"$PASS" 2>>"$ERR"; then
  msg=$(tail -n 3 "$ERR" | tr '\n' ' ')
  rm -f "$TMP" "$ERR"
  fail "pg_dump/gpg ล้มเหลว: $msg"
fi
rm -f "$ERR"
unset PASS PGPASSWORD

SIZE=$(stat -c %s "$TMP")
SHA=$(sha256sum "$TMP" | cut -d' ' -f1)
# sidecar ก่อน rename: ไฟล์สำรองที่มองเห็นได้มีไฟล์สถานะเสมอ
printf '{"kind":"%s","started_at":"%s","finished_at":"%s","size":%s,"sha256":"%s","ok":true,"downloads":[]}\n' \
  "$KIND" "$STARTED" "$(date -Iseconds)" "$SIZE" "$SHA" >"$DIR/$NAME.json"
mv -f "$TMP" "$DIR/$NAME"
write_status true "$NAME" ""

# เก็บ 5 วัน (ทุกชนิด) ลบไฟล์พร้อม sidecar ; อิง mtime ของไฟล์สำรอง เพราะ sidecar ถูกเขียนใหม่เมื่อมีคนดาวน์โหลด
find "$DIR" -maxdepth 1 -type f -name 'bkh-insight-*.dump.gpg' -mmin +"$RETENTION_MIN" -print0 |
  while IFS= read -r -d '' f; do rm -f -- "$f" "$f.json"; done
for j in "$DIR"/bkh-insight-*.dump.gpg.json; do
  if [ -e "$j" ] && [ ! -e "${j%.json}" ]; then rm -f -- "$j"; fi
done

echo "backup-db: $NAME ($SIZE bytes)"
