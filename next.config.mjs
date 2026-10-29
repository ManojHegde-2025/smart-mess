const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  {
    key: "Permissions-Policy",
    value: "camera=(self), microphone=(), geolocation=()",
  },
];
export default {
  poweredByHeader: false,
  experimental: { cpus: 2 },
  outputFileTracingIncludes: {
    "/api/**/*": ["./services/ml/data/synthetic_meal_history.csv"],
  },
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};
