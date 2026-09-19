import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Même alias que tsconfig.json, pour tester le code de l'application.
  resolve: {
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
  test: {
    environment: "node",
    // Garde-fou : refuse de démarrer si la base n'est pas le jeu fictif. Déclaré
    // ICI pour qu'aucun fichier de test ne puisse l'oublier ; tests/pg.ts le
    // re-vérifie à chaque connexion, et tests/garde-environnement.test.ts
    // échoue si l'un ou l'autre disparaît.
    globalSetup: ["./tests/global-setup.ts"],
    setupFiles: ["./tests/charger-env.ts"],
    testTimeout: 30_000,
    // Ces tests sont des tests d'intégration contre une base Postgres
    // partagée et réelle : plusieurs fichiers touchant les mêmes lignes
    // (la période « courante » de Mamelles Tower, notamment) en parallèle
    // se gênent, même quand chacun retourne proprement sa transaction.
    fileParallelism: false,
  },
});
