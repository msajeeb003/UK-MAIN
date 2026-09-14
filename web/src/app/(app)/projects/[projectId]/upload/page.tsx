import type { Metadata } from "next";

import { UploadScreen } from "@/components/upload/upload-screen";

export const metadata: Metadata = { title: "Upload" };

/** S4 — Upload documents. */
export default function UploadPage() {
  return <UploadScreen />;
}
