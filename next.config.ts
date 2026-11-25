import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdfkit reads its font files (data/*.afm) from its own folder at runtime; bundling
  // it breaks those paths (ENOENT …\pdfkit\js\data\Helvetica.afm), so load it from node_modules.
  serverExternalPackages: ['pdfkit'],
};

export default nextConfig;
