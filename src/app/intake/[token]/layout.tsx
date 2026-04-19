export default function IntakeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen items-start justify-center bg-gray-50">
      <main className="w-full px-4 py-6">
        <div className="mx-auto w-full max-w-[420px]">{children}</div>
      </main>
    </div>
  );
}
