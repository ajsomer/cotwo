export default async function FormsPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold">Forms</h1>
      <p className="text-sm text-gray-500">Token: {token}</p>
    </div>
  );
}
