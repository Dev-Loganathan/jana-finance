import type { Config } from "tailwindcss";

const c = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: c("bg"),
        surface: { DEFAULT: c("surface"), muted: c("surface-muted") },
        border: { DEFAULT: c("border"), strong: c("border-strong") },
        fg: { DEFAULT: c("text"), muted: c("text-muted"), inverse: c("text-inverse") },
        primary: {
          DEFAULT: c("primary"),
          hover: c("primary-hover"),
          soft: c("primary-soft"),
          "soft-fg": c("primary-soft-text"),
        },
        ring: c("ring"),
        sidebar: { DEFAULT: c("sidebar"), fg: c("sidebar-text"), active: c("sidebar-active") },
        success: { DEFAULT: c("success"), soft: c("success-soft") },
        warning: { DEFAULT: c("warning"), soft: c("warning-soft") },
        danger: { DEFAULT: c("danger"), soft: c("danger-soft") },
        info: { DEFAULT: c("info"), soft: c("info-soft") },
        neutral: { soft: c("neutral-soft") },
      },
      borderRadius: { sm: "var(--radius-sm)", md: "var(--radius-md)", lg: "var(--radius-lg)" },
      fontFamily: { sans: ["var(--font-sans)"] },
      minHeight: { touch: "var(--touch)" },
      minWidth: { touch: "var(--touch)" },
    },
  },
  plugins: [],
} satisfies Config;
