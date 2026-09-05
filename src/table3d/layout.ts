/**
 * 桌面尺寸与槽位数量。**每个数字都要能追溯到 `sim/rules.py`，不许拍脑袋。**
 *
 * 这些常量只描述「最多可能出现多少张牌」，不含任何规则判断——规则永远在后端。
 */

/**
 * 桌面边长。沿用 Autotable 的 `WORLD_SIZE = 174`（需求文档 §7.1 要求牌体尺寸对齐，
 * 桌面跟着对齐才不用把它那套坐标全部重算）。1 个单位≈1 厘米。
 *
 * `Table3D.tsx` 画桌面用它，`setup-slots.ts` 的 `Slot.rotate()` 也用它当旋转中心，
 * 两处必须是同一个值——否则四家的槽位会绕着错误的圆心转。
 *
 * 174 是从牌的尺寸倒推的：`Size.TILE.x / WORLD_SIZE = 6 / 174 = 3.4%`，
 * 与真实麻将（牌宽 26mm / 桌宽 900mm ≈ 2.9%）接近。1 个单位≈5.2 毫米。
 */
export const WORLD_SIZE = 174;

// ---- 以下常量抄自 sim/rules.py，改那边就要同步改这边 ----

/** `rules.DEALER_HAND_SIZE` —— 庄家起手 14 张，也是任何时刻手牌的上限 */
const DEALER_HAND_SIZE = 14;
/** `rules.BUDGET` —— 14 张预算 */
const BUDGET = 14;
/** `rules.MELD_COST` —— 每亮一个词占 3 格预算，无论词多长 */
const MELD_COST = 3;
/** `rules.MIN_WORD_LEN` 的**最小可选值**。服务端限制 2..5（api.py:107） */
const MIN_WORD_LEN_FLOOR = 2;
/** `rules.DECK_SIZE` / `rules.HAND_SIZE` / `rules.PLAYERS` */
const DECK_SIZE = 108;
const HAND_SIZE = 13;
export const PLAYERS = 4;

/**
 * 散牌区槽位数。
 *
 * 下限是 `DEALER_HAND_SIZE = 14`（实测手牌峰值恰好是 14，全参数扫描 3000 局无一例外）。
 * 需求文档 §3 要求「按 14 张预算加少量余量」，余量是给拖动腾挪用的：
 * 往一排中间插牌时 `shiftLeft`/`shiftRight` 要有地方把牌挤过去，
 * 一格余量都没有就挤不动了（§4.1）。给 4 格。
 */
export const LOOSE_SLOTS = DEALER_HAND_SIZE + 4; // 18

/**
 * 亮词区的行数 = `rules.max_melds()` 的**最大可能值**。
 *
 * `max_melds() = (BUDGET - MIN_WORD_LEN) // MELD_COST`，是最短词长的推论。
 * 最短词长由玩家在设置页选（2/3/4，服务端放行到 5），最短词长越小能亮的词越多，
 * 所以布局要按最宽松的那档（2）来留：(14 - 2) // 3 = 4 行。
 */
export const MELD_ROWS = Math.floor((BUDGET - MIN_WORD_LEN_FLOOR) / MELD_COST); // 4

/**
 * 第 i 个亮词最多能有多长（= 那一行要留几格）。
 *
 * 亮词的长度上限就是**亮它的那一刻手上有多少张牌**。手牌从 13 起，摸牌 +1、
 * 每亮一个词净 -3（`engine.py:366` 的 reveal：拿掉 L 张、补摸 L-3 张），
 * 所以已经亮了 i 个词时手牌上限是 `DEALER_HAND_SIZE - MELD_COST * i`。
 *
 * 吃牌那条路也一样：吃是「打完牌的 13 张 + 吃进来的 1 张」，同样是 14 - 3i。
 *
 * 实测（4 家 AI 自对弈，minWordLen 2-5 × minWinWordLen 0/5/6/7/8 各 150 局，
 * 共 3000 局）第 i 个亮词的最长词长为 13 / 10 / 8 / 5，逐项不超过这里算出的
 * 14 / 11 / 8 / 5，且 i=2、i=3 两档正好顶到上限——说明这个界是紧的，不是虚的。
 */
export function meldSlots(row: number): number {
  return DEALER_HAND_SIZE - MELD_COST * row; // 14, 11, 8, 5
}

/** 亮词区一共几格（四行相加 = 38） */
export const MELD_SLOTS_TOTAL = Array.from({ length: MELD_ROWS }, (_, i) => meldSlots(i)).reduce(
  (a, b) => a + b,
  0,
);

/**
 * 每家牌河的槽位数：3 行 × 9 = 27。
 *
 * 理论上限没有意义——牌河总长受牌墙约束（见 WALL_SLOTS_TOTAL，56 张），
 * 但四家分得不均，单家的理论上限接近全场总数，按那个留会摆出一片荒地。
 *
 * 所以按实测取：同一次 3000 局扫描里，单座位牌河的峰值是 **21 张**
 * （minWordLen=3、minWinWordLen=7、seed=80）。27 格留了约 30% 余量。
 * 摆不下不会崩——溢出怎么处理是 T2.1 的事，这里只保证常见局面够用。
 */
export const DISCARD_ROWS = 3;
export const DISCARD_COLS = 9;

/**
 * 开局牌墙张数：`DECK_SIZE - PLAYERS * HAND_SIZE = 108 - 52 = 56`。
 * 四家分摊，每家身边要摆得下 14 张。
 */
export const WALL_TILES = DECK_SIZE - PLAYERS * HAND_SIZE; // 56
export const WALL_TILES_PER_SEAT = WALL_TILES / PLAYERS; // 14

/**
 * 牌墙的格子摆成 4 行 × 4 列 = 16 格，比要摆的 14 张多 2 格。
 *
 * 不是 2×7 那种正好 14 格的形状，是因为**桌面上只剩这一块地方放得下它**：
 * 散牌区、亮词区、牌河三家排完（还要给四家的旋转副本让路），每家身边只剩
 * `x 141..165 × y 45..81` 这一个 24×36 的空盒子，横着放不下 7 格（要 42 宽），
 * 只放得下 4×4。多出的 2 格空着就是了——牌墙不可交互（需求文档 §9 Q6），
 * 只是「还剩多少张」的视觉表达，空两格不影响任何操作。
 */
export const WALL_ROWS = 4;
export const WALL_COLS = 4;
export const WALL_SLOTS_TOTAL = PLAYERS * WALL_ROWS * WALL_COLS; // 64
