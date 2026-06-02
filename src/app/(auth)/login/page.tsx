"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { signInAction } from "../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const result = await signInAction({ email, password });

    if (!result.ok) {
      setLoading(false);
      setError(result.error);
      return;
    }

    // Middleware will redirect to correct destination based on setup state
    router.push("/runsheet");
    router.refresh();
  }

  async function handleForgotPassword() {
    // Password reset is not wired up in this prototype's Neon Auth setup.
    // Staff accounts are managed directly; surface a clear message rather
    // than a broken flow.
    setError("Password reset isn't available in this prototype — contact an admin.");
    setResetSent(false);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <h1 className="text-xl font-semibold text-gray-800 text-center mb-6">
        Log in to Coviu
      </h1>

      {error && <p className="text-sm text-red-500 text-center">{error}</p>}

      {resetSent && (
        <p className="text-sm text-green-600 text-center">
          Password reset email sent. Check your inbox.
        </p>
      )}

      <Input
        label="Email address"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        autoComplete="email"
        autoFocus
        disabled={loading}
      />

      <Input
        label="Password"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoComplete="current-password"
        disabled={loading}
      />

      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleForgotPassword}
          className="text-xs text-teal-500 hover:underline"
        >
          Forgot password?
        </button>
      </div>

      <Button
        type="submit"
        variant="primary"
        className="w-full"
        disabled={loading}
      >
        {loading ? "Logging in..." : "Log in"}
      </Button>

      <p className="text-sm text-center text-gray-500">
        Need an account?{" "}
        <Link href="/signup" className="text-teal-500 hover:underline">
          Sign up
        </Link>
      </p>
    </form>
  );
}
