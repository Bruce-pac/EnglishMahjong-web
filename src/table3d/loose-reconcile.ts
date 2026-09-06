/**
 * A 层：散牌区身份对账（T1.4 方案 §2）。
 *
 * 服务端下发的是**排序过的多重集**，没有牌张 id；而 D3 要求散牌区的顺序由玩家自己拖。
 * 「哪张牌在哪一格」因此是服务端不知道也推不出来的东西，只能由前端自己记。
 * 这一层就是那份记忆：拿新 envelope 和上一帧的记录对账，尽量让**已经在场上的牌
 * 一格都不动**——那是玩家亲手排的顺序，动了 D3 就废了。
 *
 * 这个文件不碰 three.js，纯数据，可单测。
 */

import type { Me, Word } from "../api";
import { LOOSE_SLOTS } from "./layout";

export interface LooseEntry {
  /** 前端自有的牌张 id。一张牌从进散牌区到离开始终不变，**永不回收**（见下） */
  tileId: number;
  /** 牌面字符：`'c'` / `'1'`（元音白搭）/ `'2'`（辅音白搭） */
  tile: string;
  /**
   * 白搭声明代表哪个字母。
   *
   * **必须挂在 tileId 上，不能挂在槽位上。** 挂槽位的话，对账一旦把牌挪了位置
   * （前面一张被打掉、或玩家拖动），声明会留在原地被后来的牌捡走——那正是
   * 方案 §7 第 4 条不变式要抓的 bug，schema 自己不能制造它。
   */
  wildLetter?: string;
  /**
   * 属于哪个暗词。**每帧由配对结果重新赋值，不跨帧沿用**——服务端一旦重排
   * groups（`prune_groups` 打散一个之后后面的整体前移），沿用的 id 会集体错位。
   * 它只在当帧内表达「这几张属于同一组」。
   */
  groupId?: number;
}

/** 按散牌区槽位下标排列，空格是 null。长度恒为 `LOOSE_SLOTS` */
export type LooseSlots = Array<LooseEntry | null>;

export interface ReconcileResult {
  slots: LooseSlots;
  /** 单调递增的发号器。**tileId 永不回收**——回收会制造 ABA：同一个 id 先后指
      两张不同的牌，白搭声明就可能张冠李戴 */
  nextTileId: number;
  /** 是否放弃了 prev 从零重建（方案 §2 规则 5）。调用方可以据此决定要不要提示 */
  rebuilt: boolean;
}

/** 对账用的最小 me 视图。只要这三个字段，测试里造 fixture 不必凑整个 Me */
export type ReconcileMe = Pick<Me, "hand" | "groups">;

function emptySlots(): LooseSlots {
  return new Array(LOOSE_SLOTS).fill(null);
}

/**
 * prev 是不是一份结构上可用的存档。
 *
 * 只查结构，不查内容——内容对不对是对账本身的事。结构坏了（长度不对、tileId 重复
 * 或不是数字、tile 不是字符串）说明存档来自别的版本或者被手改过，
 * 这时按方案 §2 规则 5 从零重建：顺序丢了总比显示错了强。
 */
function isUsable(prev: LooseSlots): boolean {
  if (!Array.isArray(prev) || prev.length !== LOOSE_SLOTS) return false;
  const seen = new Set<number>();
  for (const e of prev) {
    if (e === null) continue;
    if (typeof e !== "object") return false;
    if (!Number.isInteger(e.tileId) || e.tileId < 0) return false;
    if (typeof e.tile !== "string" || e.tile.length !== 1) return false;
    if (seen.has(e.tileId)) return false;
    seen.add(e.tileId);
  }
  return true;
}

/** 多重集计数 */
function counts(tiles: readonly string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of tiles) m.set(t, (m.get(t) ?? 0) + 1);
  return m;
}

/**
 * 把这一帧的暗词分组标到 entry 上。
 *
 * `me.groups` 里的 `tiles` 是**排序串**，两个暗词的 tiles 完全可能相同
 * （同时持有 `"act"`→CAT 和 `"act"`→ACT），所以按 `(tiles, word)` 配对，
 * 连 word 都相同时按下标顺序兜底——这里的实现天然满足：按 groups 数组顺序
 * 逐个贪心取牌，取过的不再参与。
 */
function assignGroupIds(slots: LooseSlots, groups: readonly Word[]): void {
  for (const e of slots) if (e) delete e.groupId;

  const taken = new Set<number>();
  groups.forEach((g, gi) => {
    const picked: LooseEntry[] = [];
    for (const letter of g.tiles) {
      const hit = slots.find(
        (e): e is LooseEntry => e !== null && !taken.has(e.tileId) && e.tile === letter,
      );
      // 配不齐就整组放弃：宁可这一帧不显示分组，也不要标出半个暗词
      if (!hit) return;
      taken.add(hit.tileId);
      picked.push(hit);
    }
    for (const e of picked) e.groupId = gi;
  });
}

