import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Check, MapPin, Phone, StickyNote } from "lucide-react";
import { ApiError, api } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { PermissionGate } from "@/components/ui/permission-gate";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { useToast } from "@/components/ui/toast";
import type { CustomerNote } from "./types";

const ICON = { NOTE: StickyNote, CALL: Phone, VISIT: MapPin } as const;
const today = () => new Date().toISOString().slice(0, 10);

/** Notes, call/visit outcomes and follow-up tasks ("promised to pay on the 25th"). */
export function NotesTab({ customerId }: { customerId: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [kind, setKind] = useState<"NOTE" | "CALL" | "VISIT">("NOTE");
  const [body, setBody] = useState("");
  const [outcome, setOutcome] = useState("");
  const [followUpOn, setFollowUpOn] = useState("");

  const notes = useQuery({
    queryKey: ["customer-notes", customerId],
    queryFn: () => api<CustomerNote[]>(`/customers/${customerId}/notes`),
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["customer-notes", customerId] });
    void qc.invalidateQueries({ queryKey: ["follow-ups"] });
    void qc.invalidateQueries({ queryKey: ["customer-activity", customerId] });
  };
  const add = useMutation({
    mutationFn: () =>
      api(`/customers/${customerId}/notes`, {
        method: "POST",
        body: { kind, body, outcome: outcome || undefined, followUpOn: followUpOn || undefined },
      }),
    onSuccess: () => (
      refresh(),
      setBody(""),
      setOutcome(""),
      setFollowUpOn(""),
      toast({ tone: "success", title: followUpOn ? "Follow-up scheduled" : "Note added" })
    ),
    onError: (e) =>
      toast({ tone: "danger", title: "Could not save", description: e instanceof ApiError ? e.message : undefined }),
  });
  const toggle = useMutation({
    mutationFn: (id: string) => api(`/customers/${customerId}/notes/${id}/complete`, { method: "POST" }),
    onSuccess: refresh,
  });

  return (
    <div className="space-y-4">
      <PermissionGate permission="customer:edit">
        <form
          className="space-y-3 rounded-lg border border-border bg-surface p-4"
          onSubmit={(e) => {
            e.preventDefault();
            add.mutate();
          }}
        >
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Type" htmlFor="kind">
              <Select id="kind" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
                <option value="NOTE">Note</option>
                <option value="CALL">Phone call</option>
                <option value="VISIT">Visit</option>
              </Select>
            </Field>
            <Field label="Outcome" htmlFor="outcome" hint="e.g. Promised to pay on 25th">
              <Input id="outcome" value={outcome} maxLength={200} onChange={(e) => setOutcome(e.target.value)} />
            </Field>
            <Field label="Follow up on" htmlFor="followUp">
              <Input
                id="followUp"
                type="date"
                min={today()}
                value={followUpOn}
                onChange={(e) => setFollowUpOn(e.target.value)}
              />
            </Field>
          </div>
          <Field label="Note" htmlFor="body" required>
            <Textarea id="body" rows={2} value={body} maxLength={1000} onChange={(e) => setBody(e.target.value)} />
          </Field>
          <Button type="submit" loading={add.isPending} disabled={!body.trim()}>
            {followUpOn ? "Save and schedule follow-up" : "Add note"}
          </Button>
        </form>
      </PermissionGate>

      {notes.isLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : (
        <ol className="divide-y divide-border rounded-lg border border-border bg-surface">
          {notes.data?.map((n) => {
            const Icon = ICON[n.kind];
            const overdue = n.followUpOn && !n.completedAt && n.followUpOn < today();
            return (
              <li key={n.id} className="flex gap-3 p-4">
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-fg-muted" aria-hidden />
                <div className="min-w-0 flex-1 space-y-1 text-sm">
                  <p className="whitespace-pre-wrap break-words">{n.body}</p>
                  {n.outcome && <p className="text-fg-muted">Outcome: {n.outcome}</p>}
                  <p className="text-xs text-fg-muted">
                    {n.authorName} · <span className="tabular">{formatDateTime(n.createdAt)}</span>
                  </p>
                </div>
                {n.followUpOn && (
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <StatusBadge tone={n.completedAt ? "success" : overdue ? "danger" : "warning"}>
                      <CalendarClock className="sr-only" aria-hidden />
                      {n.completedAt ? "Done" : overdue ? "Overdue" : "Due"} {n.followUpOn}
                    </StatusBadge>
                    <PermissionGate permission="customer:edit">
                      <button
                        type="button"
                        className="min-h-touch text-xs text-primary hover:underline md:min-h-0"
                        onClick={() => toggle.mutate(n.id)}
                        aria-label={n.completedAt ? "Reopen follow-up" : "Mark follow-up done"}
                      >
                        {n.completedAt ? (
                          "Reopen"
                        ) : (
                          <>
                            <Check className="mr-1 inline h-3 w-3" aria-hidden />
                            Mark done
                          </>
                        )}
                      </button>
                    </PermissionGate>
                  </div>
                )}
              </li>
            );
          })}
          {notes.data?.length === 0 && <li className="px-4 py-6 text-center text-sm text-fg-muted">No notes yet.</li>}
        </ol>
      )}
    </div>
  );
}
