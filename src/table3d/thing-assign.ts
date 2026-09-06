/**
 * C 层：`assignThings()`——决定每个 Placement 由**哪个渲染实例**来演（T1.4 方案 §4）。
 *
 * 移植自参照实现 `Mahjong/app/src/render/thing-assign.ts`。
 *
 * 最朴素的做法是按下标对应（`placements[i]` → `things[i]`），但那让 Thing 的身份在
 * 两次重绘之间毫无关联——同一个实例上一帧还在你手里，下一帧可能跑到对家牌河。
 * 位置动画（T5.1）要求身份稳定，所以改成三轮匹配：
 *
 *   ⓪ 调用方指定  → 牌面无法区分时的通道（别家的暗手牌，见下）
 *   ① 槽位与牌面都没变 → 原地不动的牌，绝大多数
 *   ② 牌面相同 → 移动了的牌（摸、打、组词、重排）
 *   ③ 剩下的随便配 → 只在牌面本就要换时（白搭改字母、切大小写）
 *
 * 前面轮次占用过的 Thing 不再参与后面的轮次。
 *
 * 不碰 three.js，纯数据，可单测。
 */

import type { Placement } from "./placement";

/**
 * @param lastSlotName 上一帧每个 Thing 在哪个槽位。为空（首帧、或刷新后）时按下标直接分配
 * @param typeIndexOf **读上一帧已提交的 `Thing.typeIndex`**——所以本函数必须跑在
 *   渲染提交之前。顺序反了就会读到本帧的新值，轮 ① / ② 的比较全部退化成自比自，
 *   三轮匹配等于没做
 * @param pinned 目标槽位 → 来源槽位。见 §4.1
 */
export function assignThings(
  placements: ReadonlyArray<Placement>,
  lastSlotName: ReadonlyMap<number, string>,
  typeIndexOf: (thingIndex: number) => number,
  allTileIndices: ReadonlyArray<number>,
  pinned?: ReadonlyMap<string, string>,
): number[] {
  const n = placements.length;
  if (lastSlotName.size === 0) {
    return placements.map((_, i) => allTileIndices[i]);
  }

  const assign: number[] = new Array(n).fill(-1);
  const used = new Set<number>();

  const bySlot = new Map<string, number>();
  const byType = new Map<number, number[]>();
  for (const [idx, slotName] of lastSlotName) {
    bySlot.set(slotName, idx);
    const t = typeIndexOf(idx);
    const list = byType.get(t);
    if (list) list.push(idx);
    else byType.set(t, [idx]);
  }

  // ⓪ 调用方指定的「这张牌是从那个槽位过来的」。
  //    别家的暗手牌 typeIndex 全是哑值 0，谁被打出来靠牌面根本区分不了，
  //    只能由调用方依据事件指定（那是 T5.1 的活）。
  //    **自己的牌用不上 pinned**：每张字母的 typeIndex 各不相同，白搭声明了不同字母
  //    也落在 54..105 的不同格上，轮 ① / ② 本来就配得对。散牌区的歧义在 A 层，
  //    走的是 reconcileLoose 的 consumedTileIds，是另一个通道，别混为一谈。
  if (pinned) {
    for (let i = 0; i < n; i++) {
      const src = pinned.get(placements[i].slotName);
      if (src === undefined) continue;
      const t = bySlot.get(src);
      if (t === undefined || used.has(t)) continue;
      assign[i] = t;
      used.add(t);
    }
  }

  // ① 原地不动
  for (let i = 0; i < n; i++) {
    if (assign[i] !== -1) continue;
    const t = bySlot.get(placements[i].slotName);
    if (t === undefined || used.has(t)) continue;
    if (typeIndexOf(t) !== placements[i].typeIndex) continue;
    assign[i] = t;
    used.add(t);
  }

  // ② 同牌面的移动
  for (let i = 0; i < n; i++) {
    if (assign[i] !== -1) continue;
    const list = byType.get(placements[i].typeIndex);
    if (!list) continue;
    const pick = pickCandidate(list, used, placements[i].slotName, lastSlotName);
    if (pick === null) continue;
    assign[i] = pick;
    used.add(pick);
  }

  // ③ 兜底
  const spare: number[] = [];
  for (const idx of allTileIndices) if (!used.has(idx)) spare.push(idx);
  let k = 0;
  for (let i = 0; i < n; i++) {
    if (assign[i] !== -1) continue;
    const idx = spare[k++];
    if (idx === undefined) {
      throw new Error(`assignThings: 候选耗尽（placements=${n}, things=${allTileIndices.length}）`);
    }
    assign[i] = idx;
  }
  return assign;
}

/** 槽位名 → 「组 + 座位」键：`loose.3@0` → `loose@0`、`wall.2.1@1` → `wall@1` */
function slotKey(name: string): string {
  const at = name.indexOf("@");
  const seat = at < 0 ? "" : name.slice(at);
  const dot = name.indexOf(".");
  const group = dot < 0 ? (at < 0 ? name : name.slice(0, at)) : name.slice(0, dot);
  return group + seat;
}

/**
 * 在同牌面的候选里**优先挑原本同座位同组的**。
 *
 * 不这么做，手牌整体平移一格会退化成满桌乱飞——参照实现的注释专门点了这条。
 */
function pickCandidate(
  list: ReadonlyArray<number>,
  used: ReadonlySet<number>,
  targetSlot: string,
  lastSlotName: ReadonlyMap<number, string>,
): number | null {
  const want = slotKey(targetSlot);
  let fallback: number | null = null;
  for (const idx of list) {
    if (used.has(idx)) continue;
    const from = lastSlotName.get(idx);
    if (from !== undefined && slotKey(from) === want) return idx;
    if (fallback === null) fallback = idx;
  }
  return fallback;
}
