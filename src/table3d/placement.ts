/**
 * B 层：`layout()`——从局面算出「每个槽位上摆一张什么样的牌」（T1.4 方案 §3）。
 *
 * 纯函数：同样的入参永远给出同样的输出，不碰 three.js、不碰 localStorage。
 * 散牌区的槽位来自 A 层的 `LooseSlots`，其余全部从 `state` 现算——
 * 服务端说什么就是什么，前端不推断、不记忆。
 */

import type { State, Word } from "../api";
import { FACE_COUNT, letterFace, WILD_CONSONANT, WILD_VOWEL, wildFace } from "./atlas";
import {
  DISCARD_COLS,
  DISCARD_ROWS,
  LOOSE_SLOTS,
  MELD_ROWS,
  meldSlots,
  PLAYERS,
  WALL_COLS,
  WALL_ROWS,
} from "./layout";
import type { LooseSlots } from "./loose-reconcile";

export interface Placement {
  /** 槽位全名，如 `loose.3@0`。与 `setup-slots.ts` 建出来的名字必须一致 */
  slotName: string;
  /** 图集第几个**正面**格（0..105）。牌背不编码在这里，见下 */
  typeIndex: number;
  /** 牌背用第几个深浅变体。我们恒用 0 */
  backVariant: number;
  /**
   * **该槽位 `rotations` 数组的下标**，不是全局的「0=正面 / 1=背面」约定。
   *
   * 每个组的数组不一样，而 `slot.ts` 取 `places[rotationIndex]` 时**没有边界检查**：
   *
   * | 组 | rotations | 合法下标 |
   * |---|---|---|
   * | `loose@N` | `[FACE_UP, FACE_DOWN]` | 0=正面，1=背面 |
   * | `meld@N` / `discard@N` | `[FACE_UP]` | 只有 0 |
   * | `wall@N` | `[FACE_DOWN]` | **只有 0，而且 0 就是背面** |
   *
   * 所以「牌墙全部背面」不能写成 1——那会取到 undefined、位置算出 NaN。
   * meld / discard 侥幸不炸（正面恰好是 0），**只有牌墙会真的坏，而且坏得不明显**。
   */
  rotationIndex: number;
}

export interface DisplayState {
  /** 手牌区大小写开关（§4.9）。**纯显示**，只作用于手牌区，牌河与对手区永远大写 */
  lowercase: boolean;
}

/** 散牌区里正面朝上 / 背面朝上的 rotationIndex */
const LOOSE_FACE_UP = 0;
const LOOSE_FACE_DOWN = 1;
/** meld / discard 只有一种朝向；wall 的唯一一种朝向就是背面 */
const ONLY = 0;

/**
 * 别家未亮出的手牌与牌墙用的哑值牌面。
 *
 * **我们根本不知道那些牌是什么，也绝不能知道。** 若图省事把真实字母填进去，
 * 牌的正面就带着真牌面躺在 GPU 里——虽然朝向朝下看不见，但那是 `test_api.py`
 * 那条「别人的手牌绝不出门」红线的延伸面，不要去踩。
 */
const UNKNOWN_FACE = 0;

const VOWELS = "aeiou";
const CONSONANTS = "bcdfghjklmnpqrstvwxyz";
/** 与 `rules.py:11` 的 WILD_CANDIDATES 同一份约定 */
const WILD_CANDIDATES: Record<string, string> = { "1": VOWELS, "2": CONSONANTS };

/** 一张牌的牌面编号。白搭已声明就画声明的那个字母，未声明画星 */
export function faceOf(tile: string, wildLetter: string | undefined, lower: boolean): number {
  if (tile === "1" || tile === "2") {
    if (!wildLetter) return tile === "1" ? WILD_VOWEL : WILD_CONSONANT;
    return wildFace(tile, wildLetter, lower);
  }
  return letterFace(tile, lower);
}

/**
 * 把亮词/暗词的**排序串**还原成按 `word` 的摆牌顺序（需求文档 §10 第 6 条）。
 *
 * `melds` / `groups` 里的 `tiles` 是 `"".join(sorted(...))`（`api.py:456`），
 * 顺序只在 `word` 字段里。摆牌要按 word 走，否则玩家会看到一个拼不通的词。
 *
 * **含白搭时有歧义**：`word = "COD"`、`tiles = "1do"`，要按 `WILD_CANDIDATES`
 * 反推哪一位是白搭代替的。做法是先让真字母各就各位，剩下的位置才交给白搭，
 * 且白搭只能认领本类字母。
 *
 * 返回每一位要显示的 `{ tile, wildLetter }`；配不出来时退化成按排序串原样摆——
 * 显示得不好看，但不会崩。
 */
export function orderByWord(tiles: string, word: string): Array<{ tile: string; wild?: string }> {
  const pool = [...tiles];
  const out: Array<{ tile: string; wild?: string } | null> = new Array(word.length).fill(null);

  // ① 真字母优先认领自己的位置
  for (let i = 0; i < word.length; i++) {
    const at = pool.indexOf(word[i].toLowerCase());
    if (at >= 0) {
      out[i] = { tile: pool[at] };
      pool.splice(at, 1);
    }
  }
  // ② 剩下的位置交给白搭，且只能认领本类字母
  for (let i = 0; i < word.length; i++) {
    if (out[i]) continue;
    const letter = word[i].toLowerCase();
    const at = pool.findIndex((t) => WILD_CANDIDATES[t]?.includes(letter));
    if (at < 0) return [...tiles].map((t) => ({ tile: t })); // 配不出来，原样摆
    out[i] = { tile: pool[at], wild: letter };
    pool.splice(at, 1);
  }
  return out as Array<{ tile: string; wild?: string }>;
}

