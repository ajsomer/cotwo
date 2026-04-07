import { FormBuilderWrapper } from "@/components/clinic/form-builder-wrapper";

export default async function FormDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <FormBuilderWrapper formId={id} />;
}
