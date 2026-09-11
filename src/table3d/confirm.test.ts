import { describe, expect, it } from "vitest";
import { ConfirmGate } from "./confirm";

describe("ConfirmGate（亮词两步确认）", () => {
  it("第一次点只上膛，第二次才提交", () => {
    const g = new ConfirmGate();
    g.sync("word|cdo|cod");
    expect(g.press()).toBe(false);
    expect(g.armed).toBe(true);
    expect(g.press()).toBe(true);
    expect(g.armed).toBe(false);
  });

  it("选区变了就退回第一步，变回原来的词也还是第一步", () => {
    const g = new ConfirmGate();
    g.sync("word|cdo|cod");
    g.press();
    g.sync("word|cdo|doc");
    expect(g.armed).toBe(false);
    g.sync("word|cdo|cod");
    expect(g.armed).toBe(false);
    expect(g.press()).toBe(false);
  });

  it("同一个 key 反复 sync 不影响上膛状态", () => {
    const g = new ConfirmGate();
    g.sync("k");
    g.press();
    g.sync("k");
    expect(g.armed).toBe(true);
  });

  it("reset 退回第一步", () => {
    const g = new ConfirmGate();
    g.sync("k");
    g.press();
    g.reset();
    expect(g.armed).toBe(false);
  });
});
