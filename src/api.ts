/**
 * 后端接口封装。
 *
 * 前端**不含任何规则逻辑，也不含词典**——规则和 17 万词的词典全在服务端。
 * 这不只是为了省事：引擎若放前端，打开 DevTools 就能看穿全场（别人的手牌、
 * 牌墙顺序）。所以这里只做两件事：把玩家的操作发上去，把服务端给的状态画出来。
 */

// "1" = 元音白搭（红），"2" = 辅音白搭（黑），其余是 a-z
export type Tile = string;

export interface Word {
  tiles: string;
  word: string;
}

export interface Me {
  seat: number;
  hand: Tile[];
  /** 玩家自己组好的暗词。服务器只校验，绝不替他分组 */
  groups: Word[];
  /** 还没组进任何词的散牌 */
  loose: Tile[];
  /** 这一回合新进手的牌（摸的 / 亮词补摸的）。是多重集合：可能一次进来好几张 */
  drawn: Tile[];
  melds: Word[];
  /** 还剩几格预算（14 − 3×已亮词数）。这是本游戏最难懂的机制，界面上要一直可见 */
  budgetLeft: number;
  won: boolean;
  /** 第几个胡的（血战到底：先胡的先退出，其余人继续） */
  winOrder: number | null;
  /** 胡牌后的暗词拆法——观战时把你胡的那手牌摆出来 */
  concealed: Word[];
}

export interface Other {
  seat: number;
  /** 只给张数——服务端绝不下发别人的手牌 */
  handCount: number;
  melds: Word[];
  won: boolean;
  winOrder: number | null;
  concealed: Word[];
}

export interface State {
  wallLeft: number;
  turn: number;
  discards: Tile[];
  finished: boolean;
  exhausted: boolean;
  me: Me;
  others: Other[];
  matchScores: number[];
  gamesPlayed: number;
  maxGames: number;
  /** 本场玩法配置——顶栏常亮。以服务端为准：刷新恢复时前端本地 config 是默认值 */
  config: {
    tier: string;
    minWordLen: number;
    minWinWordLen: number;
    hints: boolean;
    bloody: boolean;
    difficulty: string;
  };
}

export interface Pending {
  kind: "discard" | "reveal" | "chi" | "win";
  tile: Tile | null;
  canPass: boolean;
  /** 提示功能关闭时恒为空——服务端根本不算，前端也就无从偷看。
      wild 是这个词里白搭代表的字母（COD 的 ★=O），不标出来提示了也用不上 */
  hints: (Word & { wild: string; isAbbr: boolean })[];
  /** 胡牌专用：是自摸还是别人点炮。
      **服务端绝不告诉你拼成了什么词**——那个词必须由你自己拼出来 */
  selfDrawn?: boolean;
}

export interface GameEvent {
  t: "draw" | "reveal" | "discard" | "chi" | "win" | "exhausted";
  seat?: number;
  tile?: Tile;
  word?: string;
  tiles?: string;
  draws?: number;
  selfDrawn?: boolean;
  order?: number;
  concealed?: Word[];
}

export interface ResultRow {
  seat: number;
  score: number;
  total: number;
  won: boolean;
  winOrder: number | null;
  words: string[];
}

export interface Result {
  rows: ResultRow[];
  exhausted: boolean;
  myWords: string[];
  /** 错题集：这些牌你本来能拼出来，但没看出来 */
  missed: string[];
  leftover: Tile[];
}

export interface Envelope {
  matchId: string;
  events: GameEvent[];
  state: State;
  pending: Pending | null;
  result: Result | null;
  matchFinished: boolean;
}

export interface Validation {
  valid: boolean;
  word?: string;
  inTier?: boolean;
  isAbbr?: boolean;
  score?: number;
  drawCount?: number;
  canReveal?: boolean;
}

export interface ProfileData {
  /** 正题集：拼出过的词（按最近拼出倒序） */
  correct: { word: string; count: number; hinted: boolean; wasWrong: boolean }[];
  /** 错题集：本可以拼出却没看出来的词（按漏过次数降序） */
  wrong: { word: string; missedCount: number }[];
  games: { played: number; won: number };
}

export interface MatchConfig {
  tier: string;
  minWordLen: number;
  minWinWordLen: number;
  hints: boolean;
  bloody: boolean;
  difficulty: string;
  maxGames: number;
}

// ---- 匿名玩家身份 ----
//
// 服务端签发一个 playerId（uuid，本身就是凭证），存 localStorage，
// 之后每个请求都带 X-Player-Id 头。学习档案（正/错题集）从第一局起就
// 挂在它名下、落在服务端数据库里——玩家无感知，数据已经在积累。
// 丢了 localStorage = 丢档案；将来的「绑定账号」功能就是为此准备的后路。

const PLAYER_KEY = "emj-player-id";

let playerReady: Promise<string> | null = null;

async function playerId(): Promise<string> {
  if (playerReady) return playerReady;
  const pending = (async () => {
    const saved = localStorage.getItem(PLAYER_KEY);
    if (saved) return saved;
    const res = await fetch("/api/players", { method: "POST" });
    const data = await res.json();
    localStorage.setItem(PLAYER_KEY, data.playerId);
    return data.playerId as string;
  })();
  // 失败别把这个 rejected promise 缓存住——否则网络抖一下，之后每个请求都拿到
  // 同一个失败结果，页面从此彻底不能用，只能刷新。
  pending.catch(() => {
    if (playerReady === pending) playerReady = null;
  });
  playerReady = pending;
  return pending;
}

