/* eslint-disable */
declare namespace Cloudflare {
  interface Env {
    OAUTH_KV: KVNamespace;
    GITHUB_CLIENT_ID: string;
    GITHUB_CLIENT_SECRET: string;
    COOKIE_ENCRYPTION_KEY: string;
    ALLOWED_USERS: string;
    FLY_API_TOKEN: string;
    FLY_APP_NAME: string;
    MACHINE_API_KEY: string;
    MCP_OBJECT: DurableObjectNamespace<import("./src/index").ClaudeCodeMCP>;
  }
}
interface Env extends Cloudflare.Env {}
