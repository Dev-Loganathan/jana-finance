import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { createUserSchema, passwordSchema, phoneSchema } from "@jana/shared";
import { ApiError, api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import type { RoleRow, UserRow } from "./types";

// Form-level schema: same rules as the API (shared), but phone/password stay strings for editing.
const editSchema = z.object({
  firstName: z.string().trim().min(1, "Required"),
  lastName: z.string().trim(),
  phone: phoneSchema,
  roleId: z.string().uuid("Choose a role"),
});
type CreateValues = z.input<typeof createUserSchema>;
type EditValues = z.input<typeof editSchema>;

export function UserFormModal({
  open,
  onOpenChange,
  user,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  user?: UserRow;
}) {
  const editing = !!user;
  const qc = useQueryClient();
  const toast = useToast();
  const [formError, setFormError] = useState<string | null>(null);
  const { data: roles = [] } = useQuery({ queryKey: ["roles"], queryFn: () => api<RoleRow[]>("/roles") });
  // The Super Admin role is never assignable through the UI.
  const assignable = roles.filter((r) => !r.locked);

  const form = useForm<CreateValues & EditValues>({
    resolver: zodResolver(editing ? (editSchema as never) : (createUserSchema as never)),
    defaultValues: editing
      ? { firstName: user.firstName, lastName: user.lastName, phone: user.phone, roleId: user.role.id }
      : { firstName: "", lastName: "", email: "", phone: "", roleId: "", mode: "invite" },
  });
  const mode = form.watch("mode");
  const e = form.formState.errors;

  const save = useMutation({
    mutationFn: (v: CreateValues & EditValues) =>
      editing
        ? api<UserRow>(`/users/${user.id}`, {
            method: "PATCH",
            body: { firstName: v.firstName, lastName: v.lastName, phone: v.phone, roleId: v.roleId },
          })
        : api<UserRow>("/users", { method: "POST", body: v }),
    onSuccess: (u) => {
      void qc.invalidateQueries({ queryKey: ["users"] });
      void qc.invalidateQueries({ queryKey: ["roles"] });
      toast({ tone: "success", title: editing ? "User updated" : "User created", description: u.name });
      onOpenChange(false);
    },
    onError: (err) => setFormError(err instanceof ApiError ? err.message : "Something went wrong"),
  });

  return (
    <Modal open={open} onOpenChange={onOpenChange} title={editing ? "Edit User" : "Create User"}>
      <form
        noValidate
        className="space-y-4"
        onSubmit={form.handleSubmit((v) => {
          setFormError(null);
          save.mutate(v);
        })}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="First Name" htmlFor="fn" required error={e.firstName?.message}>
            <Input id="fn" {...form.register("firstName")} />
          </Field>
          <Field label="Last Name" htmlFor="ln">
            <Input id="ln" {...form.register("lastName")} />
          </Field>
        </div>
        {!editing && (
          <Field label="Email" htmlFor="em" required error={e.email?.message}>
            <Input id="em" type="email" autoComplete="off" {...form.register("email")} />
          </Field>
        )}
        <Field
          label="Mobile"
          htmlFor="ph"
          required
          error={e.phone?.message as string | undefined}
          hint="10-digit Indian mobile number"
        >
          <Input id="ph" inputMode="tel" {...form.register("phone")} />
        </Field>
        <Field label="Role" htmlFor="role" required error={e.roleId?.message}>
          <Select id="role" {...form.register("roleId")}>
            <option value="">Select a role</option>
            {assignable.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </Select>
        </Field>
        {!editing && (
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">How should they get access?</legend>
            <label className="flex min-h-touch items-center gap-2 text-sm">
              <input type="radio" value="invite" {...form.register("mode")} /> Send an invite link (recommended)
            </label>
            <label className="flex min-h-touch items-center gap-2 text-sm">
              <input type="radio" value="password" {...form.register("mode")} /> Set a temporary password now
            </label>
          </fieldset>
        )}
        {!editing && mode === "password" && (
          <Field
            label="Temporary password"
            htmlFor="pw"
            required
            error={e.password?.message}
            hint="Min 12 chars: uppercase, lowercase, number, special. They must change it on first login."
          >
            <Input id="pw" type="password" autoComplete="new-password" {...form.register("password")} />
          </Field>
        )}
        {formError && (
          <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
            {formError}
          </p>
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" loading={save.isPending}>
            {editing ? "Save changes" : "Create user"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// Keep the shared password rule referenced so form hints and API rules cannot drift silently.
void passwordSchema;
