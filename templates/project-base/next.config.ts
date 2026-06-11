import type { NextConfig } from "next";
import { withPayload } from "@payloadcms/next/withPayload";

const nextConfig: NextConfig = {
  // Generated projects may live inside another repo's tree (e.g. the platform
  // monorepo or .data/projects/<id>/). Pin the workspace root so Turbopack
  // never adopts a parent lockfile.
  turbopack: { root: __dirname },
};

export default withPayload(nextConfig);
