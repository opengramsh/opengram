import { createMDX } from "fumadocs-mdx/next";

const config = {
  reactStrictMode: true,
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
