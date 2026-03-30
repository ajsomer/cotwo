export default function PatientLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen items-start justify-center bg-gray-50">
      <main className="w-full max-w-[420px] px-4 py-6">{children}</main>
    </div>
  );
}
