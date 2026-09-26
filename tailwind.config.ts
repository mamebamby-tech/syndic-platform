import type { Config } from "tailwindcss";

// Jetons de docs/04-charte.md — seul endroit où ces valeurs sont écrites.
// Aucune couleur, aucun rayon, aucune police ne doit apparaître ailleurs
// que par ces noms : changer l'accent reste une modification d'une ligne.

// Exportées pour ce qui n'est pas du CSS — le PDF de l'appel
// (lib/documents/pdf-appel.tsx) — sans jamais les recopier.
export const couleurs = {
  marque: "#1F8A82",
  action: "#166A63",
  "action-doux": "#E6F1F0",
  "action-encre": "#10504A",
  fond: "#F7F5F0",
  surface: "#FFFFFF",
  filet: "#E2DFD7",
  encre: "#17211E",
  "encre-2": "#5C6460",
  "encre-3": "#6E756F",
  alerte: "#97591A",
  "alerte-doux": "#FDF6E9",
  impaye: "#9B2F22",
  "impaye-doux": "#F8E9E6",
} as const;

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: couleurs,
      fontFamily: {
        serif: ["var(--font-newsreader)"],
        sans: ["var(--font-public-sans)"],
      },
      borderRadius: {
        card: "11px",
        control: "8px",
      },
      boxShadow: {
        // Le registre est sobre : aucune ombre portée n'est un jeton valide.
        none: "none",
      },
    },
  },
  plugins: [],
};

export default config;
