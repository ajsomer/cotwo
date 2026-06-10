'use client';

import { EntryContext } from '@/lib/types/domain';
import { EntryFlow } from '@/components/patient/entry-flow';

interface EntryFlowClientProps {
  context: EntryContext;
  token: string;
}

export function EntryFlowClient({ context, token }: EntryFlowClientProps) {
  return <EntryFlow context={context} token={token} />;
}
