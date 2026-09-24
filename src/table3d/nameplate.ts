/**
 * P4：正交视角下桌沿木框上的名牌。每个 AI 一块，正对该家座位、贴在那一侧木框顶面的中点。
 *
 * 名牌是 DOM 覆盖层，调用方每帧把这里给的锚点投影到屏幕（同「第 N 胡」）。
 * 这里只算锚点、转角和文字，方便单测。
 */

import { Vector3 } from "three";
import { PLAYERS, WORLD_SIZE } from "./layout";
import { AI_NAMES } from "./names";
import { Size, ThingType } from "./types";
import { SEAT_ROTATIONS } from "./utils";

/** 桌面边长：比槽位区多一个牌高（Table3D 建桌面时用的同一个数） */
export const TABLE_SIZE = WORLD_SIZE + Size[ThingType.TILE].y;
/** P16 木框：边条宽 T、高 H，底面在 z = −0.5，所以顶面在 z = H − 0.5 */
export const RIM_WIDTH = 7;
export const RIM_HEIGHT = 3;

export interface Nameplate {
  seat: number;
  label: string;
  /** 世界坐标：那一侧木框顶面的中点 */
  anchor: Vector3;
  /** 屏幕上转多少度：对家 0，右边（下家）顺时针 +90，左边（上家）逆时针 −90 */
  angle: number;
}

/**
 * 三块名牌。按**自己的座位**换算相对方位：相机组跟着自己的座位转，
 * 所以「下家在右、对家在上、上家在左」对任何座位都成立
 */
export function nameplates(mySeat: number): Nameplate[] {
  const c = WORLD_SIZE / 2;
  const out: Nameplate[] = [];
  for (let seat = 0; seat < PLAYERS; seat++) {
    if (seat === mySeat) continue;
    // 座位 0 那根木框的中心，再绕桌心转到该家
    const p = new Vector3(0, -TABLE_SIZE / 2 - RIM_WIDTH / 2, 0).applyQuaternion(SEAT_ROTATIONS[seat]);
    const anchor = new Vector3(c + p.x, c + p.y, RIM_HEIGHT - 0.5);
    const rel = (seat - mySeat + PLAYERS) % PLAYERS;
    const angle = rel === 1 ? 90 : rel === 3 ? -90 : 0;
    out.push({ seat, label: AI_NAMES[seat] ?? `${seat} 号`, anchor, angle });
  }
  return out;
}
