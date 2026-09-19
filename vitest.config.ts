import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./tests/charger-env.ts"],
    testTimeout: 30_000,
    // Ces tests sont des tests d'intégration contre une base Postgres
    // partagée et réelle : plusieurs fichiers touchant les mêmes lignes
    // (la période « courante » de Mamelles Tower, notamment) en parallèle
    // se gênent, même quand chacun retourne proprement sa transaction.
    fileParallelism: false,
  },
});
