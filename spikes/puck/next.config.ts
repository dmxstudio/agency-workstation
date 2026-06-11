import type { NextConfig } from "next";
import { withPayload } from "@payloadcms/next/withPayload";

const nextConfig: NextConfig = {
  // The spike lives inside the platform repo; pin the workspace root so
  // Turbopack does not adopt the parent lockfile (and the platform's src/).
  turbopack: { root: __dirname },
};

export default withPayload(nextConfig);
