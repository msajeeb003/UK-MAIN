import type { Metadata } from "next";

import { ReviewScreen } from "@/components/review/review-screen";

export const metadata: Metadata = { title: "Review" };

/** S5 — Review and edit the comparison grid. */
export default function ReviewPage() {
  return <ReviewScreen />;
}
