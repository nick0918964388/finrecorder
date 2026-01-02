import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Enable standalone output for Docker deployment
  output: "standalone",

  // Allow dev access from local network IPs
  allowedDevOrigins: [
    "http://192.168.1.214:3000",
    "https://finrecorder.nickai.cc",
  ],

  // Optimize images
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "lh3.googleusercontent.com",
      },
    ],
  },

  // Experimental features
  experimental: {
    // Enable server actions optimization
    serverActions: {
      bodySizeLimit: "2mb",
    },
  },
};

export default nextConfig;
