#!/usr/bin/env bash
# กู้คืนฐาน insight จากไฟล์สำรองของ scripts/backup-db.sh บน server ผ่าน SSH (ใช้ได้แม้แอปหรือฐานล่ม) ; คู่มือ: deploy/RESTORE.md
# Run: sudo bash /var/www/bkh-insight/scripts/restore-db.sh    ถามรหัสกู้คืน แล้วเลือกโหมด (ทดสอบกู้/กู้บางตาราง/กู้ทั้งฐาน) และไฟล์
#      bash scripts/restore-db.sh --set-password                พิมพ์บรรทัด RESTORE_PASSWORD_HASH=... ให้ admin ใส่ .env เอง
#      bash scripts/restore-db.sh --self-test                   ตรวจส่วนรหัสกู้คืน/ชื่อไฟล์/SHA-256 (ไม่แตะฐาน)
# ปลดล็อกด้วยรหัสกู้คืน (SHA-512 crypt ใน RESTORE_PASSWORD_HASH ของ .env) แยกจาก BACKUP_PASSWORD ที่สคริปต์อ่านเองเพื่อถอดไฟล์
# ทำงานกับฐานผ่าน sudo -u postgres (peer auth เครื่องเดียวกัน) INSIGHT_USER จึงไม่ต้องมี CREATEDB ; object ที่กู้เป็นของ INSIGHT_USER
# ทุกการรันต่อท้าย BACKUP_DIR/restore.log (ผู้ใช้ sudo, ผลปลดล็อก, โหมด, ไฟล์, ผล) ไม่มีรหัสผ่านใน log
set -euo pipefail
umask 077
export TZ=Asia/Bangkok

# shellcheck source=scripts/backup-lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/backup-lib.sh"
cd / # sudo -u postgres ต้อง cd เข้า cwd ได้
DIR=$BACKUP_DIR_RESOLVED
LOG=$DIR/restore.log
REQUIRED_TABLES="ar_ledger stm_row rep_row users" # ชุดเดียวกับ backup-verify.sh
SHOW_TABLES="$REQUIRED_TABLES ar_transfer claim_batch_item access_log"
UNITS="bkh-insight.service bkh-insight-ar-sync.timer bkh-insight-backup.timer bkh-insight-backup-verify.timer"
THAI_MON=(ม.ค. ก.พ. มี.ค. เม.ย. พ.ค. มิ.ย. ก.ค. ส.ค. ก.ย. ต.ค. พ.ย. ธ.ค.)
TS=$(date +%Y%m%d%H%M%S)
MODE="" FILE="" WORK="" DUMP="" DROP_DB="" STOPPED="" PORT="" LOGGING=""

say() { printf '%s\n' "$*" >&2; }
log() { [ -z "$LOGGING" ] || printf '%s run=%s user=%s %s\n' "$(date -Iseconds)" "$TS" "${SUDO_USER:-$(id -un)}" "$*" >>"$LOG" 2>/dev/null || true; }
die() {
  say "restore-db: $1"
  log "result=fail mode=${MODE:-none} file=${FILE##*/} reason=$1"
  exit 1
}
ask() {
  local a
  IFS= read -r -p "$1" a || a=""
  printf '%s' "$a"
}

