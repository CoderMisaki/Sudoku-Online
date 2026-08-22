import path from 'path';
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    // Pin the project root so Next.js doesn't infer it from stray
    // lockfiles outside the repository (e.g. ~/package-lock.json).
    root: path.join(__dirname),
  },
};

export default nextConfig;
