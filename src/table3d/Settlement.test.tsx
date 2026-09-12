/** T6.3：结算面板 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Result, ResultRow, State } from "../api";
import { finalStanding, rankRows, Settlement } from "./Settlement";
import { fixtureGames } from "./test-helpers";

const row = (seat: number, score: number, winOrder: number | null, words: string[] = []): ResultRow => ({
  seat,
  score,
  total: score,
  won: winOrder !== null,
  winOrder,
  words,
});

function render(result: Result, matchFinished: boolean, gamesPlayed = 1) {
  const state: State = { ...structuredClone(fixtureGames()[0].steps[2].state), gamesPlayed, maxGames: 4, matchScores: [30, 50, 10, 20] };
  return renderToStaticMarkup(
    <Settlement result={result} state={state} matchFinished={matchFinished} busy={false} onNext={() => {}} onBack={() => {}} />,
  );
}
const baseResult = (over: Partial<Result> = {}): Result => ({
  rows: [row(0, 12, null, ["cat"]), row(1, 40, 1, ["dog"]), row(2, 55, 0, ["fox"]), row(3, 20, null)],
  exhausted: false,
  myWords: ["cat"],
  missed: ["act"],
  leftover: ["a", "1"],
  ...over,
});

describe("结算面板", () => {
  it("名次按本局分数从高到低", () => {
    expect(rankRows(baseResult().rows).map((r) => r.seat)).toEqual([2, 1, 3, 0]);
  });

  it("胡牌先后和分数排出来不一样时，按分数排；同分时胡了的在前、再按座位号", () => {
    const rows = [
      row(0, 10, 0), // 第 1 个胡，但本局分最低
      row(1, 50, null),
      row(3, 30, null),
      row(2, 30, 1), // 和座位 3 同分，胡了的排前面
    ];
    expect(rankRows(rows).map((r) => r.seat)).toEqual([1, 2, 3, 0]);
    // 都没胡、同分：按座位号
    expect(rankRows([row(3, 20, null), row(1, 20, null)]).map((r) => r.seat)).toEqual([1, 3]);
  });

  it("每家显示本局分、累计分、拼出的词；自己的正题和错题照实显示", () => {
    const html = render(baseResult(), false);
    expect(html).toContain("第 1 局结束");
    expect(html).toContain("本局 55");
    expect(html).toContain("累计 12");
    expect(html).toContain("FOX");
    expect(html).toContain("🏆 第1胡");
    expect(html).toContain("✅ 拼出的词 +1");
    expect(html).toContain("❌ 漏掉的词 +1");
    expect(html).toContain("ACT");
    expect(html).not.toContain("荒牌");
  });

  it("荒牌要写明荒牌", () => {
    const html = render(baseResult({ exhausted: true, rows: [row(0, 0, null), row(1, 0, null), row(2, 0, null), row(3, 0, null)] }), false);
    expect(html).toContain("荒牌");
  });

  it("整场没打完：只有 [下一局]", () => {
    const html = render(baseResult(), false, 1);
    expect(html).toContain("下一局（1/4）");
    expect(html).not.toContain(">返回<");
  });

  it("整场打完：显示最终排名 + 只有 [返回]", () => {
    const html = render(baseResult(), true, 4);
    expect(html).toContain("全场结束");
    expect(html).toContain(">返回<");
    expect(html).not.toContain("下一局");
    expect(finalStanding([30, 50, 10, 20]).map((f) => f.seat)).toEqual([1, 0, 3, 2]);
    expect(html).toContain("名次按 4 局累计总分排定");
  });
});
