/** @type {import('next').NextConfig} */
const nextConfig = {
  // Next.js 16: These are now top-level keys
  serverExternalPackages: ["sharp", "@google/gemini-cli-core"],

  // We add an empty turbopack object to silence the error,
  // but we will run the dev server with the --webpack flag
  // to ensure our binary dependencies load correctly.
  turbopack: {},

  webpack: (config, { isServer }) => {
    config.externals.push({
      "utf-8-validate": "commonjs utf-8-validate",
      "bufferutil": "commonjs bufferutil",
    });
    // Force a single registry module instance so API routes share the same registry (avoids "setModel is not a function")
    if (isServer) {
      config.optimization = config.optimization || {};
      config.optimization.splitChunks = {
        ...config.optimization.splitChunks,
        cacheGroups: {
          ...config.optimization.splitChunks?.cacheGroups,
          registry: {
            test: /[\\/]lib[\\/]registry\.(ts|js)/,
            name: "registry",
            chunks: "all",
            enforce: true,
          },
        },
      };
    }
    return config;
  },
};

export default nextConfig;