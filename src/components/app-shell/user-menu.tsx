import { auth, signOut } from "@/auth";
import { ProfileMenu } from "./profile-menu";

// Server component: reads the session cookie, so it must sit inside <Suspense> (cacheComponents).
export async function UserMenu() {
  const session = await auth();
  if (!session?.user?.name) return null;

  return (
    <ProfileMenu
      name={session.user.name}
      signOut={async () => {
        "use server";
        await signOut({ redirectTo: "/login" });
      }}
    />
  );
}
