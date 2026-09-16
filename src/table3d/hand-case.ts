/**
 * T2.3b：手牌区字母大小写——**本机偏好**，不是牌局状态。
 *
 * 纯显示（需求文档 §4.9）：牌面数据、发给服务端的一切都不受影响。全大写的字母排在一起
 * 有时反而认不出单词，所以让玩家随手切，并记进 localStorage：下一局、换一场、刷新后都照他的习惯来。
 *
 * **和 2.5D 共用同一个键 `emj-hand-case`**：键是数据不是模块，不算 import 2.5D。
 * 两个页面切着玩时，玩家的习惯才不会各记各的。
 *
 * 大小写以前被存进牌局存档（`persist` 的 `display.lowercase`），那是错的定位：换一局就忘了。
 * 存档里照旧写那个字段、版本号不升——省得为一个偏好作废所有人的散牌区顺序——但**读的时候以这里为准**。
 */

const KEY = "emj-hand-case";

/** localStorage 在隐私模式 / 禁用 cookie 时会抛，读写都别让它掀翻整页 */
function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readHandCase(): boolean {
  return storage()?.getItem(KEY) === "lower";
}

export function writeHandCase(lowercase: boolean): void {
  try {
    storage()?.setItem(KEY, lowercase ? "lower" : "upper");
  } catch {
    // 存不下就只在本次会话里生效，不值得打断游戏
  }
}