valid_hash() {
  # shellcheck disable=SC2016 # $ ในรูปแบบ hash ไม่ใช่ตัวแปร
  local re='^\$6\$[./A-Za-z0-9]{1,16}\$[./A-Za-z0-9]{86}$'
  [[ $1 =~ $re ]]
}
# $1 = รหัส, $2 = hash แบบ openssl passwd -6 ; คำนวณซ้ำด้วย salt เดิม (รหัสเข้า openssl ทาง stdin ไม่อยู่ใน argv)
hash_matches() {
  local salt=${2#\$6\$}
  salt=${salt%%\$*}
  valid_hash "$2" && [ "$(openssl passwd -6 -salt "$salt" -stdin <<<"$1")" = "$2" ]
}
valid_ident() { [[ $1 =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; } # ชื่อฐาน/role ที่ใส่ใน SQL ได้ตรง (ครอบด้วย "")

# bkh-insight-20261126-003001-nightly.dump.gpg -> "26 พ.ย. 2569 00:30:01 nightly"
name_label() {
  local b=${1##*/}
  if [[ $b =~ ^bkh-insight-([0-9]{4})([0-9]{2})([0-9]{2})-([0-9]{2})([0-9]{2})([0-9]{2})-([a-z]+)\.dump\.gpg$ ]]; then
    local r=("${BASH_REMATCH[@]}")
    printf '%d %s %d %s:%s:%s %s' "$((10#${r[3]}))" "${THAI_MON[10#${r[2]} - 1]}" "$((r[1] + 543))" "${r[4]}" "${r[5]}" "${r[6]}" "${r[7]}"
  else
    printf '%s' "$b"
  fi
}
# 0 = SHA-256 ตรงกับ sidecar, 1 = ไม่ตรง, 2 = ไม่มี sidecar (ข้างไฟล์หรือใน BACKUP_DIR ชื่อเดียวกัน)
sha_check() {
  local exp="" j
  for j in "$1.json" "$DIR/${1##*/}.json"; do
    exp=$(grep -o '"sha256":"[0-9a-f]\{64\}"' "$j" 2>/dev/null | cut -d'"' -f4) || true
    [ -z "$exp" ] || break
  done
  [ -n "$exp" ] || return 2
  [ "$(sha256sum "$1" | cut -d' ' -f1)" = "$exp" ] || return 1
}

pg() { sudo -u postgres psql -XAtq -v ON_ERROR_STOP=1 -p "$PORT" "$@"; }
drop_dump() {
  if [ -n "$DUMP" ] && [ -e "$DUMP" ]; then shred -u -- "$DUMP" || rm -f -- "$DUMP"; fi
  DUMP=""
}
start_units() {
  local u=$STOPPED
  STOPPED=""
  [ -n "$u" ] || return 0
  # shellcheck disable=SC2086 # รายชื่อ unit คั่นด้วยช่องว่าง
  if systemctl start $u; then say "เปิดคืนแล้ว:$u"; else say "!! เปิดคืนไม่สำเร็จ ตรวจ: systemctl status$u"; fi
}
cleanup() {
  drop_dump
  [ -z "$WORK" ] || rm -rf -- "$WORK"
  if [ -n "$DROP_DB" ]; then
    if pg -d postgres -c "DROP DATABASE IF EXISTS \"$DROP_DB\"" >/dev/null 2>&1; then
      say "ลบฐานชั่วคราว $DROP_DB แล้ว"
    else
      say "!! ลบฐานชั่วคราว $DROP_DB ไม่สำเร็จ ลบเอง: sudo -u postgres dropdb -p $PORT $DROP_DB"
    fi
  fi
  start_units
}

set_password() {
  local a b
  [ -t 0 ] || { say "ต้องรันจาก terminal"; exit 1; }
  IFS= read -rsp "รหัสกู้คืนใหม่ (อย่างน้อย 12 ตัวอักษร): " a
  echo >&2
  [ ${#a} -ge 12 ] || { say "สั้นเกินไป"; exit 1; }
  IFS= read -rsp "พิมพ์ซ้ำ: " b
  echo >&2
  [ "$a" = "$b" ] || { say "สองครั้งไม่ตรงกัน"; exit 1; }
  say "ใส่บรรทัดนี้ใน $ENV_FILE (แทนบรรทัดเดิมถ้ามี) และเก็บรหัสกู้คืนไว้นอก server:"
  printf "RESTORE_PASSWORD_HASH='%s'\n" "$(openssl passwd -6 -stdin <<<"$a")"
}

self_test() {
  local h t rc
  h=$(openssl passwd -6 -stdin <<<"correct horse 12")
  valid_hash "$h" || die "self-test: รูปแบบ hash"
  hash_matches "correct horse 12" "$h" || die "self-test: รหัสถูกแต่ไม่ผ่าน"
  ! hash_matches "correct horse 13" "$h" || die "self-test: รหัสผิดแต่ผ่าน"
  ! hash_matches "correct horse 12" "" || die "self-test: hash ว่างแต่ผ่าน"
  # shellcheck disable=SC2016
  ! hash_matches "x" '$1$abc$def' || die "self-test: hash ชนิดอื่นแต่ผ่าน"
  [ "$(name_label /x/bkh-insight-20261126-003001-nightly.dump.gpg)" = "26 พ.ย. 2569 00:30:01 nightly" ] || die "self-test: name_label"
  [ "$(name_label /x/other.gpg)" = "other.gpg" ] || die "self-test: name_label ชื่ออื่น"
  if ! valid_ident bkh_insight || valid_ident 'x"; DROP' || valid_ident ''; then die "self-test: valid_ident"; fi
  t=$(mktemp -d)
  DIR=$t/none
  ENV_FILE=$t/.env # บรรทัดที่ --set-password พิมพ์ต้องอ่านกลับได้ครบ ($ ไม่หาย)
  printf "RESTORE_PASSWORD_HASH='%s'\n" "$h" >"$ENV_FILE"
  [ "$(env_file_get RESTORE_PASSWORD_HASH)" = "$h" ] || die "self-test: อ่าน hash จาก .env"
  printf 'data' >"$t/f.dump.gpg"
  rc=0
  sha_check "$t/f.dump.gpg" || rc=$?
  [ "$rc" = 2 ] || die "self-test: ไม่มี sidecar ต้องได้ 2 (ได้ $rc)"
  printf '{"sha256":"%s"}' "$(sha256sum "$t/f.dump.gpg" | cut -d' ' -f1)" >"$t/f.dump.gpg.json"
  sha_check "$t/f.dump.gpg" || die "self-test: sha ตรงแต่ไม่ผ่าน"
  printf 'x' >>"$t/f.dump.gpg"
  rc=0
  sha_check "$t/f.dump.gpg" || rc=$?
  [ "$rc" = 1 ] || die "self-test: sha ไม่ตรงต้องได้ 1 (ได้ $rc)"
  rm -rf -- "$t"
  say "self-test: ผ่าน"
}

count_rows() { pg -d "$1" -c "SELECT count(*) FROM public.$2" 2>/dev/null || printf '–'; } # $2 มาจากรายการคงที่
last_migration() { pg -d "$1" -c 'SELECT max(name) FROM schema_migrations' 2>/dev/null || printf '–'; }
show_counts() { # $1 = ฐานที่กู้, $2 = ฐานปัจจุบัน (ว่าง = เปิดไม่ได้)
  local t
  {
    printf 'ตาราง|ในไฟล์สำรอง|ฐานปัจจุบัน\n'
    for t in $SHOW_TABLES; do
      printf '%s|%s|%s\n' "$t" "$(count_rows "$1" "$t")" "$(if [ -n "$2" ]; then count_rows "$2" "$t"; else printf '–'; fi)"
    done
    printf 'migration ล่าสุด|%s|%s\n' "$(last_migration "$1")" "$(if [ -n "$2" ]; then last_migration "$2"; else printf '–'; fi)"
  } | column -t -s '|' >&2
}
# สร้างฐาน $1 ของ INSIGHT_USER แล้วกู้ (ทั้งหมดหรือไม่มีเลย) ; ที่เหลือ = option เพิ่มของ pg_restore เช่น -t ตาราง
restore_into() {
  local db=$1
  shift
  pg -d postgres -c "CREATE DATABASE \"$db\" OWNER \"$DBUSER\" TEMPLATE template0" >/dev/null 2>"$WORK/err" ||
    { say "$(tail -n 2 "$WORK/err")"; return 1; }
  DROP_DB=$db
  say "กำลังกู้ลงฐาน $db ..."
  # dump เป็นของ root mode 600: root เปิดไฟล์ (redirect) แล้วส่งเข้า stdin ให้ postgres ไม่ต้องอ่านไฟล์เอง
  # shellcheck disable=SC2024
  sudo -u postgres pg_restore -p "$PORT" --no-owner --no-acl --role="$DBUSER" --single-transaction -d "$db" "$@" <"$DUMP" 2>"$WORK/err" ||
    { say "$(tail -n 5 "$WORK/err")"; return 1; }
}
rename_db() { # ตัดการเชื่อมต่อแล้วลองซ้ำ เพราะ backend ที่ถูกตัดใช้เวลาออกครู่หนึ่ง
  local i
  for i in 1 2 3 4 5; do
    pg -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$1' AND pid <> pg_backend_pid()" >/dev/null 2>&1 || true
    pg -d postgres -c "ALTER DATABASE \"$1\" RENAME TO \"$2\"" >/dev/null 2>"$WORK/err" && return 0
    sleep "$i"
  done
  say "$(tail -n 2 "$WORK/err")"
  return 1
}
check_app() {
  local url code i
  url=$(conf AR_SYNC_URL)
  url=${url:-http://127.0.0.1:3000}
  url=${url%/}/login
  for i in $(seq 30); do
    code=$(curl -sk -o /dev/null -w '%{http_code}' --max-time 5 "$url") || code=000
    case $code in 200 | 307) say "แอปตอบ $url = $code"; return 0 ;; esac
    [ "$i" = 30 ] || sleep 2
  done
  say "!! แอปยังไม่ตอบ $url (ล่าสุด $code) ตรวจ: systemctl status bkh-insight ; journalctl -u bkh-insight -n 50"
  return 1
}

case ${1:-} in
  --set-password) set_password; exit 0 ;;
  --self-test) self_test; exit 0 ;;
  "") ;;
  *) say "usage: sudo bash $ROOT/scripts/restore-db.sh [--set-password | --self-test]"; exit 64 ;;
esac

[ "$(id -u)" = 0 ] || { say "ต้องรันเป็น root: sudo bash $ROOT/scripts/restore-db.sh"; exit 1; }
[ -t 0 ] || { say "ต้องรันจาก terminal (ถามรหัสและยืนยันทีละขั้น)"; exit 1; }
[ -d "$DIR" ] || { say "ไม่พบโฟลเดอร์สำรอง $DIR"; exit 1; }
LOGGING=1
trap cleanup EXIT
trap 'exit 130' INT TERM HUP
for c in gpg pg_restore psql openssl sha256sum shred flock systemctl curl column; do command -v "$c" >/dev/null || die "ไม่พบคำสั่ง $c"; done
exec 7>"$DIR/.restore.lock"
flock -n 7 || die "มีการกู้คืนอีกรอบรันอยู่"
log "start"

HASH=$(env_file_get RESTORE_PASSWORD_HASH) # จาก .env เท่านั้น
valid_hash "$HASH" || die "ยังไม่ได้ตั้ง RESTORE_PASSWORD_HASH ใน $ENV_FILE (ตั้งด้วย --set-password ดู deploy/RESTORE.md)"
ok=""
for i in 1 2 3; do
  IFS= read -rsp "รหัสกู้คืน: " pw || pw=""
  echo >&2
  if hash_matches "$pw" "$HASH"; then ok=1; break; fi
  log "unlock=fail try=$i"
  say "รหัสไม่ถูกต้อง"
done
unset pw
[ -n "$ok" ] || die "ใส่รหัสผิด 3 ครั้ง"
log "unlock=ok"

DB=$(conf INSIGHT_DATABASE) DBUSER=$(conf INSIGHT_USER) PORT=$(conf INSIGHT_PORT) HOST=$(conf INSIGHT_HOST)
PORT=${PORT:-5432}
[[ $PORT =~ ^[0-9]+$ ]] || die "INSIGHT_PORT ไม่ใช่ตัวเลข"
{ valid_ident "$DB" && valid_ident "$DBUSER"; } || die "INSIGHT_DATABASE/INSIGHT_USER ว่างหรือมีอักขระนอก A-Z a-z 0-9 _ ใช้วิธีทำมือใน deploy/RESTORE.md"
[ ${#DB} -le 41 ] || die "ชื่อฐานยาวเกิน 41 ตัวอักษร (ต่อท้าย _before_<เวลา> แล้วเกิน 63)"
case " localhost 127.0.0.1 ::1 $(hostname -I 2>/dev/null) " in
  *" ${HOST:-localhost} "*) ;;
  *) die "INSIGHT_HOST=$HOST ไม่ใช่เครื่องนี้ เครื่องมือนี้ใช้ได้เฉพาะ PostgreSQL บนเครื่องเดียวกัน ใช้วิธีทำมือใน deploy/RESTORE.md" ;;
esac
pg -d postgres -c "SELECT 1" >/dev/null || die "ต่อ PostgreSQL ด้วย sudo -u postgres ที่พอร์ต $PORT ไม่ได้ (service postgresql ทำงานอยู่ไหม)"
LIVE_EXISTS=$(pg -d postgres -c "SELECT 1 FROM pg_database WHERE datname = '$DB'")
LIVE=""
if [ "$LIVE_EXISTS" = 1 ] && pg -d "$DB" -c "SELECT 1" >/dev/null 2>&1; then LIVE=$DB; fi

say ""
say "เลือกโหมด (ฐาน $DB)"
say "  1) ทดสอบกู้: กู้ลงฐานชั่วคราว เทียบจำนวนแถวกับฐานปัจจุบัน แล้วลบ"
say "  2) กู้บางตาราง: กู้ตารางที่เลือกลงฐานชั่วคราว ให้คัดข้อมูลเอง"
say "  3) กู้ทั้งฐาน: ทับฐาน $DB ปัจจุบัน (ฐานเดิมเก็บไว้)"
case $(ask "โหมด: ") in 1) MODE="test" ;; 2) MODE=tables ;; 3) MODE=full ;; *) die "ยกเลิก (ไม่ได้เลือกโหมด)" ;; esac

