import * as Dialog from "@radix-ui/react-dialog";
import { formatINR } from "@jana/shared";
import { Button } from "./button";

/**
 * Confirmation for irreversible actions. For money actions, pass `amountPaise`
 * and `customer` so the person sees exactly what they are confirming.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  amountPaise,
  customer,
  subjectLabel = "Customer",
  confirmLabel = "Confirm",
  destructive = false,
  loading = false,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  amountPaise?: number;
  customer?: string;
  /** Label for the `customer` row, e.g. "User". */
  subjectLabel?: string;
  confirmLabel?: string;
  destructive?: boolean;
  loading?: boolean;
  onConfirm: () => void;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg bg-surface p-6 shadow-xl">
          <Dialog.Title className="text-lg font-semibold">{title}</Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-fg-muted">
            {description ?? "This action cannot be undone."}
          </Dialog.Description>
          {(amountPaise !== undefined || customer) && (
            <dl className="mt-4 space-y-1 rounded-md bg-surface-muted p-3 text-sm">
              {customer && (
                <div className="flex justify-between gap-4">
                  <dt className="text-fg-muted">{subjectLabel}</dt>
                  <dd className="font-medium">{customer}</dd>
                </div>
              )}
              {amountPaise !== undefined && (
                <div className="flex justify-between gap-4">
                  <dt className="text-fg-muted">Amount</dt>
                  <dd className="tabular font-semibold">{formatINR(amountPaise)}</dd>
                </div>
              )}
            </dl>
          )}
          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Dialog.Close asChild>
              <Button variant="secondary">Cancel</Button>
            </Dialog.Close>
            <Button variant={destructive ? "danger" : "primary"} loading={loading} onClick={onConfirm}>
              {confirmLabel}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
