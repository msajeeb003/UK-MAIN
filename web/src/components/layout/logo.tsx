import { cn } from "@/lib/utils";

interface LogoProps {
  className?: string;
  /** Larger mark for the login hero. */
  size?: "topbar" | "hero";
  /** Light-on-dark variant for the login hero. */
  inverted?: boolean;
}

/** The wireframe's mark: an accent square with a "U" and the wordmark. */
export function Logo({ className, size = "topbar", inverted = false }: LogoProps) {
  const hero = size === "hero";
  return (
    <div className={cn("flex items-center gap-2.5", hero && "gap-3", className)}>
      <span
        aria-hidden
        className={cn(
          "grid shrink-0 place-items-center bg-primary font-bold text-white",
          hero ? "size-[34px] rounded-lg text-[17px]" : "size-7 rounded-[7px] text-sm",
        )}
      >
        U
      </span>
      <span className={cn("truncate font-semibold", hero ? "tracking-[.2px]" : "text-[15px]", inverted ? "text-white" : "text-ink")}>
        UK Insurance
      </span>
    </div>
  );
}
