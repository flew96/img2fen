// Stockfish in a Web Worker, speaking UCI.
//
// analyze(fen) can be called as often as the position changes: a running
// search is stopped first, and its late "info" lines are ignored.

export class Engine {
  constructor(url, { multiPv = 3, depth = 22, onUpdate = () => {} } = {}) {
    this.depth = depth;
    this.onUpdate = onUpdate;
    this.ready = false;
    this.searching = false;
    this.current = null; // fen being searched
    this.wanted = null;  // fen to search next
    this.lines = [];
    this.worker = new Worker(url);
    this.worker.onmessage = (e) => this.receive(String(e.data));
    this.worker.onerror = (e) => this.onUpdate({ error: e.message || "engine failed to load" });
    this.send("uci");
    this.send(`setoption name MultiPV value ${multiPv}`);
    this.send("isready");
  }

  send(cmd) { this.worker.postMessage(cmd); }

  analyze(fen) {
    this.wanted = fen;
    if (!this.ready) return;
    if (this.searching) this.send("stop"); // the search restarts on "bestmove"
    else this.start();
  }

  stop() {
    this.wanted = null;
    if (this.searching) this.send("stop");
  }

  start() {
    this.current = this.wanted;
    this.wanted = null;
    this.lines = [];
    this.searching = true;
    this.send("position fen " + this.current);
    this.send(`go depth ${this.depth}`);
  }

  receive(line) {
    if (line === "readyok") {
      this.ready = true;
      if (this.wanted) this.start();
    } else if (line.startsWith("bestmove")) {
      this.searching = false;
      if (this.wanted) this.start();
      else this.onUpdate({ fen: this.current, lines: this.lines, done: true, none: line.includes("(none)") });
    } else if (line.startsWith("info") && this.searching && !this.wanted) {
      const info = parseInfo(line);
      if (!info) return;
      this.lines[info.multipv - 1] = info;
      this.onUpdate({ fen: this.current, lines: this.lines.filter(Boolean), done: false });
    }
  }
}

function parseInfo(line) {
  // "info depth 18 seldepth 25 multipv 1 score cp 34 nodes ... pv e2e4 e7e5 ..."
  const t = line.split(" ");
  const at = (key) => t.indexOf(key);
  if (at("pv") < 0 || at("score") < 0 || t.includes("lowerbound") || t.includes("upperbound")) return null;
  const kind = t[at("score") + 1];
  const value = Number(t[at("score") + 2]);
  return {
    depth: Number(t[at("depth") + 1]),
    multipv: at("multipv") >= 0 ? Number(t[at("multipv") + 1]) : 1,
    cp: kind === "cp" ? value : null,
    mate: kind === "mate" ? value : null,
    pv: t.slice(at("pv") + 1),
  };
}
