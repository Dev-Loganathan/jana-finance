import { useState } from "react";
import type { CreditCategory, RiskLevel } from "@jana/shared";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import type { KycStatus } from "./types";

const RISK: Record<RiskLevel, { tone: StatusTone; label: string }> = {
  LOW: { tone: "success", label: "Low risk" },
  MEDIUM: { tone: "warning", label: "Medium risk" },
  HIGH: { tone: "danger", label: "High risk" },
};

export function RiskBadge({ level }: { level: RiskLevel | null }) {
  if (!level) return <span className="text-fg-muted">-</span>;
  return <StatusBadge tone={RISK[level].tone}>{RISK[level].label}</StatusBadge>;
}

const KYC: Record<KycStatus, { tone: StatusTone; label: string }> = {
  NOT_STARTED: { tone: "neutral", label: "KYC not started" },
  PARTIAL: { tone: "warning", label: "KYC partial" },
  COMPLETE: { tone: "info", label: "KYC complete" },
  VERIFIED: { tone: "success", label: "KYC verified" },
  EXPIRED: { tone: "danger", label: "KYC expired" },
};

export function KycBadge({ status }: { status: KycStatus }) {
  return <StatusBadge tone={KYC[status].tone}>{KYC[status].label}</StatusBadge>;
}

/** Credit category by CIBIL band: colour is paired with the text label. */
export function CibilScore({ score }: { score: number | null }) {
  if (score === null) return <span className="text-fg-muted">-</span>;
  const cls = score >= 750 ? "text-success" : score >= 650 ? "text-warning" : "text-danger";
  return <span className={`tabular font-semibold ${cls}`}>{score}</span>;
}

export const CATEGORY_LABEL: Record<CreditCategory, string> = {
  EXCELLENT: "Excellent",
  GOOD: "Good",
  MEDIUM: "Medium",
  POOR: "Poor",
};

export function Avatar({ name, url, size = 36 }: { name: string; url?: string | null; size?: number }) {
  // If the image cannot be loaded or decoded, fall back to initials instead of a broken-image icon.
  const [broken, setBroken] = useState(false);
  const initials = (name || "?")
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return url && !broken ? (
    <img
      src={url}
      alt=""
      width={size}
      height={size}
      onError={() => setBroken(true)}
      className="shrink-0 rounded-full object-cover"
      style={{ width: size, height: size }}
    />
  ) : (
    <span
      className="flex shrink-0 items-center justify-center rounded-full bg-primary-soft text-xs font-semibold text-primary-soft-fg"
      style={{ width: size, height: size }}
      aria-hidden
    >
      {initials}
    </span>
  );
}

export function WatchBadge({ status }: { status: "NONE" | "WATCHLIST" | "BLACKLIST" }) {
  if (status === "NONE") return null;
  return status === "BLACKLIST" ? (
    <StatusBadge tone="danger">Blacklisted</StatusBadge>
  ) : (
    <StatusBadge tone="warning">Watchlist</StatusBadge>
  );
}
