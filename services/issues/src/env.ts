const DEV_ENVIRONMENTS = new Set(["development", "test"]);

export const isProduction =
  !DEV_ENVIRONMENTS.has(process.env.NODE_ENV ?? "");
