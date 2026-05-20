# TicTacToe

This is a tiny MCP server built with TanStack Start, React, Cloudflare Workers, and database persistence. It exposes TicTacToe tools, and the `new_game` tool is linked to an MCP Apps UI resource.

The UI is a normal React route at `/tictactoe/ui`. The MCP server reads that route's rendered HTML and returns it from `resources/read` as `text/html;profile=mcp-app`, which is the shape MCP Apps hosts expect.

## Routes

- `/tictactoe` - MCP endpoint for the TicTacToe server.
- `/tictactoe/ui` - React-rendered MCP Apps UI.

Most of the MCP logic lives in `src/lib/tictactoe-mcp.ts`. The React UI lives in `src/routes/tictactoe/ui.tsx`.

## Local Development

```sh
npm install
npm run dev
```

## Deploying To Cloudflare

Create a database for persisted game state and paste the returned `database_id` into `wrangler.jsonc`:

```sh
npx wrangler login
npx wrangler d1 create tap-talk-tictactoe
npx wrangler d1 migrations apply tap-talk-tictactoe --remote
npm run build
npx wrangler deploy
```

If you want a custom domain, add a route or custom domain to `wrangler.jsonc` following Cloudflare's Workers docs.

## How It Works

1. TapTalk connects to `/tictactoe` as an MCP server.
2. The model calls `new_game`, which creates server-owned persisted game state and links to `ui://tap-talk/tictactoe.html`.
3. TapTalk calls `resources/read` for that URI.
4. The MCP server fetches `/tictactoe/ui`, receives normal TanStack HTML, adds a `<base>` tag for asset loading, and returns the HTML string inside the MCP JSON response.
5. The UI renders the board and calls app-visible MCP tools through the MCP Apps host protocol when the user taps a square.
