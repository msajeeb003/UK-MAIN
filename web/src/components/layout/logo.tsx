import { cn } from "@/lib/utils";

interface LogoProps {
  className?: string;
  /** Hide the wordmark (collapsed sidebar). */
  compact?: boolean;
  /** Light-on-dark variant for the login hero. */
  inverted?: boolean;
}

export function Logo({ className, compact = false, inverted = false }: LogoProps) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <span
        aria-hidden
        className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary text-sm font-bold text-primary-foreground"
      >
        Q
      </span>
      {!compact && (
        <span className="flex min-w-0 flex-col leading-tight">
          <span
            className={cn("truncate text-sm font-semibold", inverted ? "text-white" : "text-foreground")}
          >
            Quote Comparison
          </span>
          <span className={cn("label-mono", inverted && "text-white/60")}>Trade credit</span>
        </span>
      )}
    </div>
  );
}
