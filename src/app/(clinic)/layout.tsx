import { createClient } from "@/lib/supabase/server";
import { ClinicProviders } from "@/components/clinic/providers";
import { fetchUserClinicAssignments } from "@/lib/auth/staff-access";
import { redirect } from "next/navigation";

export default async function ClinicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: userRecord } = await supabase
    .from("users")
    .select("full_name")
    .eq("id", user.id)
    .single();

  const fullName = userRecord?.full_name ?? user.user_metadata?.full_name ?? "Staff";

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
