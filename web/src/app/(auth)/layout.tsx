import { Logo } from "@/components/layout/logo";

/** The wireframe's sign-in frame: dark hero on the left, the form on the right. */
export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      <aside className="hero-gradient hidden flex-col justify-between px-[60px] py-14 text-white lg:flex">
        <Logo size="hero" inverted />
        <div className="max-w-[440px]">
          <div className="mb-[18px] font-mono text-[13px] font-medium tracking-[1px] text-[#8fa2c9] uppercase">Internal tool</div>
          <h1 className="mb-[18px] text-[42px] leading-[1.08] font-bold tracking-[-0.9px]">
            Turn insurer quotes into a client comparison in under five minutes.
          </h1>
          <p className="text-[15px] leading-[1.6] text-[#b9c4d6]">
            Upload the quotes, review the extracted terms, pick your recommendation, and generate the
            presentation — proofread and send.
          </p>
        </div>
        <span aria-hidden />
      </aside>
      <main className="grid place-items-center p-10">
        <div className="w-full max-w-[340px]">
          <div className="mb-8 lg:hidden">
            <Logo />
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}
