import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Flag, Tag } from "lucide-react";
import { ApiError, api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import { PermissionGate } from "@/components/ui/permission-gate";
import { StatusBadge } from "@/components/ui/status-badge";
import { useToast } from "@/components/ui/toast";
import type { CustomerDetail } from "./types";

/** Tag chips + editors, and the watchlist/blacklist control. */
export function ProfileFlags({ c }: { c: CustomerDetail }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [dialog, setDialog] = useState<"tags" | "watch" | null>(null);
  const [tags, setTags] = useState(c.tags.join(", "));
  const [status, setStatus] = useState<CustomerDetail["watch"]["status"]>(c.watch.status);
  const [reason, setReason] = useState(c.watch.reason ?? "");

  const done = (u: CustomerDetail, msg: string) => {
    qc.setQueryData(["customer", c.id], u);
    void qc.invalidateQueries({ queryKey: ["customers"] });
    void qc.invalidateQueries({ queryKey: ["customer-activity", c.id] });
    setDialog(null);
    toast({ tone: "success", title: msg });
  };
  const fail = (e: unknown) =>
    toast({ tone: "danger", title: "Could not save", description: e instanceof ApiError ? e.message : undefined });

  const saveTags = useMutation({
    mutationFn: () =>
      api<CustomerDetail>(`/customers/${c.id}/tags`, {
        method: "PATCH",
        body: {
          tags: tags
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
        },
      }),
    onSuccess: (u) => done(u, "Tags updated"),
    onError: fail,
  });
  const saveWatch = useMutation({
    mutationFn: () =>
      api<CustomerDetail>(`/customers/${c.id}/watch`, {
        method: "POST",
        body: { status, reason: status === "NONE" ? undefined : reason },
      }),
    onSuccess: (u) => done(u, status === "NONE" ? "Flag removed" : "Customer flagged"),
    onError: fail,
  });

  return (
    <>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {c.tags.map((t) => (
          <span key={t} className="rounded-full bg-surface-muted px-2 py-0.5 text-xs">
            {t}
          </span>
        ))}
        <PermissionGate permission="customer:edit">
          <button
            type="button"
            onClick={() => (setTags(c.tags.join(", ")), setDialog("tags"))}
            className="inline-flex min-h-touch items-center gap-1 text-xs text-primary hover:underline md:min-h-0"
          >
            <Tag className="h-3 w-3" aria-hidden /> {c.tags.length ? "Edit tags" : "Add tags"}
          </button>
        </PermissionGate>
        <PermissionGate permission="customer:blacklist">
          <button
            type="button"
            onClick={() => (setStatus(c.watch.status), setReason(c.watch.reason ?? ""), setDialog("watch"))}
            className="inline-flex min-h-touch items-center gap-1 text-xs text-primary hover:underline md:min-h-0"
          >
            <Flag className="h-3 w-3" aria-hidden /> Watchlist / blacklist
          </button>
        </PermissionGate>
      </div>

      <Modal open={dialog === "tags"} onOpenChange={(o) => !o && setDialog(null)} title="Edit tags">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            saveTags.mutate();
          }}
        >
          <Field label="Tags" htmlFor="tags" hint="Separate with commas. Up to 10, e.g. VIP, referred by Suresh">
            <Input id="tags" value={tags} onChange={(e) => setTags(e.target.value)} />
          </Field>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="secondary" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button type="submit" loading={saveTags.isPending}>
              Save tags
            </Button>
          </div>
        </form>
      </Modal>

      <Modal open={dialog === "watch"} onOpenChange={(o) => !o && setDialog(null)} title="Watchlist / blacklist">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            saveWatch.mutate();
          }}
        >
          <p className="text-sm text-fg-muted">
            A blacklisted customer is blocked from new loans and chits. Every change is recorded with your name and
            reason.
          </p>
          <Field label="Status" htmlFor="ws">
            <Select id="ws" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
              <option value="NONE">None</option>
              <option value="WATCHLIST">Watchlist (extra care)</option>
              <option value="BLACKLIST">Blacklist (block new business)</option>
            </Select>
          </Field>
          {status !== "NONE" && (
            <Field label="Reason" htmlFor="wr" required>
              <Textarea
                id="wr"
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                required
                minLength={5}
                maxLength={300}
              />
            </Field>
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="secondary" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button type="submit" variant={status === "BLACKLIST" ? "danger" : "primary"} loading={saveWatch.isPending}>
              Save
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

export function WatchBanner({ c }: { c: CustomerDetail }) {
  if (c.watch.status === "NONE") return null;
  const black = c.watch.status === "BLACKLIST";
  return (
    <div
      role="alert"
      className={`rounded-lg border p-4 text-sm ${black ? "border-danger/40 bg-danger-soft" : "border-warning/40 bg-warning-soft"}`}
    >
      <StatusBadge tone={black ? "danger" : "warning"}>{black ? "Blacklisted" : "On watchlist"}</StatusBadge>
      <span className="ml-2">{c.watch.reason}</span>
    </div>
  );
}
