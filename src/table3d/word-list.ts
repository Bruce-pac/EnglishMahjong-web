/**
 * 3D 页的自建词单文案（进度条、结算标题、荒牌说明）。纯函数，单测钉着。
 *
 * 和主包 `wordLists.ts` 里的 `listProgress` / `listWordsTitle` 同内容，但 3D 故意自带一份，
 * 理由同 `ConfigBar.tsx` 开头：3D 不依赖 2.5D 的模块，懒加载的 3D 包一旦 import 主包里的模块，
 * 主包就得多导出绑定、变大。
 */

import type { ResultRow } from "../api";

/** 够了写「词单词 2 ✓」，不够写「词单词 1 / 需 2」。数字全由服务端给 */
export function listProgress(wordList: { need: number; have: number }): string {
  return wordList.have >= wordList.need
    ? `词单词 ${wordList.have} ✓`
    : `词单词 ${wordList.have} / 需 ${wordList.need}`;
}

/** 结算页「本局词单词」的标题。一个都没拼出来时不写「0 个」 */
export function listWordsTitle(count: number, name: string): string {
  return count > 0 ? `📋 本局词单词 ${count} 个（${name}）` : `📋 本局词单词（${name}）`;
}

/**
 * 荒牌时标题下那句说明。血战到底里常常是有人先胡了、剩下的人把牌墙摸完——
 * 那时说「这一局没人胡」是错的
 */
export function exhaustedNote(rows: readonly ResultRow[]): string {
  return rows.some((r) => r.won) ? "牌墙摸完了，剩下的人没胡" : "牌墙摸完了，这一局没人胡";
}
