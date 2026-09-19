/**
 * P18 本局词条：各家亮词区里的词，按出现先后排成一列。
 *
 * **真相是 state 里各家的 `melds`**，事件只用来补两样 melds 看不出的东西：
 * 是吃来的还是亮的、四家之间谁先谁后。所以不「逐个事件追加」，而是每次 apply 之后
 * 拿 melds 和已记下的词条比差集——回放快进（`fastForward` 跳过剩下的事件）也不会漏词。
 *
 * 胡牌那一手在 `concealed` 里，不进词条（结算面板已经展示）。
 */

import type { GameEvent, State } from "../api";

/** 吃 / 亮。`null` = 来源已经无从知道（刷新后补回来的） */
export type WordAct = "chi" | "reveal" | null;

export interface WordEntry {
  seat: number;
  word: string;
  act: WordAct;
}

/** 按座位号列出各家的 melds（自己 + 别家） */
function meldsBySeat(state: State): Map<number, string[]> {
  const m = new Map<number, string[]>();
  m.set(
    state.me.seat,
    state.me.melds.map((w) => w.word),
  );
  for (const o of state.others)
    m.set(
      o.seat,
      o.melds.map((w) => w.word),
    );
  return m;
}

/**
 * 词条对齐到 state。
 *
 * 1. 已记下的每家词条逐条和这家的 melds 按顺序比，对不上的及其之后的都丢掉（state 说了算）
 * 2. melds 里多出来的按座位号、按 melds 顺序追加；标签从 `events` 里找：
 *    同座位同 word 的 `chi` → 吃；否则有 `reveal` → 亮；都没有（刷新、读档）→ 不标
 *
 * `events` 传这个 envelope 的**全部**事件：吃牌之后紧跟一个同词的 reveal，
 * 只看回放当前那一步的话，吃来的词会被标成亮。
 */
export function syncWordLog(log: readonly WordEntry[], state: State, events: readonly GameEvent[] = []): WordEntry[] {
  const melds = meldsBySeat(state);
  const seen = new Map<number, number>();
  const broken = new Set<number>();
  const kept: WordEntry[] = [];
  for (const e of log) {
    const words = melds.get(e.seat);
    const i = seen.get(e.seat) ?? 0;
    if (!words || broken.has(e.seat) || words[i] !== e.word) {
      broken.add(e.seat);
      continue;
    }
    seen.set(e.seat, i + 1);
    kept.push(e);
  }
  const seats = [...melds.keys()].sort((a, b) => a - b);
  for (const seat of seats) {
    const words = melds.get(seat)!;
    for (let i = seen.get(seat) ?? 0; i < words.length; i++) {
      kept.push({ seat, word: words[i], act: actOf(events, seat, words[i]) });
    }
  }
  return kept;
}

function actOf(events: readonly GameEvent[], seat: number, word: string): WordAct {
  const hit = (t: GameEvent["t"]) => events.some((e) => e.t === t && e.seat === seat && e.word === word);
  if (hit("chi")) return "chi";
  if (hit("reveal")) return "reveal";
  return null;
}

/** 读档用：形状不对的整份不认，返回 undefined（词条随后由 state 补回来，只是没了标签） */
export function parseWordLog(raw: unknown): WordEntry[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const ok = raw.every(
    (e) =>
      e !== null &&
      typeof e === "object" &&
      Number.isInteger(e.seat) &&
      typeof e.word === "string" &&
      (e.act === "chi" || e.act === "reveal" || e.act === null),
  );
  return ok ? (raw as WordEntry[]) : undefined;
}
