import nextConfig from "eslint-config-next";

const config = [
  {
    ignores: [".next/**", "node_modules/**", "lib/types/database.ts"],
  },
  ...nextConfig,
];

export default config;
