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

/**
 * 发牌动画的节奏。三家**依次**落牌（下家 → 对家 → 上家，即从我逆时针数过去），
 * 每家内部再逐张错开。最后一张约在 600ms 落下、860ms 落定——要比发牌音效
 * （约 520ms 收尾）稍慢一点，声音先停、牌还在落，比反过来自然。
 */
const SEAT_DELAY_MS = 170;   // 换下一家的间隔
const TILE_DELAY_MS = 22;    // 同一家里每张牌之间

function Opponent({ p, active, dealing }: { p: Other; active: boolean; dealing: boolean }) {
  return (
    <div className={`opponent ${active ? "opponent-active" : ""} ${p.won ? "opponent-won" : ""}`}>
      <div className="opponent-name">
        {SEAT_NAMES[p.seat]} · {AI_NAMES[p.seat]}
        {p.won && <span className="trophy">🏆 第{(p.winOrder ?? 0) + 1}胡</span>}
      </div>

      {/* 胡了的人牌已推倒摊开（下面的 concealed），不再显示牌背。
          dealing 只在发牌那一瞬为真：若无条件挂动画，对手每次摸牌
          （handCount 13→14 新挂一张牌背）都会重新抖一下 */}
      {!p.won && (
        <div className={dealing ? "opponent-backs dealing" : "opponent-backs"}>
          {Array.from({ length: Math.min(p.handCount, 14) }).map((_, i) => (
            <TileBack
              key={i}
              small
              style={
                dealing
                  ? { animationDelay: `${(p.seat - 1) * SEAT_DELAY_MS + i * TILE_DELAY_MS}ms` }
                  : undefined
              }
            />
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
  /** 正在发牌：三家的牌背依次落位。只在开新局后的那一瞬为真 */
  dealing: boolean;
}

export function Table({ others, discards, turn, live, dealing }: Props) {
  const seat = (n: number) => others.find((o) => o.seat === n)!;

  return (
    <div className="table">
      <div className="table-top">
        <Opponent p={seat(2)} active={turn === 2} dealing={dealing} />
      </div>

      <div className="table-mid">
        <Opponent p={seat(3)} active={turn === 3} dealing={dealing} />

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

        <Opponent p={seat(1)} active={turn === 1} dealing={dealing} />
      </div>
    </div>
  );
}
