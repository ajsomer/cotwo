"use client";

import Link from "next/link";

// Password reset via email link is not wired up in this prototype's Neon Auth
// setup. Staff accounts are managed directly. This page remains so the route
// doesn't 404, but points the user back to login.
export default function ResetPasswordPage() {
  return (
    <div className="space-y-4 text-center">
      <h1 className="text-xl font-semibold text-gray-800 mb-2">
        Password reset unavailable
      </h1>
      <p className="text-sm text-gray-500">
        Password reset isn&apos;t available in this prototype. Contact an
        administrator to reset your account.
      </p>
      <Link href="/login" className="text-teal-500 hover:underline text-sm">
        Back to login
      </Link>
    </div>
  );
}
