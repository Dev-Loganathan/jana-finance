import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import {
  CircleDollarSign,
  HandCoins,
  LayoutDashboard,
  LogOut,
  Menu,
  ScrollText,
  Search,
  ShieldCheck,
  UserCog,
  Users,
  X,
} from "lucide-react";
import type { Permission } from "@jana/shared";
import { useAuth, useUser } from "@/auth/auth-context";
import { useCan } from "@/auth/permissions";
import { cn } from "@/lib/utils";

interface NavItem {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  /** Visible if the user holds ANY of these. Cosmetic: the API enforces access. */
  anyOf?: Permission[];
}

/** Modules appear here as their phases land (Customers, Loans, Chits...). */
const NAV: NavItem[] = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/customers", label: "Customers", icon: Users, anyOf: ["customer:view"] },
  { to: "/loans", label: "Loans", icon: HandCoins, anyOf: ["loan:view"] },
  { to: "/chits", label: "Chit Funds", icon: CircleDollarSign, anyOf: ["chit:view"] },
  { to: "/user-management", label: "User Management", icon: UserCog, anyOf: ["user:view", "role:view"] },
  { to: "/audit-log", label: "Audit Log", icon: ScrollText, anyOf: ["audit:view"] },
];

function initials(name: string) {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const can = useCan();
  const user = useUser();
  const { logout } = useAuth();
  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-fg">
      <div className="flex items-center gap-3 border-b border-white/10 px-4 py-4">
        <span className="flex h-9 w-9 items-center justify-center rounded-md bg-primary text-fg-inverse">
          <ShieldCheck className="h-5 w-5" aria-hidden />
        </span>
        <div>
          <p className="text-sm font-semibold leading-tight text-white">Jana Finance</p>
          <p className="text-xs opacity-70">Management Suite</p>
        </div>
      </div>
      <nav aria-label="Main" className="flex-1 space-y-1 px-3 py-4">
        {NAV.filter((n) => !n.anyOf || can(n.anyOf, "any")).map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/"}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                "flex min-h-touch items-center gap-3 rounded-md px-3 text-sm hover:bg-sidebar-active hover:text-white md:min-h-10",
                isActive && "bg-sidebar-active text-white",
              )
            }
          >
            <Icon className="h-4 w-4" aria-hidden />
            {label}
          </NavLink>
        ))}
      </nav>
      <div className="border-t border-white/10 p-3">
        <div className="mb-2 flex items-center gap-3 px-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-sidebar-active text-xs font-semibold text-white">
            {initials(user.name)}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-white">{user.name}</p>
            <p className="truncate text-xs opacity-70">{user.role.name}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void logout()}
          className="flex min-h-touch w-full items-center gap-3 rounded-md px-3 text-sm hover:bg-sidebar-active hover:text-white md:min-h-10"
        >
          <LogOut className="h-4 w-4" aria-hidden />
          Logout
        </button>
      </div>
    </div>
  );
}

export default function AppShell() {
  const user = useUser();
  const [open, setOpen] = useState(false);
  return (
    <div className="min-h-screen md:pl-64">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <aside className="fixed inset-y-0 left-0 hidden w-64 md:block">
        <Sidebar />
      </aside>

      {open && (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <div className="relative h-full w-64">
            <Sidebar onNavigate={() => setOpen(false)} />
            <button
              type="button"
              aria-label="Close menu"
              onClick={() => setOpen(false)}
              className="absolute right-[-44px] top-2 rounded-md bg-surface p-2"
            >
              <X className="h-5 w-5" aria-hidden />
            </button>
          </div>
        </div>
      )}

      <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-surface px-4">
        <button
          type="button"
          aria-label="Open menu"
          onClick={() => setOpen(true)}
          className="rounded-md p-2 hover:bg-surface-muted md:hidden"
        >
          <Menu className="h-5 w-5" aria-hidden />
        </button>
        <div className="relative max-w-xs flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-muted"
            aria-hidden
          />
          <input
            disabled
            aria-label="Search customers"
            title="Customer search arrives with the Customers module"
            placeholder="Search customers…"
            className="h-10 w-full rounded-md bg-surface-muted pl-9 pr-3 text-sm placeholder:text-fg-muted disabled:cursor-not-allowed"
          />
        </div>
        <div className="ml-auto hidden text-right text-sm sm:block">
          <p className="font-medium leading-tight">{user.name}</p>
          <p className="text-xs text-fg-muted">{user.role.name}</p>
        </div>
      </header>

      <main id="main" className="mx-auto max-w-7xl px-4 py-6 md:px-6">
        <Outlet />
      </main>
    </div>
  );
}
