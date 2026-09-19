import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Camera, Eye, FileText, Trash2, UploadCloud } from "lucide-react";
import type { KycDocType } from "@jana/shared";
import { ApiError, api, upload } from "@/lib/api";
import { useCan } from "@/auth/permissions";
import { StatusBadge } from "@/components/ui/status-badge";
import { useToast } from "@/components/ui/toast";
import { FileViewer } from "./FileViewer";
import { compressImage } from "./image";
import type { CustomerDetail, CustomerFileInfo } from "./types";

/**
 * One upload slot (e.g. "Aadhaar front"): uploads immediately, so KYC can be completed over several sessions.
 * A slot maps to a document type plus a label; PHOTO and SIGNATURE hold a single file (a new upload replaces it).
 */
export function DocSlot({
  customer,
  type,
  label,
  slot,
  accept = "image/*,application/pdf",
  capture,
}: {
  customer: CustomerDetail;
  type: KycDocType;
  label: string;
  slot: string;
  accept?: string;
  capture?: "user" | "environment";
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const can = useCan();
  const input = useRef<HTMLInputElement>(null);
  const [viewing, setViewing] = useState<CustomerFileInfo | null>(null);
  const doc = customer.documents?.find((d) => d.type === type);
  const file = doc?.files.find((f) => f.label === slot);
  const single = type === "PHOTO" || type === "SIGNATURE";
  const canUpload = can("kyc:upload");

  const set = (c: CustomerDetail) => qc.setQueryData(["customer", customer.id], c);
  const send = useMutation({
    mutationFn: async (f: File) => {
      const form = new FormData();
      form.append("label", slot);
      form.append("file", await compressImage(f));
      return upload<CustomerDetail>(`/customers/${customer.id}/documents/${type}/files`, form);
    },
    onSuccess: (c) => (set(c), void qc.invalidateQueries({ queryKey: ["customers"] })),
    onError: (e) =>
      toast({
        tone: "danger",
        title: `Could not upload ${label}`,
        description: e instanceof ApiError ? e.message : undefined,
      }),
  });
  const remove = useMutation({
    mutationFn: () =>
      api<CustomerDetail>(`/customers/${customer.id}/documents/files/${file!.id}`, { method: "DELETE" }),
    onSuccess: (c) => (set(c), void qc.invalidateQueries({ queryKey: ["customers"] })),
    onError: (e) =>
      toast({
        tone: "danger",
        title: "Could not remove file",
        description: e instanceof ApiError ? e.message : undefined,
      }),
  });

  return (
    <div className="rounded-md border border-border bg-surface p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{label}</span>
        {file && doc && <StatusBadge status={doc.status} />}
      </div>
      {file ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2 rounded-md bg-surface-muted px-2 py-1.5 text-sm">
            <FileText className="h-4 w-4 shrink-0 text-fg-muted" aria-hidden />
            <span className="truncate">{file.originalName}</span>
            <span className="ml-auto flex shrink-0 gap-1">
              {can("kyc:view") && (
                <button
                  type="button"
                  aria-label={`View ${label}`}
                  className="min-h-touch min-w-touch rounded p-1 hover:bg-neutral-soft md:min-h-0 md:min-w-0"
                  onClick={() => setViewing(file)}
                >
                  <Eye className="h-4 w-4" aria-hidden />
                </button>
              )}
              {canUpload && (
                <button
                  type="button"
                  aria-label={`Remove ${label}`}
                  disabled={remove.isPending}
                  className="min-h-touch min-w-touch rounded p-1 hover:bg-neutral-soft md:min-h-0 md:min-w-0"
                  onClick={() => remove.mutate()}
                >
                  <Trash2 className="h-4 w-4 text-danger" aria-hidden />
                </button>
              )}
            </span>
          </div>
          {doc?.status === "REJECTED" && doc.rejectionReason && (
            <p role="alert" className="text-xs text-danger">
              Rejected: {doc.rejectionReason}. Please upload again.
            </p>
          )}
          {single && canUpload && (
            <button
              type="button"
              className="min-h-touch text-xs text-primary hover:underline md:min-h-0"
              onClick={() => input.current?.click()}
            >
              Replace
            </button>
          )}
        </div>
      ) : (
        <button
          type="button"
          disabled={!canUpload || send.isPending}
          onClick={() => input.current?.click()}
          className="flex min-h-[72px] w-full flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed border-border-strong text-sm text-fg-muted hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-60"
        >
          {capture ? <Camera className="h-5 w-5" aria-hidden /> : <UploadCloud className="h-5 w-5" aria-hidden />}
          {send.isPending
            ? "Uploading…"
            : canUpload
              ? "Click to upload (JPG, PNG, PDF · max 5 MB)"
              : "You cannot upload documents"}
        </button>
      )}
      <input
        ref={input}
        type="file"
        aria-label={`Upload ${label}`}
        accept={accept}
        capture={capture}
        className="sr-only"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) send.mutate(f);
        }}
      />
      <FileViewer file={viewing} onClose={() => setViewing(null)} />
    </div>
  );
}
