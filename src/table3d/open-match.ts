/**
 * 进 3D 页时拿哪一局：有 `?match=<id>` 就接管原来那局，没有就开新局。
 *
 * 抽成一个不碰 three.js、不碰 React 的小函数，是为了能用假的 api 单测——
 * 「什么错误该丢掉原来那局」是个一旦写错、玩家就会丢牌的判断，值得钉死。
 */

import { ApiError, type Envelope, type MatchConfig } from "../api";

export interface OpenMatchDeps {
  resume(id: string): Promise<Envelope>;
  newMatch(config: MatchConfig): Promise<Envelope>;
  /** 清掉这一局的散牌区存档（`persist.clear`） */
  clearSave(id: string): void;
}

/**
 * **只有 404 和 403 才清存档、开新局**（T1.4 方案 §6；403 是 T6.6 加的）。
 *
 * 404 的意思是「服务器上已经没有这一局了」——牌局只存内存，服务器一重启就没了
 * （DESIGN.md §3 的有意取舍），这时存档再留着也接不回去。
 *
 * 403 是「这不是你的牌局」（`api.py` 的归属校验）：在首页登录了另一个账号、或退出登录，
 * 本地 playerId 换了，再用原来带 `?match=` 的地址回来就是它。对**当前这个身份**来说，
 * 那一局和不存在没有区别——重试多少次都是 403。所以和 404 等价：清存档、开新局，别卡在「重试」。
 *
 * 其余错误一律原样抛出、**不清存档、不开新局**：网络抖一下、撞上限流（429）、
 * 服务端报 500，原来那局都还在服务器上，玩家排好的手牌顺序也还在 localStorage 里。
 * 在这些时候清存档，等于因为一次偶发失败把玩家的整局牌扔了。调用方负责显示错误、
 * 给「重试」。
 */
export async function openMatch(
  savedId: string | null,
  config: MatchConfig,
  deps: OpenMatchDeps,
): Promise<Envelope> {
  if (!savedId) return deps.newMatch(config);
  try {
    return await deps.resume(savedId);
  } catch (e) {
    if (!(e instanceof ApiError && (e.status === 404 || e.status === 403))) throw e;
    deps.clearSave(savedId);
    return deps.newMatch(config);
  }
}
