/**
 * T1.4 在线长跑（方案 §7 ②）。**不进 `npm test`**——它要活服务端。
 *
 *   EMJ_DEV=1 .venv/bin/uvicorn main:app --app-dir server
 *   cd web && npx vite-node scripts/verify-reconcile.mjs [局数]
 *
 * 走 vite-node 而不是裸 node：对账层的 import 是不带扩展名的（Vite / tsc 的
 * bundler 解析），裸 node 的 ESM 解析器认不了。
 *
 * 对着真引擎跑数百局，每一步都注入合成的本地操作，断言方案 §7 的五条不变式。
 * fixture 回放只有两局、是录死的；这里跑的是新牌局，覆盖 fixture 撞不到的局面
 * （长词补摸、连续吃牌、荒牌、血战到底里陆续有人胡）。
 */

const BASE = process.env.EMJ_API ?? "http://localhost:8000";
/** 要跑多少**局**（不是多少场）。一场最多 16 局，服务端限流 10 场 / 60 秒 */
const GAMES = Number(process.argv[2] ?? 200);
const MAX_GAMES_PER_MATCH = 16;

const m = await import("../src/table3d/loose-reconcile.ts");
const p = await import("../src/table3d/placement.ts");
const a = await import("../src/table3d/thing-assign.ts");
// 不变式 3 的判定与单元测试共用同一份，不在脚本里另写一套——
// T2.1 改过一次规则（摸牌从右端加、右端满了从右往里挤空隙），两处各写一份就是这样漏掉的
const { suffixShiftError } = await import("../src/table3d/test-helpers.ts");
// T5.1 推演不变式：fold(上一步 state, events) ≡ 这一步 state。判定与单测共用 replayDiff
const { replayDiff, stepState } = await import("../src/table3d/replay.ts");
// T2.2：envelope 没有庄家字段，盘上的 East 靠「庄家 = gameIndexOf % 4」推出来。
// 开新局的 envelope 带从开局起的全部事件，第一个 draw 就是庄家摸的——拿它核对这条推论
// 核对的是盘面实际用的 dealerOf，不是另写一遍公式——否则 dealerOf 被改坏了这里抓不到
const { gameIndexOf } = await import("../src/table3d/table-view.ts");
const { dealerOf } = await import("../src/table3d/board-model.ts");
let dealerChecked = 0;
// P21：开局发牌动画的出发点「刚发完的局面」必须满足推演不变式——服务端改了发牌数、
// 或者 dealtState 扣自己摸牌算错了，这里当场报。每一局的开局都验（包括 AI 当庄的）
const { dealtState, WALL_AFTER_DEAL } = await import("../src/table3d/deal.ts");
let openingChecked = 0;
function checkOpening(env, where) {
  const bad = replayDiff(dealtState(env), env.events, env.state);
  if (bad) fail(`开局推演：${where} ${bad}\n  events=${JSON.stringify(env.events)}`);
  const wall = dealtState(env).wallLeft;
  if (wall !== WALL_AFTER_DEAL) fail(`开局推演：${where} 发完的牌墙 ${wall}，应为 ${WALL_AFTER_DEAL}`);
  openingChecked++;
}
function checkDealer(env, where) {
  const first = env.events.find((e) => e.t === "draw");
  if (!first) fail(`庄家推论：${where} 开局 envelope 里没有 draw 事件`);
  const want = dealerOf(env);
  if (first.seat !== want) fail(`庄家推论：${where} 第一个 draw 是座位 ${first.seat}，dealerOf = ${want}`);
  dealerChecked++;
}

const DECK_SIZE = 108;
let playerId = null;

async function api(path, init = {}) {
  const headers = { "content-type": "application/json" };
  if (playerId) headers["X-Player-Id"] = playerId;
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(BASE + path, { ...init, headers });
    if (r.ok) return r.json();
    // 开场限流是 10 场 / 60 秒（api.py:46）。长跑必然会撞上，等一会儿再来
    if (r.status === 429 && attempt < 20) {
      await new Promise((f) => setTimeout(f, 7000));
      continue;
    }
    throw new Error(`${path} → ${r.status} ${await r.text()}`);
  }
}

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 0x100000000);
}

const VOWELS = "aeiou";
const CONSONANTS = "bcdfghjklmnpqrstvwxyz";

