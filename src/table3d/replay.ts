/**
 * T5.1：事件 → 局面。回放 AI 动作用的纯函数。
 *
 * 这是「事件的视觉语义」，不是规则（需求文档 §5.3）：能不能吃、是不是词、补几张，
 * 全都是事件里给定的，这里只照着事件把牌挪一挪。事件与局面的对应见 `engine.py`：
 *
 * | 事件 | 局面变化 |
 * |---|---|
 * | `draw{seat}` | 牌墙 −1、该家手牌 +1（只有自己的 draw 带 tile） |
 * | `discard{seat, tile}` | 该家手牌 −1、牌河末尾 +1 |
 * | `chi{seat, tile}` | 牌河弹出末张、该家手牌 +1（后面紧跟 reveal、discard） |
 * | `reveal{seat, tiles, word, draws}` | 手牌 −tiles、亮词 +1、补摸 draws 张（没有单独的 draw 事件） |
 * | `win{seat, tile, selfDrawn, …}` | 点炮：牌河弹出末张、手牌 +1；**自摸：那张已在 draw 里加过** |
 * | `exhausted` | 局面不变 |
 *
 * 自己补摸到什么只有最终 state 知道，这里不加——回放的最后一步用真正的 envelope 对齐。
 */

import type { GameEvent, State } from "../api";
import { DISCARD_COLS } from "./layout";
import { wallChain } from "./placement";

/**
 * 回放每一步的间隔。参照 Mahjong 项目的 `dwell = speed×200`（默认 speed 3 = 600ms）：
 * 牌 180ms 飞到位，剩下 ~400ms 静止，眼睛才跟得上「谁做了什么」。
 * 300ms 时补间几乎占满整步，桌上一直有牌在动，看不清发生了什么
 */
export const REPLAY_STEP_MS = 600;
/** 吃、亮词、胡这三种要停久一点：头上有气泡，词要读得完 */
export const REPLAY_SAY_STEP_MS = 1200;
/** 气泡停留多久（不含 0.3s 淡出）。同 Mahjong 项目的 say-ui */
export const SAY_MS = 1200;

/** 这一步回放完停多久 */
export function dwellOf(e: GameEvent): number {
  return sayOf(e) ? REPLAY_SAY_STEP_MS : REPLAY_STEP_MS;
}

/**
 * 这一步在该家头上冒什么气泡。只翻译事件里给定的内容（牌、单词），不判断任何规则。
 * 摸、打、荒牌不冒——摸打是常规动作，靠牌的移动就看得出来
 */
export function sayOf(e: GameEvent): string | null {
  const letter = (t?: string) => (t === "1" || t === "2" ? "★" : (t ?? "").toUpperCase());
  switch (e.t) {
    case "chi":
      return `吃 ${letter(e.tile)}`;
    case "reveal":
      return `亮 ${(e.word ?? "").toUpperCase()}`;
    case "win":
      return e.selfDrawn ? "自摸" : "胡";
    default:
      return null;
  }
}

function removeTiles(hand: string[], tiles: string): void {
  for (const t of tiles) {
    const at = hand.indexOf(t);
    if (at >= 0) hand.splice(at, 1);
  }
}

/** 把一个事件作用到局面上。不碰 pending、result、分数；入参不变 */
export function stepState(state: State, e: GameEvent): State {
  const s = structuredClone(state);
  const mine = e.seat === s.me.seat;
  const other = mine ? undefined : s.others.find((o) => o.seat === e.seat);
  /** 该家手牌 +n。自己的要知道是哪张（tiles），不知道就不加 */
  const gain = (n: number, tiles?: string) => {
    if (mine) {
      if (tiles) s.me.hand.push(...tiles);
    } else if (other) other.handCount += n;
  };

  switch (e.t) {
    case "draw":
      s.wallLeft -= 1;
      gain(1, e.tile);
      break;
    case "discard":
      if (mine) removeTiles(s.me.hand, e.tile ?? "");
      else if (other) other.handCount -= 1;
      s.discards.push(e.tile ?? "");
      s.discardSeats.push(e.seat!);
      break;
    case "chi":
      s.discards.pop();
      s.discardSeats.pop();
      gain(1, e.tile);
      break;
    case "reveal": {
      const tiles = e.tiles ?? "";
      const draws = e.draws ?? 0;
      if (mine) removeTiles(s.me.hand, tiles);
      else if (other) other.handCount -= tiles.length;
      (mine ? s.me : other)?.melds.push({ tiles, word: e.word ?? "" });
      s.wallLeft -= draws;
      gain(draws); // 自己补摸的牌未知，不加
      break;
    }
    case "win": {
      if (!e.selfDrawn) {
        s.discards.pop();
        s.discardSeats.pop();
        gain(1, e.tile);
      }
      const p = mine ? s.me : other;
      if (p) {
        p.won = true;
        p.winOrder = e.order ?? null;
        p.concealed = e.concealed ?? [];
      }
      break;
    }
    case "exhausted":
      break;
  }
  return s;
}

/** 把一批事件依次推一遍 */
export function foldEvents(state: State, events: readonly GameEvent[]): State {
  return events.reduce(stepState, state);
}

const sortedHand = (h: readonly string[]) => [...h].sort().join("");

