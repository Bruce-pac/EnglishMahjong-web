/** P24：提示模式的吃牌，这次提交带不带 viaHint（被提示印记宁可少记、不能多记） */

import { describe, expect, it } from "vitest";
import { claimViaHint } from "./chi";
import { HintPick } from "./hint-pick";

const CHI = "chi|t|40"; // 一个吃牌决策的 key（decisionKeyOf 的形状）

function picked(word: string | null): HintPick {
  const p = new HintPick();
  p.sync(CHI);
  if (word) p.pick(word);
  return p;
}

describe("吃牌提交带不带 viaHint", () => {
  it("点候选后原样提交 → 带", () => {
    expect(claimViaHint("chi", picked("tops"), "tops")).toBe(true);
    expect(claimViaHint("chi", picked("TOPS"), "tops")).toBe(true); // 大小写不算改词
  });

  it("点候选后改成别的词 → 不带", () => {
    expect(claimViaHint("chi", picked("tops"), "stop")).toBe(false);
  });

  it("点过 A 又点 B，提交 A → 不带（只认最后点的）", () => {
    const p = picked("tops");
    p.pick("pots");
    expect(claimViaHint("chi", p, "tops")).toBe(false);
    expect(claimViaHint("chi", p, "pots")).toBe(true);
  });

  it("没点直接输入候选里的词 → 不带", () => {
    expect(claimViaHint("chi", picked(null), "tops")).toBe(false);
  });

  it("没点直接输入候选外的词 → 不带", () => {
    expect(claimViaHint("chi", picked(null), "post")).toBe(false);
  });

  it("换了决策后再提交 → 不带", () => {
    const p = picked("tops");
    p.sync("chi|s|36"); // 下一次吃牌决策
    expect(claimViaHint("chi", p, "tops")).toBe(false);
  });

  it("胡牌一律不带（服务端不给胡牌提示）", () => {
    expect(claimViaHint("win", picked("tops"), "tops")).toBe(false);
  });
});
