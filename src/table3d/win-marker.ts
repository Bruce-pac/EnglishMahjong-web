/**
 * T6.5 血战到底：已胡的家（含自己）座位旁的「第 N 胡」标记。
 *
 * 只读服务端下发的 `won` / `winOrder`，前端不推断谁胡了。标记本身是 DOM 覆盖层，
 * 锚点由 `TableView.looseRowAnchor(seat)` 给、调用方每帧投影（同 [拆开]）
 */

import type { State } from "../api";
import { AI_NAMES } from "./names";

export interface WinMarker {
  seat: number;
  /** 「第 N 胡」，N = winOrder + 1。AI 胡了前面带名字：「Jean · 第 1 胡」（P4，和桌沿名牌合成一个） */
  label: string;
}

export function winMarkers(state: State): WinMarker[] {
  const out: WinMarker[] = [];
  for (const p of [state.me, ...state.others]) {
    if (!p.won || p.winOrder === null || p.winOrder === undefined) continue;
    const order = `第 ${p.winOrder + 1} 胡`;
    const name = p.seat === state.me.seat ? undefined : AI_NAMES[p.seat];
    out.push({ seat: p.seat, label: name ? `${name} · ${order}` : order });
  }
  return out.sort((a, b) => a.seat - b.seat);
}
