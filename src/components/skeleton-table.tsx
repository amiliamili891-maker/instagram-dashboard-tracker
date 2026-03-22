/**
 * SkeletonTable — Reusable skeleton loading component for tables.
 * Renders animated placeholder rows that match a table layout.
 * Can be used as a drop-in replacement for "Loading..." states.
 */

export interface SkeletonTableProps {
  /** Number of columns to render */
  columns?: number;
  /** Number of placeholder rows */
  rows?: number;
  /** Whether to show a header row */
  showHeader?: boolean;
}

function SkeletonRow({ columns }: { columns: number }) {
  return (
    <tr className="skeleton-row">
      {Array.from({ length: columns }, (_, i) => (
        <td key={i}>
          <div className="skeleton-cell" />
        </td>
      ))}
    </tr>
  );
}

export function SkeletonTable({
  columns = 6,
  rows = 5,
  showHeader = true,
}: SkeletonTableProps) {
  return (
    <div className="skeleton-table-wrapper" role="status" aria-label="Loading table data">
      <table className="skeleton-table">
        {showHeader && (
          <thead>
            <tr>
              {Array.from({ length: columns }, (_, i) => (
                <th key={i}>
                  <div className="skeleton-cell skeleton-header-cell" />
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {Array.from({ length: rows }, (_, i) => (
            <SkeletonRow key={i} columns={columns} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
