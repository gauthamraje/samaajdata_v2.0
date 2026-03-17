import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: false, // avoids double-mount so Leaflet map container is only initialized once
};

export default nextConfig;
