/**
 * 录一份带 events 的 envelope 序列，给 `replay.test.ts` 的推演不变式用。
 *
 *   cd web && node scripts/record-replay-fixture.mjs [局数]
 *
 * 原来的 `envelopes.json` 只存 state、不存 events，推演不变式用不上。
 * 真人一律「打第一张散牌 / 过」，跟 verify-reconcile.mjs 一样
 */
import { writeFileSync } from "node:fs";

const BASE = process.env.EMJ_API ?? "http://localhost:8000";
const GAMES = Number(process.argv[2] ?? 3);
const H = { "content-type": "application/json" };
const api = async (path, body) => {
  const r = await fetch(BASE + path, { method: body ? "POST" : "GET", headers: H, body: body && JSON.stringify(body) });
  if (!r.ok) throw new Error(`${path} → ${r.status} ${await r.text()}`);
  return r.json();
};
H["X-Player-Id"] = (await api("/api/players", {})).playerId;

const games = [];
const configs = [
  { tier: "junior", maxGames: 1, bloody: true },
  { tier: "junior", maxGames: 1, bloody: true, minWordLen: 3 },
  { tier: "cet4", maxGames: 1, bloody: true, minWordLen: 4 },
];
for (let g = 0; g < GAMES; g++) {
  let env = await api("/api/matches", configs[g % configs.length]);
  const steps = [{ events: env.events, state: env.state }];
  while (env.pending) {
    const body =
      env.pending.kind === "discard" || env.pending.kind === "reveal"
        ? { kind: "discard", tile: env.state.me.loose.find((t) => t !== "1" && t !== "2") ?? env.state.me.hand[0] }
        : { kind: "pass" };
    env = await api(`/api/matches/${env.matchId}/action`, body);
    steps.push({ events: env.events, state: env.state });
  }
  games.push({ name: `replay-${g}`, steps });
  console.log(`第 ${g + 1} 局：${steps.length} 步`);
}
writeFileSync(new URL("../src/table3d/__fixtures__/replay-envelopes.json", import.meta.url), JSON.stringify({ games }));