function localOps(slots, rand) {
  let next = slots;
  const filled = next.map((e, i) => (e ? i : -1)).filter((i) => i >= 0);
  for (let k = 0; k < Math.min(3, filled.length >> 1); k++) {
    next = m.moveLoose(
      next,
      filled[Math.floor(rand() * filled.length)],
      Math.floor(rand() * next.length),
    );
  }
  // T3.2 的插入让位。非法落点返回 null，就当玩家松手后牌回了原位
  for (let k = 0; k < 2; k++) {
    const from = filled[Math.floor(rand() * filled.length)];
    next = m.insertLoose(next, from, Math.floor(rand() * next.length)) ?? next;
  }
  // T4.3 组暗词 + 收拢：随机挑连续一段（和框选一样），写上 key 再收拢
  const lo = Math.floor(rand() * next.length);
  const win = next.slice(lo, lo + 1 + Math.floor(rand() * 4)).filter(Boolean);
  if (win.length >= 2) {
    const ids = win.map((e) => e.tileId);
    const tiles = win.map((e) => e.tile).join("");
    next = m.compactGroup(m.markGroup(next, ids, m.groupKeyOf(tiles, tiles)), ids) ?? next;
  }
  // T4.3 整组拖动：有暗词就拖一个暗词，没有就拖刚才那一段。非法落点返回 null，等于整组回原位
  const inGroups = next.filter((e) => e && e.groupId !== undefined);
  const gid = inGroups.length ? inGroups[Math.floor(rand() * inGroups.length)].groupId : undefined;
  const members =
    gid !== undefined ? inGroups.filter((e) => e.groupId === gid).map((e) => e.tileId) : win.map((e) => e.tileId);
  if (members.length > 0) {
    const anchor = next.findIndex((e) => e && members.includes(e.tileId));
    next = m.moveGroupLoose(next, members, anchor, Math.floor(rand() * next.length)) ?? next;
  }
  for (const e of next.filter((x) => x && (x.tile === "1" || x.tile === "2"))) {
    if (rand() < 0.5) continue;
    const pool = e.tile === "1" ? VOWELS : CONSONANTS;
    next = m.declareWild(next, e.tileId, pool[Math.floor(rand() * pool.length)]);
  }
  return next;
}

const slotOf = (slots) => new Map(slots.flatMap((e, i) => (e ? [[e.tileId, i]] : [])));
const wildOf = (slots) => new Map(slots.flatMap((e) => (e ? [[e.tileId, e.wildLetter]] : [])));

let steps = 0;
/** W6「提前结算」：回放放到一半就跳到终局，模拟过几次 */
let jumped = 0;
/** 推演不变式验过几步（换局那一步不算：新一局的 events 从空桌开始，不接上一局的 state） */
let replayed = 0;
/** 推演过的事件按种类计数：没见过 chi / 点炮胡的话，那两条语义等于没验 */
const eventKinds = {};
const fail = (msg) => {
  console.error("✗", msg);
  process.exit(1);
};

const CONFIGS = [
  { tier: "junior", maxGames: MAX_GAMES_PER_MATCH },
  { tier: "junior", maxGames: MAX_GAMES_PER_MATCH, minWordLen: 3, minWinWordLen: 6 },
  { tier: "cet4", maxGames: MAX_GAMES_PER_MATCH, minWordLen: 4, minWinWordLen: 5 },
];

playerId = (await api("/api/players", { method: "POST" })).playerId;
let games = 0;

