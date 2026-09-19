import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm, type FieldValues, type Path, type UseFormReturn } from "react-hook-form";
import type { ZodTypeAny } from "zod";
import { STEP_SCHEMAS, type WizardStep } from "@jana/shared";
import { ApiError, api } from "@/lib/api";
import { useToast } from "@/components/ui/toast";
import type { CustomerDetail } from "../types";

/** Drops empty strings / undefined so optional fields are simply "not provided". */
export function clean<T>(v: T): T {
  if (Array.isArray(v)) return v.map(clean).filter((x) => x !== undefined) as T;
  if (v && typeof v === "object") {
    return Object.fromEntries(
      Object.entries(v)
        .map(([k, x]) => [k, clean(x)])
        .filter(([, x]) => x !== "" && x !== undefined),
    ) as T;
  }
  return v;
}

/** "12345.50" -> 1234550 paise. Returns undefined for blank or malformed input (the schema then reports it). */
export function parseRupees(v: string | undefined): number | undefined {
  const t = (v ?? "").trim().replace(/,/g, "");
  if (t === "") return undefined;
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return NaN;
  const [r, p = ""] = t.split(".");
  return Number(r) * 100 + Number(p.padEnd(2, "0"));
}
export const toRupeesText = (paise: number) =>
  paise === 0 ? "" : paise % 100 === 0 ? String(paise / 100) : (paise / 100).toFixed(2);

interface Options<V extends FieldValues> {
  customer: CustomerDetail;
  step: WizardStep;
  defaults: V;
  toBody: (values: V) => Record<string, unknown>;
  /** Override the completeness schema (e.g. an ID number already saved does not have to be typed again). */
  strict?: ZodTypeAny;
}

export function useStepForm<V extends FieldValues>({ customer, step, defaults, toBody, strict }: Options<V>) {
  const form: UseFormReturn<V> = useForm<V>({ defaultValues: defaults as never });
  const qc = useQueryClient();
  const toast = useToast();

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api<CustomerDetail>(`/customers/${customer.id}/steps/${step}`, { method: "PATCH", body }),
    onSuccess: (c) => {
      qc.setQueryData(["customer", customer.id], c);
      void qc.invalidateQueries({ queryKey: ["customers"] });
    },
  });

  function showServerErrors(e: unknown) {
    if (e instanceof ApiError && e.status === 400 && e.details && typeof e.details === "object") {
      const fields = (e.details as { fieldErrors?: Record<string, string[]> }).fieldErrors ?? {};
      for (const [k, msgs] of Object.entries(fields)) form.setError(k as Path<V>, { message: msgs[0] });
      toast({ tone: "danger", title: "Please fix the highlighted fields" });
    } else {
      toast({ tone: "danger", title: "Could not save", description: e instanceof ApiError ? e.message : undefined });
    }
  }

  /** Save whatever is filled in. Nothing has to be complete, but anything present must be valid. */
  async function saveDraft(): Promise<CustomerDetail | null> {
    form.clearErrors();
    try {
      const c = await save.mutateAsync(clean(toBody(form.getValues())));
      toast({ tone: "success", title: "Draft saved" });
      return c;
    } catch (e) {
      showServerErrors(e);
      return null;
    }
  }

  /** Validate the whole step, then save it. Returns the updated customer, or null if something is wrong. */
  async function validateAndSave(): Promise<CustomerDetail | null> {
    form.clearErrors();
    const body = clean(toBody(form.getValues()));
    const parsed = (strict ?? STEP_SCHEMAS[step]).safeParse(body);
    if (!parsed.success) {
      for (const issue of parsed.error.issues)
        form.setError((issue.path.join(".") || "root") as Path<V>, { message: issue.message });
      const firstBad = document.querySelector('[aria-invalid="true"], [role="alert"]');
      (firstBad as HTMLElement | null)?.scrollIntoView({ block: "center", behavior: "smooth" });
      return null;
    }
    try {
      return await save.mutateAsync(body);
    } catch (e) {
      showServerErrors(e);
      return null;
    }
  }

  return { form, saving: save.isPending, saveDraft, validateAndSave };
}

export function errorOf(form: UseFormReturn<never> | UseFormReturn<FieldValues>, name: string): string | undefined {
  const parts = name.split(".");
  let cur: unknown = form.formState.errors;
  for (const p of parts) cur = (cur as Record<string, unknown> | undefined)?.[p];
  return (cur as { message?: string } | undefined)?.message;
}
