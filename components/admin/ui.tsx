/**
 * Admin design-system primitives. Every admin screen composes these instead of
 * hand-rolling `rounded-2xl border border-line bg-white …` — one place to change
 * the look, zero copy-paste drift.
 *
 * Tokens come from app/globals.css (@theme): navy/paper/blue/ink/muted/line plus
 * the semantic status scale (success/warning/danger/info + *-soft tints).
 */
import type { ReactNode, ButtonHTMLAttributes } from "react";

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(" ");

/* ---------------------------------------------------------------- Card */

export function Card({ className = "", children }: { className?: string; children: ReactNode }) {
  return <div className={cx("rounded-2xl border border-line bg-white", className)}>{children}</div>;
}

/* -------------------------------------------------------------- Button */

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
const BUTTON: Record<ButtonVariant, string> = {
  primary: "bg-navy text-paper hover:bg-navy-2 disabled:opacity-50",
  secondary: "border border-navy/20 text-ink hover:border-blue hover:text-blue-deep disabled:opacity-50",
  ghost: "text-ink/60 hover:text-blue-deep hover:bg-paper-2 disabled:opacity-50",
  danger: "bg-danger text-white hover:opacity-90 disabled:opacity-50",
};

export function Button({ variant = "primary", small = false, className = "", ...rest }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; small?: boolean }) {
  return (
    <button
      {...rest}
      className={cx(
        "rounded-full font-medium transition-colors",
        small ? "px-4 py-2 text-xs" : "px-5 py-2.5 text-sm",
        BUTTON[variant],
        className,
      )}
    />
  );
}

/* --------------------------------------------------------------- Badge */

export type Tone = "success" | "warning" | "danger" | "info" | "neutral";
const BADGE: Record<Tone, string> = {
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
  info: "bg-info-soft text-info",
  neutral: "bg-paper-2 text-muted",
};
/** Map a domain status string to a tone in the callsite, then render. */
export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={cx("inline-flex items-center rounded-full px-2.5 py-0.5 font-mono text-[10.5px] uppercase tracking-[0.08em]", BADGE[tone])}>
      {children}
    </span>
  );
}

/* ------------------------------------------------------------ StatTile */

export function StatTile({ label, value, hint, children }: { label: string; value: ReactNode; hint?: string; children?: ReactNode }) {
  return (
    <Card className="p-4">
      <div className="font-display text-2xl">{value}</div>
      <div className="mt-0.5 text-xs text-muted">{label}</div>
      {hint && <div className="mt-1 text-[11px] text-muted/70">{hint}</div>}
      {children}
    </Card>
  );
}

/* ------------------------------------------------------- Inline notice */

const NOTICE: Record<Exclude<Tone, "neutral">, string> = {
  success: "border-success/30 bg-success-soft text-success",
  warning: "border-warning/30 bg-warning-soft text-warning",
  danger: "border-danger/30 bg-danger-soft text-danger",
  info: "border-info/30 bg-info-soft text-info",
};
/** Feedback banner for inline results ("Imported ✓", "Rebuild failed — …"). */
export function Notice({ tone = "info", className = "", children }: { tone?: Exclude<Tone, "neutral">; className?: string; children: ReactNode }) {
  return <div className={cx("rounded-xl border px-4 py-3 text-sm", NOTICE[tone], className)}>{children}</div>;
}

/* ----------------------------------------------------------- EmptyState */

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <Card className="px-6 py-10 text-center">
      <p className="text-sm font-medium text-ink/70">{title}</p>
      {hint && <p className="mt-1.5 text-[13px] text-muted">{hint}</p>}
    </Card>
  );
}

/* ------------------------------------------------------------ PageTitle */

export function PageTitle({ children, count, actions }: { children: ReactNode; count?: number; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h1 className="font-display text-2xl font-semibold">
        {children}
        {typeof count === "number" && <span className="ml-2 text-sm font-normal text-muted">({count})</span>}
      </h1>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
