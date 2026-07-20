/**
 * 牌桌：三个对手 + 牌河。
 *
 * 自己永远在下方，对手按 上家(左) / 对家(上) / 下家(右) 就座——和真麻将的方位
 * 一致，降低认知负担。对手只显示牌背和张数，亮出的词公开摆在座位旁。
 */

import type { Other, Tile as TileType } from "../api";
import { AI_NAMES } from "../aiNames";
import { Tile, TileBack } from "./Tile";
import { WordTiles } from "./WordTiles";

const SEAT_NAMES: Record<number, string> = { 1: "下家", 2: "对家", 3: "上家" };

function Opponent({ p, active }: { p: Other; active: boolean }) {
  return (
    <div className={`opponent ${active ? "opponent-active" : ""} ${p.won ? "opponent-won" : ""}`}>
      <div className="opponent-name">
        {SEAT_NAMES[p.seat]} · {AI_NAMES[p.seat]}
        {p.won && <span className="trophy">🏆 第{(p.winOrder ?? 0) + 1}胡</span>}
      </div>

      {/* 胡了的人牌已推倒摊开（下面的 concealed），不再显示牌背 */}
      {!p.won && (
        <div className="opponent-backs">
          {Array.from({ length: Math.min(p.handCount, 14) }).map((_, i) => (
            <TileBack key={i} small />
          ))}
          <span className="count">{p.handCount}</span>
        </div>
      )}

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

interface Props {
  others: Other[];
  discards: TileType[];
  turn: number;
  /** 刚打出的那张——要决定吃不吃的就是它 */
  live: string | null;
}

export function Table({ others, discards, turn, live }: Props) {
  const seat = (n: number) => others.find((o) => o.seat === n)!;

  return (
    <div className="table">
      <div className="table-top">
        <Opponent p={seat(2)} active={turn === 2} />
      </div>

      <div className="table-mid">
        <Opponent p={seat(3)} active={turn === 3} />

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

        <Opponent p={seat(1)} active={turn === 1} />
      </div>
    </div>
  );
}
