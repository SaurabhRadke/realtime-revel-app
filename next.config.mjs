import { lanAddresses } from "./server/net.mjs";

/** @type {import('next').NextConfig} */
const nextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  reactCompiler: true,
  // The phone loads the dev server through this machine's LAN IP, which Next
  // blocks for dev assets/HMR unless it is listed here.
  allowedDevOrigins: lanAddresses(),
  // The 3D models are ~25 MB in all and only change when the optimiser is
  // re-run: let browsers (and any CDN in front) keep them for a week instead
  // of re-downloading them on every visit. Cuts hosting egress a lot.
  async headers() {
    return [
      {
        source: "/models/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=604800, stale-while-revalidate=86400" }],
      },
    ];
  },
};

export default nextConfig;
