/**
 * 录 envelope 序列，存成 fixture 给 vitest 回放（T1.4 方案 §7 ①）。
 *
 *   EMJ_DEV=1 .venv/bin/uvicorn main:app --app-dir server   # 先起后端
 *   cd web && node scripts/record-fixtures.mjs
 *
 * 为什么要录而不是直接连服务端跑测试：我们的引擎是 Python，只能过 HTTP，还得先起
 * uvicorn；`npm test`（vitest，node 环境）拿不到。录成 JSON 之后单测自包含、秒级、可 CI。
 *
 * **fixture 只存 envelope。玩家的本地操作（拖动重排、白搭赋值）由测试自己合成**——
 * 那些按 D3 是纯本地、不上报服务端的，envelope 里没有任何痕迹。
 */

import { writeFileSync, mkdirSync } from "node:fs";

const BASE = process.env.EMJ_API ?? "http://localhost:8000";
const OUT = new URL("../src/table3d/__fixtures__/", import.meta.url);

let playerId = null;

async function api(path, init = {}) {
  const headers = { "content-type": "application/json", ...(init.headers ?? {}) };
  if (playerId) headers["X-Player-Id"] = playerId;
  const r = await fetch(BASE + path, { ...init, headers });
  if (!r.ok) throw new Error(`${init.method ?? "GET"} ${path} → ${r.status} ${await r.text()}`);
  return r.json();
}

/** 只保留对账层要读的字段，fixture 才不会大得没法看 */
function slim(env) {
  const s = env.state;
  return {
    state: {
      wallLeft: s.wallLeft,
      turn: s.turn,
      discards: s.discards,
      discardSeats: s.discardSeats,
      finished: s.finished,
      exhausted: s.exhausted,
      me: {
        seat: s.me.seat,
        hand: s.me.hand,
        groups: s.me.groups,
        loose: s.me.loose,
        drawn: s.me.drawn,
        melds: s.me.melds,
        won: s.me.won,
        concealed: s.me.concealed,
      },
      others: s.others.map((o) => ({
        seat: o.seat,
        handCount: o.handCount,
        melds: o.melds,
        won: o.won,
        concealed: o.concealed,
      })),
    },
    pending: env.pending ? { kind: env.pending.kind, tile: env.pending.tile } : null,
    matchFinished: env.matchFinished ?? false,
  };
}

/** 一个只会打牌和过的笨玩家。目标是把局面推下去，不是打得好 */
function nextAction(env) {
  const p = env.pending;
  if (!p) return null;
  if (p.kind === "discard") {
    const loose = env.state.me.loose;
    // 白搭不能打出（RULES §1.1），除非散牌区只剩它
    const tile = loose.find((t) => t !== "1" && t !== "2") ?? loose[0];
    return { kind: "discard", tile };
  }
  return { kind: "pass" };
}

async function recordOne(seed, config) {
  const steps = [];
  let env = await api("/api/matches", { method: "POST", body: JSON.stringify(config) });
  const matchId = env.matchId;
  steps.push(slim(env));

  for (let i = 0; i < 400; i++) {
    const action = nextAction(env);
    if (!action) {
      if (env.matchFinished) break;
      // 这一局结束了但整场没完，开下一局——换局是 A 层最该被考验的时刻
      env = await api(`/api/matches/${matchId}/games`, { method: "POST" });
      steps.push(slim(env));
      continue;
    }
    env = await api(`/api/matches/${matchId}/action`, {
      method: "POST",
      body: JSON.stringify(action),
    });
    steps.push(slim(env));
  }
  return { seed, config, steps };
}

const CONFIGS = [
  { name: "default", body: { tier: "junior", maxGames: 2 } },
  { name: "long", body: { tier: "junior", maxGames: 2, minWordLen: 3, minWinWordLen: 6 } },
];

mkdirSync(OUT, { recursive: true });
const games = [];
for (const c of CONFIGS) {
  playerId = (await api("/api/players", { method: "POST" })).playerId;
  const rec = await recordOne(c.name, c.body);
  games.push({ name: c.name, ...rec });
  console.log(`${c.name}: ${rec.steps.length} 步`);
}
const file = new URL("envelopes.json", OUT);
writeFileSync(file, JSON.stringify({ recordedAt: new Date().toISOString(), games }, null, 1));
console.log("写出", file.pathname);
