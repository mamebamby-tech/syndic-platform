import { type NextRequest } from "next/server";
import { mettreAJourSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  return mettreAJourSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|webp)$).*)",
  ],
};
