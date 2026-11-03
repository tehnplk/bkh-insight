"use server";

import { AuthError } from "next-auth";
import { signIn } from "@/auth";

export type LoginState = { error: string; username: string } | null;

// Only same-site paths ("/x", not "//host" or "/\host"), so callbackUrl cannot become an open redirect.
const safePath = (v: FormDataEntryValue | null) => (typeof v === "string" && /^\/(?![/\\])/.test(v) ? v : "/");

export async function login(_prev: LoginState, form: FormData): Promise<LoginState> {
  const username = String(form.get("username") ?? "");
  try {
    await signIn("credentials", {
      username,
      password: form.get("password"),
      redirectTo: safePath(form.get("callbackUrl")),
    });
    return null;
  } catch (e) {
    if (!(e instanceof AuthError)) throw e; // success throws NEXT_REDIRECT, which must propagate
    const error = e.type === "CredentialsSignin" ? "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง" : "เข้าสู่ระบบไม่ได้ ลองใหม่อีกครั้ง";
    return { error, username };
  }
}
