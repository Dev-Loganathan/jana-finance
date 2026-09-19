import { useState } from "react";
import { Shield, Users } from "lucide-react";
import { useCan } from "@/auth/permissions";
import { cn } from "@/lib/utils";
import { RolesTab } from "@/features/users/RolesTab";
import { UsersTab } from "@/features/users/UsersTab";

export default function UserManagement() {
  const can = useCan();
  const tabs = [
    { key: "users", label: "Users", icon: Users, show: can("user:view") },
    { key: "roles", label: "Roles & Permissions", icon: Shield, show: can("role:view") },
  ].filter((t) => t.show);
  const [tab, setTab] = useState(tabs[0]?.key ?? "users");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">User Management</h1>
        <p className="text-fg-muted">Manage users, roles, and permissions</p>
      </div>
      <div role="tablist" aria-label="User management" className="flex gap-2">
        {tabs.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            role="tab"
            id={`tab-${key}`}
            aria-selected={tab === key}
            aria-controls={`panel-${key}`}
            onClick={() => setTab(key)}
            className={cn(
              "inline-flex min-h-touch items-center gap-2 rounded-md border px-4 text-sm font-medium md:min-h-10",
              tab === key
                ? "border-primary bg-primary text-fg-inverse"
                : "border-border bg-surface hover:bg-surface-muted",
            )}
          >
            <Icon className="h-4 w-4" aria-hidden />
            {label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === "users" ? <UsersTab /> : <RolesTab />}
      </div>
    </div>
  );
}
