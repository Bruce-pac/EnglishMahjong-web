/**
 * T1.4 测试的公共件：fixture 读取、确定性随机、合成本地操作。
 *
 * ⚠️ **光回放 envelope 序列测不到不变式 3 和 4——而那是 T1.4 存在的全部理由。**
 * 玩家的拖动重排按 D3 是**纯本地、不上报服务端**的，envelope 里没有任何痕迹；
 * 白搭声明同理（§4.4 说服务端不知情）。只回放 envelope 的话散牌区永远是默认排布，
 * 「顺序不被打乱」这条根本没有被触发的机会。
 *
 * 所以回放时要在 envelope 步骤**之间注入合成的本地操作**：fixture 存 envelope 序列，
 * 本地操作由这里生成。
 */

import type { State } from "../api";
import fixtures from "./__fixtures__/envelopes.json";
import { declareWild, moveLoose, type LooseSlots } from "./loose-reconcile";

export interface FixtureStep {
  state: State;
  pending: { kind: string; tile: string | null } | null;
  matchFinished: boolean;
}

export interface FixtureGame {
  name: string;
  steps: FixtureStep[];
}

export function fixtureGames(): FixtureGame[] {
  return (fixtures as unknown as { games: FixtureGame[] }).games;
}

/** 确定性 LCG。测试要能复现，不能用 Math.random */
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

const VOWELS = "aeiou";
const CONSONANTS = "bcdfghjklmnpqrstvwxyz";

/**
 * 合成一批本地操作：随机拖动重排 + 给白搭赋值。
 *
 * 返回新的 slots。这两样都是纯本地状态，服务端永远看不到，所以下一次
 * `reconcileLoose` 必须自己把它们保住——这正是不变式 3 和 4 要验的。
 */
export function localOps(slots: LooseSlots, rand: () => number): LooseSlots {
  let next = slots;

  // 拖动重排：挑几对非空格子对调
  const filled = next.map((e, i) => (e ? i : -1)).filter((i) => i >= 0);
  const swaps = Math.min(3, filled.length >> 1);
  for (let k = 0; k < swaps; k++) {
    const a = filled[Math.floor(rand() * filled.length)];
    const b = Math.floor(rand() * next.length);
    next = moveLoose(next, a, b);
  }

  // 白搭赋值：随机挑一个还没声明的白搭，给它一个本类字母
  const wilds = next.filter((e): e is NonNullable<typeof e> => !!e && (e.tile === "1" || e.tile === "2"));
  for (const w of wilds) {
    if (rand() < 0.5) continue;
    const pool = w.tile === "1" ? VOWELS : CONSONANTS;
    next = declareWild(next, w.tileId, pool[Math.floor(rand() * pool.length)]);
  }
  return next;
}

/** 槽位下标 → tileId 的映射，用来比对「谁动了」 */
export function slotOf(slots: LooseSlots): Map<number, number> {
  const m = new Map<number, number>();
  slots.forEach((e, i) => {
    if (e) m.set(e.tileId, i);
  });
  return m;
}

/**
 * 不变式 3（T2.1 修订）：幸存的牌**只能往左让位，动了的牌必须是一个后缀**。
 *
 * 摸到的牌一律从右端加，右端满了就从右往里吃掉空隙给它让位，所以「槽位逐一不变」
 * 不再成立。但放宽到此为止——这三条仍然抓得住乱序、压实、局部挪动：
 *
 * 1. 没有牌往右跑
 * 2. 相对顺序不变
 * 3. **动了的牌构成一个后缀**：某张牌没动，它右边就不许有牌动
 *
 * 返回 null 表示通过，否则返回人话的失败原因。
 */
export function suffixShiftError(
  before: ReadonlyMap<number, number>,
  after: ReadonlyMap<number, number>,
): string | null {
  const survivors = [...after]
    .filter(([id]) => before.has(id))
    .map(([id, to]) => ({ id, from: before.get(id)!, to }))
    .sort((a, b) => a.from - b.from);

  let movedSeen = false;
  for (const s of survivors) {
    if (s.to > s.from) return `tileId ${s.id} 往右跑了（${s.from} → ${s.to}）`;
    if (s.to < s.from) movedSeen = true;
    else if (movedSeen) {
      return `tileId ${s.id} 在 ${s.from} 没动，但它右边有牌动了——动的必须是一个后缀`;
    }
  }
  for (let i = 1; i < survivors.length; i++) {
    if (survivors[i].to <= survivors[i - 1].to) {
      return `tileId ${survivors[i].id} 越过了左邻——相对顺序乱了`;
    }
  }
  return null;
}

/** tileId → 白搭声明，用来比对「声明有没有串位」 */
export function wildOf(slots: LooseSlots): Map<number, string | undefined> {
  const m = new Map<number, string | undefined>();
  for (const e of slots) if (e) m.set(e.tileId, e.wildLetter);
  return m;
}
