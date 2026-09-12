/** T4.1：请求时机与竞态。validate 注入成可手动 resolve 的假函数 */

import { describe, expect, it, vi } from "vitest";
import type { Validation } from "../api";
import { SelectionValidator, type CheckState } from "./check";
import type { Spell } from "./spell";

function harness() {
  const calls: { tiles: string; word: string; resolve: (v: Validation) => void; reject: (e: unknown) => void }[] = [];
  const validate = vi.fn(
    (tiles: string, word: string) =>
      new Promise<Validation>((resolve, reject) => calls.push({ tiles, word, resolve, reject })),
  );
  const states: CheckState[] = [];
  const errors: unknown[] = [];
  const v = new SelectionValidator(validate, (s) => states.push(s), (e) => errors.push(e));
  return { v, validate, calls, states, errors, last: () => states[states.length - 1] };
}
const word = (w: string): Spell => ({ kind: "word", tiles: w, word: w });
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("SelectionValidator", () => {
  it("过期响应被丢弃：先发 A 再发 B，A 后回来，界面仍显示 B", async () => {
    const h = harness();
    h.v.update(word("cat"));
    h.v.update(word("act"));
    h.calls[1].resolve({ valid: true, score: 3 });
    await flush();
    h.calls[0].resolve({ valid: false });
    await flush();
    expect(h.last()).toMatchObject({ status: "done", display: "ACT", result: { valid: true, score: 3 } });
  });

  it("同一个 key 不重复请求（每帧都喂也只发一次）", () => {
    const h = harness();
    for (let i = 0; i < 60; i++) h.v.update(word("cat"));
    expect(h.validate).toHaveBeenCalledTimes(1);
    expect(h.states).toMatchObject([{ status: "checking", display: "CAT" }]);
  });

  it("未声明白搭 → needWild，不发请求", () => {
    const h = harness();
    h.v.update({ kind: "needWild", display: "C★T", wild: { tileId: 7, kind: "1" } });
    expect(h.validate).not.toHaveBeenCalled();
    expect(h.last()).toMatchObject({ status: "needWild", display: "C★T" });
  });

  it("不足 2 张 → 回到 idle，不发请求；在途的请求也作废", async () => {
    const h = harness();
    h.v.update({ kind: "none" });
    expect(h.validate).not.toHaveBeenCalled();
    h.v.update(word("cat"));
    h.v.update({ kind: "none" });
    h.calls[0].resolve({ valid: true, score: 3 });
    await flush();
    expect(h.last()).toMatchObject({ status: "idle" });
  });

  it("选区变回原来的词会重新请求（前一次的结果已经作废）", () => {
    const h = harness();
    h.v.update(word("cat"));
    h.v.update({ kind: "none" });
    h.v.update(word("cat"));
    expect(h.validate).toHaveBeenCalledTimes(2);
  });

  it("请求失败：交给 onError，状态回到 idle，不显示成「不是单词」", async () => {
    const h = harness();
    h.v.update(word("cat"));
    h.calls[0].reject(new Error("断网"));
    await flush();
    expect(h.errors).toHaveLength(1);
    expect(h.last()).toMatchObject({ status: "idle" });
  });

  it("过期的失败也丢弃，不弹通知", async () => {
    const h = harness();
    h.v.update(word("cat"));
    h.v.update(word("act"));
    h.calls[0].reject(new Error("旧的"));
    await flush();
    expect(h.errors).toHaveLength(0);
  });

  it("dispose 之后回来的响应一律丢掉，也不再发请求", async () => {
    const h = harness();
    h.v.update(word("cat"));
    h.v.dispose();
    h.calls[0].resolve({ valid: true, score: 3 });
    await flush();
    h.v.update(word("act"));
    expect(h.validate).toHaveBeenCalledTimes(1);
    expect(h.last()).toMatchObject({ status: "checking", display: "CAT" });
  });

  it("状态带着推导结果的 key、tiles、word，不从校验响应里拼", async () => {
    const h = harness();
    h.v.update({ kind: "word", tiles: "c1d", word: "cod" });
    h.calls[0].resolve({ valid: true, word: "something-else", score: 5 });
    await flush();
    expect(h.last()).toMatchObject({ status: "done", key: "word|c1d|cod", tiles: "c1d", word: "cod" });
  });

  it("两张白搭 → tooManyWilds，不发请求", () => {
    const h = harness();
    h.v.update({ kind: "tooManyWilds", display: "C★★" });
    expect(h.validate).not.toHaveBeenCalled();
    expect(h.last()).toMatchObject({ status: "tooManyWilds", display: "C★★" });
  });
});

