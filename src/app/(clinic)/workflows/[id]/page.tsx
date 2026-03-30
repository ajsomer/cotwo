export default async function WorkflowDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold text-gray-800">Workflow Detail</h1>
      <p className="text-sm text-gray-500">ID: {id}</p>
    </div>
  );
}