shopt -s nullglob
files=("$DIR"/bkh-insight-*.dump.gpg) # ชื่อมีวันเวลา เรียงตามตัวอักษร = เก่าไปใหม่
n=${#files[@]}
say ""
say "ไฟล์สำรองใน $DIR (ใหม่สุดก่อน)"
for ((i = n - 1; i >= 0; i--)); do
  say "  $((n - i))) $(name_label "${files[i]}")  $(numfmt --to=iec --suffix=B "$(stat -c %s "${files[i]}")")"
done
[ "$n" -gt 0 ] || say "  (ไม่มี)"
ans=$(ask "เลือกหมายเลข หรือพิมพ์ path ของไฟล์ที่นำขึ้นมา: ")
if [[ $ans =~ ^[0-9]+$ ]] && [ "$ans" -ge 1 ] && [ "$ans" -le "$n" ]; then FILE=${files[n - ans]}; else FILE=$ans; fi
[ -n "$FILE" ] && [ -f "$FILE" ] || die "ไม่พบไฟล์ $FILE"
FILE=$(realpath -- "$FILE")
log "mode=$MODE file=${FILE##*/}"

rc=0
say "ตรวจ SHA-256 ..."
sha_check "$FILE" || rc=$?
case $rc in
  0) say "SHA-256 ตรงกับตอนสำรอง" ;;
  1) die "SHA-256 ไม่ตรงกับตอนสำรอง ไฟล์เสียหรือถูกแก้" ;;
  *)
    say "ไม่มี sidecar (.json) ของไฟล์นี้ ตรวจ SHA-256 ไม่ได้ เทียบกับค่าที่จดไว้ตอนดาวน์โหลดเอง:"
    say "  $(sha256sum "$FILE" | cut -d' ' -f1)"
    [ "$(ask "พิมพ์ ใช้ เพื่อใช้ไฟล์นี้ต่อ: ")" = "ใช้" ] || die "ยกเลิก (ไม่ได้ยืนยันไฟล์ที่ไม่มี sidecar)"
    log "sha256=unverified"
    ;;
