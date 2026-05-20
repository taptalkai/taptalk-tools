import { env } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/react-router";
import handler from "@tanstack/react-start/server-entry";

import { addBaseHref, handleTicTacToeMCPRequest } from "@/lib/tictactoe-mcp";

export const Route = createFileRoute("/tictactoe")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => handleTicTacToeMCPRequest(request, env, renderUIHTML),
      GET: async ({ request }) => handleTicTacToeMCPRequest(request, env, renderUIHTML),
      POST: async ({ request }) => handleTicTacToeMCPRequest(request, env, renderUIHTML),
      DELETE: async ({ request }) => handleTicTacToeMCPRequest(request, env, renderUIHTML),
    },
  },
});

async function renderUIHTML(request: Request) {
  const uiURL = new URL(request.url);
  uiURL.pathname = "/tictactoe/ui";
  uiURL.search = "";
  uiURL.hash = "";

  // In production, a Worker cannot reliably fetch its own custom domain from
  // inside the same request. Calling TanStack's server entry directly keeps the
  // demo's public behavior identical to "fetch the normal React page" without
  // going back out through Cloudflare's edge.
  const response = await handler.fetch(new Request(uiURL, {
    headers: { accept: "text/html" },
  }), {
    context: {
      cloudflare: { env },
    },
  });
  if (!response.ok) {
    throw new Error(`Could not load TicTacToe UI HTML: ${response.status}`);
  }
  return addBaseHref(await response.text(), uiURL.origin, uiURL.href);
}
