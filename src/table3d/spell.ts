/**
 * T4.1：框选结果 → 单词（需求文档 §4.2、§10 第 1、2 条）。
 *
 * 纯函数，不碰 three.js、不发请求。
 *
 * **顺序只来自 `LooseSlots` 的数组下标**：按下标从左到右遍历散牌区，碰到选中的牌就接上，
 * 中间的空格跳过。调用方传进来的 id 顺序一律不信，更不按世界坐标——
 * 「单词就是散牌区从左到右读出来的那一串」是规则书的定义，不是渲染层的推论。
 */

import type { LooseSlots } from "./loose-reconcile";

export type Spell =
  /** 不足 2 张：不校验 */
  | { kind: "none" }
  /** 含还没声明字母的白搭：不发请求。`display` 里白搭显示成 ★ */
  | { kind: "needWild"; display: string }
  /** 可以校验：`tiles` 是牌面（白搭写 1/2），`word` 是读出来的词（白搭写它声明的字母），一律小写 */
  | { kind: "word"; tiles: string; word: string };

/** 牌面编码里的白搭：1 = 元音白搭，2 = 辅音白搭。这是编码，不是规则 */
function isWildTile(tile: string): boolean {
  return tile === "1" || tile === "2";
}

export function spellSelection(loose: LooseSlots, selected: Iterable<number>): Spell {
  const picked = new Set(selected);
  let tiles = "";
  let word = "";
  let display = "";
  let undeclared = false;
  let count = 0;

  for (const e of loose) {
    // 暗词里的牌不单独参与推导（它们不会被选中，这里是第二道保险，见 TableView.inGroup）
    if (!e || !picked.has(e.tileId) || e.groupId !== undefined) continue;
    count++;
    tiles += e.tile;
    if (isWildTile(e.tile)) {
      if (e.wildLetter) {
        word += e.wildLetter.toLowerCase();
        display += e.wildLetter.toUpperCase();
      } else {
        undeclared = true;
        display += "★";
      }
    } else {
      word += e.tile.toLowerCase();
      display += e.tile.toUpperCase();
    }
  }

  if (count < 2) return { kind: "none" };
  if (undeclared) return { kind: "needWild", display };
  return { kind: "word", tiles: tiles.toLowerCase(), word };
}

/** 一个推导结果的身份。只有它变了才重新校验（同一个 key 不重复请求） */
export function spellKey(s: Spell): string {
  switch (s.kind) {
    case "none":
      return "none";
    case "needWild":
      return `needWild|${s.display}`;
    case "word":
      return `word|${s.tiles}|${s.word}`;
  }
}
