import { useMemo, useState } from 'react';
import { ArrowUpDown } from 'lucide-react';
import { TableSkeleton, EmptyState, ErrorState } from './States.jsx';

/**
 * Columns: [{ key, header, render?, className?, hideOnMobile?, sort?: (row) => value }]
 * Columns with `sort` get a clickable header (sorts the rows on this page).
 * Stacks into cards below `sm` so clinic tables stay usable on a phone.
 */
export function DataTable({ columns, rows, loading, error, onRetry, empty, onRowClick, rowKey = (r) => r._id }) {
  const [sort, setSort] = useState(null);
  const sorted = useMemo(() => {
    if (!sort || !rows) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sort) return rows;
    return [...rows].sort((a, b) => {
      const x = col.sort(a); const y = col.sort(b);
      return (x > y ? 1 : x < y ? -1 : 0) * sort.dir;
    });
  }, [rows, sort, columns]);

  if (loading) return <div className="card"><TableSkeleton cols={Math.min(columns.length, 6)} /></div>;
  if (error) return <div className="card"><ErrorState error={error} onRetry={onRetry} /></div>;
  if (!rows?.length) return <div className="card">{empty || <EmptyState title="Nothing here yet" />}</div>;

  const toggle = (key) => setSort((s) => (s?.key === key ? { key, dir: -s.dir } : { key, dir: 1 }));

  return (
    <div className="card overflow-hidden">
      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-line bg-paper-sunk/60">
            <tr>
              {columns.map((c) => (
                <th key={c.key} scope="col" className={`whitespace-nowrap px-4 py-3 text-xs font-semibold uppercase tracking-wide text-ink-muted ${c.className || ''}`}
                    aria-sort={sort?.key === c.key ? (sort.dir > 0 ? 'ascending' : 'descending') : undefined}>
                  {c.sort ? (
                    <button className="inline-flex items-center gap-1 hover:text-ink" onClick={() => toggle(c.key)}>
                      {c.header}<ArrowUpDown className="h-3 w-3" />
                    </button>
                  ) : c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {sorted.map((row) => (
              <tr key={rowKey(row)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  onKeyDown={onRowClick ? (e) => e.key === 'Enter' && onRowClick(row) : undefined}
                  tabIndex={onRowClick ? 0 : undefined}
                  className={`transition-colors duration-150 ${onRowClick ? 'cursor-pointer hover:bg-paper-sunk/50 focus:bg-paper-sunk/50' : ''}`}>
                {columns.map((c) => (
                  <td key={c.key} className={`px-4 py-3 align-middle ${c.className || ''}`}>
                    {c.render ? c.render(row) : row[c.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="divide-y divide-line sm:hidden">
        {sorted.map((row) => (
          <li key={rowKey(row)} onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={`space-y-1.5 px-4 py-3 ${onRowClick ? 'cursor-pointer hover:bg-paper-sunk/50' : ''}`}>
            {columns.filter((c) => !c.hideOnMobile).map((c) => (
              <div key={c.key} className="flex items-baseline justify-between gap-4">
                <span className="shrink-0 text-xs text-ink-muted">{c.header}</span>
                <span className="min-w-0 text-right text-sm">{c.render ? c.render(row) : row[c.key]}</span>
              </div>
            ))}
          </li>
        ))}
      </ul>
    </div>
  );
}
