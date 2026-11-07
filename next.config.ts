import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // libSQL ships a native module for local `file:` databases; keep it out of the bundle.
  serverExternalPackages: ["@libsql/client", "libsql"],
  poweredByHeader: false,
  images: { unoptimized: true },
};

export default nextConfig;
