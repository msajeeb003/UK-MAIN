import type { Metadata } from "next";

import { RecommendScreen } from "@/components/recommend/recommend-screen";

export const metadata: Metadata = { title: "Recommendation" };

/** S7 — Comments and recommendation. */
export default function RecommendPage() {
  return <RecommendScreen />;
}
