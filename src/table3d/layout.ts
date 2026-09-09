/**
 * 桌面尺寸与槽位数量。**每个数字都要能追溯到 `sim/rules.py`，不许拍脑袋。**
 *
 * 这些常量只描述「最多可能出现多少张牌」，不含任何规则判断——规则永远在后端。
 */

/**
 * 桌面边长。**222，不是 Autotable 的 174。**
 *
 * 174 是照抄 Autotable 的，抄的时候只对齐了牌的尺寸，没对齐**牌占桌面的比例**——
 * 而我们每家要摆的东西比立直麻将多得多：
 *
 * | | Autotable | 我们（W=174） | 我们（W=222） |
 * |---|---|---|---|
 * | 手牌排占桌宽 | 84/174 = 48% | 108/174 = **62%** | 108/222 = **49%** |
 * | 中央空地占桌宽 | 36/174 = 21% | 54/174 = **31%** | 42/222 = **19%** |
 * | 牌宽占桌宽 | 3.45% | 3.45% | 2.70% |
 *
 * 我们的散牌区是 18 格（立直是 14 格）、亮词区最长一行 14 格、牌墙一侧 15 墩——
 * 这些东西在 174 的桌上一圈围下来把四周挤满，中间却空着 54×54，
 * 看起来就是「桌子小、当中一个大洞」。放到 222 之后手牌排占桌宽与 Autotable
 * 几乎相同、中央空地比它还紧凑，四条带子（手牌 / 牌墙 / 亮词 / 牌河）
 * 正好一层层码在身前。
 *
 * 牌宽占比 2.70%，比真实麻将（26mm / 900mm ≈ 2.9%）略小，仍在同一档。
 * 1 个单位 ≈ 4.1 毫米。
 *
 * `Table3D.tsx` 画桌面用它，`setup-slots.ts` 的 `Slot.rotate()` 也拿它当旋转中心，
 * 两处必须是同一个值——否则四家的槽位会绕着错误的圆心转。相机也全部按它取景
 * （`main-view.ts` 的 `WORLD_SIZE * 1.2` 等），所以改这个数不必动相机。
 */
export const WORLD_SIZE = 222;

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
 * 整排 18 格**居中**，多出来的 4 格腾挪余量**左右各 2 格**——不是全挂在右边。
 *
 * 于是满手 14 张落在正中间的 14 格里（下标 2..15），画面上是对称的；
 * 往左往右都有地方挤牌（`shiftLeft` / `shiftRight`），也不必只能往一个方向腾。
 *
 * 「初始手牌摆在哪几格」是 A 层的事（`rebuildLoose` 会把牌居中铺），
 * 这里只负责让**格子**居中。
 */
export const LOOSE_SPARE_EACH_SIDE = 2;


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
 * 吃牌那条路也一样：吃是「打完牌的 13 张 + 吃进来的 1 张」，同样是 14 - 3i。
 *
 * 实测（3000 局扫描）第 i 个亮词的最长词长为 13 / 10 / 8 / 5，逐项不超过这里算出的
 * 14 / 11 / 8 / 5，且 i=2、i=3 两档正好顶到上限——说明这个界是紧的，不是虚的。
 *
 * ⚠️ 这一整块在 **174 的桌面上站不下**：最长一行 84 长，摆上两层牌墙之后
 * 桌上最大的合法空矩形只剩 28 格（穷举四家旋转副本之后的结论）。
 * 桌面放大到 222 才容得下——这是 WORLD_SIZE 改数的直接原因之一。
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
 * 每家牌河：**7 列 × 4 行 = 28 格**。
 *
 * 列数不是随便取的，它**同时决定中央空地的边长**：四家的牌河要拼成风车，
 * 内侧边必须正好切在中央空地上，于是「空地边长 = 牌河宽度」（见 setup-slots.ts
 * 文件头约束 ①）。7 列 × 6 = 42，空地就是 42×42 —— 占桌宽 19%，比 Autotable
 * 的 21% 还紧凑。原来的 9 列在 174 的桌上给出 54×54、占 31%，中间空得发慌。
 *
 * 行数按容量取：3000 局扫描里单座位牌河峰值 **21 张**
 * （minWordLen=3、minWinWordLen=7、seed=80），28 格留约 30% 余量。
 * 摆不下不会崩——溢出是显示问题，不影响任何规则。
 */
export const DISCARD_ROWS = 4;
export const DISCARD_COLS = 7;

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
