# shellcheck shell=bash
# ใช้ร่วมกันโดย scripts/backup-db.sh และ scripts/backup-verify.sh (source ไม่ได้รันตรง)
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
ENV_FILE="$ROOT/.env"

# ค่า KEY จาก .env โดยไม่ source/eval: บรรทัดสุดท้ายที่ตรง ตัดเครื่องหมายคำพูดครอบหนึ่งคู่ ค่าไม่มีคำพูดตัด " # comment" ท้าย
# shortcut: ไม่รองรับ escape ในค่า (\" หรือ \n) ถ้ารหัสผ่านมีอักขระเหล่านี้ให้เปลี่ยนรหัสผ่าน
env_file_get() {
  local v
  v=$(grep -E "^[[:space:]]*(export[[:space:]]+)?$1[[:space:]]*=" "$ENV_FILE" 2>/dev/null | tail -n 1) || true
  v=${v#*=}
  v=${v%$'\r'}
  v=${v#"${v%%[![:space:]]*}"}
  case $v in
    \"*) v=${v#\"}; v=${v%\"*} ;;
    \'*) v=${v#\'}; v=${v%\'*} ;;
    *) v=${v%%[[:space:]]#*}; v=${v%"${v##*[![:space:]]}"} ;;
  esac
  printf '%s' "$v"
}
# environment ก่อน (เช่น Next/migrate โหลด .env ให้แล้ว) แล้วค่อย .env
conf() { if [ -n "${!1:-}" ]; then printf '%s' "${!1}"; else env_file_get "$1"; fi; }

json_str() { printf '"%s"' "$(printf '%s' "$1" | tr -s '[:cntrl:]' ' ' | sed 's/\\/\\\\/g; s/"/\\"/g')"; }

# ค่าเชื่อมต่อผ่าน env ของ libpq (รหัสผ่านไม่อยู่ใน argv) ; คืน 1 เมื่อขาดตัวใด (ชื่อตัวแปรใน MISSING)
export_pg() {
  local k
  MISSING=""
  for k in INSIGHT_HOST INSIGHT_PORT INSIGHT_USER INSIGHT_PASSWORD INSIGHT_DATABASE; do
    [ -n "$(conf "$k")" ] || MISSING+=" $k"
  done
  [ -z "$MISSING" ] || return 1
  PGHOST=$(conf INSIGHT_HOST) PGPORT=$(conf INSIGHT_PORT) PGUSER=$(conf INSIGHT_USER) PGDATABASE=$(conf INSIGHT_DATABASE)
  PGPASSWORD=$(conf INSIGHT_PASSWORD)
  export PGHOST PGPORT PGUSER PGDATABASE PGPASSWORD
}

BACKUP_DIR_RESOLVED=$(conf BACKUP_DIR)
BACKUP_DIR_RESOLVED=${BACKUP_DIR_RESOLVED:-/var/backups/bkh-insight}
