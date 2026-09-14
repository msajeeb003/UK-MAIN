import { redirect } from "next/navigation";

import { routes } from "@/lib/navigation";

export default function HomePage() {
  redirect(routes.projects);
}
