import type { MetadataRoute } from "next";
import { reglesRobots } from "@/lib/demonstration";

// Lu à la requête : DEMONSTRATION est une variable d'environnement du déploiement.
export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  return reglesRobots();
}
