import { NextResponse } from "next/server";
import { getAuthenticatedUserId } from "@/lib/auth/staff-access";
import { getFactory, supportedProviders } from "@/lib/pms/registry";

/**
 * GET → connect metadata for every provider with a real adapter (label +
 * credential fields). Powers client-side provider pickers (setup grid,
 * Settings connect form), which can't import the server-only registry.
 */
export async function GET() {
  const userId = await getAuthenticatedUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const providers = supportedProviders().flatMap((provider) => {
    const factory = getFactory(provider);
    if (!factory) return [];
    return [
      {
        provider,
        label: factory.displayName,
        credentialFields: factory.staticMetadata().credentialFields,
      },
    ];
  });

  return NextResponse.json({ providers });
}
