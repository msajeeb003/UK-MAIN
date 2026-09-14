import type { Metadata } from "next";

import { SetupScreen } from "@/components/projects/setup-screen";

export const metadata: Metadata = { title: "Setup" };

/** S3 — New project / setup. */
export default function SetupPage() {
  return <SetupScreen />;
}
