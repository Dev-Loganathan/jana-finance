import type { Permission } from "@jana/shared";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: { id: string; name: string };
  permissions: Permission[];
  mustChangePassword: boolean;
  totpEnabled: boolean;
  requiresTotpSetup: boolean;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

/** Access token lives in memory only. The refresh token is an httpOnly cookie the JS cannot read. */
/** All API routes live under /api (the dev server proxies it; in production the reverse proxy does). */
export const apiUrl = (path: string) => `/api${path.startsWith("/") ? path : `/${path}`}`;

let accessToken: string | null = null;
export const setAccessToken = (t: string | null) => (accessToken = t);

let refreshing: Promise<SessionUser | null> | null = null;

/** Single-flight refresh so parallel 401s trigger one rotation, not several. */
export function refreshSession(): Promise<SessionUser | null> {
  refreshing ??= (async () => {
    try {
      const res = await fetch(apiUrl("/auth/refresh"), { method: "POST", credentials: "include" });
      if (!res.ok) return (setAccessToken(null), null);
      const data = (await res.json()) as { accessToken: string; user: SessionUser };
      setAccessToken(data.accessToken);
      return data.user;
    } catch {
      return null;
    } finally {
      setTimeout(() => (refreshing = null), 0);
    }
  })();
  return refreshing;
}

interface Opts {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  /** Do not try to refresh on 401 (login, refresh itself). */
  noRetry?: boolean;
  /** Sent as the Idempotency-Key header so a retried write cannot be applied twice. */
  idempotencyKey?: string;
}

export async function api<T = unknown>(path: string, opts: Opts = {}): Promise<T> {
  const url = new URL(apiUrl(path), window.location.origin);
  for (const [k, v] of Object.entries(opts.query ?? {}))
    if (v !== undefined && v !== "") url.searchParams.set(k, String(v));

  const send = () =>
    fetch(url, {
      method: opts.method ?? "GET",
      credentials: "include",
      headers: {
        ...(opts.body !== undefined && { "Content-Type": "application/json" }),
        ...(accessToken && { Authorization: `Bearer ${accessToken}` }),
        ...(opts.idempotencyKey && { "Idempotency-Key": opts.idempotencyKey }),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });

  let res = await send();
  if (res.status === 401 && !opts.noRetry && (await refreshSession())) res = await send();

  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.code ?? "ERROR", data.message ?? res.statusText, data.errors);
  return data as T;
}

/** Multipart upload (files). Same auth and refresh behaviour as `api`. */
export async function upload<T>(path: string, form: FormData): Promise<T> {
  const send = () =>
    fetch(apiUrl(path), {
      method: "POST",
      credentials: "include",
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
      body: form,
    });
  let res = await send();
  if (res.status === 401 && (await refreshSession())) res = await send();
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.code ?? "ERROR", data.message ?? res.statusText, data.errors);
  return data as T;
}

/** Downloads a file response (CSV export) through the authenticated API and saves it in the browser. */
export async function download(
  path: string,
  query: Record<string, string | number | undefined>,
  fallbackName: string,
): Promise<void> {
  const url = new URL(apiUrl(path), window.location.origin);
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
  const send = () =>
    fetch(url, { credentials: "include", headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {} });
  let res = await send();
  if (res.status === 401 && (await refreshSession())) res = await send();
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(res.status, data.code ?? "ERROR", data.message ?? res.statusText);
  }
  const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? fallbackName;
  const link = document.createElement("a");
  link.href = URL.createObjectURL(await res.blob());
  link.download = name;
  link.click();
  URL.revokeObjectURL(link.href);
}
