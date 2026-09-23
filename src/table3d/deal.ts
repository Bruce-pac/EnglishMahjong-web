/**
 * P21：开局发牌动画的纯函数部分。
 *
 * 真的发了一局新牌时（开新场、[下一局]），先从满墙空手演一遍发牌，再接着回放开局以来的事件。
 * 这里只算「每一轮之后桌上是什么样、这几张从哪几个墙位飞出来」，不碰 three.js、不碰计时。
 *
 * 发牌规则（用户 2026-09-23 定）：分 4 轮，每轮四家**同时**各抓一批——前三轮每家 4 张、第四轮每家 1 张，
 * 共 52 张。同一轮里按 庄家 → 下家 → 对家 → 上家 的顺序占用牌墙链上连续的几张。
 * 庄家的第 14 张不在发牌里：它就是 envelope 里第一个 `draw` 事件，发完照常回放。
 */

import type { Envelope, State } from "../api";
import { rebuildLoose, type LooseSlots } from "./loose-reconcile";
import { LOOSE_SLOTS, PLAYERS, TILE_COUNT } from "./layout";
import { wallChain } from "./placement";

/** `sim/rules.py:27` 的 `HAND_SIZE = 13`：每家起手张数（庄家的第 14 张走 draw 事件） */
export const HAND_SIZE = 13;
/** 每一轮每家抓几张。加起来必须是 HAND_SIZE */
export const DEAL_ROUNDS: readonly number[] = [4, 4, 4, 1];
/** 发完之后牌墙还剩几张：`sim/rules.py:25` 的 `DECK_SIZE`（108，即 TILE_COUNT）减去四家起手 */
export const WALL_AFTER_DEAL = TILE_COUNT - PLAYERS * HAND_SIZE;

/** 庄家座位：开局 envelope 的第一个 `draw` 就是庄家摸的（verify-reconcile 核对过这条推论） */
export function dealerOfEvents(env: Envelope): number {
  return env.events.find((e) => e.t === "draw")?.seat ?? 0;
}

/**
 * 「刚发完」的局面：四家各 13 张、牌墙 WALL_AFTER_DEAL、牌河与亮词区空。
 *
 * **自己的手牌 = 最终手牌减去 events 里自己 draw 带的牌**（从后往前各减一张同字母的，保住顺序）。
 * 必须满足推演不变式 `fold(dealtState, env.events) ≡ env.state`——这样发完之后接着回放，
 * 最后一步对齐真值时不会跳
 */
export function dealtState(env: Envelope): State {
  const s = structuredClone(env.state);
  const hand = [...s.me.hand];
  for (const e of env.events) {
    if (e.t !== "draw" || e.seat !== s.me.seat || !e.tile) continue;
    const at = hand.lastIndexOf(e.tile);
    if (at >= 0) hand.splice(at, 1);
  }
  s.me.hand = hand;
  s.me.groups = [];
  s.me.melds = [];
  s.me.won = false;
  s.me.winOrder = null;
  s.me.concealed = [];
  for (const o of s.others) {
    o.handCount = HAND_SIZE;
    o.melds = [];
    o.won = false;
    o.winOrder = null;
    o.concealed = [];
  }
  s.wallLeft = WALL_AFTER_DEAL;
  s.discards = [];
  s.discardSeats = [];
  return s;
}

/** 发牌的一轮：这一轮之后的局面、自己散牌区露出了哪些格、这几张从哪几个墙位飞出来 */
export interface DealStep {
  state: State;
  /** 自己的散牌区：最终那份 LooseSlots 里从左往右露出前 n 张，其余格子是空的 */
  loose: LooseSlots;
  /** 目标槽位 → 来源墙位（自己的也 pin：自己的牌面编号和牌墙的哑值不同，不 pin 的话 C 层会随便配一个实例） */
  pinned: Map<string, string>;
}

/**
 * 算出发牌的每一轮，外加发完之后自己散牌区的完整摆法（与 `rebuildLoose(发完的自己)` 逐格相同）。
 *
 * 自己的牌**直接落进最终的格子**：不能一轮轮走 reconcileLoose / addAtRight——
 * 第一批 4 张会被居中，后面的从右端追加，最后整排就不居中了。
 */
export function dealSteps(env: Envelope, nextTileId: number): { steps: DealStep[]; final: LooseSlots; nextTileId: number } {
  const dealt = dealtState(env);
  const mySeat = dealt.me.seat;
  const built = rebuildLoose({ hand: dealt.me.hand, groups: [] }, nextTileId);
  /** 最终的格子里，从左往右第 i 张在哪一格 */
  const filled = built.slots.reduce<number[]>((a, e, i) => (e ? (a.push(i), a) : a), []);
  const chain = wallChain();
  const dealer = dealerOfEvents(env);
  const order = Array.from({ length: PLAYERS }, (_, i) => (dealer + i) % PLAYERS);

  const got = new Map<number, number>(order.map((s) => [s, 0]));
  let k = 0;
  const steps: DealStep[] = [];
  for (const n of DEAL_ROUNDS) {
    const pinned = new Map<string, string>();
    for (const seat of order) {
      const have = got.get(seat)!;
      for (let i = 0; i < n; i++) {
        const target = seat === mySeat ? `loose.${filled[have + i]}@${seat}` : `loose.${have + i}@${seat}`;
        pinned.set(target, chain[k++]);
      }
      got.set(seat, have + n);
    }
    const state = structuredClone(dealt);
    state.wallLeft = TILE_COUNT - k;
    for (const o of state.others) o.handCount = got.get(o.seat)!;
    const shown = got.get(mySeat)!;
    state.me.hand = dealt.me.hand.slice(0, shown);
    const loose: LooseSlots = new Array(LOOSE_SLOTS).fill(null);
    for (let i = 0; i < shown; i++) loose[filled[i]] = built.slots[filled[i]];
    steps.push({ state, loose, pinned });
  }
  return { steps, final: built.slots, nextTileId: built.nextTileId };
}

/** 发牌前的起点：牌墙满 108 张、四家空手、牌河与亮词区空 */
export function startStep(env: Envelope): DealStep {
  const state = structuredClone(dealtState(env));
  state.wallLeft = TILE_COUNT;
  state.me.hand = [];
  for (const o of state.others) o.handCount = 0;
  return { state, loose: new Array(LOOSE_SLOTS).fill(null), pinned: new Map() };
}
