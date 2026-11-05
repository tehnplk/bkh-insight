import { Suspense } from "react";
import { auth } from "@/auth";
import { AppShell } from "@/components/app-shell/app-shell";
import { UserMenu } from "@/components/app-shell/user-menu";

// Every signed-in page lives in this group; /login sits outside it, so it renders without the shell.
export default function AppLayout({ children }: LayoutProps<"/">) {
  // Not awaited: the promise streams to the sidebar, which reads it inside its own Suspense (cacheComponents).
  const isAdmin = auth().then((s) => s?.user.role === "admin");
  return (
    <AppShell
      isAdmin={isAdmin}
      account={
        <Suspense fallback={null}>
          <UserMenu />
        </Suspense>
      }
    >
      {children}
    </AppShell>
  );
}
