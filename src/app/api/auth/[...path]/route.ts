import { auth } from "@/lib/auth/neon-auth";

// Neon Auth API proxy. Handles sign-in/up, session, OAuth callbacks, etc.
// All client auth calls route through here.
export const { GET, POST } = auth.handler();
