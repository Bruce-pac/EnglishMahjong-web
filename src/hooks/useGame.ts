/**
 * 对局状态。
 *
 * 状态的**唯一真相在服务端**，前端只是把它画出来，外加播一下动画。
 * 所以不需要 Redux / Zustand——一个 useState 加几个 async 函数就够了。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { AI_NAMES } from "../aiNames";
import { api, type Envelope, type GameEvent, type MatchConfig, type Validation } from "../api";

/** AI 每步之间停一下，不然它们瞬间打完，学生看不清发生了什么 */
const AI_STEP_MS = 700;

/** 操作记录保留的条数——横幅一闪就没了，记录得留着让人回头看 */
const LOG_SIZE = 30;

export interface LogEntry {
  id: number;
  text: string;
}

const SEAT_NAMES: Record<number, string> = { 1: "下家", 2: "对家", 3: "上家" };

function describe(e: GameEvent): string | null {
  const who = e.seat === 0 ? "你" : `${SEAT_NAMES[e.seat ?? 0] ?? ""} ${AI_NAMES[e.seat ?? 0] ?? ""}`;
  switch (e.t) {
    case "draw":
      return e.seat === 0 ? null : `${who} 摸牌`;
    case "discard":
      return `${who} 打出 ${e.tile?.toUpperCase()}`;
    case "reveal":
      return `${who} 亮出 ${e.word?.toUpperCase()}（补摸 ${e.draws} 张）`;
    case "chi":
      return `${who} 吃 ${e.tile?.toUpperCase()}，拼出 ${e.word?.toUpperCase()}`;
    case "win":
      return `🏆 ${who} ${e.selfDrawn ? "自摸" : "胡牌"}！第 ${(e.order ?? 0) + 1} 个胡`;
    case "exhausted":
      return "牌墙摸空，荒牌";
    default:
      return null;
  }
}

let nextLogId = 1;

