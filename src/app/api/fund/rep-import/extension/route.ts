import { auth } from "@/auth";
import { extensionZip } from "./zip";

/** GET: ดาวน์โหลด Chrome extension "e-Claim sync" เป็น zip ให้เครื่องเจ้าหน้าที่ Load unpacked (ปุ่มใน modal นำเข้าอัตโนมัติ) */
export async function GET() {
  if (!(await auth())) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { version, data } = await extensionZip();
  return new Response(data as BodyInit, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="bkh-eclaim-sync-${version}.zip"`,
      "Cache-Control": "no-store",
    },
  });
}
