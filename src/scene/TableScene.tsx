/**
 * 牌桌场景：2.5D 舞台 + 倾斜桌面 + 三家的牌 + 牌河 + 席位信息卡。
 *
 * 方位与真麻将一致：自己永远在下方（Hand 区），对手按
 * 上家(左) / 对家(上) / 下家(右) 就座。
 *
 * 分层原则：3D 只发生在 .table-surface 内部（牌背、牌河）；名字和亮出的词
 * 是要读的文字，一律留在屏幕空间的席位卡里。
 */

import { Tile } from "../components/Tile";
import { SeatHand, SeatInfo } from "./Seat";
import type { SceneProps } from "./types";
import "./scene.css";

export function TableScene({ others, discards, turn, live, dealing, replay }: SceneProps) {
  const seat = (n: number) => others.find((o) => o.seat === n)!;

  return (
    <div className="scene-stage">
      <div className="table-surface">
        <div className="river">
          <div className="river-label">牌河 {discards.length}</div>
          <div className="river-tiles">
            {discards.map((t, i) => {
              const newest = i === discards.length - 1;
              return (
                // key 带上牌面：只用下标的话，React 会复用同一个 DOM 节点，
                // 落牌动画根本不会重新触发，看着就像「没动效」
                <span
                  key={`${i}-${t}`}
                  className={newest ? "river-slot river-newest" : "river-slot"}
                >
                  <Tile tile={t} small dimmed={!newest} />
                </span>
              );
            })}
          </div>
          {live && (
            <div className="river-live">
              刚打出 <Tile tile={live} small />
            </div>
          )}
        </div>
      </div>

      {/* 三家的牌墙：SVG 画在屏幕空间，不进桌面那层 3D 变换——
          进去会被再变换一次，透视就双份了 */}
      <SeatHand p={seat(2)} pose="far" dealing={dealing} />
      <SeatHand p={seat(3)} pose="left" dealing={dealing} />
      <SeatHand p={seat(1)} pose="right" dealing={dealing} />

      {/* 席位信息卡：桌子三边外侧的屏幕空间 */}
      <div className="seat-slot seat-slot-top">
        <SeatInfo p={seat(2)} active={turn === 2} replay={replay} />
      </div>
      <div className="seat-slot seat-slot-left">
        <SeatInfo p={seat(3)} active={turn === 3} replay={replay} />
      </div>
      <div className="seat-slot seat-slot-right">
        <SeatInfo p={seat(1)} active={turn === 1} replay={replay} />
      </div>
    </div>
  );
}
