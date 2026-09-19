/** Business timezone display. Data is stored in UTC; default Asia/Kolkata (configurable in settings later). */
const TZ = "Asia/Kolkata";
const fmt = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: TZ });
export const formatDateTime = (iso?: string | null) => (iso ? fmt.format(new Date(iso)) : "Never");

/** Compact rupees for charts and tiles: ₹1.2 Cr, ₹3.4 L, ₹45,000. Input is paise. */
export function inrCompact(paise: number): string {
  const r = paise / 100;
  const a = Math.abs(r);
  const sign = r < 0 ? "-" : "";
  const trim = (n: number) => String(Math.round(n * 100) / 100);
  if (a >= 10_000_000) return `${sign}₹${trim(a / 10_000_000)} Cr`;
  if (a >= 100_000) return `${sign}₹${trim(a / 100_000)} L`;
  return `${sign}₹${a.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}
