/**
 * T6.1 / T6.3：吃牌、胡牌时，把玩家在输入框里打的词对应到手里具体的牌。
 *
 * 服务端只认字母，不知道前端的 tileId——哪几张牌离开散牌区只能由前端按固定规则挑，
 * 再把挑出来的 tileId 作为 `consumedTileIds` 交给对账（否则重复字母时空出的会是另一格）。
 * 能不能吃仍由服务端判，这里只负责把字母落到牌上。纯函数，不碰 three.js。
 *
 * 规则：
 * 1. 打出的那张先认领词里一个同字母的位置；它是白搭时放到最后才认领
 * 2. 其余位置**只从散牌里挑**，暗词里的牌一律不用（需求文档 §4.3）
 * 3. 真字母优先；同字母有好几张时挑**最靠右**的，尽量不打乱左边玩家排好的顺序
 * 4. 真字母补不齐的那一位才用白搭，种类要对得上；有几张可选时优先挑声明字母正好相同的
 * 5. 白搭总数不超过 `MAX_WILDS_PER_WORD`，打出的那张白搭也算在内
 * 6. 胡牌另加一条：**必须用光全部散牌**（服务端 build_answer 的 win 分支同样要求）
 *
 * 吃牌和胡牌共用 `matchWord`，「打出的那张」在胡牌时就是要胡的那张（自摸摸到的、或别家打出的）。
 *
 * 失败只给原因，**不说差哪张牌**（教学红线：不提示）。
 */

import { WILD_CANDIDATES } from "./atlas";
import type { LooseEntry, LooseSlots } from "./loose-reconcile";
import { MAX_WILDS_PER_WORD } from "./spell";

export type ChiMatch =
  | {
      ok: true;
      /** 手里用到的牌面（不含打出的那张），按词的顺序。给 `/validate` 的 `tiles` */
      handTiles: string;
      /** 手里的牌面 + 打出的那张。给 `/action` 吃牌的 `tiles`（服务端要求里面有打出的那张） */
      tiles: string;
      /** 手里用到的那几张的 tileId：高亮它们，亮词成功后作为 consumedTileIds */
      tileIds: number[];
    }
  | { ok: false; reason: "empty" | "discardUnused" | "missing" | "tooManyWilds" | "notAll" };

const isWild = (t: string): t is "1" | "2" => t === "1" || t === "2";
/** 这个字母该由哪种白搭代替 */
const wildKindOf = (letter: string): "1" | "2" => (WILD_CANDIDATES["1"].includes(letter) ? "1" : "2");

/** 吃牌：打出的那张 + 手里任意几张散牌 */
export function matchChi(loose: LooseSlots, word: string, discard: string): ChiMatch {
  return matchWord(loose, word, discard, false);
}

/** 胡牌：要胡的那张 + **全部**散牌（暗词里的牌不算散牌）。没用光返回 `notAll` */
export function matchWin(loose: LooseSlots, word: string, winTile: string): ChiMatch {
  return matchWord(loose, word, winTile, true);
}

/**
 * 吃牌、胡牌共用的对应规则（见文件头）。`discard` 是桌上那张（吃牌时别家打出的、胡牌时要胡的），
 * `useAll` 为真时要求用光全部散牌
 */
function matchWord(loose: LooseSlots, word: string, discard: string, useAll: boolean): ChiMatch {
  const w = [...word.trim().toLowerCase()];
  if (w.length === 0 || w.some((c) => !/[a-z]/.test(c))) return { ok: false, reason: "empty" };

  /** 每一位由谁来填：打出的那张（-1）或手里某张牌 */
  const fill: Array<LooseEntry | "discard" | null> = new Array(w.length).fill(null);
  // 只从散牌里挑：暗词里的牌不参与
  const pool = loose
    .map((e, slot) => ({ e, slot }))
    .filter((x): x is { e: LooseEntry; slot: number } => x.e !== null && x.e.groupId === undefined);
  const used = new Set<number>();

  // ① 打出的那张是字母：先认领一个同字母的位置
  if (!isWild(discard)) {
    const at = w.findIndex((c) => c === discard);
    if (at < 0) return { ok: false, reason: "discardUnused" };
    fill[at] = "discard";
  }

  // ② 真字母优先，同字母挑最靠右的
  for (let i = 0; i < w.length; i++) {
    if (fill[i]) continue;
    const hit = [...pool].reverse().find((x) => !used.has(x.e.tileId) && x.e.tile === w[i]);
    if (hit) {
      fill[i] = hit.e;
      used.add(hit.e.tileId);
    }
  }

  // ③ 剩下的位置交给白搭。打出的那张是白搭时，它最后认领一个种类对得上的位置
  const rest = w.map((_, i) => i).filter((i) => !fill[i]);
  let discardWildAt = -1;
  if (isWild(discard)) {
    discardWildAt = rest.findIndex((i) => wildKindOf(w[i]) === discard);
    if (discardWildAt < 0) return { ok: false, reason: rest.length ? "missing" : "discardUnused" };
  }
  const handWildPositions = rest.filter((_, k) => k !== discardWildAt);
  for (const i of handWildPositions) {
    const kind = wildKindOf(w[i]);
    const candidates = [...pool].reverse().filter((x) => !used.has(x.e.tileId) && x.e.tile === kind);
    const hit = candidates.find((x) => x.e.wildLetter === w[i]) ?? candidates[0];
    if (!hit) return { ok: false, reason: "missing" };
    fill[i] = hit.e;
    used.add(hit.e.tileId);
  }
  if (discardWildAt >= 0) fill[rest[discardWildAt]] = "discard";

  const wilds = fill.filter((f) => f === "discard" ? isWild(discard) : f !== null && isWild(f.tile)).length;
  if (wilds > MAX_WILDS_PER_WORD) return { ok: false, reason: "tooManyWilds" };

  const hand = fill.filter((f): f is LooseEntry => f !== null && f !== "discard");
  // 胡牌要用光全部散牌：手里还剩一张没用上就不行（不说剩的是哪张）
  if (useAll && hand.length !== pool.length) return { ok: false, reason: "notAll" };
  const handTiles = hand.map((e) => e.tile).join("");
  return { ok: true, handTiles, tiles: handTiles + discard, tileIds: hand.map((e) => e.tileId) };
}
