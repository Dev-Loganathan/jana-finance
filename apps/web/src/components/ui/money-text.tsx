import { formatINR } from "@jana/shared";
import { cn } from "@/lib/utils";

/** Renders an amount given in PAISE. Right-aligned, tabular numerals, Indian grouping. */
export function MoneyText({
  paise,
  decimals = true,
  tone = "auto",
  className,
}: {
  paise: number;
  decimals?: boolean;
  /** "auto" colours negatives red; "none" never colours. */
  tone?: "auto" | "none";
  className?: string;
}) {
  return (
    <span className={cn("tabular inline-block text-right", tone === "auto" && paise < 0 && "text-danger", className)}>
      {formatINR(paise, { decimals })}
    </span>
  );
}
