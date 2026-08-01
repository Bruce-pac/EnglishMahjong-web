/**
 * 场景层的数据接口。
 *
 * 场景层（scene/）是**可替换的渲染层**：只吃这里定义的纯数据 props，
 * 不 import hooks、不发请求、不含任何游戏规则。未来若升级 three.js，
 * 只需要按同样的 props 重写渲染，App/useGame 一行不动。
 * （类型允许从 ../api 复用——那只是数据形状，不是运行时依赖。）
 */

import type { GameEvent, Other, Tile } from "../api";

export interface SceneProps {
  /** 三个 AI 对手（seat 1 下家 / 2 对家 / 3 上家） */
  others: Other[];
  /** 牌河：全部弃牌，按打出顺序 */
  discards: Tile[];
  /** 当前轮到谁（0=我） */
  turn: number;
  /** 刚打出、等我决定吃不吃的那张 */
  live: string | null;
  /** 正在发牌：三家牌背依次落位的动画窗口 */
  dealing: boolean;
  /**
   * 此刻正在回放的那条事件（useGame 的 replay）——驱动卡通形象的表情。
   * 复用现成状态，不为表情新增任何状态或请求。
   */
  replay: GameEvent | null;
}
