import { createClient } from "@/lib/supabase/server";
import { ClinicProviders } from "@/components/clinic/providers";
import type { Location, Organisation, UserRole } from "@/lib/supabase/types";

export default async function ClinicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();

  // Get current user
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let assignments: Array<{
    location: Location;
    org: Organisation;
    role: UserRole;
    userId: string;
  }> = [];

  if (user) {
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
  }

  // For prototype without auth: provide hardcoded seed data
  if (assignments.length === 0) {
    assignments = [
      {
        userId: "00000000-0000-0000-0000-000000001001",
        role: "receptionist",
        location: {
          id: "00000000-0000-0000-0000-000000000010",
          org_id: "00000000-0000-0000-0000-000000000001",
          name: "Bondi Junction Clinic",
          address: "123 Oxford St, Bondi Junction NSW 2022",
          timezone: "Australia/Sydney",
          qr_token: "qr-bondi-junction",
          stripe_account_id: "acct_test_bondi",
        },
        org: {
          id: "00000000-0000-0000-0000-000000000001",
          name: "Sunrise Allied Health",
          slug: "sunrise-allied",
          tier: "complete",
          logo_url: null,
          stripe_routing: "location",
          timezone: "Australia/Sydney",
        },
      },
    ];
  }

  return (
    <ClinicProviders assignments={assignments}>{children}</ClinicProviders>
  );
}
