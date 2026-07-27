/**
 * 排行榜。三个视角：我的位置、累计分榜、词数榜。
 *
 * 做成 overlay 而不是整页：结算页自己就是 overlay，而 App 的整页 view 状态机只在
 * 不在牌局时才渲染——从结算页切整页得先退出牌局，会把「再开一场」的上下文弄丢。
 * 站里既有的「牌局中看数据」模式就是 overlay（Profile 也是这么开的）。
 *
 * **匿名玩家也上榜**，显示「(匿名)」。这不是疏漏：只让绑定账号的人上榜的话，
 * 榜上只有个位数行，看着像没人玩；而「想让榜上显示自己的名字」正是最强的注册动机。
 */

import { useEffect, useState } from "react";
import { api, type LeaderRow, type LeaderboardData } from "../api";
import { Seg } from "./Seg";

type Board = "me" | "scores" | "words";

const BOARDS: [string | number, string][] = [
  ["me", "我的位置"],
  ["scores", "累计分"],
  ["words", "认识词数"],
];

/** 「超过了 N% 的**其他**玩家」——分母是别人，不含自己，别写成「N% 的玩家」 */
function Percentile({ value, label }: { value: number | null; label: string }) {
  if (value === null) return <p className="lb-note">{label}：还没有别人可比</p>;
  return (
    <div className="lb-pct">
      <div className="lb-pct-head">
        {label}超过了 <b>{value}%</b> 的其他玩家
      </div>
      <div className="lb-bar">
        <span style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

function Rows({ rows, unit }: { rows: LeaderRow[]; unit: "score" | "words" }) {
  if (rows.length === 0) return <p className="lb-note">还没有人上榜，打一局就是第一名。</p>;
  return (
    <table className="lb-table">
      <tbody>
        {rows.map((r) => (
          <tr key={r.rank} className={r.isMe ? "lb-me" : ""}>
            <td className="lb-rank">{r.rank <= 3 ? ["🥇", "🥈", "🥉"][r.rank - 1] : r.rank}</td>
            <td className="lb-name">
              {r.name}
              {r.isMe && <span className="lb-you">你</span>}
            </td>
            <td className="lb-val">
              {unit === "score" ? (
                <>
                  {r.score} 分<span className="lb-sub">{r.games} 局</span>
                </>
              ) : (
                <>{r.words} 词</>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function Leaderboard({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Board>("me");
  const [data, setData] = useState<LeaderboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.leaderboard().then(setData).catch((e) => setError(String(e.message ?? e)));
  }, []);

  const me = data?.me;

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet sheet-leaderboard" onClick={(e) => e.stopPropagation()}>
        <h2>排行榜</h2>
        <Seg options={BOARDS} value={tab} onChange={(v) => setTab(v as Board)} />

        {error && <p className="lb-note">{error}</p>}
        {!data && !error && <p className="lb-note">加载中…</p>}

        {data && tab === "me" && (
          <div className="lb-body">
            {me ? (
              <>
                <Percentile value={me.scorePercentile} label="平均分" />
                <Percentile value={me.wordPercentile} label="认识词数" />
                <p className="lb-note">
                  打了 <b>{me.games}</b> 局，累计 <b>{me.score}</b> 分（第 {me.scoreRank} 名），
                  自己看出来 <b>{me.words}</b> 个词
                  {me.wordRank && <>（第 {me.wordRank} 名）</>}。
                </p>
              </>
            ) : (
              <p className="lb-note">还没打过局。打完一场就能看到自己在全站的位置。</p>
            )}
          </div>
        )}

        {data && tab === "scores" && (
          <div className="lb-body">
            <Rows rows={data.scores} unit="score" />
          </div>
        )}

        {data && tab === "words" && (
          <div className="lb-body">
            {/* 口径必须写明：这里的数字比单词本里的小，因为靠提示拼出的词不算 */}
            <p className="lb-caption">只算自己看出来的词——用了提示的不计入。</p>
            <Rows rows={data.words} unit="words" />
          </div>
        )}

        {/* 未绑定的人在榜上是「(匿名)」，这里是把它变成注册动机的地方 */}
        {me && !me.bound && (
          <p className="lb-bind">绑定账号后，榜上就会显示你的昵称。</p>
        )}

        <div className="sheet-actions">
          <button className="btn btn-primary" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
