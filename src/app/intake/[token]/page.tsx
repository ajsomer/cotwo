import { IntakeJourney } from '@/components/patient/intake-journey';
import { PersistentHeader } from '@/components/patient/persistent-header';
import { resolveJourney } from '@/lib/intake/resolve-journey';

export default async function IntakePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const context = await resolveJourney(token);

  if (!context) {
    return (
      <div className="flex flex-col items-center py-12 text-center">
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-50">
          <span className="text-lg text-red-500">!</span>
        </div>
        <h1 className="text-xl font-semibold text-gray-800">Link not found</h1>
        <p className="mt-2 text-sm text-gray-500">
          This link has expired or is no longer valid. Please contact your clinic
          for a new link.
        </p>
      </div>
    );
  }

  if (context.journey.status === 'completed') {
    return (
      <div className="flex flex-col items-center">
        <PersistentHeader
          clinicName={context.org.name}
          logoUrl={context.org.logo_url}
        />
        <div className="flex flex-col items-center py-8 text-center">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-teal-50">
            <svg
              className="h-6 w-6 text-teal-500"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4.5 12.75l6 6 9-13.5"
              />
            </svg>
          </div>
          <h1 className="text-xl font-semibold text-gray-800">All done</h1>
          <p className="mt-2 text-sm text-gray-500">
            You&apos;ve already completed this intake. We&apos;ll be in touch
            before your appointment.
          </p>
        </div>
      </div>
    );
  }

  return <IntakeJourney context={context} token={token} />;
}
