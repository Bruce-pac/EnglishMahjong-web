import { describe, expect, it } from "vitest";
import type { ResultRow } from "../api";
import { exhaustedNote, listProgress, listWordsTitle } from "./word-list";

describe("3D 词单文案", () => {
  it("进度：够数、超过、不够、0 个", () => {
    expect(listProgress({ need: 1, have: 1 })).toBe("词单词 1 ✓");
    expect(listProgress({ need: 1, have: 3 })).toBe("词单词 3 ✓");
    expect(listProgress({ need: 2, have: 1 })).toBe("词单词 1 / 需 2");
    expect(listProgress({ need: 2, have: 0 })).toBe("词单词 0 / 需 2");
  });

  it("结算标题：有词写个数，0 个不写", () => {
    expect(listWordsTitle(3, "机械专业")).toBe("📋 本局词单词 3 个（机械专业）");
    expect(listWordsTitle(0, "机械专业")).toBe("📋 本局词单词（机械专业）");
  });

  it("荒牌说明：有人胡过写「剩下的人没胡」，没人胡照旧", () => {
    const row = (won: boolean): ResultRow => ({ seat: 0, score: 0, total: 0, won, winOrder: won ? 0 : null, words: [] });
    expect(exhaustedNote([row(false), row(true), row(false)])).toBe("牌墙摸完了，剩下的人没胡");
    expect(exhaustedNote([row(false), row(false)])).toBe("牌墙摸完了，这一局没人胡");
  });
});
