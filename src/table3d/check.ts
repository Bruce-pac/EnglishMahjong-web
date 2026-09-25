/**
 * T4.1：选中的牌是不是个词——请求时机与竞态。
 *
 * **结果只有一个来源**（2.5D `Hand.tsx` 踩过的坑）：调用方每帧把最新的推导结果喂进
 * `update()`，这里按 `spellKey` 比对，变了才处理；各个事件回调里不手动发请求、不手动清结果。
 *
 * - 同一个 key 不重复请求
 * - 过期响应丢弃：每次发请求递增序号，回来的不是最新一次就扔掉；`dispose()` 之后也扔
 * - 不看 `pending`、不受打牌锁：校验是只读的提问
 * - 请求失败：`onError` 照旧调（通知里说「为什么」），状态进 `failed`、key 不变（校验条给「校验失败 · 重试」，说「怎么办」），
 *   **不显示成「不是单词」**。不自动重试：只有玩家点了重试（`retry()`）才对同一个选区再问一次（P13）
 *
 * `validate` 可注入，单测不需要服务端。
 */

import type { Validation } from "../api";
import { spellKey, type Spell } from "./spell";

/**
 * 非空状态都带着推导结果的 `key`（亮词两步确认靠它判断「选区变了没有」）。
 * `tiles` / `word` 是 T4.1 推导出来的，组暗词、亮词直接拿去提交——不从校验响应里重新拼。
 */
export type CheckState =
  | { status: "idle" }
  | { status: "tooManyWilds"; key: string; display: string }
  | { status: "needWild"; key: string; display: string; wild: { tileId: number; kind: "1" | "2" } }
  | { status: "checking"; key: string; display: string; tiles: string; word: string }
  | { status: "done"; key: string; display: string; tiles: string; word: string; result: Validation }
  /** P13：请求失败（断网、服务端 500）。带着同一个 key 和推导结果，`retry()` 拿它们再问一次 */
  | { status: "failed"; key: string; display: string; tiles: string; word: string };

export type ValidateFn = (tiles: string, word: string) => Promise<Validation>;

export class SelectionValidator {
  private key = "none";
  private seq = 0;
  private disposed = false;
  /** 当前状态。`retry()` 只在 failed 时生效，要知道现在是什么 */
  private state: CheckState = { status: "idle" };

  constructor(
    private readonly validate: ValidateFn,
    private readonly onChange: (state: CheckState) => void,
    private readonly onError: (error: unknown) => void,
  ) {}

  private emit(state: CheckState): void {
    this.state = state;
    this.onChange(state);
  }

  update(spell: Spell): void {
    if (this.disposed) return;
    const key = spellKey(spell);
    if (key === this.key) return;
    this.key = key;
    const seq = ++this.seq; // 选区一变，在途的请求就过期了

    if (spell.kind === "none") {
      this.emit({ status: "idle" });
      return;
    }
    if (spell.kind === "tooManyWilds") {
      this.emit({ status: "tooManyWilds", key, display: spell.display });
      return;
    }
    if (spell.kind === "needWild") {
      this.emit({ status: "needWild", key, display: spell.display, wild: spell.wild });
      return;
    }

    this.ask(seq, key, spell.word.toUpperCase(), spell.tiles, spell.word);
  }

  /**
   * P13：失败之后玩家点了「重试」，用同一个选区再问一次。**只有当前是 failed 时才生效**，其余状态什么也不做。
   * 照旧递增序号：重试途中选区变了，重试的响应照样被丢掉
   */
  retry(): void {
    if (this.disposed || this.state.status !== "failed") return;
    const { key, display, tiles, word } = this.state;
    this.ask(++this.seq, key, display, tiles, word);
  }

  private ask(seq: number, key: string, display: string, tiles: string, word: string): void {
    this.emit({ status: "checking", key, display, tiles, word });
    this.validate(tiles, word).then(
      (result) => {
        if (this.disposed || seq !== this.seq) return;
        this.emit({ status: "done", key, display, tiles, word, result });
      },
      (error) => {
        if (this.disposed || seq !== this.seq) return;
        this.emit({ status: "failed", key, display, tiles, word });
        this.onError(error);
      },
    );
  }

  /** 组件卸载：之后回来的响应一律丢掉 */
  dispose(): void {
    this.disposed = true;
    this.seq++;
  }
}
