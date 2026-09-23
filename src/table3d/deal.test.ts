/** P21：开局发牌动画的纯函数 */

import { describe, expect, it } from "vitest";
import type { Envelope, GameEvent, State } from "../api";
import recorded from "./__fixtures__/replay-envelopes.json";
import { DEAL_ROUNDS, dealerOfEvents, dealSteps, dealtState, HAND_SIZE, startStep, WALL_AFTER_DEAL } from "./deal";
import { TILE_COUNT } from "./layout";
import { rebuildLoose } from "./loose-reconcile";
import { wallChain } from "./placement";
import { replayDiff } from "./replay";

const games = (recorded as unknown as { games: Array<{ name: string; steps: Array<{ events: GameEvent[]; state: State }> }> }).games;
/** 录像里每一场的第一步就是开局 envelope（庄家是自己） */
const openings = games.map((g) => ({ name: g.name, env: { ...g.steps[0], matchId: "m", pending: null, result: null, matchFinished: false } as Envelope }));

/** AI 当庄的开局：下家摸牌、打牌，对家摸牌、打牌……轮到自己摸牌时停下 */
function aiDealerOpening(): Envelope {
  const base = openings[0].env;
  const st = structuredClone(base.state);
  // 自己这时是 13 张（还没摸），别家：下家摸 1 打 1 = 13，对家、上家同理
  const drew = base.events.find((e) => e.t === "draw" && e.seat === st.me.seat)!.tile!;
  st.me.hand.splice(st.me.hand.lastIndexOf(drew), 1);
  const events: GameEvent[] = [
    { t: "draw", seat: 1 },
    { t: "discard", seat: 1, tile: "q" },
    { t: "draw", seat: 2 },
    { t: "discard", seat: 2, tile: "z" },
    { t: "draw", seat: 3 },
    { t: "discard", seat: 3, tile: "x" },
    { t: "draw", seat: 0, tile: drew },
  ];
  st.me.hand.push(drew);
  st.wallLeft = WALL_AFTER_DEAL - 4;
  st.discards = ["q", "z", "x"];
  st.discardSeats = [1, 2, 3];
  for (const o of st.others) o.handCount = HAND_SIZE;
  return { ...base, events, state: st };
}

describe("发牌的轮次与墙位", () => {
  it("4 轮，每轮四家各 4/4/4/1 张，加起来每家 13 张", () => {
    expect(DEAL_ROUNDS).toEqual([4, 4, 4, 1]);
    expect(DEAL_ROUNDS.reduce((a, b) => a + b, 0)).toBe(HAND_SIZE);
    const { steps } = dealSteps(openings[0].env, 1);
    expect(steps).toHaveLength(4);
    steps.forEach((s, r) => expect(s.pinned.size).toBe(4 * DEAL_ROUNDS[r]));
    const last = steps[3].state;
    for (const o of last.others) expect(o.handCount).toBe(HAND_SIZE);
    expect(last.me.hand).toHaveLength(HAND_SIZE);
    expect(last.wallLeft).toBe(WALL_AFTER_DEAL);
  });

  it("第 k 张取自 wallChain()[k]；同一轮里按 庄家 → 下家 → 对家 → 上家 占用连续的墙位", () => {
    const chain = wallChain();
    for (const env of [openings[0].env, aiDealerOpening()]) {
      const dealer = dealerOfEvents(env);
      const { steps } = dealSteps(env, 1);
      let k = 0;
      steps.forEach((s, r) => {
        const sources = [...s.pinned.entries()];
        // Map 按插入顺序：先庄家那几张，再下家……
        for (let i = 0; i < 4; i++) {
          const seat = (dealer + i) % 4;
          for (let j = 0; j < DEAL_ROUNDS[r]; j++) {
            const [target, source] = sources[i * DEAL_ROUNDS[r] + j];
            expect(target.endsWith(`@${seat}`), `${target} 应属座位 ${seat}`).toBe(true);
            expect(source).toBe(chain[k++]);
          }
        }
      });
      expect(k).toBe(TILE_COUNT - WALL_AFTER_DEAL);
    }
  });

  it("每轮之后牌墙数跟着递减，别家已发的牌不挪格（从第 0 格往右逐轮加）", () => {
    const { steps } = dealSteps(openings[0].env, 1);
    let dealt = 0;
    steps.forEach((s, r) => {
      dealt += 4 * DEAL_ROUNDS[r];
      expect(s.state.wallLeft).toBe(TILE_COUNT - dealt);
      const had = DEAL_ROUNDS.slice(0, r).reduce((a, b) => a + b, 0);
      for (const target of s.pinned.keys()) {
        if (target.endsWith("@1")) expect(Number(target.split(".")[1].split("@")[0])).toBeGreaterThanOrEqual(had);
      }
    });
  });

  it("起点：牌墙满、四家空手", () => {
    const s = startStep(openings[0].env);
    expect(s.state.wallLeft).toBe(TILE_COUNT);
    expect(s.state.me.hand).toEqual([]);
    for (const o of s.state.others) expect(o.handCount).toBe(0);
    expect(s.loose.every((e) => e === null)).toBe(true);
  });
});

describe("自己的牌", () => {
  it("发完之后逐格等于 rebuildLoose(刚发完的自己)，tileId 也一样", () => {
    for (const { env } of openings) {
      const { steps, final, nextTileId } = dealSteps(env, 7);
      const want = rebuildLoose({ hand: dealtState(env).me.hand, groups: [] }, 7);
      expect(final).toEqual(want.slots);
      expect(steps[3].loose).toEqual(want.slots);
      expect(nextTileId).toBe(want.nextTileId);
    }
  });

  it("逐轮露出最终格子里从左往右的前 4 / 8 / 12 / 13 张，已露出的不挪", () => {
    const { steps, final } = dealSteps(openings[0].env, 1);
    const filled = final.flatMap((e, i) => (e ? [i] : []));
    [4, 8, 12, 13].forEach((n, r) => {
      const shown = steps[r].loose.flatMap((e, i) => (e ? [i] : []));
      expect(shown).toEqual(filled.slice(0, n));
      for (const i of shown) expect(steps[r].loose[i]).toBe(final[i]);
    });
  });
  it("每轮 pin 的自己那几张，目标正是这一轮新露出的格子（牌直接飞进最终的格子）", () => {
    for (const env of [openings[0].env, aiDealerOpening()]) {
      const me = env.state.me.seat;
      const { steps } = dealSteps(env, 1);
      steps.forEach((s, r) => {
        const before = new Set(r === 0 ? [] : steps[r - 1].loose.flatMap((e, i) => (e ? [i] : [])));
        const fresh = s.loose.flatMap((e, i) => (e && !before.has(i) ? [`loose.${i}@${me}`] : []));
        const mine = [...s.pinned.keys()].filter((t) => t.endsWith(`@${me}`));
        expect(mine.sort()).toEqual(fresh.sort());
      });
    }
  });
});

describe("推演不变式：刚发完的局面 + events ≡ envelope", () => {
  for (const { name, env } of openings) {
    it(`录像 ${name}（自己当庄）`, () => {
      expect(replayDiff(dealtState(env), env.events, env.state)).toBeNull();
    });
  }
  it("AI 当庄（合成的开局）", () => {
    const env = aiDealerOpening();
    expect(dealerOfEvents(env)).toBe(1);
    expect(replayDiff(dealtState(env), env.events, env.state)).toBeNull();
  });
});
