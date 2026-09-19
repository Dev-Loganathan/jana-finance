import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
  type OnChangeFn,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { EmptyState, Skeleton } from "./skeleton";

declare module "@tanstack/react-table" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData, TValue> {
    /** Right-align (use for money and numbers). */
    align?: "right";
  }
}

/**
 * Server-driven table: sorting, paging and filtering happen on the API, so the
 * table only renders the current page and reports sort/page changes.
 */
export function DataTable<T>({
  columns,
  data,
  loading = false,
  sorting,
  onSortingChange,
  emptyTitle = "Nothing here yet",
  emptyDescription,
  onRowClick,
  page,
  pageSize,
  total,
  onPageChange,
}: {
  // TanStack column defs are heterogeneous by design (each column has its own value type).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  columns: ColumnDef<T, any>[];
  data: T[];
  loading?: boolean;
  sorting?: SortingState;
  onSortingChange?: OnChangeFn<SortingState>;
  emptyTitle?: string;
  emptyDescription?: string;
  onRowClick?: (row: T) => void;
  page?: number;
  pageSize?: number;
  total?: number;
  onPageChange?: (page: number) => void;
}) {
  const table = useReactTable({
    data,
    columns,
    state: { sorting: sorting ?? [] },
    onSortingChange,
    manualSorting: true,
    getCoreRowModel: getCoreRowModel(),
  });

  const paged = page !== undefined && pageSize !== undefined && total !== undefined && onPageChange;
  const lastPage = paged ? Math.max(1, Math.ceil(total / pageSize)) : 1;

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-fg-muted">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => {
                  const sortable = h.column.getCanSort() && !!onSortingChange;
                  const dir = h.column.getIsSorted();
                  return (
                    <th
                      key={h.id}
                      scope="col"
                      aria-sort={dir === "asc" ? "ascending" : dir === "desc" ? "descending" : undefined}
                      className={cn(
                        "px-4 py-3 font-medium",
                        h.column.columnDef.meta?.align === "right" && "text-right",
                      )}
                    >
                      {h.isPlaceholder ? null : sortable ? (
                        <button
                          type="button"
                          onClick={h.column.getToggleSortingHandler()}
                          className="inline-flex items-center gap-1 uppercase hover:text-fg"
                        >
                          {flexRender(h.column.columnDef.header, h.getContext())}
                          {dir === "asc" ? (
                            <ArrowUp className="h-3 w-3" aria-hidden />
                          ) : dir === "desc" ? (
                            <ArrowDown className="h-3 w-3" aria-hidden />
                          ) : (
                            <ArrowUpDown className="h-3 w-3 opacity-50" aria-hidden />
                          )}
                        </button>
                      ) : (
                        flexRender(h.column.columnDef.header, h.getContext())
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody className="divide-y divide-border">
            {loading
              ? Array.from({ length: 5 }).map((_, r) => (
                  <tr key={r}>
                    {columns.map((_, c) => (
                      <td key={c} className="px-4 py-3">
                        <Skeleton className="h-4 w-full" />
                      </td>
                    ))}
                  </tr>
                ))
              : table.getRowModel().rows.map((row) => (
                  <tr
                    key={row.id}
                    tabIndex={onRowClick ? 0 : undefined}
                    onClick={() => onRowClick?.(row.original)}
                    onKeyDown={(e) => e.key === "Enter" && onRowClick?.(row.original)}
                    className={cn(onRowClick && "cursor-pointer hover:bg-surface-muted")}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td
                        key={cell.id}
                        className={cn("px-4 py-3", cell.column.columnDef.meta?.align === "right" && "text-right")}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))}
          </tbody>
        </table>
      </div>
      {!loading && data.length === 0 && <EmptyState title={emptyTitle} description={emptyDescription} />}
      {paged && (
        <div className="flex items-center justify-between border-t border-border px-4 py-2 text-sm text-fg-muted">
          <span className="tabular">
            Page {page} of {lastPage} · {total} total
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              className="min-h-touch rounded-md px-3 hover:bg-surface-muted disabled:opacity-40"
              disabled={page <= 1}
              onClick={() => onPageChange(page - 1)}
            >
              Previous
            </button>
            <button
              type="button"
              className="min-h-touch rounded-md px-3 hover:bg-surface-muted disabled:opacity-40"
              disabled={page >= lastPage}
              onClick={() => onPageChange(page + 1)}
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
