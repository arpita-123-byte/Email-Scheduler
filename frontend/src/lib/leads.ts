const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

export interface ParsedLeads {
  emails: string[];
  duplicates: number;
}

/**
 * Pull every email address out of a CSV or plain-text file.
 * Works with any column layout (header row, "name,email", one per line, etc.)
 * because it scans the raw text rather than assuming a column.
 */
export function parseLeads(text: string): ParsedLeads {
  const found = text.match(EMAIL_RE) ?? [];
  const seen = new Set<string>();
  const emails: string[] = [];
  for (const raw of found) {
    const e = raw.toLowerCase();
    if (seen.has(e)) continue;
    seen.add(e);
    emails.push(e);
  }
  return { emails, duplicates: found.length - emails.length };
}

export async function readLeadsFile(file: File): Promise<ParsedLeads> {
  const text = await file.text();
  return parseLeads(text);
}
