import type { NextConfig } from "next";
import { resolve } from "node:path";
const nextConfig: NextConfig = { reactStrictMode: true, agentRules: false, turbopack: { root: resolve(__dirname, "../..") } };
export default nextConfig;
