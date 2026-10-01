/**
 * 观战条的状态和「提前结算」按钮的显示条件（纯函数，单测覆盖）。
 *
 * 3D 在 `table3d/spectate.ts` 里自带一份同内容的，理由同 `table3d/ConfigBar.tsx` 开头。
 */

/**
 * 你胡牌之后，手牌区换成的那条横条该怎么说。
 *
 * 不只是血战到底才会出现：你一胡，`me.won` 就为真，非血战局（你一胡本局就结束）、
 * 血战局打到牌墙摸完，这条都会在结算页底下露出来。那两种情况都已经没人在打了，
 * 写「血战到底：还有 N 家在打」是错的
 */
export function spectateStatus(o: { bloody: boolean; finished: boolean; stillPlaying: number }): {
  over: boolean;
  note: string;
} {
  if (!o.bloody) return { over: true, note: "你胡牌了，本局结束" };
  if (o.finished) return { over: true, note: "本局已结束" };
  // 只剩一家时，血战到底就结束了（引擎里 `len(active()) <= 1` 即收场）
  if (o.stillPlaying <= 1) return { over: true, note: "只剩一家，本局已结束，正在结算…" };
  return { over: false, note: `血战到底：还有 ${o.stillPlaying} 家在打，打完才结算` };
}

/**
 * 「提前结算」按钮：血战到底、你已经胡了、回放还没放完、界面上还有人在打。
 *
 * 你胡牌那一刻服务端已经把剩下几家打完、结算好了，这里只是跳过回放，结果完全一样
 */
export function canSkipReplay(o: { bloody: boolean; meWon: boolean; replaying: boolean; stillPlaying: number }): boolean {
  return o.bloody && o.meWon && o.replaying && o.stillPlaying > 1;
}
