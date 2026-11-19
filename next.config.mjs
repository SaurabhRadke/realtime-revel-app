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
};

export default nextConfig;
