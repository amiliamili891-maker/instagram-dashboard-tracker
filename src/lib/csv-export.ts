/**
 * CSV export utility.
 *
 * Converts an array of row objects into a downloadable CSV file.
 * Handles null values, commas, quotes, and newlines in cell data.
 */

function escapeCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  // Wrap in quotes if the value contains a comma, quote, or newline
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function downloadCSV(
  rows: Record<string, unknown>[],
  filename: string,
  columns?: { key: string; label: string }[],
): void {
  if (rows.length === 0) return;

  // Determine columns: use provided list or derive from first row keys
  const cols = columns ?? Object.keys(rows[0]).map((key) => ({ key, label: key }));

  // Header row
  const header = cols.map((c) => escapeCell(c.label)).join(',');

  // Data rows
  const dataLines = rows.map((row) =>
    cols.map((c) => escapeCell(row[c.key])).join(','),
  );

  const csvContent = [header, ...dataLines].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
