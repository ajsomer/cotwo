export default function ClinicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Clinic sidebar/nav will go here */}
      <main>{children}</main>
    </div>
  );
}
