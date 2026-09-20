import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import type { Paged } from "@jana/shared";
import { api } from "@/lib/api";
import { Input } from "@/components/ui/form";
import { KycBadge, WatchBadge } from "@/features/customers/badges";
import type { CustomerListItem } from "@/features/customers/types";

/** Search active customers by name, mobile, code or Aadhaar/PAN and pick one. Ineligible ones are shown but disabled. */
export function CustomerPicker({
  onPick,
  excludeIds = [],
  isBlocked = (c) => c.watchStatus === "BLACKLIST" || (c.kycStatus !== "COMPLETE" && c.kycStatus !== "VERIFIED"),
}: {
  onPick: (c: CustomerListItem) => void;
  excludeIds?: string[];
  /** Customers that are shown but cannot be picked. Chits need finished KYC; loans only refuse the blacklisted. */
  isBlocked?: (c: CustomerListItem) => boolean;
}) {
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setQ(text), 250);
    return () => clearTimeout(t);
  }, [text]);
  const res = useQuery({
    queryKey: ["chit-customer-search", q],
    queryFn: () => api<Paged<CustomerListItem>>("/customers", { query: { q, status: "ACTIVE", pageSize: 8 } }),
    enabled: q.length >= 2,
  });

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-muted"
          aria-hidden
        />
        <Input
          aria-label="Search customers to add"
          className="pl-9"
          placeholder="Search name, mobile or customer ID…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          autoFocus
        />
      </div>
      {q.length >= 2 && (
        <ul className="max-h-64 divide-y divide-border overflow-auto rounded-md border border-border">
          {res.data?.items.map((c) => {
            const blocked = isBlocked(c);
            return (
              <li key={c.id}>
                <button
                  type="button"
                  disabled={blocked}
                  onClick={() => onPick(c)}
                  className="flex min-h-touch w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span>
                    <span className="font-medium">{c.name}</span> <span className="text-fg-muted">({c.code})</span>
                    <span className="block text-xs text-fg-muted">{c.phone}</span>
                  </span>
                  <span className="flex flex-col items-end gap-1">
                    <KycBadge status={c.kycStatus} />
                    <WatchBadge status={c.watchStatus} />
                    {excludeIds.includes(c.id) && <span className="text-xs text-fg-muted">Already in this group</span>}
                  </span>
                </button>
              </li>
            );
          })}
          {res.data?.items.length === 0 && (
            <li className="px-3 py-4 text-center text-sm text-fg-muted">No active customers found.</li>
          )}
        </ul>
      )}
    </div>
  );
}
