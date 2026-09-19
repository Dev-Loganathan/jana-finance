import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { passwordSchema } from "@jana/shared";
import { ApiError, api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { AuthCard } from "./Login";

const schema = z
  .object({ password: passwordSchema, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "Passwords do not match" });

/** Landing page for invite and password-reset links: /accept-invite?token=... */
export default function AcceptInvite() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) });
  const e = form.formState.errors;

  if (done)
    return (
      <AuthCard title="Password set" subtitle="You can now sign in with your new password.">
        <Button asChild size="touch" className="w-full">
          <Link to="/login">Go to sign in</Link>
        </Button>
      </AuthCard>
    );

  return (
    <AuthCard title="Set your password" subtitle="Choose a password to activate your account.">
      <form
        noValidate
        className="space-y-4"
        onSubmit={form.handleSubmit(async (v) => {
          setError(null);
          try {
            await api("/auth/accept-token", { method: "POST", body: { token, password: v.password }, noRetry: true });
            setDone(true);
          } catch (err) {
            setError(err instanceof ApiError ? err.message : "Something went wrong");
          }
        })}
      >
        <Field
          label="New password"
          htmlFor="pw"
          error={e.password?.message}
          hint="Min 12 characters, with uppercase, lowercase, a number and a special character"
        >
          <Input id="pw" type="password" autoComplete="new-password" {...form.register("password")} />
        </Field>
        <Field label="Confirm password" htmlFor="cf" error={e.confirm?.message}>
          <Input id="cf" type="password" autoComplete="new-password" {...form.register("confirm")} />
        </Field>
        {error && (
          <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}
        <Button type="submit" size="touch" className="w-full" loading={form.formState.isSubmitting} disabled={!token}>
          Set password
        </Button>
      </form>
    </AuthCard>
  );
}
