import type { Metadata } from "next";

import { ExportScreen } from "@/components/export/export-screen";

export const metadata: Metadata = { title: "Generate" };

/** S8 — Generate and export the presentation. */
export default function ExportPage() {
  return <ExportScreen />;
}
