/**
 * 3D 页的观战横幅与「提前结算」按钮（纯函数，单测钉着）。
 *
 * 和主包 `spectate.ts` 的 `canSkipReplay` 同内容，但 3D 故意自带一份，理由同 `ConfigBar.tsx` 开头：
 * 3D 不依赖 2.5D 的模块，懒加载的 3D 包一旦 import 主包里的模块，主包就得多导出绑定、变大。
 */

import type { State } from "../api";

/**
 * 「提前结算」按钮：血战到底、你已经胡了、回放还没放完、界面上还有人在打。
 * 你胡牌那一刻服务端已经把剩下几家打完、结算好了，按钮只是跳过回放，结果完全一样
 */
export function canSkipReplay(o: { bloody: boolean; meWon: boolean; replaying: boolean; stillPlaying: number }): boolean {
  return o.bloody && o.meWon && o.replaying && o.stillPlaying > 1;
}

/** 回放的某一步里，你胡了没有、第几个胡、还有几家在打。没胡时为 null */
export function spectateOf(state: State): { order: number; left: number } | null {
  if (!state.me.won) return null;
  return { order: (state.me.winOrder ?? 0) + 1, left: state.others.filter((o) => !o.won).length };
}

/** 横幅上的字：「👁 你已胡牌（第 1 个）· 还有 2 家在打」 */
export function spectateText(s: { order: number; left: number }): string {
  return `👁 你已胡牌（第 ${s.order} 个）· 还有 ${s.left} 家在打`;
}
