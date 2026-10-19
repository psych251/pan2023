/*
 * A small, self-contained Tetris used as the 5-minute distractor task (Pan & Rivers used
 * Tetris between the predictions and the criterial test). No libraries, no network.
 *
 *   const game = Tetris.start(canvasElement, { onTick })   // begins play immediately
 *   game.stop()  -> { lines, pieces, games, score, keypresses }
 *
 * Controls: left/right arrows move, up arrow rotates, down arrow drops faster, space drops.
 * When the stack reaches the top the board clears and a new game starts, so the task always
 * fills the full time; `games` counts how many boards were played.
 */
(function () {
  const COLS = 10, ROWS = 20;
  const SHAPES = {
    I: [[0, 1], [1, 1], [2, 1], [3, 1]],
    O: [[1, 0], [2, 0], [1, 1], [2, 1]],
    T: [[1, 0], [0, 1], [1, 1], [2, 1]],
    S: [[1, 0], [2, 0], [0, 1], [1, 1]],
    Z: [[0, 0], [1, 0], [1, 1], [2, 1]],
    J: [[0, 0], [0, 1], [1, 1], [2, 1]],
    L: [[2, 0], [0, 1], [1, 1], [2, 1]],
  };
  const COLORS = { I: "#3fa7c9", O: "#e0b83a", T: "#9a62c4", S: "#5aa85a", Z: "#d0574e", J: "#4a6fc4", L: "#e08a3a" };
  const KEYS = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", " ", "Spacebar"];

  function start(canvas, opts) {
    opts = opts || {};
    const ctx = canvas.getContext("2d");
    const cell = Math.floor(canvas.height / ROWS);
    const stats = { lines: 0, pieces: 0, games: 1, score: 0, keypresses: 0 };
    let board, piece, dropMs = 600, last = performance.now(), raf = null, stopped = false;

    function emptyBoard() { return Array.from({ length: ROWS }, () => Array(COLS).fill(null)); }
    function newPiece() {
      const names = Object.keys(SHAPES);
      const kind = names[Math.floor(Math.random() * names.length)];
      stats.pieces++;
      return { kind, cells: SHAPES[kind].map(([x, y]) => [x, y]), x: 3, y: 0 };
    }
    function fits(cells, x, y) {
      return cells.every(([cx, cy]) => {
        const bx = cx + x, by = cy + y;
        return bx >= 0 && bx < COLS && by < ROWS && (by < 0 || !board[by][bx]);
      });
    }
    function rotate(cells) {
      if (piece.kind === "O") return cells;
      // Rotate clockwise around the piece's third cell.
      const [px, py] = cells[2];
      return cells.map(([x, y]) => [px - (y - py), py + (x - px)]);
    }
    function lock() {
      piece.cells.forEach(([cx, cy]) => {
        const by = cy + piece.y;
        if (by >= 0) board[by][cx + piece.x] = piece.kind;
      });
      let cleared = 0;
      for (let r = ROWS - 1; r >= 0; r--) {
        if (board[r].every(Boolean)) { board.splice(r, 1); board.unshift(Array(COLS).fill(null)); cleared++; r++; }
      }
      stats.lines += cleared;
      stats.score += [0, 40, 100, 300, 1200][cleared];
      piece = newPiece();
      if (!fits(piece.cells, piece.x, piece.y)) { board = emptyBoard(); stats.games++; }
    }
    function step() {
      if (fits(piece.cells, piece.x, piece.y + 1)) piece.y++;
      else lock();
    }
    function draw() {
      ctx.fillStyle = "#1d2230";
      ctx.fillRect(0, 0, COLS * cell, ROWS * cell);
      const paint = (x, y, kind) => {
        ctx.fillStyle = COLORS[kind];
        ctx.fillRect(x * cell + 1, y * cell + 1, cell - 2, cell - 2);
      };
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (board[r][c]) paint(c, r, board[r][c]);
      piece.cells.forEach(([cx, cy]) => { if (cy + piece.y >= 0) paint(cx + piece.x, cy + piece.y, piece.kind); });
    }
    function onKey(e) {
      if (!KEYS.includes(e.key)) return;
      e.preventDefault(); // keep the arrow keys and space from scrolling the page
      stats.keypresses++;
      if (e.key === "ArrowLeft" && fits(piece.cells, piece.x - 1, piece.y)) piece.x--;
      else if (e.key === "ArrowRight" && fits(piece.cells, piece.x + 1, piece.y)) piece.x++;
      else if (e.key === "ArrowDown") step();
      else if (e.key === "ArrowUp") { const r = rotate(piece.cells); if (fits(r, piece.x, piece.y)) piece.cells = r; }
      else if (e.key === " " || e.key === "Spacebar") { while (fits(piece.cells, piece.x, piece.y + 1)) piece.y++; lock(); }
      draw();
    }
    function loop(now) {
      if (stopped) return;
      if (now - last > dropMs) { step(); last = now; }
      draw();
      if (opts.onTick) opts.onTick(stats);
      raf = requestAnimationFrame(loop);
    }

    board = emptyBoard();
    piece = newPiece();
    window.addEventListener("keydown", onKey);
    raf = requestAnimationFrame(loop);

    return {
      stats,
      stop() {
        stopped = true;
        if (raf) cancelAnimationFrame(raf);
        window.removeEventListener("keydown", onKey);
        return { ...stats };
      },
    };
  }

  window.Tetris = { start };
})();
