import type { FieldValues, UseFormReturn } from "react-hook-form";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { errorOf } from "./useStepForm";

// Step forms are small string-valued forms; field names are checked by the step's defaults, so these
// helpers take a plain string name instead of a deep generic path.
// react-hook-form's UseFormReturn<T> is invariant in T, so a typed form cannot be passed to a generic helper.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyForm = UseFormReturn<any> | any;

interface Common {
  form: AnyForm;
  name: string;
  label: string;
  required?: boolean;
  hint?: string;
}

const err = (form: AnyForm, name: string) => errorOf(form as unknown as UseFormReturn<FieldValues>, name);

export function TextField({
  form,
  name,
  label,
  required,
  hint,
  ...rest
}: Common & Omit<React.InputHTMLAttributes<HTMLInputElement>, "name" | "form">) {
  const e = err(form, name);
  return (
    <Field label={label} htmlFor={name} required={required} error={e} hint={hint}>
      <Input id={name} aria-invalid={!!e} {...rest} {...form.register(name)} />
    </Field>
  );
}

export function SelectField({
  form,
  name,
  label,
  required,
  hint,
  options,
  placeholder,
}: Common & { options: readonly { value: string; label: string }[]; placeholder?: string }) {
  const e = err(form, name);
  return (
    <Field label={label} htmlFor={name} required={required} error={e} hint={hint}>
      <Select id={name} aria-invalid={!!e} {...form.register(name)}>
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
    </Field>
  );
}

export function TextAreaField({ form, name, label, required }: Common) {
  const e = err(form, name);
  return (
    <Field label={label} htmlFor={name} required={required} error={e}>
      <Textarea id={name} rows={3} aria-invalid={!!e} {...form.register(name)} />
    </Field>
  );
}

export const humanize = (s: string) =>
  s
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/^\w/, (c) => c.toUpperCase());
export const opts = (values: readonly string[]) => values.map((v) => ({ value: v, label: humanize(v) }));

/** Back / Save Draft / Next bar. Sticks to the bottom on phones with large touch targets. */
export function WizardFooter({
  onBack,
  onSaveDraft,
  backDisabled,
  nextLabel,
  busy,
}: {
  onBack: () => void;
  onSaveDraft: () => void;
  backDisabled: boolean;
  nextLabel: string;
  busy: boolean;
}) {
  return (
    <div className="sticky bottom-0 -mx-4 mt-6 flex items-center justify-between gap-2 border-t border-border bg-bg/95 px-4 py-3 backdrop-blur md:static md:mx-0 md:border-0 md:bg-transparent md:px-0">
      <Button type="button" variant="secondary" onClick={onBack} disabled={backDisabled || busy}>
        Back
      </Button>
      <div className="flex gap-2">
        <Button type="button" variant="ghost" onClick={onSaveDraft} disabled={busy}>
          <Save className="h-4 w-4" aria-hidden /> Save Draft
        </Button>
        <Button type="submit" loading={busy}>
          {nextLabel}
        </Button>
      </div>
    </div>
  );
}
