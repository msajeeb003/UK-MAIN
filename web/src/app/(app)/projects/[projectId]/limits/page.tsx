import type { Metadata } from "next";

import { LimitsScreen } from "@/components/limits/limits-screen";

export const metadata: Metadata = { title: "Credit limits" };

/** S6 — Buyer credit limits. */
export default function LimitsPage() {
  return <LimitsScreen />;
}
