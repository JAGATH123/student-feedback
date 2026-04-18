/** @type {import('next').NextConfig} */

const BACKEND = process.env.BACKEND_URL || "http://localhost:8000";

const nextConfig = {
  output: "standalone",
  async rewrites() {
    return [
      { source: "/auth/:path*",       destination: `${BACKEND}/auth/:path*`       },
      { source: "/api/:path*",        destination: `${BACKEND}/api/:path*`        },
      { source: "/workshops/:path*",  destination: `${BACKEND}/workshops/:path*`  },
      { source: "/workshops",         destination: `${BACKEND}/workshops`         },
      { source: "/sessions/:path*",   destination: `${BACKEND}/sessions/:path*`   },
      { source: "/sessions",          destination: `${BACKEND}/sessions`          },
      { source: "/feed/:path*",       destination: `${BACKEND}/feed/:path*`       },
      { source: "/feed",              destination: `${BACKEND}/feed`              },
      { source: "/health",            destination: `${BACKEND}/health`            },
    ];
  },
};

module.exports = nextConfig;
