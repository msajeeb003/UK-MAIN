import { Logo } from "@/components/layout/logo";

/** Two-column sign-in frame from the wireframe: dark hero + form panel. */
export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      <aside className="hero-gradient hidden flex-col justify-between p-14 text-white lg:flex">
        <Logo inverted />
        <div className="max-w-md space-y-4">
          <h2 className="text-3xl font-semibold leading-tight tracking-tight">
            Compare trade-credit quotes in minutes, not afternoons.
          </h2>
          <p className="text-sm leading-relaxed text-white/70">
            Upload insurer quotes, review every extracted value against its source page, and
            generate the client presentation once the key figures are confirmed.
          </p>
        </div>
        <p className="label-mono text-white/50">Internal broker tool · authorised users only</p>
      </aside>
      <main className="flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <Logo />
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}
