import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/router";
import Header from "@/components/Header";
import Button from "@/components/Button";
import EmailTable from "@/components/EmailTable";
import ComposeModal from "@/components/ComposeModal";
import { fetchMe, fetchScheduled, fetchSent } from "@/lib/api";
import { EmailJob, MeResponse } from "@/types";

type Tab = "scheduled" | "sent";

export default function Dashboard() {
  const router = useRouter();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [authChecked, setAuthChecked] = useState(false);

  const [tab, setTab] = useState<Tab>("scheduled");
  const [scheduled, setScheduled] = useState<EmailJob[]>([]);
  const [sent, setSent] = useState<EmailJob[]>([]);
  const [loadingScheduled, setLoadingScheduled] = useState(true);
  const [loadingSent, setLoadingSent] = useState(true);
  const [composeOpen, setComposeOpen] = useState(false);

  useEffect(() => {
    fetchMe()
      .then(setMe)
      .catch(() => router.replace("/"))
      .finally(() => setAuthChecked(true));
  }, [router]);

  const loadScheduled = useCallback(() => {
    setLoadingScheduled(true);
    fetchScheduled()
      .then(setScheduled)
      .finally(() => setLoadingScheduled(false));
  }, []);

  const loadSent = useCallback(() => {
    setLoadingSent(true);
    fetchSent()
      .then(setSent)
      .finally(() => setLoadingSent(false));
  }, []);

  useEffect(() => {
    if (!authChecked || !me) return;
    loadScheduled();
    loadSent();

    // Lightweight polling so "Scheduled -> Sent" transitions show up without
    // a manual refresh, since sends happen asynchronously via BullMQ.
    const interval = setInterval(() => {
      loadScheduled();
      loadSent();
    }, 8000);
    return () => clearInterval(interval);
  }, [authChecked, me, loadScheduled, loadSent]);

  function refreshMe() {
    fetchMe().then(setMe).catch(() => {});
  }

  if (!authChecked || !me) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <Header
        user={me.user}
        slackConnected={me.slackConnected}
        slackTeamName={me.slack?.team_name}
        onSlackChange={refreshMe}
      />

      <main className="mx-auto max-w-5xl px-6 py-8">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">Dashboard</h1>
            <p className="text-sm text-slate-500">Track and schedule your outbound email sends.</p>
          </div>
          <Button onClick={() => setComposeOpen(true)}>+ Compose New Email</Button>
        </div>

        <div className="mb-4 inline-flex rounded-lg border border-slate-200 bg-white p-1">
          {(["scheduled", "sent"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-md px-4 py-1.5 text-sm font-medium capitalize transition-colors ${
                tab === t ? "bg-brand-600 text-white" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              {t === "scheduled" ? `Scheduled (${scheduled.length})` : `Sent (${sent.length})`}
            </button>
          ))}
        </div>

        {tab === "scheduled" ? (
          <EmailTable emails={scheduled} loading={loadingScheduled} mode="scheduled" />
        ) : (
          <EmailTable emails={sent} loading={loadingSent} mode="sent" />
        )}
      </main>

      <ComposeModal
        open={composeOpen}
        onClose={() => setComposeOpen(false)}
        onScheduled={() => {
          loadScheduled();
          loadSent();
        }}
      />
    </div>
  );
}
