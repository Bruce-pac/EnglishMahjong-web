/**
 * 观战条 —— 你已经胡牌退出，但血战到底还没打完。
 *
 * 没有它的话，你胡完就只能对着一个「不再响应」的界面干等：没有提示条、
 * 没有按钮、手牌区一片死寂，根本不知道自己在等什么，还以为卡死了。
 * 这里把三件事讲清楚：你已经胡了、你胡的是什么牌、还有几家在打。
 */

import type { Me, Other } from "../api";
import { spectateStatus } from "../spectate";
import { WordTiles } from "./WordTiles";

interface Props {
  me: Me;
  others: Other[];
  bloody: boolean;
  /** 本局打完了（服务端的 state.finished） */
  finished: boolean;
  /** 给了就在右边出「提前结算」：跳过剩下的回放，直接进结算 */
  onSkip?: () => void;
}

export function Spectating({ me, others, bloody, finished, onSkip }: Props) {
  const stillPlaying = others.filter((o) => !o.won).length;
  const words = [...me.melds, ...me.concealed];

  // 非血战局、血战局打完了、只剩一家：都已经没什么可「观战」的，说清楚本局结束
  const { over, note } = spectateStatus({ bloody, finished, stillPlaying });

  return (
    <div className={`spectating ${over ? "spectating-over" : ""}`}>
      <div className="spectating-head">
        <span className="spectating-badge">{over ? "🏁 本局结束" : "👁 观战中"}</span>
        <b>你已胡牌（第 {(me.winOrder ?? 0) + 1} 个）</b>
        <span className="spectating-note">{note}</span>
        {onSkip && (
          <button className="btn btn-primary spectating-skip" onClick={onSkip}>
            提前结算 →
          </button>
        )}
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
