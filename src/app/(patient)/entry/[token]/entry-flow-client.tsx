'use client';

import { EntryContext } from '@/lib/supabase/types';
import { EntryFlow } from '@/components/patient/entry-flow';

interface EntryFlowClientProps {
  context: EntryContext;
  token: string;
}

export function EntryFlowClient({ context, token }: EntryFlowClientProps) {
  return <EntryFlow context={context} token={token} />;
}
