import { useId, useState } from "react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { inrCompact } from "@/lib/format";
import { formatINR } from "@jana/shared";

/** One headline number. A tile carries no chart, so it needs no hover layer. */
export function StatTile({
  label,
  value,
  hint,
  tone,
  hero,
  href,
}: {
  label: string;
  value: string;
  hint?: React.ReactNode;
  tone?: "danger" | "success";
  hero?: boolean;
  href?: string;
}) {
  const body = (
    <div
      className={cn(
        "h-full rounded-lg border border-border bg-surface p-4",
        href && "transition-colors hover:bg-surface-muted",
      )}
    >
      <p className="text-xs text-fg-muted">{label}</p>
      <p
        className={cn(
          "tabular mt-1 font-semibold leading-tight",
          hero ? "text-4xl" : "text-2xl",
          tone === "danger" && "text-danger",
          tone === "success" && "text-success",
        )}
      >
        {value}
      </p>
      {hint && <p className="mt-1 text-xs text-fg-muted">{hint}</p>}
    </div>
  );
  return href ? (
    <Link to={href} className="block rounded-lg">
      {body}
    </Link>
  ) : (
    body
  );
}

export function Panel({
  title,
  subtitle,
  children,
  action,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border bg-surface">
      <header className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h2 className="font-semibold">{title}</h2>
          {subtitle && <p className="text-xs text-fg-muted">{subtitle}</p>}
        </div>
        {action}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

/** Every chart has a table view so the numbers are readable without the picture (and to screen readers). */
function DataTable({ head, rows }: { head: [string, string]; rows: [string, string][] }) {
  return (
    <details className="mt-3 text-sm">
      <summary className="cursor-pointer text-primary hover:underline">View as table</summary>
      <table className="mt-2 w-full">
        <thead className="text-left text-xs text-fg-muted">
          <tr>
            <th className="py-1 font-medium">{head[0]}</th>
            <th className="py-1 text-right font-medium">{head[1]}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([a, b]) => (
            <tr key={a} className="border-t border-border">
              <td className="py-1">{a}</td>
              <td className="tabular py-1 text-right">{b}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (ym: string) => `${MONTHS[Number(ym.slice(5)) - 1]} ${ym.slice(2, 4)}`;

/**
 * Single-series column chart (money by month). One series in the accent colour, thin bars with rounded tops anchored to
 * the baseline, a recessive grid, a direct label on the latest bar, and a hover/focus tooltip.
 */
export function ColumnChart({ data, ariaLabel }: { data: { month: string; paise: number }[]; ariaLabel: string }) {
  const id = useId();
  const [hover, setHover] = useState<number | null>(null);
  const W = 560;
  const H = 220;
  const pad = { l: 56, r: 12, t: 16, b: 28 };
  const max = Math.max(...data.map((d) => d.paise), 1);
  // Round the axis top up to a friendly number so gridlines read cleanly
  const mag = 10 ** Math.floor(Math.log10(max));
  const top = Math.ceil(max / mag / 2) * mag * 2 || 1;
  const ticks = [0, top / 2, top];
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / top);
  const slot = (W - pad.l - pad.r) / data.length;
  const bw = Math.min(36, slot * 0.55);
  const last = data.length - 1;

  return (
    <div>
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaLabel} className="w-full" aria-describedby={id}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="rgb(var(--border))" strokeWidth={1} />
              <text
                x={pad.l - 8}
                y={y(t) + 4}
                textAnchor="end"
                fontSize={11}
                fill="rgb(var(--text-muted))"
                className="tabular"
              >
                {inrCompact(t)}
              </text>
            </g>
          ))}
          {data.map((d, i) => {
            const x = pad.l + slot * i + (slot - bw) / 2;
            const h = Math.max(0, y(0) - y(d.paise));
            const r = Math.min(4, bw / 2, h);
            return (
              <g key={d.month}>
                {/* Hit target is the whole column slot, larger than the mark */}
                <rect
                  x={pad.l + slot * i}
                  y={pad.t}
                  width={slot}
                  height={H - pad.t - pad.b}
                  fill="transparent"
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                />
                {h > 0 && (
                  <path
                    d={`M${x},${y(0)} v${-(h - r)} a${r},${r} 0 0 1 ${r},${-r} h${bw - 2 * r} a${r},${r} 0 0 1 ${r},${r} v${h - r} z`}
                    fill="rgb(var(--primary))"
                    opacity={hover === null || hover === i ? 1 : 0.45}
                  />
                )}
                <text x={x + bw / 2} y={H - 8} textAnchor="middle" fontSize={11} fill="rgb(var(--text-muted))">
                  {monthLabel(d.month)}
                </text>
                {i === last && d.paise > 0 && (
                  <text
                    x={x + bw / 2}
                    y={y(d.paise) - 6}
                    textAnchor="middle"
                    fontSize={11}
                    fontWeight={600}
                    fill="rgb(var(--text))"
                    className="tabular"
                  >
                    {inrCompact(d.paise)}
                  </text>
                )}
                {/* Keyboard access: each column can be focused to show its value */}
                <rect
                  x={pad.l + slot * i}
                  y={pad.t}
                  width={slot}
                  height={H - pad.t - pad.b}
                  fill="transparent"
                  tabIndex={0}
                  role="img"
                  aria-label={`${monthLabel(d.month)}: ${formatINR(d.paise, { decimals: false })}`}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                  className="outline-none focus-visible:stroke-[rgb(var(--ring))] focus-visible:stroke-2"
                />
              </g>
            );
          })}
        </svg>
        {hover !== null && (
          <div
            className="pointer-events-none absolute -translate-x-1/2 rounded-md border border-border bg-surface px-2 py-1 text-xs shadow-md"
            style={{ left: `${((pad.l + slot * hover + slot / 2) / W) * 100}%`, top: 0 }}
          >
            <span className="text-fg-muted">{monthLabel(data[hover]!.month)}</span>{" "}
            <strong className="tabular">{formatINR(data[hover]!.paise, { decimals: false })}</strong>
          </div>
        )}
      </div>
      <p id={id} className="sr-only">
        {ariaLabel}
      </p>
      <DataTable
        head={["Month", "Collected"]}
        rows={data.map((d) => [monthLabel(d.month), formatINR(d.paise, { decimals: false })])}
      />
    </div>
  );
}

