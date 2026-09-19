import { useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ShieldCheck } from "lucide-react";
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
    <main className="flex min-h-screen items-center justify-center bg-sidebar px-4 py-8">
      <div className="w-full max-w-md rounded-lg bg-surface p-6 shadow-xl sm:p-8">
        <div className="mb-6 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-md bg-primary text-fg-inverse">
            <ShieldCheck className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <p className="font-semibold leading-tight">Jana Finance</p>
            <p className="text-xs text-fg-muted">Management Suite</p>
          </div>
        </div>
        <h1 className="text-xl font-semibold">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-fg-muted">{subtitle}</p>}
        <div className="mt-6">{children}</div>
      </div>
    </main>
  );
}

export default function Login() {
  const { state, login } = useAuth();
  const location = useLocation();
  const [needTotp, setNeedTotp] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            aria-invalid={!!form.formState.errors.password}
            {...form.register("password")}
          />
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
