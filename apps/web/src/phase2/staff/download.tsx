import { useEffect, useState } from 'react';
export function CsvDownload({
  csv,
  filename,
  label,
}: {
  csv: string;
  filename: string;
  label: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const value = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    setUrl(value);
    return () => URL.revokeObjectURL(value);
  }, [csv]);
  return url ? (
    <a href={url} download={filename.replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 100)}>
      {label}
    </a>
  ) : (
    <span>Preparing download…</span>
  );
}