esac

PASS=$(conf BACKUP_PASSWORD)
[ -n "$PASS" ] || die "ไม่ได้ตั้ง BACKUP_PASSWORD ใน .env"
WORK=$(mktemp -d "$DIR/.restore.XXXXXX")
DUMP=$WORK/db.dump
say "ถอดรหัส ..."
gpg --batch --no-symkey-cache --pinentry-mode loopback --passphrase-fd 3 -o "$DUMP" --decrypt "$FILE" 3<<<"$PASS" 2>"$WORK/err" ||
  die "ถอดรหัสไม่สำเร็จ (ไฟล์ที่สำรองก่อนเปลี่ยน BACKUP_PASSWORD ต้องใช้รหัสเดิม ถอดด้วยวิธีทำมือใน deploy/RESTORE.md)"
unset PASS
pg_restore --list "$DUMP" >"$WORK/list" 2>"$WORK/err" || die "อ่านไฟล์ dump ไม่ได้: $(tail -n 2 "$WORK/err" | tr '\n' ' ')"
for t in $REQUIRED_TABLES; do grep -q " TABLE DATA public $t " "$WORK/list" || die "ไม่พบข้อมูลตาราง $t ในไฟล์สำรอง"; done

NEW="${DB}_restore_$TS"
case $MODE in
  test)
    restore_into "$NEW" || die "กู้ลงฐานชั่วคราวไม่สำเร็จ"
    drop_dump
    show_counts "$NEW" "$LIVE"
    say "ทดสอบกู้ผ่าน (ไฟล์สำรองมักมีแถวน้อยกว่าฐานปัจจุบันตามเวลาที่ผ่านไป)"
    log "result=ok mode=test file=${FILE##*/}"
    ;;

  tables)
    tables=$(sed -n 's/.* TABLE DATA public \([^ ]*\) .*/\1/p' "$WORK/list" | sort)
    say "ตารางในไฟล์สำรอง:"
    printf '%s\n' "$tables" | column -c 100 >&2
    args=() picked=()
    read -r -a picked -p "ตารางที่จะกู้ (คั่นด้วยช่องว่าง): " || true
    for t in "${picked[@]}"; do
      grep -qxF -- "$t" <<<"$tables" || die "ไม่มีตาราง $t ในไฟล์สำรอง"
      args+=(-t "$t")
    done
    [ ${#args[@]} -gt 0 ] || die "ยกเลิก (ไม่ได้เลือกตาราง)"
    restore_into "$NEW" "${args[@]}" || die "กู้ลงฐานชั่วคราวไม่สำเร็จ"
    drop_dump
    log "restored db=$NEW tables=${args[*]}"
    say "กู้แล้วลงฐาน $NEW (เจ้าของ $DBUSER ต่อด้วยค่าเดียวกับแอปได้ เปลี่ยนแค่ชื่อฐาน)"
    say "คัดข้อมูลตาม deploy/RESTORE.md หัวข้อ \"กู้บางตาราง\" เปิด SSH อีกหน้าต่างไปทำก่อนได้ แล้วกลับมาตอบ"
    if [ "$(ask "พิมพ์ ลบ เพื่อลบฐาน $NEW ตอนนี้ (Enter = เก็บไว้): ")" = "ลบ" ]; then
      log "result=ok mode=tables db=$NEW dropped"
    else
      DROP_DB=""
      say "เก็บฐาน $NEW ไว้ ลบเมื่อเสร็จ: sudo -u postgres dropdb -p $PORT $NEW"
      log "result=ok mode=tables db=$NEW kept"
    fi
    ;;

  full)
    OLD="${DB}_before_$TS"
    [ "$(ask "กู้ทับฐานจริง พิมพ์ชื่อฐาน $DB เพื่อยืนยัน: ")" = "$DB" ] || die "ยกเลิก (ชื่อฐานไม่ตรง)"
    # กู้ลงฐานใหม่ก่อนหยุดแอป แอปจึงหยุดแค่ช่วงสำรองสภาพปัจจุบันและสลับชื่อ
    restore_into "$NEW" || die "กู้ลงฐานใหม่ไม่สำเร็จ ฐาน $DB ไม่เปลี่ยน"
    drop_dump
    for t in $REQUIRED_TABLES; do [ "$(count_rows "$NEW" "$t")" != – ] || die "ฐานที่กู้ไม่มีตาราง $t ฐาน $DB ไม่เปลี่ยน"; done
    show_counts "$NEW" "$LIVE"
    for u in $UNITS; do if systemctl is-active --quiet "$u"; then STOPPED+=" $u"; fi; done
    say "หยุดแอปและ timer ..."
    # shellcheck disable=SC2086 # รายชื่อ unit ; oneshot ที่อาจรันอยู่หยุดด้วย ไม่ต้องเปิดคืน timer เรียกเอง
    systemctl stop $UNITS bkh-insight-ar-sync.service bkh-insight-backup.service bkh-insight-backup-verify.service 2>/dev/null || true
    ! systemctl is-active --quiet bkh-insight.service || die "หยุด bkh-insight ไม่ได้ ไม่ได้กู้ทับ"
    log "stopped=$STOPPED"
    if [ -n "$LIVE" ]; then
      say "สำรองสภาพปัจจุบันก่อน ..."
      sudo -u "$(stat -c %U "$DIR")" bash "$ROOT/scripts/backup-db.sh" manual || die "สำรองสภาพปัจจุบันไม่สำเร็จ ไม่ได้กู้ทับ (ฐาน $DB ไม่เปลี่ยน)"
      log "prebackup=ok"
    else
      say "ฐาน $DB เปิดไม่ได้หรือไม่มี จึงสำรองสภาพปัจจุบันไม่ได้"
      [ "$(ask "พิมพ์ ข้าม เพื่อกู้ต่อโดยไม่สำรอง: ")" = "ข้าม" ] || die "ยกเลิก (ไม่ได้ยืนยันข้ามการสำรอง) ฐาน $DB ไม่เปลี่ยน"
      log "prebackup=skipped"
    fi
    trap '' INT # สลับชื่อสองขั้นต้องไม่ถูกตัดกลางทาง
    if [ "$LIVE_EXISTS" = 1 ]; then rename_db "$DB" "$OLD" || die "เปลี่ยนชื่อฐานเดิมไม่สำเร็จ ฐาน $DB ไม่เปลี่ยน"; fi
    if ! rename_db "$NEW" "$DB"; then
      u_list=$STOPPED
      if [ "$LIVE_EXISTS" != 1 ] || rename_db "$OLD" "$DB"; then die "ตั้งชื่อฐานใหม่ไม่สำเร็จ ฐาน $DB เดิมยังอยู่"; fi
      DROP_DB="" STOPPED=""
      die "!! ตั้งชื่อฐานใหม่และย้อนชื่อไม่สำเร็จ ฐานเดิมอยู่ที่ $OLD ฐานที่กู้อยู่ที่ $NEW แอปยังหยุดอยู่ แก้ชื่อเองก่อนเปิด: sudo systemctl start$u_list"
    fi
    DROP_DB=""
    trap 'exit 130' INT
    log "swapped old=$([ "$LIVE_EXISTS" = 1 ] && printf '%s' "$OLD" || printf none)"
    app=""
    [[ " $STOPPED " != *" bkh-insight.service "* ]] || app=1
    start_units
    appok=ok
    [ -z "$app" ] || check_app || appok=fail
    log "result=ok mode=full file=${FILE##*/} app=$appok"
    say ""
    say "กู้ทั้งฐานเสร็จ: $DB มาจาก ${FILE##*/}"
    say "ต่อไป: รัน npm run db:migrate ใน $ROOT ในฐานะผู้ใช้ของแอป (ไฟล์เก่ากว่า migration ล่าสุดจะรันส่วนที่ขาด)"
    if [ "$LIVE_EXISTS" = 1 ]; then
      say "ฐานเดิมเก็บไว้ที่ $OLD (ไม่ลบ)"
      say "ย้อนกลับ: sudo systemctl stop bkh-insight && sudo -u postgres psql -p $PORT -c 'ALTER DATABASE \"$DB\" RENAME TO \"${DB}_bad_$TS\"' -c 'ALTER DATABASE \"$OLD\" RENAME TO \"$DB\"' && sudo systemctl start bkh-insight"
      say "ลบฐานเดิมเมื่อแน่ใจ: sudo -u postgres dropdb -p $PORT $OLD"
    fi
    ;;
esac
