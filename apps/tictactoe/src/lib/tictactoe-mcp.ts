import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";

const TICTACTOE_RESOURCE_URI = "ui://tap-talk/tictactoe.html";
const PLAYER_X = "X";
const PLAYER_O = "O";
const EMPTY = "";

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
  "access-control-allow-headers": "content-type,mcp-session-id,last-event-id,mcp-protocol-version,authorization",
  "access-control-expose-headers": "mcp-session-id,mcp-protocol-version",
  "cache-control": "no-store",
};

type Player = typeof PLAYER_X | typeof PLAYER_O;
type Cell = Player | typeof EMPTY;
type GameStatus = "playing" | "won" | "draw";

export type TicTacToeGame = {
  game_id: string;
  board: Cell[];
  current_player: Player;
  status: GameStatus;
  winner: Player | null;
  legal_moves: number[];
  created_at: string;
  updated_at: string;
};

type StoredGameRow = {
  game_id: string;
  board_json: string;
  current_player: Player;
  status: GameStatus;
  winner: Player | null;
  created_at: string;
  updated_at: string;
};

type TicTacToeEnv = Pick<Env, "DB">;
type RenderUIHTML = (request: Request) => Promise<string>;

const boardIndexDescription =
  "Board square index, 0-8, ordered left-to-right and top-to-bottom. For example 0 is top left, 4 is center, and 8 is bottom right.";

export function createTicTacToeMCPServer(
  env: TicTacToeEnv,
  request: Request,
  renderUIHTML: RenderUIHTML,
  now: () => string = () => new Date().toISOString(),
) {
  const server = new McpServer({
    name: "tap-talk-tictactoe",
    title: "TapTalk TicTacToe",
    version: "0.1.0",
  });

  registerAppResource(
    server,
    TICTACTOE_RESOURCE_URI,
    TICTACTOE_RESOURCE_URI,
    {
      title: "TicTacToe UI",
      description: "A tiny MCP App for playing TicTacToe through MCP tools.",
      mimeType: RESOURCE_MIME_TYPE,
      _meta: {
        ui: { prefersBorder: false },
      },
    },
    async () => {
      // MCP resources/read returns the actual HTML string inside JSON. To keep
      // this UI feeling like a normal React app, we let TanStack render
      // the `/tictactoe/ui` route and then hand that finished HTML to the
      // MCP host.
      const html = await renderUIHTML(request);
      return {
        contents: [
          {
            uri: TICTACTOE_RESOURCE_URI,
            mimeType: RESOURCE_MIME_TYPE,
            text: html,
            _meta: {
              ui: { prefersBorder: false },
            },
          },
        ],
      };
    },
  );

  // The model calls this public tool. `_meta.ui.resourceUri` tells an MCP Apps
  // host that the tool result can be shown with the registered UI resource.
  registerAppTool(
    server,
    "new_game",
    {
      title: "New TicTacToe Game",
      description:
        "Start a new TicTacToe game and open the TicTacToe UI. The user is X and the agent is O. Tell the user to tap the board to make their move.",
      inputSchema: {},
      _meta: {
        ui: { resourceUri: TICTACTOE_RESOURCE_URI, visibility: ["model"] },
        // Optional TapTalk polish for showing this tool in menus. It is not
        // required for MCP Apps compatibility.
        "tapTalk/menu": {
          label: "TicTacToe",
          icon: "gamecontroller",
        },
      },
    },
    async () => {
      const game = await createGame(env.DB, now());
      return toolResult(game, "Started a new TicTacToe game. User is X, agent is O. X moves first. Ask the user to tap the square they want to play.");
    },
  );

  registerAppTool(
    server,
    "make_move",
    {
      title: "Make TicTacToe Move",
      description:
        "Apply the user's TicTacToe move as X. The user can tap a square in the UI or ask the agent to choose the square for them.",
      _meta: {
        ui: { resourceUri: TICTACTOE_RESOURCE_URI, visibility: ["model", "app"] },
      },
      inputSchema: {
        game_id: z.string().min(1).describe("Server-generated TicTacToe game id."),
        square: z.number().int().min(0).max(8).describe(boardIndexDescription),
      },
    },
    async ({ game_id, square }) => {
      const game = await applyMove(env.DB, game_id, square, PLAYER_X, now());
      return toolResult(game, `User placed X at ${squareLabel(square)}. ${stateSummary(game)}`);
    },
  );

  // The model calls this after the UI sends a message asking it to choose O's move.
  registerAppTool(
    server,
    "agent_move",
    {
      title: "Apply Agent TicTacToe Move",
      description:
        "Apply the agent's chosen TicTacToe move as O. Choose the strongest move.",
      _meta: {
        ui: { resourceUri: TICTACTOE_RESOURCE_URI, visibility: ["model"] },
      },
      inputSchema: {
        game_id: z.string().min(1).describe("Server-generated TicTacToe game id."),
        square: z.number().int().min(0).max(8).describe(boardIndexDescription),
      },
    },
    async ({ game_id, square }) => {
      const game = await applyMove(env.DB, game_id, square, PLAYER_O, now());
      return toolResult(game, `Agent placed O at ${squareLabel(square)}. ${stateSummary(game)}`);
    },
  );

  return server;
}

