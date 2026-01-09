"use client";
import { useEffect, Suspense } from "react";
import phFetch from "../services/phFetch";
import { useSearchParams, useRouter } from "next/navigation";

function OAuthBridgeInner() {
  const params = useSearchParams();
  const router = useRouter();

  useEffect(() => {
    const token = params.get("token");
    const apiBase = process.env.NEXT_PUBLIC_API_BASE;
    if (!token || !apiBase) {
      router.replace("/");
      return;
    }
    (async () => {
      try {
        await phFetch(`${apiBase}/api/user/session/exchange`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token })
        });
      } catch {}
      router.replace("/");
    })();
  }, [params, router]);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-gray-600">Signing you in…</div>
    </div>
  );
}

export default function OAuthBridge() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-gray-600">Loading…</div>
      </div>
    }>
      <OAuthBridgeInner />
    </Suspense>
  );
}


