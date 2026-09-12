/**
 * T6.3：3D 页的结算面板（DOM 覆盖层）。
 *
 * 内容和措辞参照 2.5D 的 `components/Scoreboard.tsx`，**但不 import 它**——3D 不依赖 2.5D 的组件，
 * 2.5D 以后要删。牌也不画 `Tile` 组件，剩牌用简单的字母块。
 *
 * 错题（`missed`）是服务端给的教学反馈，照实显示：这些牌本来能拼出来、玩家没看出来。
 */

import type { Result, ResultRow, State } from "../api";
import { AI_NAMES } from "./names";

/**
 * 名次：按**本局分数**从高到低（用户定）。同分时胡了的排在前面、按胡牌先后（winOrder）；
 * 仍然同分就按座位号。胡牌先后不决定名次，靠每行的「🏆 第 N 胡」标记表达。
 * 纯函数，单测钉着
 */
export function rankRows(rows: readonly ResultRow[]): ResultRow[] {
  const order = (r: ResultRow) => (r.won && r.winOrder !== null ? r.winOrder : Number.POSITIVE_INFINITY);
  return [...rows].sort((a, b) => b.score - a.score || order(a) - order(b) || a.seat - b.seat);
}

/** 整场打完时的最终排名：按累计总分（`matchScores`）从高到低 */
export function finalStanding(matchScores: readonly number[]): Array<{ seat: number; score: number }> {
  return matchScores.map((score, seat) => ({ seat, score })).sort((a, b) => b.score - a.score);
}

const nameOf = (seat: number) => (seat === 0 ? "你" : AI_NAMES[seat]);
const tileLabel = (t: string) => (t === "1" || t === "2" ? "★" : t.toUpperCase());

interface Props {
  result: Result;
  state: State;
  matchFinished: boolean;
  /** 有请求在途（点了 [下一局] 还没回来）：按钮禁用 */
  busy: boolean;
  onNext: () => void;
  onBack: () => void;
}

export function Settlement({ result, state, matchFinished, busy, onNext, onBack }: Props) {
  const rows = rankRows(result.rows);
  return (
    <div className="table3d-settle" role="dialog" aria-label="结算">
      <div className="table3d-settle-sheet">
        <h2 className="table3d-settle-title">
          {matchFinished ? "全场结束" : `第 ${state.gamesPlayed} 局结束`}
          {result.exhausted && <span className="table3d-settle-tag">荒牌</span>}
        </h2>
        {result.exhausted && <p className="table3d-settle-note">牌墙摸完了，这一局没人胡</p>}

        <table className="table3d-settle-rows">
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.seat} className={r.seat === 0 ? "me" : ""}>
                <td className="rank">第 {i + 1} 名</td>
                <td className="who">{nameOf(r.seat)}</td>
                <td className="pts">本局 {r.score}</td>
                <td className="words">
                  {r.words.length ? (
                    r.words.map((w, k) => (
                      <span key={`${w}-${k}`} className="table3d-chip">
                        {w.toUpperCase()}
                      </span>
                    ))
                  ) : (
                    <span className="empty">没组出词</span>
                  )}
                  {r.won && <span className="trophy">🏆 第{(r.winOrder ?? 0) + 1}胡</span>}
                </td>
                <td className="total">累计 {r.total}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* ---- 学习档案：这一局自己的正题和错题 ---- */}
        <div className="table3d-settle-profile">
          <div className="box ok">
            <div className="box-title">✅ 拼出的词 +{result.myWords.length}</div>
            <div>
              {result.myWords.length ? (
                result.myWords.map((w, k) => (
                  <span key={`${w}-${k}`} className="table3d-chip">
                    {w.toUpperCase()}
                  </span>
                ))
              ) : (
                <span className="empty">这一局你一个词都没组出来</span>
              )}
            </div>
          </div>
          {result.missed.length > 0 && (
            <div className="box bad">
              <div className="box-title">❌ 漏掉的词 +{result.missed.length}</div>
              <div className="missed-lead">
                这些牌你本来能拼出来，但没看出来：
                <span className="leftover">
                  {result.leftover.map((t, k) => (
                    <span key={k} className="table3d-mini-tile">
                      {tileLabel(t)}
                    </span>
                  ))}
                </span>
              </div>
              <div>
                {result.missed.map((w, k) => (
                  <span key={`${w}-${k}`} className="table3d-chip bad">
                    {w.toUpperCase()}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {matchFinished && (
          <div className="table3d-settle-final">
            <p className="table3d-settle-note">名次按 {state.gamesPlayed} 局累计总分排定</p>
            <ol>
              {finalStanding(state.matchScores).map((f) => (
                <li key={f.seat} className={f.seat === 0 ? "me" : ""}>
                  {nameOf(f.seat)}　{f.score} 分
                </li>
              ))}
            </ol>
          </div>
        )}

        <div className="table3d-settle-actions">
          {matchFinished ? (
            <button className="table3d-act-btn" onClick={onBack}>
              返回
            </button>
          ) : (
            <button className="table3d-act-btn primary" disabled={busy} onClick={onNext}>
              下一局（{state.gamesPlayed}/{state.maxGames}）
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
