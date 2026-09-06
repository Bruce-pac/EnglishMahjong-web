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
 * 散牌区这一排**按满手 14 张居中**，多出来的 4 格腾挪余量挂在右边（见 setup-slots）。
 *
 * 整排 18 格居中的话，手牌从第 0 格左对齐排起，画面上永远偏左两格——
 * 满手的时候尤其明显。居中的应该是**牌**，不是那排空格子。
 */
export const LOOSE_CENTERED_ON = DEALER_HAND_SIZE; // 14

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
 * 牌墙的格子摆成 4 列 × 4 行 = 16 格，比要摆的 14 张多 2 格。
 *
 * 形状由**它待的那块地方**决定。需求文档 §3.1 要牌墙夹在散牌区与牌河之间
 * （照 Autotable：hand y=0 / wall y=20 / discard y=60），而 0 号座位在那条带子上
 * 只剩 `x 45..81 × y 9..33` 这一块 36×24 的空地：左边 x 9..45 是**下家亮词区**
 * 转过来的阶梯，右边 x 81 起是自家亮词区第 0 行，上边 y 33 起是自家牌河。
 *
 * 36×24 塞不下 3 行竖放的牌（要 27 高），竖放只放得下 6×2 = 12 格，不够 14 张。
 * 所以牌墙的牌**侧躺**（绕 z 转 90°，占地 9×6），4 列 × 4 行正好填满 36×24。
 * 多出的 2 格空着——牌墙不可交互（需求文档 §9 Q6），只是「还剩多少张」的视觉表达。
 */
export const WALL_ROWS = 4;
export const WALL_COLS = 4;
export const WALL_SLOTS_TOTAL = PLAYERS * WALL_ROWS * WALL_COLS; // 64

/**
 * 渲染实例池的大小 = `rules.DECK_SIZE`。
 *
 * 全副牌在任何时刻都分布在散牌区、亮词区、牌河、牌墙里，同时可见的上限就是 108，
 * 不需要回收机制。**注意这是零余量**：将来任何「多渲一张」的场景（拖动中的 ghost、
 * 动画里的过渡副本）都要给池子加余量，不能挤占现有的 108（T1.4 方案 §4.2）。
 */
export const TILE_COUNT = DECK_SIZE; // 108
