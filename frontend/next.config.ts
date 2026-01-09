import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      {
        source: "/studio",
        destination: "https://cooly.sanity.studio",
        permanent: false,
      },
      {
        source: "/studio/:path*",
        destination: "https://cooly.sanity.studio/:path*",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
