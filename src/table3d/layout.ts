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
/** `rules.DECK_SIZE` / `rules.PLAYERS` */
const DECK_SIZE = 108;
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
 * 亮词区：**7 列 × 4 行 = 28 格的一块，词按行摆、放不下就折行。**
 *
 * ⚠️ **这块的形状是被牌墙挤出来的，不是从 rules.py 推出来的**，与需求文档 §3.3
 * 「4 行 14/11/8/5」不符——那 38 格是按「亮词长度上限 = 亮它那一刻手上有几张牌」
 * 算的理论上界，写它的时候桌面上还没有真正的牌墙。
 *
 * 摆上两层的牌墙（玩家侧 15 墩 = 90 长）之后，把四家的旋转副本一起算，
 * 桌上**最大的合法空矩形只剩 28 格**（7 列 × 4 行，x 18..60 × y 18..54）——
 * 一行 14 格 = 84 长的亮词行在 174 的桌面上根本站不下。
 *
 * 所以这版按 28 格摆，够 4 个 ≤7 字母的词；更长的词折行，占用下一行。
 * 真要塞下理论上界的 38 格，得改桌面尺寸或亮词区的呈现方式（缩放/叠压），
 * 那是布局层面的决定，不在 T2.1 里。
 */
export const MELD_ROWS = Math.floor((BUDGET - MIN_WORD_LEN_FLOOR) / MELD_COST); // 4
export const MELD_COLS = 7;

/** 第 i 行几格。现在每行一样长，签名留着是因为调用方按行取 */
export function meldSlots(_row: number): number {
  return MELD_COLS;
}

/** 亮词区一共几格（28）。**小于理论上界 38**，见上 */
export const MELD_SLOTS_TOTAL = MELD_ROWS * MELD_COLS;

/**
 * 每家牌河的槽位数：3 行 × 9 = 27。
 *
 * 理论上限没有意义——牌河总长受牌墙约束（开局 108 − 4×13 = 56 张可摸），
 * 但四家分得不均，单家的理论上限接近全场总数，按那个留会摆出一片荒地。
 *
 * 所以按实测取：同一次 3000 局扫描里，单座位牌河的峰值是 **21 张**
 * （minWordLen=3、minWinWordLen=7、seed=80）。27 格留了约 30% 余量。
 * 摆不下不会崩——溢出怎么处理是 T2.1 的事，这里只保证常见局面够用。
 */
export const DISCARD_ROWS = 3;
export const DISCARD_COLS = 9;

/**
 * 牌墙：**两层的墩，一条全局的逆时针链**，不是每家面前一个方块。
 *
 * 108 张分四个方向，每方向 27 张 = 13.5 墩。半墩（1 张）不好看，所以把四个半墩
 * 凑成的 4 张变成 2 墩，塞进**玩家那一侧**：玩家侧 15 墩，其余三家各 13 墩。
 *
 *     15 * 2 + 13 * 2 * 3 = 108
 *
 * 槽位数**正好等于一副牌**，零余量——开局时整副牌都码在墙上，这是它该有的样子。
 *
 * （立直麻将是 136 张、每家 17 墩，所以 Autotable 的 `row(19), stack()` 抄不得，
 * 只有「两层」和「一条线」这两点是共通的。）
 */
export const WALL_LAYERS = 2;
export const WALL_STACKS_PLAYER = 15;
export const WALL_STACKS_OTHER = 13;
export const WALL_SLOTS_TOTAL =
  (WALL_STACKS_PLAYER + WALL_STACKS_OTHER * (PLAYERS - 1)) * WALL_LAYERS; // 108

/**
 * 发牌与摸牌的顺序：**从玩家侧牌墙的最左端起，逆时针绕桌一圈**，
 * 一墩一墩地取（先上层后下层）。座位号每 +1 就是逆时针转 90°，所以座位顺序
 * 就是 0 → 1 → 2 → 3。
 *
 * 这条链是**渲染唯一需要的东西**：服务端只给 `wallLeft`（还剩几张），
 * 前端把这条链的**后 wallLeft 项**画出来即可。开局 52 张发出去，正好啃掉
 * 玩家侧那 30 张和下家的 22 张——玩家面前的墙一开局就空了，与真牌桌一致。
 */
export function wallStacks(seat: number): number {
  return seat === 0 ? WALL_STACKS_PLAYER : WALL_STACKS_OTHER;
}

/**
 * 渲染实例池的大小 = `rules.DECK_SIZE`。
 *
 * 全副牌在任何时刻都分布在散牌区、亮词区、牌河、牌墙里，同时可见的上限就是 108，
 * 不需要回收机制。**注意这是零余量**：将来任何「多渲一张」的场景（拖动中的 ghost、
 * 动画里的过渡副本）都要给池子加余量，不能挤占现有的 108（T1.4 方案 §4.2）。
 */
export const TILE_COUNT = DECK_SIZE; // 108
