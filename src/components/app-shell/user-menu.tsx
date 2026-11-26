import { auth, signOut } from "@/auth";
import { loadBackups } from "@/lib/backup";
import { backupAlert } from "@/lib/backup-status";
import { ProfileMenu, type MenuAlerts } from "./profile-menu";

// จุดแจ้งเตือนของ admin อ่านจากไฟล์สถานะสำรองบน server ; ไม่มีโฟลเดอร์สำรอง (เครื่อง dev) = ไม่แจ้ง
async function adminAlerts(): Promise<MenuAlerts> {
  const b = await loadBackups();
  const alert = b.configured ? backupAlert(b.status, b.files, Date.now()) : null;
  return alert ? { "/admin/backup": alert } : {};
}

// Server component: reads the session cookie, so it must sit inside <Suspense> (cacheComponents).
export async function UserMenu() {
  const session = await auth();
  if (!session?.user?.name) return null;
  const admin = session.user.role === "admin";

  return (
    <ProfileMenu
      name={session.user.name}
      userKey={session.user.userId ?? `super:${session.user.name}`}
      admin={admin}
      alerts={admin ? await adminAlerts() : undefined}
      signOut={async () => {
        "use server";
        // logged_out=1 stops /login from starting SSO again while the IdP session is still alive.
        await signOut({ redirectTo: "/login?logged_out=1" });
      }}
    />
  );
}
