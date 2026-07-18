/**
 * 把「排序后的牌面」还原成「单词的字母顺序」。
 *
 * 服务端存的 `tiles` 是**排序后**的签名（CAT 存成 "act"），因为引擎只关心多重集合。
 * 但界面上把牌摆成 A-C-T 而底下写着 CAT，看着就是错的。所以显示前要按单词的
 * 字母顺序把牌重排一遍。
 *
 * 白搭（1/2）没有字母，它顶替的是单词里没有真实牌覆盖的那个位置——
 * 顺带把它代表的字母也算出来，牌面上可以标 ★=O。
 */

import { isWild } from "./components/Tile";

export interface OrderedTile {
  /** 实际的牌（白搭是 "1"/"2"） */
  tile: string;
  /** 这张牌在单词里当的是哪个字母。白搭时即它顶替的字母 */
  letter: string;
}

export function orderTiles(tiles: string, word: string): OrderedTile[] {
  // 先把真实字母按数量记下来，白搭单独放
  const real = new Map<string, number>();
  const wilds: string[] = [];
  for (const t of tiles) {
    if (isWild(t)) wilds.push(t);
    else real.set(t, (real.get(t) ?? 0) + 1);
  }

  const out: OrderedTile[] = [];
  for (const letter of word) {
    const count = real.get(letter) ?? 0;
    if (count > 0) {
      real.set(letter, count - 1);
      out.push({ tile: letter, letter });
    } else {
      // 没有真牌盖住这个位置 —— 只能是白搭顶上来的
      const wild = wilds.shift();
      if (wild) out.push({ tile: wild, letter });
    }
  }
  return out;
}
