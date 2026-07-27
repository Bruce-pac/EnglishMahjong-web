/**
 * 结算页 —— 教学价值的落点。
 *
 * **错题集是这个产品和普通拼字游戏的分水岭**：它把「我输了」变成「我漏了什么」。
 * 它之所以能有内容，是因为分组是玩家自己做的——服务器若替他拆牌，散牌永远为空，
 * 这一栏就永远是空的。
 */

import { useEffect, useState } from "react";
import { AI_NAMES } from "../aiNames";
import { api, type MyStanding, type Result, type State } from "../api";
import { Leaderboard } from "./Leaderboard";
import { Profile } from "./Profile";
import { Tile } from "./Tile";

const MEDALS = ["🥇", "🥈", "🥉", "4️⃣"];

/**
 * 场末的「我在全站什么位置」一行。自己拉数据——它和这一局的结果无关，
 * 是跨场累积的档案，塞进 envelope 反而会让每局结算都白背一份。
 *
 * 拉失败或还没数据就整行不显示：结算页已经够满了，不值得为它加一行报错。
 */
function StandingLine({ onOpen }: { onOpen: () => void }) {
  const [me, setMe] = useState<MyStanding | null>(null);
  useEffect(() => {
    api.leaderboard().then((d) => setMe(d.me), () => setMe(null));
  }, []);

  if (!me) return null;
  return (
    <p className="standing-line">
      全站累计第 <b>{me.scoreRank}</b> 名
      {me.scorePercentile !== null && <> · 平均分超过 <b>{me.scorePercentile}%</b> 的其他玩家</>}
      <button className="text-link" onClick={onOpen}>
        看完整榜单 →
      </button>
    </p>
  );
}

interface Props {
  result: Result;
  state: State;
  matchFinished: boolean;
  /** 匿名（未绑定账号）且已查过登录态时为 true——显示「保存成绩」入口 */
  canSave: boolean;
  onSave: () => void;
  onNext: () => void;
  onRestart: () => void;
}

export function Scoreboard({
  result,
  state,
  matchFinished,
  canSave,
  onSave,
  onNext,
  onRestart,
}: Props) {
  const [showProfile, setShowProfile] = useState(false);
  const [showBoard, setShowBoard] = useState(false);

  return (
    <div className="overlay">
      <div className="sheet">
        <h2>
          {matchFinished ? "全场结束" : `第 ${state.gamesPlayed} 局结束`}
          {result.exhausted && <span className="tag">荒牌</span>}
        </h2>
        {/* 场末奖牌按累计总分发，不是最后一局的得分——说清楚，免得对不上号 */}
        {matchFinished && <p className="rank-note">名次按 {state.gamesPlayed} 局累计总分排定</p>}

        <table className="scores">
          <tbody>
            {result.rows.map((r, i) => (
              <tr key={r.seat} className={r.seat === 0 ? "me-row" : ""}>
                <td className="medal">{MEDALS[i]}</td>
                <td className="who">{r.seat === 0 ? "你" : AI_NAMES[r.seat]}</td>
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

        {/* 全场结束＝情绪最高点，正好问「我算什么水平」。这是排行榜的主入口，
            也和下面的「保存成绩」呼应：未绑定的人看到自己上榜却显示「(匿名)」，
            比任何文案都能推动注册。 */}
        {matchFinished && <StandingLine onOpen={() => setShowBoard(true)} />}

        {/* 全场结束、还没绑账号——最想「留住成绩」的时刻，给个非强制入口 */}
        {matchFinished && canSave && (
          <button className="btn btn-save" onClick={onSave}>
            💾 保存成绩到账号（换设备也能找回）
          </button>
        )}

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
      {showBoard && <Leaderboard onClose={() => setShowBoard(false)} />}
    </div>
  );
}
