import nextConfig from "eslint-config-next";
import i18next from "eslint-plugin-i18next";

const config = [
  {
    ignores: [".next/**", "node_modules/**", "lib/types/database.ts"],
  },
  ...nextConfig,
  {
    // Aucune chaîne visible en dur dans l'interface : tout texte passe par
    // messages/*.json (next-intl). `jsx-only` contrôle le texte JSX et les
    // attributs ; les attributs de mise en forme et de comportement, qui ne
    // sont pas du texte affiché, sont exclus.
    files: ["app/**/*.tsx", "components/**/*.tsx"],
    plugins: { i18next },
    rules: {
      "i18next/no-literal-string": [
        "error",
        {
          mode: "jsx-only",
          // Les clés passées aux traducteurs et aux formateurs ne sont pas
          // du texte affiché : `t("titre")`, `tStatut(...)`, `format.number(...)`.
          callees: { exclude: ["t", "t\\..*", "t[A-Z].*", "format\\..*"] },
          "jsx-attributes": {
            exclude: [
              "className",
              "id",
              "name",
              "htmlFor",
              "type",
              "form",
              "href",
              "key",
              "value",
              "defaultValue",
              "inputMode",
              "autoComplete",
              "lang",
              "role",
              "rel",
              "target",
              "aria-current",
              "min",
              "step",
              "colSpan",
            ],
          },
        },
      ],
    },
  },
];

export default config;
