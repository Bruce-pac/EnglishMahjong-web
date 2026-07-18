/**
 * 结算页 —— 教学价值的落点。
 *
 * **错题集是这个产品和普通拼字游戏的分水岭**：它把「我输了」变成「我漏了什么」。
 * 它之所以能有内容，是因为分组是玩家自己做的——服务器若替他拆牌，散牌永远为空，
 * 这一栏就永远是空的。
 */

import { useState } from "react";
import type { Result, State } from "../api";
import { Profile } from "./Profile";
import { Tile } from "./Tile";

const MEDALS = ["🥇", "🥈", "🥉", "4️⃣"];

interface Props {
  result: Result;
  state: State;
  matchFinished: boolean;
  onNext: () => void;
  onRestart: () => void;
}

export function Scoreboard({ result, state, matchFinished, onNext, onRestart }: Props) {
  const [showProfile, setShowProfile] = useState(false);

  return (
    <div className="overlay">
      <div className="sheet">
        <h2>
          {matchFinished ? "全场结束" : `第 ${state.gamesPlayed} 局结束`}
          {result.exhausted && <span className="tag">荒牌</span>}
        </h2>

        <table className="scores">
          <tbody>
            {result.rows.map((r, i) => (
              <tr key={r.seat} className={r.seat === 0 ? "me-row" : ""}>
                <td className="medal">{MEDALS[i]}</td>
                <td className="who">{r.seat === 0 ? "你" : `AI-${r.seat}`}</td>
                <td className="pts">{r.score}</td>
                <td className="words">
                  {r.words.length ? (
                    r.words.map((w) => (
                      <span key={w} className="chip">
                        {w.toUpperCase()}
                      </span>
                    ))
                  ) : (
                    <span className="empty">没组出词</span>
                  )}
                  {r.won && <span className="trophy">🏆 第{(r.winOrder ?? 0) + 1}胡</span>}
                </td>
                <td className="total">场内 {r.total}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* ---- 学习档案 ---- */}
        <div className="profile">
          <div className="profile-box profile-ok">
            <div className="profile-title">✅ 拼出的词 +{result.myWords.length}</div>
            <div>
              {result.myWords.length ? (
                result.myWords.map((w) => (
                  <span key={w} className="chip">
                    {w.toUpperCase()}
                  </span>
                ))
              ) : (
                <span className="empty">这一局你一个词都没组出来</span>
              )}
            </div>
          </div>

          {result.missed.length > 0 && (
            <div className="profile-box profile-bad">
              <div className="profile-title">❌ 漏掉的词 +{result.missed.length}</div>
              <div className="missed-lead">
                这些牌你本来能拼出来，但没看出来：
                <span className="leftover">
                  {result.leftover.map((t, i) => (
                    <Tile key={i} tile={t} small />
                  ))}
                </span>
              </div>
              <div>
                {result.missed.map((w) => (
                  <span key={w} className="chip chip-bad">
                    {w.toUpperCase()}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="sheet-actions">
          <button className="btn btn-ghost" onClick={() => setShowProfile(true)}>
            📖 单词本
          </button>
          {matchFinished ? (
            <button className="btn btn-primary" onClick={onRestart}>
              再开一场
            </button>
          ) : (
            <button className="btn btn-primary" onClick={onNext}>
              下一局（{state.gamesPlayed}/{state.maxGames}）
            </button>
          )}
        </div>
      </div>

      {showProfile && <Profile onClose={() => setShowProfile(false)} />}
    </div>
  );
}