export function useGame() {
  const [env, setEnv] = useState<Envelope | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** 正在播 AI 的动画——这期间界面上挂的是旧 pending，输入必须锁住 */
  const [replaying, setReplaying] = useState(false);
  /** 正在回放的事件（高亮横幅） */
  const [replay, setReplay] = useState<GameEvent | null>(null);
  /** 操作记录：滚动日志，横幅消失后仍能回头看「刚才发生了什么」 */
  const [log, setLog] = useState<LogEntry[]>([]);
  /**
   * 刚刚胡牌的那个事件——用来放一段庆祝特效。
   *
   * 没有它的话，真人（尤其是第二、三个胡的）点完「胡牌」，画面上只有左上角
   * 日志在滚，其余纹丝不动，感觉像卡死了。
   */
  const [celebrate, setCelebrate] = useState<GameEvent | null>(null);
  const timers = useRef<number[]>([]);
  // discard/win 是 useCallback 包的，闭包会把值锁在创建那一刻。用 ref 兜住最新值。
  const matchIdRef = useRef<string | undefined>(undefined);
  matchIdRef.current = env?.matchId;
  // 乐观更新失败时要回滚到「动手之前」，所以得能同步拿到当下的 env
  const envRef = useRef<Envelope | null>(null);
  envRef.current = env;

  useEffect(
    () => () => {
      timers.current.forEach(clearTimeout);
    },
    [],
  );

  const pushLog = useCallback((e: GameEvent) => {
    const text = describe(e);
    if (!text) return;
    setLog((old) => [...old.slice(-(LOG_SIZE - 1)), { id: nextLogId++, text }]);
  }, []);

  /**
   * 把服务端返回的事件逐条播出来，播完再把新状态交给界面。
   *
   * `instant` 用于开新一局/新一场：那时的事件是「上一局的余波 + 新局 AI 的开场」，
   * 玩家刚点了按钮就该立刻看到新牌桌——若还按 700ms/步慢放，按钮就像卡死了一样。
   */
  const apply = useCallback(
    (next: Envelope, instant = false) => {
      timers.current.forEach(clearTimeout);
      timers.current = [];

      // 只有别人的动作值得慢放；自己的操作是即时反馈，不该等
      const worth = next.events.filter((e) => e.seat !== undefined && e.seat !== 0);

      // 谁胡了都要放一下特效——否则点完「胡牌」画面纹丝不动，像卡死了
      const won = instant ? null : next.events.find((e) => e.t === "win");
      if (won) {
        setCelebrate(won);
        timers.current.push(window.setTimeout(() => setCelebrate(null), 2200));
      }

      if (instant || worth.length === 0) {
        next.events.forEach(pushLog);
        setReplay(null);
        setReplaying(false);
        setEnv(next);
        return;
      }

      // 动画期间界面上还挂着**旧的** pending，按钮若不锁住，玩家点下去发的就是
      // 过期的操作，服务端只会回 400。所以整段回放期间输入必须是禁用的。
      setReplaying(true);

      worth.forEach((e, i) => {
        timers.current.push(
          window.setTimeout(() => {
            setReplay(e);
            pushLog(e);
          }, i * AI_STEP_MS),
        );
      });
      timers.current.push(
        window.setTimeout(() => {
          setReplay(null);
          setReplaying(false);
          setEnv(next);
        }, worth.length * AI_STEP_MS),
      );
    },
    [pushLog],
  );

  const run = useCallback(
    async (fn: () => Promise<Envelope>, instant = false) => {
      setBusy(true);
      setError(null);
      try {
        apply(await fn(), instant);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [apply],
  );

  /**
   * 乐观更新：先在本地把结果画出来，再发请求；**服务端一旦拒绝就回滚**。
   *
   * 为什么要乐观：你点完「打出」，若等 AI 的动画全部播完（每步 700ms，三家轮完
   * 就是一两秒）才更新手牌，那张牌会一直赫然躺在你手里，跟卡死一样。
   * 自己的动作必须立刻有反应；慢放只该用在**别人**的动作上。
   *
   * 为什么必须回滚：服务端才是裁判。曾经漏了回滚，结果玩家胡牌时全称拼错、
   * 服务端拒绝，界面却已经切成「已胡牌」并清空了 pending——既没有按钮也没法重来，
   * **整局卡死**。乐观更新和回滚必须成对出现，少一个就是定时炸弹。
   */
  const optimistic = useCallback(
    (mutate: (cur: Envelope) => Envelope, fn: () => Promise<Envelope>) => {
      const snapshot = envRef.current;
      setEnv((cur) => (cur ? mutate(cur) : cur));

      return (async () => {
        setBusy(true);
        setError(null);
        try {
          apply(await fn());
        } catch (e) {
          setEnv(snapshot); // 回滚到动手之前，玩家可以重来
          setError(e instanceof Error ? e.message : String(e));
        } finally {
          setBusy(false);
        }
      })();
    },
    [apply],
  );

  const discard = useCallback(
    (tile: string) =>
      optimistic(
        (cur) => {
          const loose = [...cur.state.me.loose];
          const at = loose.indexOf(tile);
          if (at < 0) return cur;
          loose.splice(at, 1);
          const hand = [...cur.state.me.hand];
          const inHand = hand.indexOf(tile);
          if (inHand >= 0) hand.splice(inHand, 1);
          return {
            ...cur,
            pending: null, // 立刻交出操作权，免得手快点第二下
            state: {
              ...cur.state,
              discards: [...cur.state.discards, tile],
              me: { ...cur.state.me, loose, hand, drawn: [] },
            },
          };
        },
        () => api.act(matchIdRef.current!, { kind: "discard", tile }),
      ),
    [optimistic],
  );

  /**
   * 胡牌。必须自己拼出最后那个词；若是缩写，还要带上全称（拼错不让胡）。
   *
   * 同样是乐观更新——血战到底里你胡完，其余人还要接着打，AI 的动画要慢放一两秒；
   * 等它播完再切观战条，就会跟结算页一起姗姗而来，你胡了却毫无反应。
   * 暗词拆法 = 你已组好的词 + 最后拼成的那个（与服务端 _human_win_split 一致）。
   */
  const win = useCallback(
    (word: string, expansion?: string) =>
      optimistic(
        (cur) => {
          if (!cur.pending?.tile) return cur;
          const me = cur.state.me;
          const finalTiles = [...me.loose, cur.pending.tile].sort().join("");
          return {
            ...cur,
            pending: null,
            state: {
              ...cur.state,
              me: {
                ...me,
                won: true,
                loose: [],
                drawn: [],
                // 你是第几个胡的 = 已经胡了的人数（服务端的 win_count 也这么算）
                winOrder: cur.state.others.filter((o) => o.won).length,
                concealed: [...me.groups, { tiles: finalTiles, word }],
              },
            },
          };
        },
        () => api.act(matchIdRef.current!, { kind: "win", word, expansion }),
      ),
    [optimistic],
  );

  const matchId = env?.matchId;

  // 把 matchId 挂到 window 上，浏览器测试才能用 /api/dev/setup 摆局面。
  // 纯调试用，不影响任何游戏逻辑。
  if (typeof window !== "undefined") {
    (window as unknown as { __matchId?: string }).__matchId = matchId;
  }

  return {
    env,
    error,
    /** 请求进行中、或正在播 AI 动画——两种情况下都不该接受输入 */
    busy: busy || replaying,
    replay,
    log,
    /** 刚有人胡牌 —— 放庆祝特效，别让画面看着像卡死 */
    celebrate,
    clearError: () => setError(null),

    // 开新场/新局要立即响应——玩家刚点了按钮，慢放会像卡死一样（instant）
    // 开新场顺手清掉上一场的操作记录——旧日志挂在角落里会让人以为还在上一场
    newMatch: (config: MatchConfig) => {
      setLog([]);
      return run(() => api.newMatch(config), true);
    },
    nextGame: () => run(() => api.nextGame(matchId!), true),
    /** 刷新页面后恢复对局。不重播动画，直接给最终状态 */
    resume: (id: string) => run(() => api.resume(id), true),

    /** 打出一张牌——本地立即生效，不等 AI 动画（见上面的 discard） */
    discard,
    /** 亮词 / 吃牌 —— viaHint 会在正题集里留下「被提示」的印记 */
    reveal: (tiles: string, word: string, viaHint = false, expansion?: string) =>
      run(() => api.act(matchId!, { kind: "reveal", tiles, word, viaHint, expansion })),
    chi: (tiles: string, word: string, viaHint = false, expansion?: string) =>
      run(() => api.act(matchId!, { kind: "chi", tiles, word, viaHint, expansion })),
    /** 胡牌——本地立即生效，服务端拒绝则回滚（见上面的 win） */
    win,
    pass: () => run(() => api.act(matchId!, { kind: "pass" })),

    /** 把散牌区选中的牌组成暗词 —— 这是玩家自己的活，服务器只校验 */
    group: (tiles: string, word?: string, viaHint?: boolean, expansion?: string) =>
      run(() => api.group(matchId!, tiles, word, viaHint, expansion)),
    ungroup: (tiles: string) => run(() => api.ungroup(matchId!, tiles)),

    validate: (tiles: string, word: string, withTile?: string): Promise<Validation> =>
      api.validate(matchId!, tiles, word, withTile),
  };
}
