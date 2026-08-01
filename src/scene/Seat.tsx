/**
 * 一个对手席位，拆成两半：
 *
 *   · SeatHand —— 这家的牌墙，交给 <Wall> 用 SVG 画（见 Wall.tsx）。
 *   · SeatInfo —— 名字、张数、亮出的词，屏幕空间的普通 DOM，文字才不会糊。
 */

import type { GameEvent, Other } from "../api";
import { AI_NAMES } from "../aiNames";
import { WordTiles } from "../components/WordTiles";
import { Avatar, bubbleFor, type Mood } from "./Avatar";
import { Wall, type WallPose } from "./Wall";

const SEAT_NAMES: Record<number, string> = { 1: "下家", 2: "对家", 3: "上家" };

/**
 * 桌面平面里的一排牌背 —— 现在整堵墙交给 <Wall> 用 SVG 画（见 Wall.tsx 的说明）。
 * 这里只负责「胡了的人不再有牌墙」这条规则，以及把张数透传下去。
 */
export function SeatHand({
  p,
  pose,
  dealing,
  style,
}: {
  p: Other;
  pose: WallPose;
  dealing: boolean;
  style?: React.CSSProperties;
}) {
  // 胡了的人牌已推倒摊开（SeatInfo 里的 concealed），桌上不再留牌墙
  if (p.won) return null;
  return <Wall pose={pose} count={p.handCount} dealing={dealing} style={style} />;
}

/**
 * 这一家此刻的表情。
 *
 * 优先级：胡了 > 正在回放它的动作 > 轮到它思考 > 待机。
 * 数据全部来自现成的 `replay`（useGame 播 AI 动作时逐条设的那条事件）和 `turn`，
 * 不新增状态、不发请求。
 */
function moodOf(p: Other, active: boolean, replay: GameEvent | null): Mood {
  if (p.won) return "win";
  if (replay?.seat === p.seat) {
    if (replay.t === "win") return "win";
    if (replay.t === "chi") return "call";
    if (replay.t === "discard") return "discard";
    return "thinking"; // draw / reveal：还在盘算
  }
  return active ? "thinking" : "idle";
}

/** 屏幕空间的席位信息卡：卡通形象 + 名字 + 张数 + 亮出的词 */
export function SeatInfo({
  p,
  active,
  replay,
}: {
  p: Other;
  active: boolean;
  replay: GameEvent | null;
}) {
  const mood = moodOf(p, active, replay);
  const bubble = bubbleFor(mood);

  return (
    <div className={`opponent ${active ? "opponent-active" : ""} ${p.won ? "opponent-won" : ""}`}>
      <div className="seat-head">
        <Avatar seat={p.seat} mood={mood} />
        {bubble && <span className={`seat-bubble seat-bubble-${mood}`}>{bubble}</span>}
      </div>

      <div className="opponent-name">
        {SEAT_NAMES[p.seat]} · {AI_NAMES[p.seat]}
        {!p.won && <span className="count">{p.handCount}</span>}
        {p.won && <span className="trophy">🏆 第{(p.winOrder ?? 0) + 1}胡</span>}
      </div>

      <div className="opponent-words">
        {p.melds.map((m) => (
          <WordTiles key={m.tiles} tiles={m.tiles} word={m.word} />
        ))}
        {/* 胡了 / 荒牌了才亮暗牌 */}
        {p.concealed.map((m) => (
          <WordTiles key={"c" + m.tiles} tiles={m.tiles} word={m.word} />
        ))}
      </div>
    </div>
  );
}
