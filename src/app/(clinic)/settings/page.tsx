import Link from "next/link";

const settingsCards = [
  {
    title: "Team",
    description: "Manage staff members, roles, and location assignments.",
    href: "/settings/team",
  },
  {
    title: "Rooms",
    description: "Configure rooms, room types, and sort order.",
    href: "/settings/rooms",
  },
  {
    title: "Appointment Types",
    description: "Define appointment types, modality, duration, and fees.",
    href: "/settings/appointment-types",
  },
  {
    title: "Payment Config",
    description: "Stripe Connect setup and routing configuration.",
    href: "/settings/payments",
  },
];

export default function SettingsPage() {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold text-gray-800">Settings</h1>
      <p className="text-sm text-gray-500 mt-1">
        Organisation and location configuration.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-6">
        {settingsCards.map((card) => (
          <Link
            key={card.href}
            href={card.href}
            className="block rounded-xl border border-gray-200 bg-white p-5 hover:shadow-sm transition-shadow"
          >
            <h2 className="text-base font-semibold text-gray-800">
              {card.title}
            </h2>
            <p className="text-sm text-gray-500 mt-1">{card.description}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
