'use client';

import { useState } from 'react';

/** A read-only value with a copy button. Selecting a long URL by hand invites typos. */
export function CopyField({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard access can be refused; the field stays selectable either way.
      setCopied(false);
    }
  }

  return (
    <div className="row" style={{ gap: 8, marginTop: 6, flexWrap: 'nowrap' }}>
      <input readOnly value={value} onFocus={(event) => event.currentTarget.select()} className="mono grow" />
      <button type="button" className="btn-secondary btn-sm" onClick={copy}>
        {copied ? 'Kopiert' : 'Kopieren'}
      </button>
    </div>
  );
}
