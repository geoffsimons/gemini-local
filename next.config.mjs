/** @type {import('next').NextConfig} */
const nextConfig = {
  // Next.js 16: These are now top-level keys
  serverExternalPackages: ["sharp", "@google/gemini-cli-core"],

  // We add an empty turbopack object to silence the error,
  // but we will run the dev server with the --webpack flag
  // to ensure our binary dependencies load correctly.
  turbopack: {},

  webpack: (config) => {
    config.externals.push({
      "utf-8-validate": "commonjs utf-8-validate",
      "bufferutil": "commonjs bufferutil",
    });
    return config;
  },
};

export default nextConfig;