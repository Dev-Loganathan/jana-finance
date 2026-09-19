import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { QRCodeSVG } from "qrcode.react";
import { passwordSchema } from "@jana/shared";
import { useAuth, useUser } from "@/auth/auth-context";
import { ApiError, api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { AuthCard } from "./Login";

const pwSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password"),
    newPassword: passwordSchema,
    confirm: z.string(),
  })
  .refine((v) => v.newPassword === v.confirm, { path: ["confirm"], message: "Passwords do not match" });

function ChangePassword({ onDone }: { onDone: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const form = useForm<z.infer<typeof pwSchema>>({ resolver: zodResolver(pwSchema) });
  const e = form.formState.errors;
  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={form.handleSubmit(async (v) => {
        setError(null);
        try {
          await api("/auth/change-password", {
            method: "POST",
            body: { currentPassword: v.currentPassword, newPassword: v.newPassword },
          });
          onDone();
        } catch (err) {
          setError(err instanceof ApiError ? err.message : "Could not change password");
        }
      })}
    >
      <Field label="Current password" htmlFor="cp" error={e.currentPassword?.message}>
        <Input id="cp" type="password" autoComplete="current-password" {...form.register("currentPassword")} />
      </Field>
      <Field
        label="New password"
        htmlFor="np"
        error={e.newPassword?.message}
        hint="Min 12 characters, with uppercase, lowercase, a number and a special character"
      >
        <Input id="np" type="password" autoComplete="new-password" {...form.register("newPassword")} />
      </Field>
      <Field label="Confirm new password" htmlFor="cf" error={e.confirm?.message}>
        <Input id="cf" type="password" autoComplete="new-password" {...form.register("confirm")} />
      </Field>
      {error && (
        <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      <Button type="submit" size="touch" className="w-full" loading={form.formState.isSubmitting}>
        Change password
      </Button>
    </form>
  );
}

function TotpSetup({ onDone }: { onDone: () => void }) {
  const [info, setInfo] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api<{ secret: string; otpauthUrl: string }>("/auth/2fa/setup", { method: "POST" })
      .then(setInfo)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Could not start 2FA setup"));
  }, []);

  async function verify(ev: React.FormEvent) {
    ev.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/auth/2fa/enable", { method: "POST", body: { code } });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not verify the code");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={verify} className="space-y-4">
      {info && (
        <div className="flex flex-col items-center gap-3">
          <div className="rounded-md border border-border bg-white p-3">
            <QRCodeSVG value={info.otpauthUrl} size={160} />
          </div>
          <p className="text-center text-sm text-fg-muted">
            Scan with Google Authenticator, Microsoft Authenticator or similar. Cannot scan? Enter this key:
          </p>
          <code data-testid="totp-secret" className="break-all rounded bg-surface-muted px-2 py-1 text-sm">
            {info.secret}
          </code>
        </div>
      )}
      <Field label="6-digit code" htmlFor="code">
        <Input
          id="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
      </Field>
      {error && (
        <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      <Button type="submit" size="touch" className="w-full" loading={busy} disabled={!info || code.length !== 6}>
        Turn on 2FA
      </Button>
    </form>
  );
}

/** Shown instead of the app while a forced password change or mandatory 2FA setup is pending. */
export default function Setup() {
  const user = useUser();
  const { reload, logout } = useAuth();
  const step = user.mustChangePassword ? "password" : "totp";
  return (
    <AuthCard
      title={step === "password" ? "Set a new password" : "Set up two-factor authentication"}
      subtitle={
        step === "password"
          ? "You must change your password before continuing."
          : "Two-factor authentication is required for the Super Admin account."
      }
    >
      {step === "password" ? (
        <ChangePassword onDone={() => void reload()} />
      ) : (
        <TotpSetup onDone={() => void reload()} />
      )}
      <button
        type="button"
        onClick={() => void logout()}
        className="mt-4 w-full min-h-touch text-sm text-fg-muted hover:text-fg"
      >
        Sign out
      </button>
    </AuthCard>
  );
}
