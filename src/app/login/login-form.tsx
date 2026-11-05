"use client";

import Image from "next/image";
import { useSearchParams } from "next/navigation";
import { Suspense, useActionState, useId } from "react";
import { useFormStatus } from "react-dom";
import { Icon } from "@/components/app-shell/icons";
import { login, ssoLogin } from "./actions";

const field =
  "h-9 w-full rounded-md border border-line bg-surface px-3 text-base text-foreground shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring aria-invalid:border-danger";
const focus = "outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface";

function Alert({ id, children }: { id?: string; children: string }) {
  return (
    <p
      id={id}
      role="alert"
      className="flex items-start gap-2 rounded-md border border-danger-line bg-danger-soft px-3 py-2 text-sm text-danger"
    >
      <Icon name="alert" className="mt-px size-4 shrink-0" />
      {children}
    </p>
  );
}

// ?error= from Auth.js (pages.error = /login) or from the signIn callback ("pending").
function UrlError() {
  const error = useSearchParams().get("error");
  if (!error) return null;
  return <Alert>{error === "pending" ? "บัญชีรอการอนุมัติ" : "เข้าสู่ระบบไม่ได้ ลองใหม่อีกครั้ง"}</Alert>;
}

export function LoginForm({ sso }: { sso: boolean }) {
  const [state, action, pending] = useActionState(login, null);
  const errorId = useId();
  const invalid = state ? true : undefined;
  const describedBy = state ? errorId : undefined;

  return (
    <div className="space-y-4">
      {state ? (
        <Alert id={errorId}>{state.error}</Alert>
      ) : (
        <Suspense fallback={null}>
          <UrlError />
        </Suspense>
      )}

      {sso && (
        <>
          <form action={ssoLogin}>
            <Suspense fallback={null}>
              <CallbackUrl />
            </Suspense>
            <SsoButton />
          </form>
          <div className="flex items-center gap-3 text-sm text-muted">
            <span aria-hidden="true" className="h-px flex-1 bg-line" />
            หรือ
            <span aria-hidden="true" className="h-px flex-1 bg-line" />
          </div>
        </>
      )}

      <form action={action} className="space-y-4">
        <div className="space-y-1.5">
          <label htmlFor="username" className="block text-sm font-medium">
            ชื่อผู้ใช้
          </label>
          <input
            id="username"
            name="username"
            autoComplete="username"
            required
            autoFocus={!sso}
            defaultValue={state?.username}
            aria-invalid={invalid}
            aria-describedby={describedBy}
            className={field}
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="password" className="block text-sm font-medium">
            รหัสผ่าน
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            aria-invalid={invalid}
            aria-describedby={describedBy}
            className={field}
          />
        </div>

        {/* Reads the URL, so it suspends under cacheComponents; the rest of the form stays in the static shell. */}
        <Suspense fallback={null}>
          <CallbackUrl />
        </Suspense>

        <button
          type="submit"
          disabled={pending}
          className={`h-9 w-full rounded-md text-base font-semibold transition-colors disabled:cursor-wait disabled:opacity-70 ${focus} ${
            sso ? "border border-line bg-surface text-foreground hover:bg-hover" : "bg-accent text-accent-fg hover:bg-accent/90"
          }`}
        >
          {pending ? "กำลังเข้าสู่ระบบ…" : "เข้าสู่ระบบ"}
        </button>
      </form>
    </div>
  );
}

// The logo is drawn for a white background, so the button stays light in both themes: surface (white) in light,
// foreground (near-white) in dark. No token is light in both, and these two are the closest pair. The green
// border and taller size mark it as the primary action over the outline password button below.
function SsoButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      aria-label="เข้าสู่ระบบด้วย Provider ID"
      className={`grid h-14 w-full place-items-center rounded-md border border-accent-line bg-surface shadow-xs transition-colors hover:bg-accent-soft disabled:cursor-wait dark:border-transparent dark:bg-foreground dark:hover:bg-foreground/90 ${focus}`}
    >
      {/* Rendered at 111x44 CSS px; the 236x94 source covers 2x screens without upscaling. */}
      <Image src="/provider-id.png" alt="Provider ID" width={111} height={44} priority className={pending ? "animate-pulse" : undefined} />
    </button>
  );
}

function CallbackUrl() {
  return <input type="hidden" name="callbackUrl" value={useSearchParams().get("callbackUrl") ?? "/"} />;
}
