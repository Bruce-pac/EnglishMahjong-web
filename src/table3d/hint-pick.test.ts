/** T6.2：viaHint 的判定 */

import { describe, expect, it } from "vitest";
import type { Envelope, Pending } from "../api";
import { decisionKeyOf, HintPick } from "./hint-pick";

describe("HintPick（只有点过的那一项算被提示）", () => {
  it("没点过任何一项 → 假，哪怕提交的词就在提示列表里", () => {
    const h = new HintPick();
    h.sync("reveal|t|40");
    expect(h.viaHint("cat")).toBe(false);
  });

  it("点了某项、提交的正是它 → 真（大小写不敏感）", () => {
    const h = new HintPick();
    h.sync("reveal|t|40");
    h.pick("CAT");
    expect(h.viaHint("cat")).toBe(true);
  });

  it("点了 A、提交的是列表里的 B → 假", () => {
    const h = new HintPick();
    h.sync("reveal|t|40");
    h.pick("cat");
    expect(h.viaHint("act")).toBe(false);
  });

  it("点了 A 又点 B、提交 B → 真；提交 A → 假", () => {
    const h = new HintPick();
    h.sync("reveal|t|40");
    h.pick("cat");
    h.pick("act");
    expect(h.viaHint("act")).toBe(true);
    expect(h.viaHint("cat")).toBe(false);
  });

  it("换了决策 → 清掉；同一个决策重复 sync 不清", () => {
    const h = new HintPick();
    h.sync("reveal|t|40");
    h.pick("cat");
    h.sync("reveal|t|40");
    expect(h.viaHint("cat")).toBe(true);
    h.sync("reveal|t|36"); // 摸了新牌（碰巧还是 T）
    expect(h.viaHint("cat")).toBe(false);
    expect(h.word).toBeNull();
  });

  it("决策签名：类型 + 桌上那张 + 牌墙张数；没有待决策是空串", () => {
    const env = (pending: Pending | null, wallLeft: number) =>
      ({ pending, state: { wallLeft } }) as unknown as Pick<Envelope, "pending" | "state">;
    const p = (kind: Pending["kind"], tile: string | null): Pending => ({ kind, tile, canPass: true, hints: [] });
    expect(decisionKeyOf(env(p("reveal", "t"), 40))).toBe("reveal|t|40");
    expect(decisionKeyOf(env(p("chi", "x"), 40))).not.toBe(decisionKeyOf(env(p("chi", "y"), 40)));
    expect(decisionKeyOf(env(null, 40))).toBe("");
  });
});