/**
 * 推演不变式：`fold(上一步 state, events)` 与这一步的 state 逐项相同。
 *
 * 比 `wallLeft`、`discards`、`discardSeats`、别家 `handCount` / `melds` / `won` / `winOrder`，
 * 自己的 `hand` 按多重集比。**唯一的豁免**：这批事件里有自己的 reveal 且 `draws > 0`——
 * 补摸的牌只有最终 state 知道。返回 null 表示一致，否则返回第一处不一致
 */
export function replayDiff(prev: State, events: readonly GameEvent[], next: State): string | null {
  const got = foldEvents(prev, events);
  if (got.wallLeft !== next.wallLeft) return `wallLeft：推演 ${got.wallLeft}，实际 ${next.wallLeft}`;
  if (got.discards.join() !== next.discards.join()) return `discards：推演 ${got.discards.join("")}，实际 ${next.discards.join("")}`;
  if (got.discardSeats.join() !== next.discardSeats.join()) return `discardSeats：推演 ${got.discardSeats.join("")}，实际 ${next.discardSeats.join("")}`;
  for (const want of next.others) {
    const o = got.others.find((x) => x.seat === want.seat);
    if (!o) return `少了座位 ${want.seat}`;
    if (o.handCount !== want.handCount) return `座位 ${want.seat} handCount：推演 ${o.handCount}，实际 ${want.handCount}`;
    if (JSON.stringify(o.melds) !== JSON.stringify(want.melds)) return `座位 ${want.seat} melds 对不上`;
    if (o.won !== want.won || o.winOrder !== want.winOrder) return `座位 ${want.seat} won/winOrder 对不上`;
  }
  const myRevealDrew = events.some((e) => e.t === "reveal" && e.seat === prev.me.seat && (e.draws ?? 0) > 0);
  if (!myRevealDrew && sortedHand(got.me.hand) !== sortedHand(next.me.hand)) {
    return `自己的 hand：推演 ${sortedHand(got.me.hand)}，实际 ${sortedHand(next.me.hand)}`;
  }
  return null;
}

/**
 * 这一步的 pinned（T1.4 方案 §4.1）：目标槽位 → 来源槽位。
 *
 * 别家的背面牌彼此长得一样，三轮匹配分不出「是哪一张飞去了牌河」，由这里按事件指定。
 * `prev` 是事件之前的局面。**自己的牌走 A 层身份**，自己座位的散牌区不出现在这里。
 * 别家散牌区的摆法见 `layout()`：没胡的人从第 0 格起连续摆 handCount 张，最右那格是 handCount − 1
 */
export function pinnedFor(prev: State, e: GameEvent, ownSource?: string): Map<string, string> {
  const pinned = new Map<string, string>();
  const seat = e.seat;
  if (seat === undefined) return pinned;
  const mine = seat === prev.me.seat;
  const other = prev.others.find((o) => o.seat === seat);
  const handCount = other?.handCount ?? 0;
  const loose = (i: number) => `loose.${i}@${seat}`;
  const chain = wallChain();
  /** 牌墙上第 k 张被摸走的（k 从 0 数）：画出来的是后 wallLeft 项，摸的是最前面那张 */
  const wallAt = (k: number) => chain[chain.length - prev.wallLeft + k];
  const riverSlot = (s: State, k: number) => {
    const owner = s.discardSeats[k];
    const n = s.discardSeats.slice(0, k).filter((x) => x === owner).length;
    return `discard.${Math.floor(n / DISCARD_COLS)}.${n % DISCARD_COLS}@${owner}`;
  };
  const lastRiver = () => riverSlot(prev, prev.discardSeats.length - 1);

  switch (e.t) {
    case "draw":
      if (!mine && wallAt(0)) pinned.set(loose(handCount), wallAt(0));
      break;
    case "discard": {
      const n = prev.discardSeats.filter((x) => x === seat).length;
      const river = `discard.${Math.floor(n / DISCARD_COLS)}.${n % DISCARD_COLS}@${seat}`;
      // 自己打的那张在散牌区哪一格，只有 A 层知道（按 tileId），由调用方给 ownSource。
      // 不给也多半配得对（轮 ② 同牌面），但手牌区开了小写时牌面编号和牌河的大写对不上，会配到别处去
      if (mine) {
        if (ownSource) pinned.set(river, ownSource);
        break;
      }
      pinned.set(river, loose(handCount - 1));
      break;
    }
    case "chi":
      if (!mine && prev.discards.length > 0) pinned.set(loose(handCount), lastRiver());
      break;
    case "win":
      if (!mine && !e.selfDrawn && prev.discards.length > 0) pinned.set(loose(handCount), lastRiver());
      break;
    case "reveal": {
      const tiles = e.tiles ?? "";
      const row = (mine ? prev.me.melds : (other?.melds ?? [])).length;
      // 亮词靠右码齐（layMelds）：第 row 行宽 14 − 3·row，词占最右 tiles.length 格
      const width = 14 - 3 * row;
      const first = Math.max(0, width - tiles.length);
      if (!mine) {
        for (let i = 0; i < tiles.length; i++) {
          pinned.set(`meld.${row}.${first + i}@${seat}`, loose(handCount - tiles.length + i));
        }
        // 补摸：从牌墙飞进手牌右端
        const left = handCount - tiles.length;
        for (let k = 0; k < (e.draws ?? 0); k++) if (wallAt(k)) pinned.set(loose(left + k), wallAt(k));
      }
      break;
    }
  }
  return pinned;
}
