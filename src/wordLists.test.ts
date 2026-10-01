/** 自建词单的前端小工具：字节转 base64、默认名称、记住的词单回落、日期格式 */

import { afterEach, describe, expect, it } from "vitest";
import type { WordListSummary } from "./api";
import {
  REMEMBERED_LIST_KEY,
  bytesToBase64,
  defaultListName,
  formatListDate,
  listProgress,
  listWordsTitle,
  readRememberedList,
  resolveRemembered,
  writeRememberedList,
} from "./wordLists";

describe("bytesToBase64：原始字节原样编码，不解码", () => {
  it("GBK 字节（按 UTF-8 解不开）也原样编码", () => {
    const gbk = new Uint8Array([0x67, 0x65, 0x61, 0x72, 0x20, 0xb3, 0xdd, 0xc2, 0xd6, 0x0a]); // "gear 齿轮\n"
    expect(bytesToBase64(gbk)).toBe("Z2VhciCz3cLWCg==");
  });

  it("超过分块大小的文件：解回来逐字节一致", () => {
    const big = new Uint8Array(100_000).map((_, i) => (i * 31) % 256);
    const back = Uint8Array.from(atob(bytesToBase64(big)), (ch) => ch.charCodeAt(0));
    expect(back).toEqual(big);
  });

  it("空文件", () => {
    expect(bytesToBase64(new Uint8Array())).toBe("");
  });
});

describe("defaultListName：文件名去掉 .txt", () => {
  it.each([
    ["机械专业.txt", "机械专业"],
    ["Words.TXT", "Words"],
    ["a.b.txt", "a.b"],
    ["notes", "notes"],
    ["txt.txt", "txt"],
  ])("%s → %s", (file, name) => {
    expect(defaultListName(file)).toBe(name);
  });
});

describe("resolveRemembered：记住的词单不在列表里就回落到「不用」", () => {
  const lists: WordListSummary[] = [
    { id: 3, name: "机械", wordCount: 39, createdAt: 0 },
    { id: 7, name: "电子", wordCount: 35, createdAt: 0 },
  ];
  it("还在就用它", () => expect(resolveRemembered(7, lists)).toBe(7));
  it("删掉了（或换了账号）就是 null", () => expect(resolveRemembered(5, lists)).toBeNull());
  it("没记过就是 null", () => expect(resolveRemembered(null, lists)).toBeNull());
  it("列表为空也是 null", () => expect(resolveRemembered(3, [])).toBeNull());
});

describe("formatListDate：M月D日", () => {
  it("本地时区的月和日，不补零", () => {
    expect(formatListDate(new Date(2026, 8, 30, 12).getTime() / 1000)).toBe("9月30日");
    expect(formatListDate(new Date(2026, 0, 5, 0, 30).getTime() / 1000)).toBe("1月5日");
  });
});

describe("记住的词单读写", () => {
  const map = new Map<string, string>();
  const g = globalThis as unknown as { localStorage?: unknown };
  afterEach(() => {
    map.clear();
    delete g.localStorage;
  });

  it("写了能读回；清掉后读到 null；乱写的值当没记过", () => {
    g.localStorage = {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
    };
    writeRememberedList(12);
    expect(readRememberedList()).toBe(12);
    writeRememberedList(null);
    expect(readRememberedList()).toBeNull();
    map.set(REMEMBERED_LIST_KEY, "abc");
    expect(readRememberedList()).toBeNull();
  });

  it("没有 localStorage（或访问抛错）也不崩", () => {
    expect(() => writeRememberedList(1)).not.toThrow();
    expect(readRememberedList()).toBeNull();
  });
});

describe("牌局里的词单文案", () => {
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
});
