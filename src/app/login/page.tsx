import type { Metadata } from "next";
import { plkhealthEnabled } from "@/auth";
import { Icon } from "@/components/app-shell/icons";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "เข้าสู่ระบบ" };

// Outside the (app) group, so it renders without AppShell.
export default function LoginPage() {
  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-5 flex items-center justify-center gap-2.5">
          <span className="grid size-8 place-items-center rounded-lg bg-accent text-accent-fg">
            <Icon name="pulse" className="size-5" />
          </span>
          <span className="text-base font-semibold tracking-tight">BKH Insight</span>
        </div>
        <div className="rounded-xl border border-line bg-surface p-6 max-sm:p-5">
          <h1 className="mb-5 text-title">เข้าสู่ระบบ</h1>
          <LoginForm sso={plkhealthEnabled} />
        </div>
      </div>
    </main>
  );
}
