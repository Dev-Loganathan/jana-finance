import { useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { BookOpenCheck, Coins, Eye, EyeOff, Lock, ShieldCheck, Users } from "lucide-react";
import { useAuth } from "@/auth/auth-context";
import { ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";

const schema = z.object({
  email: z.string().trim().email("Enter a valid email"),
  password: z.string().min(1, "Enter your password"),
  totp: z.string().optional(),
});
type Values = z.infer<typeof schema>;

const FEATURES = [
  {
    icon: Users,
    title: "Customers and KYC",
    text: "Onboard in six guided steps, verify documents, keep every record in one place.",
  },
  {
    icon: Coins,
    title: "Chit funds",
    text: "Groups, auctions, collections and payouts, with the month-end maths done for you.",
  },
  {
    icon: BookOpenCheck,
    title: "A ledger you can trust",
    text: "Every rupee is a balanced entry that can be reversed but never edited.",
  },
] as const;

function Logo({ inverse }: { inverse?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <span
        className={
          inverse
            ? "flex h-10 w-10 items-center justify-center rounded-md bg-primary text-fg-inverse ring-1 ring-white/20"
            : "flex h-10 w-10 items-center justify-center rounded-md bg-primary text-fg-inverse"
        }
      >
        <ShieldCheck className="h-5 w-5" aria-hidden />
      </span>
      <div>
        <p className={inverse ? "font-semibold leading-tight text-fg-inverse" : "font-semibold leading-tight"}>
          Jana Finance
        </p>
        <p className={inverse ? "text-xs text-sidebar-fg" : "text-xs text-fg-muted"}>Management Suite</p>
      </div>
    </div>
  );
}

/** Decorative background: soft glows and concentric rings. Hidden from assistive tech. */
function Backdrop() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute -left-32 -top-32 h-96 w-96 rounded-full bg-primary/40 blur-3xl" />
      <div className="absolute -bottom-40 -right-24 h-96 w-96 rounded-full bg-ring/25 blur-3xl" />
      <svg
        className="absolute -bottom-24 -right-24 h-[34rem] w-[34rem] text-white/10"
        viewBox="0 0 400 400"
        fill="none"
      >
        {[60, 105, 150, 195].map((r) => (
          <circle key={r} cx="200" cy="200" r={r} stroke="currentColor" strokeWidth="1.5" />
        ))}
      </svg>
    </div>
  );
}

function BrandPanel() {
  return (
    <aside className="relative hidden flex-col justify-between overflow-hidden bg-sidebar p-12 text-fg-inverse lg:flex">
      <Backdrop />
      <div className="relative">
        <Logo inverse />
      </div>
      <div className="relative max-w-lg">
        <h2 className="text-4xl font-semibold leading-tight tracking-tight">
          Lending and chit funds, run from one place.
        </h2>
        <p className="mt-4 text-base text-sidebar-fg">
          Built for a small team that handles a lot of customers and wants every rupee accounted for.
        </p>
        <ul className="mt-10 space-y-6">
          {FEATURES.map(({ icon: Icon, title, text }) => (
            <li key={title} className="flex gap-4">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-white/10 ring-1 ring-white/15">
                <Icon className="h-5 w-5" aria-hidden />
              </span>
              <div>
                <p className="font-medium">{title}</p>
                <p className="mt-0.5 text-sm text-sidebar-fg">{text}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
      <p className="relative flex items-center gap-2 text-sm text-sidebar-fg">
        <Lock className="h-4 w-4" aria-hidden />
        Encrypted ID data, a full audit trail and two-factor sign-in.
      </p>
    </aside>
  );
}

export function AuthCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <main className="grid min-h-screen bg-bg lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      <BrandPanel />
      <div className="flex min-h-screen flex-col lg:min-h-0">
        <div className="relative overflow-hidden bg-sidebar px-4 py-5 lg:hidden">
          <Backdrop />
          <div className="relative">
            <Logo inverse />
          </div>
        </div>
        <div className="flex flex-1 items-center justify-center px-4 py-8 sm:px-8">
          <div className="w-full max-w-md">
            <div className="rounded-xl border border-border bg-surface p-6 shadow-lg shadow-primary/5 sm:p-8">
              <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
              {subtitle && <p className="mt-1 text-sm text-fg-muted">{subtitle}</p>}
              <div className="mt-6">{children}</div>
            </div>
            <p className="mt-6 text-center text-xs text-fg-muted">
              Trouble signing in? Ask your administrator to reset your access.
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}

export default function Login() {
  const { state, login } = useAuth();
  const location = useLocation();
  const [needTotp, setNeedTotp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { email: "", password: "", totp: "" } });

  if (state.status === "authed")
    return <Navigate to={(location.state as { from?: string } | null)?.from ?? "/"} replace />;

  const onSubmit = form.handleSubmit(async (v) => {
    setError(null);
    try {
      await login(v.email, v.password, v.totp);
    } catch (e) {
      if (e instanceof ApiError && e.code === "TOTP_REQUIRED") return setNeedTotp(true);
      setError(e instanceof ApiError ? e.message : "Something went wrong. Try again.");
    }
  });

  return (
    <AuthCard title="Sign in" subtitle="Use your staff account.">
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field label="Email" htmlFor="email" error={form.formState.errors.email?.message}>
          <Input
            id="email"
            type="email"
            autoComplete="username"
            autoFocus
            aria-invalid={!!form.formState.errors.email}
            {...form.register("email")}
          />
        </Field>
        <Field label="Password" htmlFor="password" error={form.formState.errors.password?.message}>
          <div className="relative">
            <Input
              id="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              className="pr-11"
              aria-invalid={!!form.formState.errors.password}
              {...form.register("password")}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? "Hide password" : "Show password"}
              aria-pressed={showPassword}
              className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-md text-fg-muted hover:bg-surface-muted hover:text-fg"
            >
              {showPassword ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
            </button>
          </div>
        </Field>
        {needTotp && (
          <Field label="Authenticator code" htmlFor="totp" hint="6-digit code from your authenticator app">
            <Input
              id="totp"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              autoFocus
              {...form.register("totp")}
            />
          </Field>
        )}
        {error && (
          <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}
        <Button type="submit" size="touch" className="w-full" loading={form.formState.isSubmitting}>
          {needTotp ? "Verify and sign in" : "Sign in"}
        </Button>
      </form>
    </AuthCard>
  );
}