export async function handleTicTacToeMCPRequest(request: Request, env: TicTacToeEnv, renderUIHTML = fetchUIHTML) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  const server = createTicTacToeMCPServer(env, request, renderUIHTML);

  try {
    await server.connect(transport);
    const response = await transport.handleRequest(request);
    return withCORS(response);
  } catch (error) {
    console.error("TapTalk TicTacToe MCP request failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    return jsonRPCError(-32603, "Internal server error", null, 500);
  } finally {
    await server.close().catch(() => {});
    await transport.close().catch(() => {});
  }
}

export async function fetchUIHTML(request: Request) {
  const uiURL = new URL(request.url);
  uiURL.pathname = "/tictactoe/ui";
  uiURL.search = "";
  uiURL.hash = "";

  const response = await fetch(uiURL, {
    headers: { accept: "text/html" },
  });
  if (!response.ok) {
    throw new Error(`Could not load TicTacToe UI HTML: ${response.status}`);
  }
  return addBaseHref(await response.text(), uiURL.origin, uiURL.href);
}

export function addBaseHref(html: string, origin: string, documentURL?: string) {
  // MCP Apps hosts load this HTML from resources/read, so relative scripts and
  // styles need a real origin. A base tag lets a normal TanStack page keep its
  // generated asset links instead of inlining every JS and CSS file.
  const tags = [
    /<base\s/i.test(html) ? "" : `<base href="${origin}/" />`,
    documentURL && !/name=["']tap-talk-document-url["']/i.test(html)
      ? `<meta name="tap-talk-document-url" content="${documentURL}" />`
      : "",
  ].join("");
  if (!tags) return html;
  return html.replace(/<head([^>]*)>/i, `<head$1>${tags}`);
}

// This demo could keep game state in memory, but database persistence shows the
// more useful pattern: MCP tools own durable state while the UI stays thin.
async function createGame(db: D1Database, timestamp: string): Promise<TicTacToeGame> {
  const game: TicTacToeGame = {
    game_id: crypto.randomUUID(),
    board: Array<Cell>(9).fill(EMPTY),
    current_player: PLAYER_X,
    status: "playing",
    winner: null,
    legal_moves: [0, 1, 2, 3, 4, 5, 6, 7, 8],
    created_at: timestamp,
    updated_at: timestamp,
  };
  await db.prepare(
    `INSERT INTO tictactoe_games (game_id, board_json, current_player, status, winner, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(game.game_id, JSON.stringify(game.board), game.current_player, game.status, game.winner, game.created_at, game.updated_at)
    .run();
  return game;
}

async function requireGame(db: D1Database, gameID: string): Promise<TicTacToeGame> {
  const row = await db
    .prepare(
      `SELECT game_id, board_json, current_player, status, winner, created_at, updated_at
       FROM tictactoe_games
       WHERE game_id = ?`,
    )
    .bind(gameID)
    .first<StoredGameRow>();
  if (!row) {
    throw new Error("Game not found.");
  }
  return gameFromRow(row);
}

// Each move is a separate MCP tool call, so the server reloads the game by id,
// validates the move, and writes back the new authoritative state.
async function applyMove(db: D1Database, gameID: string, square: number, player: Player, timestamp: string): Promise<TicTacToeGame> {
  const game = await requireGame(db, gameID);
  validateMove(game, square, player);

  const board = [...game.board];
  board[square] = player;
  const status = statusForBoard(board);
  const nextGame: TicTacToeGame = {
    ...game,
    board,
    current_player: status.status === "playing" ? otherPlayer(player) : player,
    status: status.status,
    winner: status.winner,
    legal_moves: legalMoves(board),
    updated_at: timestamp,
  };

  await db
    .prepare(
      `UPDATE tictactoe_games
       SET board_json = ?, current_player = ?, status = ?, winner = ?, updated_at = ?
       WHERE game_id = ?`,
    )
    .bind(JSON.stringify(nextGame.board), nextGame.current_player, nextGame.status, nextGame.winner, nextGame.updated_at, nextGame.game_id)
    .run();
  return nextGame;
}

function validateMove(game: TicTacToeGame, square: number, player: Player) {
  if (game.status !== "playing") {
    throw new Error("Game is already over.");
  }
  if (game.current_player !== player) {
    throw new Error(`It is ${game.current_player}'s turn.`);
  }
  if (!Number.isInteger(square) || square < 0 || square > 8) {
    throw new Error("Square must be between 0 and 8.");
  }
  if (game.board[square] !== EMPTY) {
    throw new Error("Square is already taken.");
  }
}

function gameFromRow(row: StoredGameRow): TicTacToeGame {
  const board = JSON.parse(row.board_json) as Cell[];
  return {
    game_id: row.game_id,
    board,
    current_player: row.current_player,
    status: row.status,
    winner: row.winner,
    legal_moves: legalMoves(board),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function statusForBoard(board: Cell[]): { status: GameStatus; winner: Player | null } {
  const lines = [
    [0, 1, 2],
    [3, 4, 5],
    [6, 7, 8],
    [0, 3, 6],
    [1, 4, 7],
    [2, 5, 8],
    [0, 4, 8],
    [2, 4, 6],
  ];
  for (const [a, b, c] of lines) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return { status: "won", winner: board[a] };
    }
  }
  if (legalMoves(board).length === 0) {
    return { status: "draw", winner: null };
  }
  return { status: "playing", winner: null };
}

function legalMoves(board: Cell[]) {
  return board.flatMap((cell, index) => (cell === EMPTY ? [index] : []));
}

function otherPlayer(player: Player): Player {
  return player === PLAYER_X ? PLAYER_O : PLAYER_X;
}

function toolResult(game: TicTacToeGame, text: string) {
  // structuredContent gives the UI exact state; content gives the model a short
  // natural-language summary.
  return {
    content: [{ type: "text" as const, text }],
    structuredContent: {
      game,
    },
    isError: false,
  };
}

function stateSummary(game: TicTacToeGame) {
  const board = game.board.map((cell) => cell || "-").join("");
  if (game.status === "won") {
    return `Board ${board}. ${game.winner} won.`;
  }
  if (game.status === "draw") {
    return `Board ${board}. The game is a draw.`;
  }
  return `Board ${board}. ${game.current_player} to move. Legal moves: ${game.legal_moves.join(", ")}.`;
}

function squareLabel(square: number) {
  return [
    "top left",
    "top middle",
    "top right",
    "middle left",
    "center",
    "middle right",
    "bottom left",
    "bottom middle",
    "bottom right",
  ][square] ?? `square ${square}`;
}

function withCORS(response: Response) {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders)) {
    headers.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function jsonRPCError(code: number, message: string, id: unknown, status: number) {
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      error: { code, message },
      id,
    }),
    {
      status,
      headers: {
        ...corsHeaders,
        "content-type": "application/json",
      },
    },
  );
}
