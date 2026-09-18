import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typescript: {
    // Le build échoue sur toute erreur de type : pas d'exception tolérée.
    ignoreBuildErrors: false,
  },
};

export default nextConfig;
