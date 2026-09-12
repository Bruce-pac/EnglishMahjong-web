/**
 * 散牌区存档（T1.4 方案 §6）。
 *
 * **只存 A 层。** C 层的 `lastSlotName` 不持久化——刷新后 Thing 全部重建，
 * 没有视觉连续性可保，首帧按下标分配即可。
 *
 * 存的是玩家意图（顺序、白搭声明、大小写开关），服务端不知道也不该知道这些。
 */

import { LOOSE_SLOTS } from "./layout";
import type { LooseSlots } from "./loose-reconcile";

const VERSION = 1;
const PREFIX = "emj3d.loose.";
/** 多久没动过的记录算过期。覆盖不到「关了标签页再也不回来」的牌局，读取时顺手清 */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface LooseSave {
  version: number;
  matchId: string;
  loose: LooseSlots;
  display: { lowercase: boolean };
  /** 单调发号器；tileId 永不回收（方案 §2 规则 3），跨局也一样 */
  nextTileId: number;
  /**
   * 存档时是这一场的第几局（`gameIndexOf`，从 0 数；**不是** state.gamesPlayed——那个在结算时就加 1 了）。
   * T6.3 加的可选字段：同一场的下一局 matchId 不变，刷新时读到上一局的存档，要靠它认出来、
   * 不把上一局的散牌区身份带进新一局。没有这个字段的存档按「同一局」处理
   */
  gameIndex?: number;
  updatedAt: number;
}

/**
 * 键里带 matchId，是为了开新局时旧记录**自然失效**，不会被新局误读；
 * 清理靠 `clear()` 的两条时机，不靠覆盖。
 *
 * 同一局开两个标签页会互相覆盖存档。真实但罕见，后果只是顺序乱、不影响正确性，
 * 初版不处理。
 */
function key(matchId: string): string {
  return PREFIX + matchId;
}

function store(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null; // 隐私模式 / 禁用了站点数据。存不了就退化成「每次刷新重排」，不能崩
  }
}

export function save(matchId: string, s: Omit<LooseSave, "version" | "matchId" | "updatedAt">): void {
  const ls = store();
  if (!ls) return;
  const payload: LooseSave = { version: VERSION, matchId, updatedAt: Date.now(), ...s };
  try {
    ls.setItem(key(matchId), JSON.stringify(payload));
  } catch {
    // 配额满了之类。存档丢了只是顺序丢了，不该把牌局带崩
  }
}

/**
 * 读存档。**任何不对劲都返回 null，让调用方从零重建**——
 * 顺序丢了总比显示错了强（方案 §2 规则 5）。
 */
export function load(matchId: string): LooseSave | null {
  const ls = store();
  if (!ls) return null;
  sweep(ls);
  const raw = ls.getItem(key(matchId));
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as LooseSave;
    if (p.version !== VERSION) return null;
    if (p.matchId !== matchId) return null;
    // 长度对不上说明布局常量变过，按版本不认处理
    if (!Array.isArray(p.loose) || p.loose.length !== LOOSE_SLOTS) return null;
    if (!Number.isInteger(p.nextTileId)) return null;
    if (typeof p.display?.lowercase !== "boolean") return null;
    return p;
  } catch {
    return null;
  }
}

/**
 * 清掉这一局的存档。两条时机：
 * - 结算时（`matchFinished` 或 `result` 非空）
 * - `GET /matches/{id}` 返回 404 时（服务器重启丢局——牌局只存内存是 DESIGN.md §3 的有意取舍）
 */
export function clear(matchId: string): void {
  const ls = store();
  if (!ls) return;
  try {
    ls.removeItem(key(matchId));
  } catch {
    /* 清不掉就算了，下次 sweep 会收 */
  }
}

/** 顺手清掉过期记录。量很小，但不该无限堆着 */
function sweep(ls: Storage): void {
  try {
    const dead: string[] = [];
    for (let i = 0; i < ls.length; i++) {
      const k = ls.key(i);
      if (!k || !k.startsWith(PREFIX)) continue;
      const raw = ls.getItem(k);
      if (!raw) continue;
      let at = 0;
      try {
        at = (JSON.parse(raw) as LooseSave).updatedAt ?? 0;
      } catch {
        at = 0; // 解析不了的直接算过期
      }
      if (Date.now() - at > MAX_AGE_MS) dead.push(k);
    }
    for (const k of dead) ls.removeItem(k);
  } catch {
    /* 遍历失败不影响主流程 */
  }
}
