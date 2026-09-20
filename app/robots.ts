import type { MetadataRoute } from "next";
import { reglesRobots } from "@/lib/demonstration";

// Lu à la requête : le mode (démonstration ou production) se déduit de l'environnement du
// déploiement (lib/demonstration.ts).
export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  return reglesRobots();
}
