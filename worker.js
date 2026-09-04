/**
 * Cloudflare entry point. The interactive demo is entirely client-side and is
 * served from public/; live MCP OAuth continues to run in the Node service.
 */
export default {
  async fetch(request, env) {
    return env.ASSETS.fetch(request);
  },
};
