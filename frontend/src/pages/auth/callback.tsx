import { useEffect } from "react";
import { useRouter } from "next/router";
import { setToken } from "@/lib/api";

export default function AuthCallback() {
  const router = useRouter();

  useEffect(() => {
    if (!router.isReady) return;
    const token = router.query.token;
    if (typeof token === "string" && token.length > 0) {
      setToken(token);
      router.replace("/dashboard");
    } else {
      router.replace("/?error=missing_token");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.isReady]);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
    </div>
  );
}
