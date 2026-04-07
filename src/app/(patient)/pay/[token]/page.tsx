export default async function PayPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return (
    <div className="mx-auto w-full max-w-[420px] p-6">
      <h1 className="text-2xl font-semibold">Payment</h1>
      <p className="text-sm text-gray-500">Token: {token}</p>
    </div>
  );
}
