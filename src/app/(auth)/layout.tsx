export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-4 py-8">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/images/images.png" alt="Coviu" className="h-6 mb-8" />
      <div className="w-full max-w-[440px] bg-white border border-gray-200 rounded-2xl p-8">
        {children}
      </div>
    </div>
  );
}