for (let round = 0; games < GAMES; round++) {
  const rand = rng(round * 7919 + 13);
  let env = await api("/api/matches", {
    method: "POST",
    body: JSON.stringify(CONFIGS[round % CONFIGS.length]),
  });
  const matchId = env.matchId;
  checkDealer(env, `场${round}第 1 局`);
  checkOpening(env, `场${round}第 1 局`);

  let r = m.rebuildLoose(env.state.me, 1);
  let lastSlotName = new Map();
  let lastType = new Map();
  const pool = Array.from({ length: DECK_SIZE }, (_, i) => i);

  for (let step = 0; step < 400; step++) {
    const state = env.state;

    const withLocal = localOps(r.slots, rand);
    const before = slotOf(withLocal);
    const wildBefore = wildOf(withLocal);
    r = m.reconcileLoose(state.me, withLocal, r.nextTileId);

    if (!r.rebuilt) {
      const bad = suffixShiftError(before, slotOf(r.slots));
      if (bad) fail(`不变式3：局${round}步${step} ${bad}`);
      for (const [id, w] of wildOf(r.slots)) {
        if (wildBefore.has(id) && w !== wildBefore.get(id))
          fail(`不变式4：局${round}步${step} tile ${id} 白搭声明串了`);
      }
    }

    const placements = p.layout(state, r.slots, { lowercase: step % 3 === 0 });
    if (placements.length > DECK_SIZE)
      fail(`池子撑爆：局${round}步${step} 摆了 ${placements.length} 张（上限 ${DECK_SIZE}）`);
    if (new Set(placements.map((x) => x.slotName)).size !== placements.length)
      fail(`槽位重名：局${round}步${step}`);
    for (const pl of placements) {
      if (!p.isValidFace(pl.typeIndex)) fail(`牌面越界：${pl.slotName} → ${pl.typeIndex}`);
      const group = pl.slotName.split(".")[0];
      const max = group === "loose" ? 1 : 0;
      if (pl.rotationIndex > max) fail(`rotationIndex 越界：${pl.slotName} → ${pl.rotationIndex}`);
    }

    const assign = a.assignThings(placements, lastSlotName, (i) => lastType.get(i) ?? -1, pool);
    if (new Set(assign).size !== assign.length) fail(`不变式1：局${round}步${step} 分配不是双射`);

    // 不变式 5：存档走一遍 JSON 再对账，结果必须逐格相同
    const revived = JSON.parse(JSON.stringify(r.slots));
    const again = m.reconcileLoose(state.me, revived, r.nextTileId);
    if (JSON.stringify(again.slots) !== JSON.stringify(r.slots))
      fail(`不变式5：局${round}步${step} 刷新后对不上`);

    lastSlotName = new Map(assign.map((t, i) => [t, placements[i].slotName]));
    lastType = new Map(assign.map((t, i) => [t, placements[i].typeIndex]));
    steps++;

    const pd = env.pending;
    if (!pd) {
      games++;
      if (env.matchFinished || games >= GAMES) break;
      env = await api(`/api/matches/${matchId}/games`, { method: "POST" });
      checkDealer(env, `场${round}第 ${gameIndexOf(env) + 1} 局`);
      checkOpening(env, `场${round}第 ${gameIndexOf(env) + 1} 局`);
      // 换局是 A 层最该被考验的时刻：整手牌全换，上一局的存档必须整体作废
      r = m.rebuildLoose(env.state.me, r.nextTileId);
      lastSlotName = new Map();
      lastType = new Map();
      continue;
    }
    const body =
      pd.kind === "discard"
        ? {
            kind: "discard",
            tile: state.me.loose.find((t) => t !== "1" && t !== "2") ?? state.me.loose[0],
          }
        : { kind: "pass" };
    env = await api(`/api/matches/${matchId}/action`, { method: "POST", body: JSON.stringify(body) });
    const bad = replayDiff(state, env.events, env.state);
    if (bad) fail(`推演不变式：局${round}步${step} ${bad}\n  events=${JSON.stringify(env.events)}`);
    replayed++;
    // W6「提前结算」：随机挑一半回包，照回放层那样推演到事件中途的某一步、对账一次，
    // 然后不再逐步推——下一轮循环开头直接对账到终局（和 Table3D 的 fastForward 出口一样）。
    // 两次对账都要满足不变式 3、4；终局那次在循环开头照常验全部五条
    if (env.events.length > 1 && rand() < 0.5) {
      const k = 1 + Math.floor(rand() * (env.events.length - 1));
      let mid = state;
      for (const e of env.events.slice(0, k)) mid = stepState(mid, e);
      const before = slotOf(r.slots);
      const wildBefore = wildOf(r.slots);
      const rm = m.reconcileLoose(mid.me, r.slots, r.nextTileId);
      if (!rm.rebuilt) {
        const bad3 = suffixShiftError(before, slotOf(rm.slots));
        if (bad3) fail(`提前结算（中途那一步）不变式3：局${round}步${step} ${bad3}`);
        for (const [id, w] of wildOf(rm.slots)) {
          if (wildBefore.has(id) && w !== wildBefore.get(id))
            fail(`提前结算（中途那一步）不变式4：局${round}步${step} tile ${id} 白搭声明串了`);
        }
      }
      r = rm;
      jumped++;
    }
    for (const e of env.events) {
      const k = e.t === "win" ? (e.selfDrawn ? "win(自摸)" : "win(点炮)") : e.t;
      eventKinds[k] = (eventKinds[k] ?? 0) + 1;
    }
  }
  console.log(`  第 ${round + 1} 场：累计 ${games}/${GAMES} 局、${steps} 步`);
}

console.log(`✓ ${games} 局 / ${steps} 步，五条不变式全部成立；推演不变式验了 ${replayed} 步`);
console.log(`  推演过的事件：${JSON.stringify(eventKinds)}`);
console.log(`  提前结算（推到事件中途再直接跳到终局）模拟了 ${jumped} 次`);
console.log(`  庄家推论（开局第一个 draw 的座位 = dealerOf）核对了 ${dealerChecked} 局`);
console.log(`  开局推演（刚发完的局面 + events ≡ envelope）验了 ${openingChecked} 局`);