/**
 * Horizontal bars for an ordered scale (days past due). One hue, darker = later/worse, so order and severity read without
 * relying on colour: every bar carries its label and value directly.
 */
export function BucketBars({
  rows,
  unit,
  ariaLabel,
}: {
  rows: { label: string; paise: number; count: number }[];
  unit: string;
  ariaLabel: string;
}) {
  const max = Math.max(...rows.map((r) => r.paise), 1);
  const shade = [0.4, 0.6, 0.8, 1];
  return (
    <div>
      <ul className="space-y-3" aria-label={ariaLabel}>
        {rows.map((r, i) => (
          <li
            key={r.label}
            className="grid grid-cols-[5.5rem_1fr_auto] items-center gap-3 text-sm"
            title={`${r.label} days past due: ${formatINR(r.paise, { decimals: false })} across ${r.count} ${unit}`}
          >
            <span className="whitespace-nowrap text-fg-muted">{r.label} days</span>
            <span className="h-3 overflow-hidden rounded-full bg-surface-muted">
              <span
                className="block h-full rounded-full bg-primary"
                style={{
                  width: `${(r.paise / max) * 100}%`,
                  minWidth: r.paise > 0 ? "0.5rem" : 0,
                  opacity: shade[i] ?? 1,
                }}
              />
            </span>
            <span className="tabular text-right">
              <strong>{inrCompact(r.paise)}</strong> <span className="text-xs text-fg-muted">· {r.count}</span>
            </span>
          </li>
        ))}
      </ul>
      <DataTable
        head={["Days past due", `Amount · ${unit}`]}
        rows={rows.map((r) => [`${r.label} days`, `${formatINR(r.paise, { decimals: false })} · ${r.count}`])}
      />
    </div>
  );
}

/** A labelled share (KYC status, risk mix): count with a thin one-hue meter. */
export function ShareRows({
  rows,
  total,
  format,
}: {
  rows: { label: string; count: number }[];
  total: number;
  format?: (n: number) => string;
}) {
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li key={r.label} className="grid grid-cols-[6.5rem_1fr_auto] items-center gap-3 text-sm">
          <span className="text-fg-muted">{r.label}</span>
          <span className="h-2 overflow-hidden rounded-full bg-surface-muted">
            <span
              className="block h-full rounded-full bg-primary"
              style={{ width: total ? `${(r.count / total) * 100}%` : 0, minWidth: r.count > 0 ? "0.4rem" : 0 }}
            />
          </span>
          <span className="tabular text-right">
            {format ? format(r.count) : r.count}{" "}
            <span className="text-xs text-fg-muted">({total ? Math.round((r.count / total) * 100) : 0}%)</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
