'use client';

/**
 * Client-side CSV export button.
 * Converts the provided rows to CSV and triggers a download.
 */

import { downloadCSV } from '@/lib/csv-export';

interface CsvExportButtonProps {
  rows: Record<string, unknown>[];
  filename: string;
  columns?: { key: string; label: string }[];
}

export function CsvExportButton({ rows, filename, columns }: CsvExportButtonProps) {
  return (
    <button
      type="button"
      onClick={() => downloadCSV(rows, filename, columns)}
      className="csv-export-btn"
      disabled={rows.length === 0}
    >
      Download CSV
    </button>
  );
}
