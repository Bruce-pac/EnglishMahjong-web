/**
 * 自建词单的前端小工具（纯函数，单测覆盖）。
 *
 * 词单的解析、校验、编码识别全在服务端——这里只管把文件字节原样送上去、
 * 记住上次选的是哪份、把日期写成「9月30日」。
 */

import type { WordListSummary } from "./api";

/** localStorage 里记「上次选的词单」的键。其余设置照旧不记，只记这一项（需求 §2.2） */
export const REMEMBERED_LIST_KEY = "emj-word-list";

/**
 * 文件原始字节 → base64。**不解码**：GBK 文件按 UTF-8 读会乱码，
 * 编码识别只在服务端做一处（用户定的方案）。
 *
 * 分块拼字符串：`String.fromCharCode(...整个数组)` 在大文件上会爆调用栈。
 */
export function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** 名称不填时用的默认名：文件名去掉 `.txt`（和服务端的规则一致，只用来当占位符） */
export function defaultListName(filename: string): string {
  return filename.trim().replace(/\.txt$/i, "").trim();
}

/** 记住的那份词单还在不在列表里：在就用它，删了（或换了账号）就回落到「不用」 */
export function resolveRemembered(remembered: number | null, lists: WordListSummary[]): number | null {
  if (remembered === null) return null;
  return lists.some((l) => l.id === remembered) ? remembered : null;
}

/** 上传日期：Unix 秒 → 「9月30日」（本地时区） */
export function formatListDate(createdAt: number): string {
  const d = new Date(createdAt * 1000);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

/** 读记住的词单 id。localStorage 不可用或内容不对都当没记过 */
export function readRememberedList(): number | null {
  try {
    const raw = localStorage.getItem(REMEMBERED_LIST_KEY);
    const id = raw === null ? NaN : Number(raw);
    return Number.isInteger(id) ? id : null;
  } catch {
    return null;
  }
}

/** 记下（或清掉）选中的词单 */
export function writeRememberedList(id: number | null): void {
  try {
    if (id === null) localStorage.removeItem(REMEMBERED_LIST_KEY);
    else localStorage.setItem(REMEMBERED_LIST_KEY, String(id));
  } catch {
    /* 存不了就不记，不影响开局 */
  }
}

/**
 * 牌局里的词单进度：够了写「词单词 2 ✓」，不够写「词单词 1 / 需 2」。
 * 数字全由服务端给（`state.wordList`），这里只拼字。3D 在 `table3d/word-list.ts` 里自带一份
 */
export function listProgress(wordList: { need: number; have: number }): string {
  return wordList.have >= wordList.need
    ? `词单词 ${wordList.have} ✓`
    : `词单词 ${wordList.have} / 需 ${wordList.need}`;
}

/** 结算页「本局词单词」的标题。一个都没拼出来时不写「0 个」 */
export function listWordsTitle(count: number, name: string): string {
  return count > 0 ? `📋 本局词单词 ${count} 个（${name}）` : `📋 本局词单词（${name}）`;
}
