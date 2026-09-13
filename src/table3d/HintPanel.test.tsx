/** T6.2：提示列表的渲染 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HintPanel, orderHints, type Hint } from "./HintPanel";

const hint = (word: string, wild = "", isAbbr = false): Hint => ({ tiles: [...word].sort().join(""), word, wild, isAbbr });
const hints = [hint("cod", "o"), hint("mrs", "", true), hint("cat"), hint("act"), hint("tac"), hint("sixth")];
const render = (enabled: boolean, list: Hint[], open = true) =>
  renderToStaticMarkup(
    <HintPanel
      enabled={enabled}
      hints={list}
      open={open}
      onToggle={() => {}}
      picked="cat"
      note={(h) =>
        h.word === "act"
          ? { text: "要先拆开暗词", tone: "warn" }
          : h.word === "tac"
            ? { text: "已组成暗词", tone: "info" }
            : null
      }
      onPick={() => {}}
    />,
  );

describe("提示面板", () => {
  it("config.hints 为假：什么都不渲染（没有任何提示入口），哪怕 hints 非空", () => {
    expect(render(false, hints)).toBe("");
    expect(render(false, hints, false)).toBe("");
  });

  it("没有提示：不渲染", () => {
    expect(render(true, [])).toBe("");
  });

  it("收起时只有 [提示] 按钮", () => {
    const html = render(true, hints, false);
    expect(html).toContain(">提示<");
    expect(html).not.toContain("table3d-hints");
  });

  it("展开：白搭注明 ★=O、缩写注明缩写、要用暗词的注明要先拆开暗词、点过的那项标出来", () => {
    // 只喂前 5 条：这 5 条本来就是「能用 → 要拆 → 已组成」的顺序，排完不变，专看注明
    const html = render(true, hints.slice(0, 5));
    const words = [...html.matchAll(/<span class="word">([A-Z]+)<\/span>/g)].map((m) => m[1]);
    expect(words).toEqual(["COD", "MRS", "CAT", "ACT", "TAC"]);
    expect(html).toContain("★=O");
    expect(html).toContain("缩写");
    // 两种注明的语气不同：已组成暗词是中性的告知，要先拆开暗词是提醒
    expect(html).toContain('<span class="tag warn">要先拆开暗词</span>');
    expect(html).toContain('<span class="tag info">已组成暗词</span>');
    expect(html).toMatch(/table3d-hint-item picked"><span class="word">CAT/);
  });

  it("超过 5 条时：散牌就能拼的先占名额，已组成暗词的被挤出去", () => {
    const html = render(true, hints); // 第 6 条 SIXTH 散牌就能拼
    const words = [...html.matchAll(/<span class="word">([A-Z]+)<\/span>/g)].map((m) => m[1]);
    expect(words).toEqual(["COD", "MRS", "CAT", "SIXTH", "ACT"]);
    expect(html).not.toContain("已组成暗词");
  });
});

describe("orderHints（用户定的显示顺序）", () => {
  const warn = { text: "要先拆开暗词", tone: "warn" } as const;
  const info = { text: "已组成暗词", tone: "info" } as const;
  // 服务端顺序：长词在前、几乎都要借暗词——这正是要解决的情况
  const server = [hint("postcard"), hint("cat"), hint("comrade"), hint("act"), hint("dog"), hint("stage")];
  const note = (h: Hint) =>
    ({ postcard: warn, comrade: warn, stage: warn, cat: info } as Record<string, typeof warn | typeof info>)[h.word] ?? null;

  it("散牌就能拼 → 要先拆开暗词 → 已组成暗词；每组内部保持服务端的顺序", () => {
    expect(orderHints(server, note).map((h) => h.word)).toEqual(["act", "dog", "postcard", "comrade", "stage", "cat"]);
  });

  it("只重排、不增不减，也不改传进来的数组", () => {
    const before = server.map((h) => h.word);
    const out = orderHints(server, note);
    expect([...out.map((h) => h.word)].sort()).toEqual([...before].sort());
    expect(server.map((h) => h.word)).toEqual(before);
  });
});
