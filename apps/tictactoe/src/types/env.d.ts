export type CloudflareEnv = {
  DB: D1Database;
  ASSETS: Fetcher;
};

declare global {
  type Env = CloudflareEnv;
  const process: {
    env: Record<string, string | undefined>;
  };
}

declare module "cloudflare:workers" {
  namespace Cloudflare {
    interface Env extends CloudflareEnv {}
  }
}
