import { createClient } from "@/lib/supabase/server";
import { ClinicProviders } from "@/components/clinic/providers";
import type { Location, Organisation, UserRole } from "@/lib/supabase/types";
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

  let assignments: Array<{
    location: Location;
    org: Organisation;
    role: UserRole;
    userId: string;
    fullName: string;
  }> = [];

  const { data } = await supabase
    .from("staff_assignments")
    .select(
      `
      role,
      locations!inner (
        id,
        org_id,
        name,
        address,
        timezone,
        qr_token,
        stripe_account_id,
        organisations!inner (
          id,
          name,
          slug,
          tier,
          logo_url,
          stripe_routing,
          timezone
        )
      )
    `
    )
    .eq("user_id", user.id);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  assignments = (data ?? []).map((sa: any) => {
    const loc = sa.locations as Record<string, unknown>;
    const org = loc.organisations as Record<string, unknown>;
    return {
      userId: user.id,
      fullName,
      role: sa.role as UserRole,
      location: {
        id: loc.id as string,
        org_id: loc.org_id as string,
        name: loc.name as string,
        address: loc.address as string | null,
        timezone: loc.timezone as string,
        qr_token: loc.qr_token as string,
        stripe_account_id: loc.stripe_account_id as string | null,
      },
      org: {
        id: org.id as string,
        name: org.name as string,
        slug: org.slug as string,
        tier: org.tier as Organisation["tier"],
        logo_url: org.logo_url as string | null,
        stripe_routing: org.stripe_routing as Organisation["stripe_routing"],
        timezone: org.timezone as string,
      },
    };
  });

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
