import { config } from "dotenv";

// .env.local UNIQUEMENT : la base de développement (syndic-dev, jeu fictif).
// Jamais .env.reel — la base réelle. Le garde-fou
// (tests/garde-environnement.ts) contrôle en plus la valeur effective.
config({ path: ".env.local" });