/** 从零重建：按 hand 的顺序铺满前几格。刷新后第一帧、以及存档不可用时走这里 */
export function rebuildLoose(me: ReconcileMe, nextTileId: number): ReconcileResult {
  const slots = emptySlots();
  let id = nextTileId;
  me.hand.forEach((tile, i) => {
    if (i < LOOSE_SLOTS) slots[i] = { tileId: id++, tile };
  });
  assignGroupIds(slots, me.groups);
  return { slots, nextTileId: id, rebuilt: true };
}

/**
 * 拿新 envelope 和上一帧的记录对账。
 *
 * **比对基是 `me.hand`，不是 `me.loose`。** `loose_tiles()`（`engine.py:127`）排除了
 * 已组进暗词的牌，而需求文档 §3 定的是「暗词就住在 loose@N 这一排里」——拿 loose 当基，
 * 玩家一组暗词那几张就从多重集里消失、命中下面的「腾空格子」，暗词当场从散牌区蒸发。
 * `me.hand` = 散牌 + 暗词牌，正是这一排该装的全部。
 *
 * 选对基还白捡一个好处：`engine.py:547` 的 `prune_groups()` 会在手牌变化后**静默打散
 * 不再成立的暗词**（`reveal` 末尾就会调）。以 hand 为基时这件事对槽位毫无影响——
 * 牌还在那儿，只是 groupId 没了。
 *
 * @param consumedTileIds 前端自己发起的操作（打牌、组暗词、亮词）知道消耗掉的是哪几张，
 *   填进来消除重复字母的歧义：手牌 `[C][A][T][A]` 打掉一个 A，空出槽位 1 还是槽位 3，
 *   决定了剩下是 `C _ T A` 还是 `C A T _`。填不了时退化到「按下标从左到右取」。
 */
export function reconcileLoose(
  me: ReconcileMe,
  prev: LooseSlots,
  nextTileId: number,
  consumedTileIds: readonly number[] = [],
): ReconcileResult {
  if (!isUsable(prev)) return rebuildLoose(me, nextTileId);

  const consumed = new Set(consumedTileIds);
  const slots: LooseSlots = prev.map((e) => (e && !consumed.has(e.tileId) ? { ...e } : null));

  // ① 留：两边都有的字母，tileId 与槽位都不动。这是全部意义所在
  const want = counts(me.hand);
  for (let i = 0; i < slots.length; i++) {
    const e = slots[i];
    if (!e) continue;
    const left = want.get(e.tile) ?? 0;
    if (left > 0) {
      want.set(e.tile, left - 1);
    } else {
      // ② 腾：prev 有而 hand 没有的。consumedTileIds 没覆盖到时落到这里，
      //    同字母按下标从左到右取——歧义在此消解，规则是确定的
      slots[i] = null;
    }
  }

  // ③ 添：hand 多出来的是新进手的牌（摸的 / 亮词补摸的），发新 tileId
  const fresh: string[] = [];
  for (const [tile, n] of want) for (let k = 0; k < n; k++) fresh.push(tile);

  let id = nextTileId;
  for (const tile of fresh) {
    const at = slots.indexOf(null);
    // 散牌区 18 格、手牌上限 14 张，正常填不满；填满了说明存档和局面已经对不上
    if (at < 0) return rebuildLoose(me, id);
    slots[at] = { tileId: id++, tile };
  }

  assignGroupIds(slots, me.groups);
  return { slots, nextTileId: id, rebuilt: false };
}

/**
 * 本地拖动重排：把 `from` 格的牌移到 `to` 格。
 *
 * 纯本地、不上报服务端（D3）。目标格有牌就两者对调——沿 shiftLeft/shiftRight 链
 * 挤开是 T3.2 的事，这里只提供对账层认得的最小语义，好让测试能注入本地操作。
 */
export function moveLoose(slots: LooseSlots, from: number, to: number): LooseSlots {
  const next = slots.slice();
  if (from < 0 || to < 0 || from >= next.length || to >= next.length) return next;
  const tmp = next[to];
  next[to] = next[from];
  next[from] = tmp;
  return next;
}

/** 给白搭声明代表的字母（§4.4，随时可改）。声明跟着 tileId 走，不跟着槽位走 */
export function declareWild(slots: LooseSlots, tileId: number, letter: string): LooseSlots {
  return slots.map((e) => (e && e.tileId === tileId ? { ...e, wildLetter: letter } : e));
}
