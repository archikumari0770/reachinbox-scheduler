import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import Button from "@/components/Button";
import { googleLoginUrl, fetchMe } from "@/lib/api";

export default function Home() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    // If already signed in, skip straight to the dashboard.
    fetchMe()
      .then(() => router.replace("/dashboard"))
      .catch(() => setChecking(false));
  }, [router]);

  const error = router.query.error as string | undefined;

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-brand-50 to-white px-4">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-brand-600 text-lg font-bold text-white">
          RI
        </div>
        <h1 className="text-xl font-semibold text-slate-900">ReachInbox Mini</h1>
        <p className="mt-1 text-sm text-slate-500">Schedule and track your email sends, reliably.</p>

        {error && (
          <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
            Sign-in failed ({error}). Please try again.
          </p>
        )}

        <Button
          className="mt-6 w-full"
          onClick={() => (window.location.href = googleLoginUrl())}
        >
          Continue with Google
        </Button>

        <p className="mt-4 text-xs text-slate-400">
          Real Google OAuth — you&apos;ll be redirected to Google and back to your dashboard.
        </p>
      </div>
    </div>
  );
}
