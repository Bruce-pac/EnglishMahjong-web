import type { Pending } from "../api";

/**
 * 现在能不能提交打牌（T3.4）。**只读 `pending` 的状态，不做任何规则判断**——
 * 能不能打白搭、打的牌在不在手里，一律交给服务端判，前端照常提交、显示它的 400。
 *
 * - `discard`：该出牌了
 * - `reveal`：摸牌后的「要不要亮词」。直接打牌服务端当作放弃亮词
 *   （`api.py` 的 act，有 `test_discard_during_reveal_decision_is_implicit_pass` 守着）
 * - `chi` / `win` / 没轮到你：不能打
 *
 * `busy` = 上一个请求还没回来。锁住，防止连打两张。
 */
export function canDiscard(pending: Pending | null, busy: boolean): boolean {
  if (busy || !pending) return false;
  return pending.kind === "discard" || pending.kind === "reveal";
}

/** 这时候要不要显示「过」：等吃 / 胡的决策、且服务端说可以过 */
export function canPass(pending: Pending | null, busy: boolean): boolean {
  if (busy || !pending) return false;
  return (pending.kind === "chi" || pending.kind === "win") && pending.canPass;
}

/** 要打哪张：tileId 给对账消歧（consumedTileIds），tile 是提交给服务端的牌面字符 */
export interface DiscardIntent {
  tileId: number;
  tile: string;
}
