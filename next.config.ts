import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const nextConfig: NextConfig = {
  typescript: {
    // Le build échoue sur toute erreur de type : pas d'exception tolérée.
    ignoreBuildErrors: false,
  },
};

const avecNextIntl = createNextIntlPlugin("./i18n/request.ts");

export default avecNextIntl(nextConfig);
