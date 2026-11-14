import { redirect } from "next/navigation";

// ย้ายไป /catalog/standard-codes (หมวด "เตรียมข้อมูลมาตรฐาน") คงไว้ให้ bookmark เดิมยังใช้ได้
export default function Page() {
  redirect("/catalog/standard-codes");
}