async function request<T>(
  url: string,
  init: RequestInit = {},
  { retryOn401 = true }: { retryOn401?: boolean } = {},
): Promise<T> {
  let res = await fetch(url, {
    ...init,
    headers: { ...(init.headers ?? {}), "X-Player-Id": await playerId() },
  });
  // 401 有两种含义，绝不能混：一种是「你的 playerId 失效了」（服务端换过库/档案
  // 被清），该重领身份重试；另一种是登录密码错，那是业务结果，**碰身份就等于
  // 一次失败登录把用户的匿名档案指针弄丢**。所以账号接口传 retryOn401=false。
  if (res.status === 401 && retryOn401) {
    localStorage.removeItem(PLAYER_KEY);
    playerReady = null;
    res = await fetch(url, {
      ...init,
      headers: { ...(init.headers ?? {}), "X-Player-Id": await playerId() },
    });
  }
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail ?? "请求失败");
  return data as T;
}

async function post<T>(
  url: string,
  body?: unknown,
  opts?: { retryOn401?: boolean },
): Promise<T> {
  return request<T>(
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    },
    opts,
  );
}

export const api = {
  newMatch: (config: MatchConfig) => post<Envelope>("/api/matches", config),

  /** 拉当前状态——刷新页面后恢复对局（?match=<id>） */
  resume: (id: string) => request<Envelope>(`/api/matches/${id}`),

  /** 单词本：正题集 / 错题集 / 战绩，跨场累积 */
  profile: () => request<ProfileData>("/api/profile"),

  /** 释义 + 音标（本地词表，查不到 found=false） */
  define: (word: string) =>
    request<{ found: boolean; phonetic?: string; definition?: string }>(
      `/api/define/${encodeURIComponent(word)}`,
    ),

  nextGame: (id: string) => post<Envelope>(`/api/matches/${id}/games`),

  /** 做一个决策：打牌 / 亮词 / 吃 / 胡 / 过 */
  act: (
    id: string,
    body: {
      kind: string;
      tile?: string;
      tiles?: string;
      word?: string;
      viaHint?: boolean;
      /** 缩写的全称（RULES.md §8.3：拼对才算） */
      expansion?: string;
    },
  ) => post<Envelope>(`/api/matches/${id}/action`, body),

  /** 把散牌区选中的牌组成一个暗词 */
  group: (id: string, tiles: string, word?: string, viaHint?: boolean, expansion?: string) =>
    post<Envelope>(`/api/matches/${id}/group`, { tiles, word, viaHint, expansion }),

  /** 拆开一个已组的暗词，牌退回散牌区 */
  ungroup: (id: string, tiles: string) =>
    post<Envelope>(`/api/matches/${id}/ungroup`, { tiles }),

  /**
   * 校验玩家拼的这个词。
   *
   * **点选顺序就是要拼的词**（点 C→A→T 是 CAT），白搭要声明代表哪个字母。
   * 它只回答对错，**绝不列出「这几张还能拼成什么」**——那等于替玩家做完了思考。
   * 列词是提示功能的事，且要在正题集里留下「被提示」的印记。
   */
  validate: (id: string, tiles: string, word: string, withTile?: string) =>
    post<Validation>(`/api/matches/${id}/validate`, { tiles, word, withTile }),

  // ---- 账号 ----

  /** 当前身份的登录态：未绑定 bound=false */
  accountMe: () => request<AccountState>("/api/account/me"),

  /** 把当前匿名身份升级成账号（历史单词本/战绩原地保留）。
   *  retryOn401=false：注册失败（如身份问题）不该悄悄换掉本地身份。 */
  register: (username: string, password: string, displayName: string) =>
    post<{ displayName: string }>(
      "/api/account/register",
      { username, password, displayName },
      { retryOn401: false },
    ),

  /**
   * 登录已有账号。服务端发回该账号的 playerId——写回 localStorage 顶替当前身份，
   * 于是换设备/换浏览器也能接管同一份档案。返回后要重置 playerId 缓存。
   *
   * retryOn401=false 是关键：密码错也是 401，若走默认的重试逻辑，会把用户的
   * 匿名 playerId 删掉重领——一次点错就丢了档案指针（测试bug.md）。
   */
  login: async (username: string, password: string) => {
    const r = await post<{ playerId: string; displayName: string }>(
      "/api/account/login",
      { username, password },
      { retryOn401: false },
    );
    localStorage.setItem(PLAYER_KEY, r.playerId);
    playerReady = Promise.resolve(r.playerId);
    return r;
  },

  /**
   * 退出登录 = 领一个全新的匿名身份。账号数据安全躺在库里（登录可找回），
   * 这台机器回到「干净匿名」——于是共享设备上换个人能注册/登录别的账号。
   *
   * 领新 id 失败**不算退出失败**：本地身份已经清掉，「已退出」这个事实成立，
   * 下一个请求会自己再领一次。这里若把异常抛出去，调用方的 busy 就再也回不来。
   */
  logout: async () => {
    localStorage.removeItem(PLAYER_KEY);
    playerReady = null;
    try {
      await playerId(); // 立刻领一个新的匿名 id，后续请求不至于空手
    } catch {
      /* 交给下次请求重试 */
    }
  },

  /** 当前本地身份。切换账号前留个底，注册失败好原样回滚（见 Account.tsx） */
  currentPlayerId: () => localStorage.getItem(PLAYER_KEY),

  /** 把本地身份强制换回指定 id——只给上面那个回滚用 */
  usePlayer: (id: string) => {
    localStorage.setItem(PLAYER_KEY, id);
    playerReady = Promise.resolve(id);
  },
};

export interface AccountState {
  bound: boolean;
  username?: string;
  displayName?: string;
}
