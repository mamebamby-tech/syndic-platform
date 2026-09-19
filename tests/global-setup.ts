import { garderEnvironnement } from "./garde-environnement";

// Exécuté UNE fois, avant tout fichier de test (globalSetup dans
// vitest.config.ts). Une exception ici abandonne toute la suite : aucun
// test ne démarre sur une base qui n'est pas le jeu fictif.
export default async function setup() {
  await garderEnvironnement();
}
