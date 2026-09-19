import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Eye, EyeOff } from "lucide-react";
import type { REVEALABLE_FIELDS } from "@jana/shared";
import { ApiError, api } from "@/lib/api";
import { PermissionGate } from "@/components/ui/permission-gate";
import { useToast } from "@/components/ui/toast";

/**
 * Shows a masked value with a permissioned "Reveal". Each reveal is audited by the API, and the plaintext
 * disappears from the screen again after 15 seconds.
 */
export function Masked({
  customerId,
  field,
  masked,
}: {
  customerId: string;
  field: (typeof REVEALABLE_FIELDS)[number];
  masked: string;
}) {
  const toast = useToast();
  const [value, setValue] = useState<string | null>(null);
  const reveal = useMutation({
    mutationFn: () => api<{ value: string }>(`/customers/${customerId}/reveal`, { method: "POST", body: { field } }),
    onSuccess: (r) => setValue(r.value),
    onError: (e) =>
      toast({ tone: "danger", title: "Could not reveal", description: e instanceof ApiError ? e.message : undefined }),
  });
  useEffect(() => {
    if (value === null) return;
    const t = setTimeout(() => setValue(null), 15_000);
    return () => clearTimeout(t);
  }, [value]);

  return (
    <span className="inline-flex items-center gap-2">
      <code className="tabular text-sm">{value ?? masked}</code>
      <PermissionGate permission="kyc:reveal_sensitive">
        <button
          type="button"
          className="min-h-touch min-w-touch rounded p-1 text-fg-muted hover:bg-surface-muted md:min-h-0 md:min-w-0"
          aria-label={
            value
              ? `Hide ${field.toLowerCase().replace("_", " ")}`
              : `Reveal ${field.toLowerCase().replace("_", " ")} (audited)`
          }
          disabled={reveal.isPending}
          onClick={() => (value ? setValue(null) : reveal.mutate())}
        >
          {value ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
        </button>
      </PermissionGate>
    </span>
  );
}
