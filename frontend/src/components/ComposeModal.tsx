import { useMemo, useState } from "react";
import Papa from "papaparse";
import Modal from "./Modal";
import Button from "./Button";
import { Input, Textarea } from "./FormFields";
import { scheduleEmails } from "@/lib/api";

interface ComposeModalProps {
  open: boolean;
  onClose: () => void;
  onScheduled: () => void;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function defaultStartTime(): string {
  const d = new Date(Date.now() + 5 * 60 * 1000); // default: 5 minutes from now
  d.setSeconds(0, 0);
  const tzOffset = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tzOffset).toISOString().slice(0, 16);
}

function extractEmailsFromText(text: string): string[] {
  const found = new Set<string>();
  text
    .split(/[\s,;]+/)
    .map((t) => t.trim())
    .filter((t) => EMAIL_RE.test(t))
    .forEach((t) => found.add(t));
  return Array.from(found);
}

export default function ComposeModal({ open, onClose, onScheduled }: ComposeModalProps) {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [recipientsText, setRecipientsText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [fileRecipientCount, setFileRecipientCount] = useState<number | null>(null);
  const [startTime, setStartTime] = useState(defaultStartTime());
  const [delaySeconds, setDelaySeconds] = useState(2);
  const [hourlyLimit, setHourlyLimit] = useState(200);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const textRecipientCount = useMemo(() => extractEmailsFromText(recipientsText).length, [recipientsText]);
  const totalRecipients = (fileRecipientCount ?? 0) + (file ? 0 : textRecipientCount);

  function handleFileChange(f: File | null) {
    setFile(f);
    setFileRecipientCount(null);
    if (!f) return;
    Papa.parse(f, {
      complete: (results) => {
        const rows = results.data as string[][];
        const found = new Set<string>();
        rows.forEach((row) => row.forEach((cell) => extractEmailsFromText(String(cell)).forEach((e) => found.add(e))));
        setFileRecipientCount(found.size);
      },
      error: () => setFileRecipientCount(0),
    });
  }

  function reset() {
    setSubject("");
    setBody("");
    setRecipientsText("");
    setFile(null);
    setFileRecipientCount(null);
    setStartTime(defaultStartTime());
    setDelaySeconds(2);
    setHourlyLimit(200);
    setError(null);
  }

  async function handleSubmit() {
    setError(null);
    if (!subject.trim() || !body.trim()) {
      setError("Subject and body are required.");
      return;
    }
    if (totalRecipients === 0) {
      setError("Add at least one valid recipient (paste addresses or upload a CSV).");
      return;
    }

    setSubmitting(true);
    try {
      const formData = new FormData();
      formData.append("subject", subject);
      formData.append("body", body);
      formData.append("startTime", new Date(startTime).toISOString());
      formData.append("delayMs", String(delaySeconds * 1000));
      formData.append("hourlyLimit", String(hourlyLimit));
      if (file) {
        formData.append("file", file);
      } else {
        formData.append("recipients", recipientsText);
      }

      await scheduleEmails(formData);
      reset();
      onScheduled();
      onClose();
    } catch (err: any) {
      setError(err?.response?.data?.error || "Failed to schedule emails. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Compose New Email" widthClass="max-w-xl">
      <div className="space-y-4">
        <Input label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Q3 product update" />
        <Textarea
          label="Body"
          rows={5}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Write your email..."
        />

        <div>
          <span className="mb-1 block text-sm font-medium text-slate-700">Recipients</span>
          <div className="rounded-lg border border-dashed border-slate-300 p-3">
            <input
              type="file"
              accept=".csv,.txt"
              onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
              className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-brand-50 file:px-3 file:py-1.5 file:text-brand-700 hover:file:bg-brand-100"
            />
            <p className="mt-2 text-xs text-slate-400">Upload a CSV/TXT of leads, or paste addresses below.</p>
            <textarea
              className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
              rows={3}
              placeholder="jane@company.com, john@company.com ..."
              value={recipientsText}
              disabled={!!file}
              onChange={(e) => setRecipientsText(e.target.value)}
            />
          </div>
          <p className="mt-1 text-sm font-medium text-slate-600">
            {totalRecipients > 0 ? `${totalRecipients} email address(es) detected` : "No recipients detected yet"}
          </p>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <Input
            label="Start time"
            type="datetime-local"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
          />
          <Input
            label="Delay between emails"
            type="number"
            min={0}
            value={delaySeconds}
            onChange={(e) => setDelaySeconds(Number(e.target.value))}
            hint="seconds"
          />
          <Input
            label="Hourly limit"
            type="number"
            min={1}
            value={hourlyLimit}
            onChange={(e) => setHourlyLimit(Number(e.target.value))}
            hint="per sender"
          />
        </div>

        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} loading={submitting}>
            Schedule
          </Button>
        </div>
      </div>
    </Modal>
  );
}
