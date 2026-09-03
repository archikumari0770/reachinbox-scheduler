import { EmailJob } from "@/types";
import { StatusBadge, EmptyState, TableSkeleton } from "./StatusUi";

interface EmailTableProps {
  emails: EmailJob[];
  loading: boolean;
  mode: "scheduled" | "sent";
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function EmailTable({ emails, loading, mode }: EmailTableProps) {
  if (loading) return <TableSkeleton rows={6} cols={4} />;

  if (emails.length === 0) {
    return mode === "scheduled" ? (
      <EmptyState
        title="No scheduled emails yet"
        subtitle="Click “Compose New Email” to schedule your first batch."
      />
    ) : (
      <EmptyState title="Nothing sent yet" subtitle="Sent (and failed) emails will show up here." />
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <table className="w-full text-left text-sm">
        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-4 py-3 font-medium">Email</th>
            <th className="px-4 py-3 font-medium">Subject</th>
            <th className="px-4 py-3 font-medium">{mode === "scheduled" ? "Scheduled time" : "Sent time"}</th>
            <th className="px-4 py-3 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {emails.map((e) => (
            <tr key={e.id} className="border-t border-slate-100 hover:bg-slate-50/60">
              <td className="max-w-[220px] truncate px-4 py-3 text-slate-700">{e.recipient_email}</td>
              <td className="max-w-[280px] truncate px-4 py-3 text-slate-600">{e.subject}</td>
              <td className="px-4 py-3 text-slate-500">
                {formatDate(mode === "scheduled" ? e.scheduled_at : e.sent_at ?? e.scheduled_at)}
              </td>
              <td className="px-4 py-3">
                <div className="flex items-center gap-2">
                  <StatusBadge status={e.status} />
                  {e.preview_url && (
                    <a
                      href={e.preview_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-brand-600 underline hover:text-brand-700"
                    >
                      preview
                    </a>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
