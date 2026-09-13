/**
 * T2.2 中央记分盘：数据那一层（需求文档 §6.1）。纯函数，画布那一层只吃这里的输出。
 *
 * - 四条边：英文方位 + 该家 `matchScores[seat]`。座位 `(dealer + k) % 4` 是第 k 个方位（E→S→W→N），
 *   座位号每 +1 就是逆时针转 90°（`SEAT_ROTATIONS`），逆时针就是出牌顺序
 * - East 就是庄家标记，不另画庄
 * - 中央：牌墙剩余 + `Game N/M`
 * - 盘上不画名字；分数原样照抄服务端，前端不算任何分数
 */

import type { Envelope, GameEvent } from "../api";
import { gameIndexOf } from "./table-view";

export const WINDS = ["East", "South", "West", "North"] as const;
export type Wind = (typeof WINDS)[number];

export interface BoardSide {
  seat: number;
  wind: Wind;
  score: number;
  /** 当前行动的那一家 */
  lit: boolean;
}

export interface BoardModel {
  /** 按座位号排，sides[s].seat === s */
  sides: BoardSide[];
  wallLeft: number;
  /** 第几局（从 1 数），带 result 时仍是刚打完那一局 */
  game: number;
  maxGames: number;
}

/**
 * 庄家座位。envelope 没有庄家字段，但服务端结算时 gamesPlayed 与庄家同时加 1（`session.py:162`、`:294`），
 * 所以庄家 = 这是第几局 % 4；`gameIndexOf` 在带 result 时已经减了 1
 */
export function dealerOf(env: Envelope): number {
  return gameIndexOf(env) % 4;
}

/**
 * 现在亮哪一边（用户定的优先级，从高到低）：
 * 1. 带 result（结算中）：不亮
 * 2. 回放中：当前事件的座位（`replayActor`，由 `nextReplayActor` 逐步维护）
 * 3. 有 pending（轮到自己决策，含吃 / 胡）：亮自己。**不照 state.turn**——吃 / 胡时它还是打牌的那家
 * 4. 其余：state.turn（比如自己已经胡了、在等别家）
 */
export function actorOf(env: Envelope, replayActor: number | null): number | null {
  if (env.result) return null;
  if (replayActor !== null) return replayActor;
  if (env.pending) return env.state.me.seat;
  return env.state.turn;
}

/** 回放推进一步后的行动方：事件有座位就换成它，没有（如 exhausted）就保持上一步 */
export function nextReplayActor(prev: number | null, e: GameEvent): number | null {
  return e.seat ?? prev;
}

export function boardModel(env: Envelope, actor: number | null): BoardModel {
  const dealer = dealerOf(env);
  const sides: BoardSide[] = [];
  for (let seat = 0; seat < 4; seat++) {
    sides.push({
      seat,
      wind: WINDS[(seat - dealer + 4) % 4],
      score: env.state.matchScores[seat] ?? 0,
      lit: seat === actor,
    });
  }
  return {
    sides,
    wallLeft: env.state.wallLeft,
    game: gameIndexOf(env) + 1,
    maxGames: env.state.maxGames,
  };
}

/** model 序列化成 key：key 没变就不重画 */
export function boardKey(m: BoardModel): string {
  return JSON.stringify(m);
}
