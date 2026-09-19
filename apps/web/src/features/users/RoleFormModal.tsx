import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, api } from "@/lib/api";
import { useUser } from "@/auth/auth-context";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import type { PermissionCatalog, RoleRow } from "./types";

const title = (s: string) => s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

/** Create or edit a role. The Super Admin role opens read-only. Permissions you do not hold cannot be granted. */
export function RoleFormModal({
  open,
  onOpenChange,
  role,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  role?: RoleRow;
}) {
  const editing = !!role;
  const readOnly = !!role?.locked;
  const me = useUser();
  const qc = useQueryClient();
  const toast = useToast();
  const { data: catalog } = useQuery({
    queryKey: ["permissions"],
    queryFn: () => api<PermissionCatalog>("/permissions"),
  });
  const [name, setName] = useState(role?.name ?? "");
  const [description, setDescription] = useState(role?.description ?? "");
  const [dataScope, setDataScope] = useState<RoleRow["dataScope"]>(role?.dataScope ?? "ALL");
  const [selected, setSelected] = useState<Set<string>>(new Set(role?.permissions ?? []));
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => {
      const body = { name, description, dataScope, permissions: [...selected] };
      return editing ? api(`/roles/${role.id}`, { method: "PATCH", body }) : api("/roles", { method: "POST", body });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["roles"] });
      toast({ tone: "success", title: editing ? "Role updated" : "Role created", description: name });
      onOpenChange(false);
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Something went wrong"),
  });

  const grantable = (p: string) => me.permissions.includes(p as never);
  const toggle = (p: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(p)) n.delete(p);
      else n.add(p);
      return n;
    });
  const toggleGroup = (perms: string[], on: boolean) =>
    setSelected((s) => {
      const n = new Set(s);
      perms.filter(grantable).forEach((p) => (on ? n.add(p) : n.delete(p)));
      return n;
    });

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      wide
      title={readOnly ? `Role: ${role.name}` : editing ? `Edit Role: ${role.name}` : "Create Role"}
    >
      <form
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          save.mutate();
        }}
      >
        {readOnly && (
          <p className="rounded-md bg-info-soft px-3 py-2 text-sm text-info">
            The Super Admin role is protected and cannot be changed.
          </p>
        )}
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Role Name" htmlFor="rn" required>
            <Input
              id="rn"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={readOnly}
              required
              minLength={2}
              placeholder="e.g. Branch Manager"
            />
          </Field>
          <Field label="Description" htmlFor="rd">
            <Input
              id="rd"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={readOnly}
              placeholder="What can this role do?"
            />
          </Field>
          <Field label="Data access" htmlFor="rs">
            <Select
              id="rs"
              value={dataScope}
              onChange={(e) => setDataScope(e.target.value as RoleRow["dataScope"])}
              disabled={readOnly}
            >
              <option value="ALL">All data</option>
              <option value="BRANCH">Own branch</option>
              <option value="ASSIGNED">Only assigned customers</option>
            </Select>
          </Field>
        </div>

        <div className="space-y-3">
          <p className="text-sm font-medium">Permissions</p>
          {Object.entries(catalog ?? {}).map(([group, actions]) => {
            const perms = actions.map((a) => `${group}:${a}`);
            const allOn = perms.filter(grantable).every((p) => selected.has(p));
            return (
              <fieldset key={group} className="rounded-md border border-border p-3">
                <div className="mb-2 flex items-center justify-between">
                  <legend className="font-medium">{title(group)}</legend>
                  {!readOnly && (
                    <button
                      type="button"
                      className="min-h-touch text-xs text-primary hover:underline md:min-h-0"
                      onClick={() => toggleGroup(perms, !allOn)}
                    >
                      {allOn ? "Deselect All" : "Select All"}
                    </button>
                  )}
                </div>
                <div className="grid gap-x-4 sm:grid-cols-2">
                  {perms.map((p) => (
                    <label key={p} className="flex min-h-touch items-center gap-2 font-mono text-xs md:min-h-8">
                      <input
                        type="checkbox"
                        checked={selected.has(p)}
                        onChange={() => toggle(p)}
                        disabled={readOnly || !grantable(p)}
                        title={!grantable(p) ? "You cannot grant a permission you do not hold" : undefined}
                      />
                      {p}
                    </label>
                  ))}
                </div>
              </fieldset>
            );
          })}
        </div>

        {error && (
          <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            {readOnly ? "Close" : "Cancel"}
          </Button>
          {!readOnly && (
            <Button type="submit" loading={save.isPending}>
              {editing ? "Save role" : "Create role"}
            </Button>
          )}
        </div>
      </form>
    </Modal>
  );
}
