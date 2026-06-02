import { auth } from "@/lib/auth/neon-auth";
import { db } from "@/lib/db";
import { users as usersT } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { ClinicProviders } from "@/components/clinic/shared/providers";
import { fetchUserClinicAssignments } from "@/lib/auth/staff-access";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function ClinicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { data: session } = await auth.getSession();
  const user = session?.user;

  if (!user) {
    redirect("/login");
  }

  const [userRecord] = await db
    .select({ full_name: usersT.fullName })
    .from(usersT)
    .where(eq(usersT.id, user.id))
    .limit(1);

  const fullName = userRecord?.full_name ?? user.name ?? "Staff";

  const assignments = await fetchUserClinicAssignments(user.id, fullName);

  if (assignments.length === 0) {
    redirect("/setup/clinic");
  }

  return (
    <ClinicProviders
      assignments={assignments}
      initialLocationId={assignments[0].location.id}
    >
      {children}
    </ClinicProviders>
  );
}
