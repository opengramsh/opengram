import { createMDX } from "fumadocs-mdx/next";

const isProd = process.env.NODE_ENV === "production";

const config = {
  reactStrictMode: true,
  assetPrefix: isProd ? "https://docs.opengram.sh" : undefined,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex" }],
      },
    ];
  },
};

const withMDX = createMDX();
export default withMDX(config);
