/** ชื่อ-สกุลในเซลล์ตาราง: บรรทัดสองเป็นเพศ/อายุ (sexAgeText จาก @/lib/sex-age) ไม่มีค่า = ซ่อน ; ไม่มีชื่อ = ขีดจาง */
export function PatientName({ name, sexAge }: { name: string | null | undefined; sexAge?: string | null }) {
  return (
    <span className="flex flex-col">
      {name || <span className="text-muted">–</span>}
      {sexAge && <span className="text-grid-sub text-subtle">{sexAge}</span>}
    </span>
  );
}
