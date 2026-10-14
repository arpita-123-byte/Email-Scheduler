'use client';

import { useRef, useState } from 'react';
import { readLeadsFile } from '@/lib/leads';
import { plural } from '@/lib/format';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';

/**
 * Upload a CSV / TXT of leads. Every email address in the file is detected,
 * de-duplicated and counted before anything is sent to the server.
 */
export function LeadsUpload({ emails, onChange }: { emails: string[]; onChange: (emails: string[]) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [duplicates, setDuplicates] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    if (file.size > 5 * 1024 * 1024) {
      setError('That file is over 5 MB. Split it into smaller lists.');
      return;
    }
    const { emails: found, duplicates: dupes } = await readLeadsFile(file);
    setFileName(file.name);
    setDuplicates(dupes);
    if (found.length === 0) setError(`No email addresses found in ${file.name}.`);
    onChange(found);
  }

  function clear() {
    setFileName(null);
    setDuplicates(0);
    setError(null);
    onChange([]);
    if (input.current) input.current.value = '';
  }

  return (
    <div>
      <input
        ref={input}
        type="file"
        accept=".csv,.txt,text/csv,text/plain"
        className="sr-only"
        id="leads-file"
        onChange={(e) => void handleFile(e.target.files?.[0])}
      />

      {emails.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 px-2 py-1.5">
          {emails.slice(0, 3).map((e) => (
            <span key={e} className="rounded-full bg-surface-sunken px-2.5 py-1 text-xs text-ink">
              {e}
            </span>
          ))}
          {emails.length > 3 && (
            <span className="rounded-full bg-brand-tint px-2.5 py-1 text-xs font-medium text-brand-dark">
              +{(emails.length - 3).toLocaleString()} more
            </span>
          )}
          <span className="ml-auto flex items-center gap-1 text-xs text-ink-muted">
            <Icon name="file" size={14} />
            {fileName}
            <button type="button" onClick={clear} className="ml-1 rounded-full p-1 hover:bg-surface-sunken hover:text-ink" aria-label="Remove list">
              <Icon name="close" size={14} />
            </button>
          </span>
        </div>
      ) : (
        <label
          htmlFor="leads-file"
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            void handleFile(e.dataTransfer.files?.[0]);
          }}
          className={`flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-dashed px-3 py-2.5 text-sm transition-colors ${
            dragging ? 'border-brand bg-brand-tint' : 'border-line hover:border-brand/50'
          }`}
        >
          <span className="text-ink-muted">Drop a .csv or .txt of leads here</span>
          <Button type="button" variant="outline" size="sm" onClick={() => input.current?.click()}>
            <Icon name="upload" size={15} />
            Upload list
          </Button>
        </label>
      )}

      <p className="mt-1 px-2 text-xs" aria-live="polite">
        {error ? (
          <span className="text-danger">{error}</span>
        ) : emails.length > 0 ? (
          <span className="font-medium text-brand-dark">
            {plural(emails.length, 'email address', 'email addresses')} detected
            {duplicates > 0 && <span className="font-normal text-ink-muted"> ({plural(duplicates, 'duplicate')} removed)</span>}
          </span>
        ) : (
          <span className="text-ink-muted">Any column layout works: every email address in the file is picked up.</span>
        )}
      </p>
    </div>
  );
}
