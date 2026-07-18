/**
 * 观战条 —— 你已经胡牌退出，但血战到底还没打完。
 *
 * 没有它的话，你胡完就只能对着一个「不再响应」的界面干等：没有提示条、
 * 没有按钮、手牌区一片死寂，根本不知道自己在等什么，还以为卡死了。
 * 这里把三件事讲清楚：你已经胡了、你胡的是什么牌、还有几家在打。
 */

import type { Me, Other } from "../api";
import { WordTiles } from "./WordTiles";

interface Props {
  me: Me;
  others: Other[];
}

export function Spectating({ me, others }: Props) {
  const stillPlaying = others.filter((o) => !o.won).length;
  const words = [...me.melds, ...me.concealed];

  /**
   * 只剩一家时，血战到底就结束了（引擎里 `len(active()) <= 1` 即收场）——
   * 最后那家没人可打了。这时候没什么可「观战」的，本局已经完了，直接说在结算。
   */
  const over = stillPlaying <= 1;

  return (
    <div className={`spectating ${over ? "spectating-over" : ""}`}>
      <div className="spectating-head">
        <span className="spectating-badge">{over ? "🏁 本局结束" : "👁 观战中"}</span>
        <b>你已胡牌（第 {(me.winOrder ?? 0) + 1} 个）</b>
        <span className="spectating-note">
          {over
            ? "只剩一家，本局已结束，正在结算…"
            : `血战到底：还有 ${stillPlaying} 家在打，打完才结算`}
        </span>
      </div>

      <div className="spectating-hand">
        <span className="hand-zone-label">你胡的这手牌</span>
        {words.map((w) => (
          <WordTiles key={w.tiles + w.word} tiles={w.tiles} word={w.word} />
        ))}
      </div>
    </div>
  );
}
