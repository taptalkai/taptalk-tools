import { createFileRoute } from "@tanstack/react-router";
import { App } from "@modelcontextprotocol/ext-apps";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/tictactoe/ui")({
  component: TicTacToeUI,
});

type Player = "X" | "O";
type Cell = Player | "";

type TicTacToeGame = {
  game_id: string;
  board: Cell[];
  current_player: Player;
  status: "playing" | "won" | "draw";
  winner: Player | null;
  legal_moves: number[];
};

type ToolResult = {
  structuredContent?: {
    game?: TicTacToeGame;
  };
};

// `App` speaks the MCP Apps postMessage protocol with the parent host.
const app = new App(
  { name: "TicTacToe", version: "1.0.0" },
  {},
  // autoResize tells hosts like TapTalk to fit the native container to the UI.
  { autoResize: true },
);

function TicTacToeUI() {
  const [game, setGame] = useState<TicTacToeGame | null>(null);
  const [pendingSquare, setPendingSquare] = useState<number | null>(null);

  useEffect(() => {
    let isMounted = true;

    // Hosts deliver the opening `new_game` result here, plus any later tool
    // results they choose to forward to the UI.
    app.ontoolresult = (result) => {
      if (!isMounted) return;
      applyToolResult(result as ToolResult, setGame);
    };
    app.onerror = console.warn;

    app.connect()
      .catch((error) => console.warn(error instanceof Error ? error.message : String(error)));

    return () => {
      isMounted = false;
      app.close().catch(() => {});
    };
  }, []);

  const canMove = game?.status === "playing" && game.current_player === "X";
  const boardLabel = game ? boardText(game) : "---------";

  async function makeMove(square: number) {
    if (!game || !canMove || !game.legal_moves.includes(square)) return;
    setPendingSquare(square);
    try {
      // User taps become same-server MCP tool calls. `make_move` is marked as
      // app-visible on the server so the UI can call it directly.
      const result = await app.callServerTool({
        name: "make_move",
        arguments: {
          game_id: game.game_id,
          square,
        },
      });
      const nextGame = applyToolResult(result as ToolResult, setGame);
      if (nextGame) {
        // Keep the latest board in the model's passive context. This is useful
        // background state, but it should never block the active message below
        // that asks the agent to make O's move.
        app.updateModelContext({
          structuredContent: { game: nextGame },
          content: [{ type: "text", text: modelContextText(nextGame) }],
        }).catch((error) => console.warn(error instanceof Error ? error.message : String(error)));
      }
      if (nextGame?.status === "playing" && nextGame.current_player === "O") {
        // After the user moves, ask the host to start a model turn so the
        // agent can choose O's move and call `agent_move`.
        await app.sendMessage({
          role: "user",
          content: [{
            type: "text",
            text: `User played X at ${squareName(square)}. ${stateSummary(nextGame)} Call agent_move with game_id "${nextGame.game_id}" and the strongest move.`,
          }],
        });
      } else if (nextGame?.status === "won" || nextGame?.status === "draw") {
        // If the user's move ends the game, still start a model turn so the
        // agent can say what happened and offer a new game.
        await app.sendMessage({
          role: "user",
          content: [{
            type: "text",
            text: `User played X at ${squareName(square)}. ${gameOverText(nextGame)} Offer to start a new game.`,
          }],
        });
      }
    } catch (error) {
      console.warn(error instanceof Error ? error.message : String(error));
    } finally {
      setPendingSquare(null);
    }
  }

  return (
    <main className="tictactoe-ui" aria-label="TicTacToe UI">
      <div className="tictactoe-board" aria-label={`TicTacToe board ${boardLabel}`}>
        {Array.from({ length: 9 }, (_, index) => {
          const cell = game?.board[index] || "";
          const disabled = !canMove || !game?.legal_moves.includes(index) || pendingSquare !== null;
          return (
            <button
              key={index}
              type="button"
              className="tictactoe-cell"
              aria-label={cell ? `${cell} at ${squareName(index)}` : `Empty ${squareName(index)}`}
              disabled={disabled}
              onClick={() => makeMove(index)}
            >
              {pendingSquare === index ? "" : cell}
            </button>
          );
        })}
      </div>
    </main>
  );
}

function applyToolResult(result: ToolResult | undefined, setGame: (game: TicTacToeGame) => void) {
  // Tool results carry the exact board state in structuredContent; the text
  // content is mainly for the model.
  const nextGame = result?.structuredContent?.game;
  if (nextGame) {
    setGame(nextGame);
  }
  return nextGame;
}

function boardText(game: TicTacToeGame) {
  return game.board.map((cell) => cell || "-").join("");
}

function modelContextText(game: TicTacToeGame) {
  if (game.status !== "playing") {
    return gameOverText(game);
  }
  return `TicTacToe board ${boardText(game)}. ${game.current_player} to move.`;
}

function stateSummary(game: TicTacToeGame) {
  if (game.status !== "playing") {
    return gameOverText(game);
  }
  return `Board ${boardText(game)}. ${game.current_player} to move. Legal moves: ${game.legal_moves.join(", ")}.`;
}

function gameOverText(game: TicTacToeGame) {
  if (game.status === "draw") {
    return `Board ${boardText(game)}. The game ended in a draw.`;
  }
  return `Board ${boardText(game)}. ${game.winner} won.`;
}

function squareName(square: number) {
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
