import { parse } from "csv-parse/sync";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Accepts raw CSV/text content (one address per line, or a CSV with an
 * "email" column, or comma-separated addresses) and returns a deduplicated
 * list of valid email addresses.
 */
export function parseRecipients(raw: string): string[] {
  const found = new Set<string>();

  // Try structured CSV first (handles a header row like "email,name").
  try {
    const records: string[][] = parse(raw, {
      skip_empty_lines: true,
      relax_column_count: true,
    });
    for (const row of records) {
      for (const cell of row) {
        extractEmails(cell).forEach((e) => found.add(e));
      }
    }
  } catch {
    // fall through to plain-text extraction below
  }

  if (found.size === 0) {
    extractEmails(raw).forEach((e) => found.add(e));
  }

  return Array.from(found);
}

function extractEmails(text: string): string[] {
  return text
    .split(/[\s,;]+/)
    .map((t) => t.trim())
    .filter((t) => EMAIL_RE.test(t));
}
