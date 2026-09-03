import { EmailStatus } from "@/types";

const statusStyles: Record<EmailStatus, string> = {
  scheduled: "bg-amber-50 text-amber-700 border-amber-200",
  processing: "bg-blue-50 text-blue-700 border-blue-200",
  sent: "bg-emerald-50 text-emerald-700 border-emerald-200",
  failed: "bg-red-50 text-red-700 border-red-200",
  cancelled: "bg-slate-100 text-slate-500 border-slate-200",
};

export function StatusBadge({ status }: { status: EmailStatus }) {
  return (
    <span
      className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize ${statusStyles[status]}`}
    >
      {status}
    </span>
  );
}

export function EmptyState({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-slate-200 bg-white py-16 text-center">
      <div className="text-3xl">📭</div>
      <p className="mt-2 font-medium text-slate-700">{title}</p>
      <p className="text-sm text-slate-400">{subtitle}</p>
    </div>
  );
}

export function TableSkeleton({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-4 border-b border-slate-100 px-4 py-4 last:border-0">
          {Array.from({ length: cols }).map((__, c) => (
            <div key={c} className="h-4 flex-1 animate-pulse rounded bg-slate-100" />
          ))}
        </div>
      ))}
    </div>
  );
}
