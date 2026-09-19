import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export interface Step {
  key: string;
  label: string;
}

/**
 * Horizontal stepper for the customer wizard. Completed steps are clickable so a
 * draft can be resumed at any step. On narrow screens only the current label shows.
 */
export function Stepper({
  steps,
  current,
  completed = [],
  onStepClick,
}: {
  steps: readonly Step[];
  current: number;
  completed?: readonly string[];
  onStepClick?: (index: number) => void;
}) {
  return (
    <ol className="flex w-full items-center gap-2" aria-label="Progress">
      {steps.map((step, i) => {
        const done = completed.includes(step.key);
        const active = i === current;
        const clickable = !!onStepClick && (done || active);
        return (
          <li key={step.key} className="flex flex-1 items-center gap-2" aria-current={active ? "step" : undefined}>
            <button
              type="button"
              disabled={!clickable}
              onClick={() => onStepClick?.(i)}
              className={cn(
                "flex min-h-touch items-center gap-2 rounded-md text-sm",
                clickable && "hover:bg-surface-muted",
              )}
            >
              <span
                className={cn(
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                  done && !active && "bg-success text-fg-inverse",
                  active && "bg-primary text-fg-inverse",
                  !done && !active && "bg-neutral-soft text-fg-muted",
                )}
              >
                {done && !active ? <Check className="h-4 w-4" aria-hidden /> : i + 1}
              </span>
              <span
                className={cn("font-medium", active ? "text-primary" : "text-fg-muted", !active && "hidden md:inline")}
              >
                {step.label}
                <span className="sr-only">{done ? " (completed)" : active ? " (current step)" : ""}</span>
              </span>
            </button>
            {i < steps.length - 1 && <span aria-hidden className="h-px flex-1 bg-border" />}
          </li>
        );
      })}
    </ol>
  );
}
