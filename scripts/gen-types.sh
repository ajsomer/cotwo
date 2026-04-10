#!/bin/bash
# Regenerate Supabase types and re-append the custom types re-export.
# Usage: ./scripts/gen-types.sh

set -e

PROJECT_REF=$(cat supabase/.temp/project-ref)

npx supabase gen types typescript --project-id "$PROJECT_REF" > src/lib/supabase/types.ts

# Append re-export of custom types (survives gen overwrites)
echo "" >> src/lib/supabase/types.ts
echo "// Re-export custom types so all consumers can import from '@/lib/supabase/types'" >> src/lib/supabase/types.ts
echo "// Custom types live in custom-types.ts to survive \`supabase gen types\` overwrites." >> src/lib/supabase/types.ts
echo "export * from './custom-types';" >> src/lib/supabase/types.ts

echo "Done. Types regenerated with custom-types re-export."
