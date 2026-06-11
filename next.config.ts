import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite ships WASM/native assets that must not go through the server
  // bundler; load it with native require instead. (`pg` is already in
  // Next's built-in external list.)
  serverExternalPackages: ["@electric-sql/pglite"],
};

export default nextConfig;
