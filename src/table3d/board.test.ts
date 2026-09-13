/** T2.2 中央记分盘：model（纯函数）与「model 不变不重画」 */

import { describe, expect, it } from "vitest";
import type { Envelope, Pending, Result, State } from "../api";
import { actorOf, boardModel, dealerOf, nextReplayActor } from "./board-model";
import { CenterBoard } from "./center-board";
import { fixtureGames } from "./test-helpers";

function envOf(opts: { gamesPlayed?: number; turn?: number; pending?: Pending | null; result?: boolean; scores?: number[] } = {}): Envelope {
  const state: State = structuredClone(fixtureGames()[0].steps[2].state);
  state.gamesPlayed = opts.gamesPlayed ?? 0;
  state.maxGames = 4;
  state.turn = opts.turn ?? 0;
  state.matchScores = opts.scores ?? [10, 20, 30, 40];
  return {
    matchId: "m-board",
    events: [],
    state,
    pending: opts.pending ?? null,
    result: opts.result ? ({} as Result) : null,
    matchFinished: false,
  };
}
const windsOf = (env: Envelope) => boardModel(env, null).sides.map((s) => s.wind);

describe("方位：座位 (dealer + k) % 4 是第 k 个（E→S→W→N，逆时针）", () => {
  it("庄家 0..3 时四家方位", () => {
    expect(windsOf(envOf({ gamesPlayed: 0 }))).toEqual(["East", "South", "West", "North"]);
    expect(windsOf(envOf({ gamesPlayed: 1 }))).toEqual(["North", "East", "South", "West"]);
    expect(windsOf(envOf({ gamesPlayed: 2 }))).toEqual(["West", "North", "East", "South"]);
    expect(windsOf(envOf({ gamesPlayed: 3 }))).toEqual(["South", "West", "North", "East"]);
    // 第 5 局又轮回座位 0
    expect(dealerOf(envOf({ gamesPlayed: 4 }))).toBe(0);
  });

  it("分数照抄 matchScores，按座位", () => {
    expect(boardModel(envOf({ scores: [5, 6, 7, 8] }), null).sides.map((s) => s.score)).toEqual([5, 6, 7, 8]);
  });
});

describe("结算中", () => {
  it("带 result：局数与庄家仍是刚打完那一局，且不亮任何一边", () => {
    // 第 2 局（gamesPlayed=1）结算那一刻服务端已把 gamesPlayed 加到 2
    const env = envOf({ gamesPlayed: 2, result: true, turn: 3 });
    const m = boardModel(env, actorOf(env, null));
    expect(m.game).toBe(2);
    expect(dealerOf(env)).toBe(1);
    expect(m.sides.find((s) => s.wind === "East")!.seat).toBe(1);
    expect(m.sides.some((s) => s.lit)).toBe(false);
    // 回放里就算有 actor，结算也不亮
    expect(actorOf(env, 2)).toBeNull();
  });
});

describe("亮哪一边", () => {
  it("回放中：actor 覆盖 state.turn；exhausted（没有 seat）保持上一步", () => {
    const env = envOf({ turn: 0 });
    let actor: number | null = null;
    actor = nextReplayActor(actor, { t: "draw", seat: 2 });
    expect(actorOf(env, actor)).toBe(2);
    actor = nextReplayActor(actor, { t: "discard", seat: 2, tile: "a" });
    actor = nextReplayActor(actor, { t: "exhausted" });
    expect(actor).toBe(2);
    expect(boardModel(env, actorOf(env, actor)).sides.filter((s) => s.lit).map((s) => s.seat)).toEqual([2]);
  });

  it("吃牌决策时 state.turn 还是上家：亮的是自己", () => {
    const env = envOf({ turn: 3, pending: { kind: "chi", tile: "a", canPass: true, hints: [] } });
    expect(actorOf(env, null)).toBe(env.state.me.seat);
  });

  it("没有 pending（自己胡了在等别家）：照 state.turn", () => {
    expect(actorOf(envOf({ turn: 2 }), null)).toBe(2);
  });
});

describe("model 不变不重画", () => {
  /** node 里没有 canvas：造一个什么都不做的 2D 上下文 */
  function fakeCanvas(): HTMLCanvasElement {
    const ctx = new Proxy({}, { get: (_t, p) => (p === "measureText" ? () => ({ width: 0 }) : () => {}), set: () => true });
    return { width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement;
  }

  it("同一个 model 重复喂，只画一次、贴图不重新上传；变了才重画", () => {
    const board = new CenterBoard(fakeCanvas());
    const texture = (board.mesh.material as unknown as { map: { version: number } }).map;
    const env = envOf();
    board.update(boardModel(env, 0));
    const v = texture.version;
    board.update(boardModel(env, 0));
    board.update(boardModel(structuredClone(env), 0));
    expect(board.drawCount).toBe(1);
    expect(texture.version).toBe(v);

    board.update(boardModel(env, 1)); // 换人行动
    expect(board.drawCount).toBe(2);
    expect(texture.version).toBe(v + 1);
    board.dispose();
  });
});
