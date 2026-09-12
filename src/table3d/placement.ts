/**
 * B 层：`layout()`——从局面算出「每个槽位上摆一张什么样的牌」（T1.4 方案 §3）。
 *
 * 纯函数：同样的入参永远给出同样的输出，不碰 three.js、不碰 localStorage。
 * 散牌区的槽位来自 A 层的 `LooseSlots`，其余全部从 `state` 现算——
 * 服务端说什么就是什么，前端不推断、不记忆。
 */

import type { State, Word } from "../api";
import { FACE_COUNT, letterFace, WILD_CANDIDATES, WILD_CONSONANT, WILD_VOWEL, wildFace } from "./atlas";
import {
  DISCARD_COLS,
  DISCARD_ROWS,
  LOOSE_SLOTS,
  MELD_ROWS,
  meldSlots,
  PLAYERS,
  WALL_LAYERS,
  wallStacks,
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

/** 散牌区的两种朝向：0 = 平放正面朝上，1 = 立着（牌面朝那一家自己） */
const LOOSE_FACE_UP = 0;
/**
 * 别家没亮出来的手牌**立在自己面前**，牌面朝他本人、牌背朝桌心——
 * 真牌桌就是这样，我们只看得见背面。平着扣在桌上的是打出去的牌，不是手牌。
 */
const LOOSE_STANDING = 1;
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
    const at = pool.findIndex((t) => (t === "1" || t === "2") && WILD_CANDIDATES[t].includes(letter));
    if (at < 0) return [...tiles].map((t) => ({ tile: t })); // 配不出来，原样摆
    out[i] = { tile: pool[at], wild: letter };
    pool.splice(at, 1);
  }
  return out as Array<{ tile: string; wild?: string }>;
}

/**
 * 一家的亮词区。亮词永远公开、永远正面、永远大写。
 *
 * **一词一行、并且每个词都靠右端码齐**（§3：亮词区在右下角）。
 *
 * 行本身是右对齐的（`setup-slots.ts` 里每行从右边界往左退自己那么多格），但词
 * 未必占满一行——第 0 行有 14 格，亮一个 9 字母的词只用掉 9 格。若把词摆在
 * 行首，右边就空出 5 格 30 个单位，整块亮词区看着离桌角老远。所以词从**行尾**
 * 起算：末字母永远落在最右那格，紧贴桌沿。
 *
 * 每行 `meldSlots(i)` 格 = 14/11/8/5，正好是「亮第 i 个词时手上最多有几张牌」，
 * 所以放得下的词一定放得下；越界只可能是服务端改了预算常量而这里没跟上。
 */
function layMelds(melds: readonly Word[], seat: number, out: Placement[]): void {
  melds.forEach((meld, row) => {
    if (row >= MELD_ROWS) return; // 亮词数超过 max_melds()，只可能是常量脱节
    const cells = orderByWord(meld.tiles, meld.word);
    const width = meldSlots(row);
    // 靠右端码齐：长度不足就把左边空出来，不是把右边空出来
    const first = Math.max(0, width - cells.length);
    cells.forEach((cell, i) => {
      const col = first + i;
      if (col >= width) return;
      out.push({
        slotName: `meld.${row}.${col}@${seat}`,
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
        rotationIndex: LOOSE_STANDING,
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

  // ---- 牌墙：一条全局的逆时针链，只表达还剩多少张 ----
  //
  // 发牌与摸牌**从玩家侧牌墙的最左端起，逆时针绕桌一圈**，一墩一墩地取
  // （先上层后下层）。服务端只给 wallLeft，所以前端把这条链的**后 wallLeft 项**
  // 画出来即可——前面那些已经被摸走了。
  //
  // 开局 52 张发出去，正好啃掉玩家侧那 30 张和下家的 22 张：玩家面前的墙一开局
  // 就空了，与真牌桌一致。**这就是为什么不能各摸各的**——各家从自己面前摸的话，
  // 四堵墙会同进同退地一起变矮，那不是麻将。
  const chain: Array<{ seat: number; stack: number; layer: number }> = [];
  for (let seat = 0; seat < PLAYERS; seat++) {
    for (let stack = 0; stack < wallStacks(seat); stack++) {
      // 一墩两张，先取上层（layer = WALL_LAYERS-1）再取下层
      for (let layer = WALL_LAYERS - 1; layer >= 0; layer--) {
        chain.push({ seat, stack, layer });
      }
    }
  }
  for (let k = chain.length - state.wallLeft; k < chain.length; k++) {
    const at = chain[k];
    if (!at) continue; // wallLeft 比整副牌还多，不可能，但不为它崩
    out.push({
      slotName: `wall.${at.stack}.${at.layer}@${at.seat}`,
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
