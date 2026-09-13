/**
 * T6.2：「被提示」（viaHint）的判定。用户定：和 2.5D 一样（`Hand.tsx` 的 `check.word === hintWord`）。
 *
 * - 只有**点过的那一项**算被提示：只打开提示列表看、没点任何一项，不算——哪怕玩家自己排出了列表里的词
 * - 再点另一项就换成新的那个词
 * - 之后组暗词 / 亮词提交的词**等于**点过的那个词，才带 `viaHint: true`
 * - 决策换了（摸了新牌、轮到别家、吃牌决策换了一张）就清掉
 *
 * 被提示的词会在正题集里留下「被提示」印记（CLAUDE.md 教学红线），所以宁可少记、不能多记。纯逻辑，单测钉着
 */

import type { Envelope } from "../api";

/**
 * 一个决策的身份：待决策的类型 + 桌上那张牌 + 牌墙还剩几张。
 * 牌墙张数每摸一张就变，所以连着两回合摸到同一个字母也分得清是换了决策
 */
export function decisionKeyOf(env: Pick<Envelope, "pending" | "state">): string {
  const p = env.pending;
  return p ? `${p.kind}|${p.tile ?? ""}|${env.state.wallLeft}` : "";
}

export class HintPick {
  private decision = "";
  private picked: string | null = null;

  /** 每来一个 envelope 调一次：决策换了就清掉点过的词 */
  sync(decisionKey: string): void {
    if (decisionKey === this.decision) return;
    this.decision = decisionKey;
    this.picked = null;
  }

  /** 玩家在提示列表里点了某一项 */
  pick(word: string): void {
    this.picked = word.toLowerCase();
  }

  clear(): void {
    this.picked = null;
  }

  /** 点过的那个词（没点过是 null） */
  get word(): string | null {
    return this.picked;
  }

  /** 这次提交的词算不算被提示 */
  viaHint(submitWord: string): boolean {
    return this.picked !== null && submitWord.toLowerCase() === this.picked;
  }
}