/** 一家的亮词区。亮词永远公开、永远正面、永远大写 */
function layMelds(melds: readonly Word[], seat: number, out: Placement[]): void {
  melds.forEach((meld, row) => {
    if (row >= MELD_ROWS) return; // 超出布局能放的行数，交给 T2.1 处理
    const cells = orderByWord(meld.tiles, meld.word);
    cells.forEach((cell, i) => {
      if (i >= meldSlots(row)) return;
      out.push({
        slotName: `meld.${row}.${i}@${seat}`,
        typeIndex: faceOf(cell.tile, cell.wild, false),
        backVariant: 0,
        rotationIndex: ONLY,
      });
    });
  });
}

/**
 * 摊开整个局面。
 *
 * `loose` 是 A 层的输出（只描述**自己**的散牌区）；别家的散牌区从 `handCount`
 * 和 `concealed` 现算。
 */
export function layout(state: State, loose: LooseSlots, display: DisplayState): Placement[] {
  const out: Placement[] = [];

  // ---- 自己的散牌区。暗词也住在这一排里（需求文档 §3），不是独立的区 ----
  loose.forEach((entry, i) => {
    if (!entry || i >= LOOSE_SLOTS) return;
    out.push({
      slotName: `loose.${i}@${state.me.seat}`,
      typeIndex: faceOf(entry.tile, entry.wildLetter, display.lowercase),
      backVariant: 0,
      rotationIndex: LOOSE_FACE_UP,
    });
  });

  layMelds(state.me.melds, state.me.seat, out);

  // ---- 别家 ----
  for (const other of state.others) {
    layMelds(other.melds, other.seat, out);

    // ⚠️ concealed 与 handCount 是**同一批牌**，不是两批。
    //
    // `engine.py:257` 的 commit_win 不清空 hand，只是给 concealed 记了一个拆法；
    // 荒牌路径同理。所以 concealed 非空时要**取代**该家的背面牌，不是额外再摆一份——
    // 摆两份就把牌数了两遍，而 Thing 池是零余量的 108，一开胡就会崩在
    // 「池子不够」这种看不出根因的地方。
    //
    // **但「取代」是部分的，不是整手。** 两条路径覆盖率不同：胡牌时 concealed
    // 恰好铺满整手；荒牌时 `greedy_words` 拼不出词就 return，剩下的散牌被丢掉，
    // 真人更极端（没组过词的直接是空数组）。所以剩下的 `handCount − 已覆盖张数`
    // 仍然是背面——写成「整手切换」的话，荒牌时别家那些拼不成词的散牌会凭空消失。
    let i = 0;
    for (const word of other.concealed) {
      for (const cell of orderByWord(word.tiles, word.word)) {
        if (i >= LOOSE_SLOTS) break;
        out.push({
          slotName: `loose.${i++}@${other.seat}`,
          typeIndex: faceOf(cell.tile, cell.wild, false),
          backVariant: 0,
          rotationIndex: LOOSE_FACE_UP,
        });
      }
    }
    for (; i < other.handCount && i < LOOSE_SLOTS; i++) {
      out.push({
        slotName: `loose.${i}@${other.seat}`,
        typeIndex: UNKNOWN_FACE,
        backVariant: 0,
        rotationIndex: LOOSE_FACE_DOWN,
      });
    }
  }

  // ---- 牌河：按座位分四片，靠 T0.4 加的 discardSeats ----
  const perSeat = new Array(PLAYERS).fill(0);
  const seats = state.discardSeats ?? [];
  state.discards.forEach((tile, k) => {
    const seat = seats[k];
    if (seat === undefined) return; // 字段缺失（老服务端）就整体不摆，不猜
    const n = perSeat[seat]++;
    if (n >= DISCARD_ROWS * DISCARD_COLS) return; // 摆不下，溢出留给 T2.1
    out.push({
      slotName: `discard.${Math.floor(n / DISCARD_COLS)}.${n % DISCARD_COLS}@${seat}`,
      // 白搭原则上不能打出，但那条规则有个有状态的例外（散牌区只剩白搭时放行，
      // 需求文档 §4.4），所以牌河里真会出现白搭——画成未声明的星，不能画成字母
      typeIndex: faceOf(tile, undefined, false),
      backVariant: 0,
      rotationIndex: ONLY,
    });
  });

  // ---- 牌墙：只表达还剩多少张，全部背面、不可交互 ----
  //
  // **四家轮流分**，不是一家填满了再填下一家：需求文档 §3 要的是「四家各一段」，
  // 按座位顺序铺的话开局就是 16/16/16/8，摸牌时还会整段整段地空掉一家——
  // 看起来像谁的牌墙塌了。轮流分则四家同进同退（开局 14/14/14/14）。
  const perWall = WALL_ROWS * WALL_COLS;
  for (let k = 0; k < state.wallLeft && k < PLAYERS * perWall; k++) {
    const seat = k % PLAYERS;
    const n = Math.floor(k / PLAYERS);
    out.push({
      slotName: `wall.${Math.floor(n / WALL_COLS)}.${n % WALL_COLS}@${seat}`,
      typeIndex: UNKNOWN_FACE,
      backVariant: 0,
      rotationIndex: ONLY, // 牌墙的 rotations 只有 [FACE_DOWN]，0 就是背面
    });
  }

  return out;
}

/** 牌面编号必须落在图集的正面段里。测试与运行时自检共用 */
export function isValidFace(typeIndex: number): boolean {
  return Number.isInteger(typeIndex) && typeIndex >= 0 && typeIndex < FACE_COUNT;
}
