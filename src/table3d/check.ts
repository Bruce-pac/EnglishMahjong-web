/**
 * T4.1：选中的牌是不是个词——请求时机与竞态。
 *
 * **结果只有一个来源**（2.5D `Hand.tsx` 踩过的坑）：调用方每帧把最新的推导结果喂进
 * `update()`，这里按 `spellKey` 比对，变了才处理；各个事件回调里不手动发请求、不手动清结果。
 *
 * - 同一个 key 不重复请求
 * - 过期响应丢弃：每次发请求递增序号，回来的不是最新一次就扔掉；`dispose()` 之后也扔
 * - 不看 `pending`、不受打牌锁：校验是只读的提问
 * - 请求失败交给 `onError`（显示成通知），状态回到中性，**不显示成「不是单词」**
 *
 * `validate` 可注入，单测不需要服务端。
 */

import type { Validation } from "../api";
import { spellKey, type Spell } from "./spell";

export type CheckState =
  | { status: "idle" }
  | { status: "needWild"; display: string }
  | { status: "checking"; display: string }
  | { status: "done"; display: string; result: Validation };

export type ValidateFn = (tiles: string, word: string) => Promise<Validation>;

export class SelectionValidator {
  private key = "none";
  private seq = 0;
  private disposed = false;

  constructor(
    private readonly validate: ValidateFn,
    private readonly onChange: (state: CheckState) => void,
    private readonly onError: (error: unknown) => void,
  ) {}

  update(spell: Spell): void {
    if (this.disposed) return;
    const key = spellKey(spell);
    if (key === this.key) return;
    this.key = key;
    const seq = ++this.seq; // 选区一变，在途的请求就过期了

    if (spell.kind === "none") {
      this.onChange({ status: "idle" });
      return;
    }
    if (spell.kind === "needWild") {
      this.onChange({ status: "needWild", display: spell.display });
      return;
    }

    const display = spell.word.toUpperCase();
    this.onChange({ status: "checking", display });
    this.validate(spell.tiles, spell.word).then(
      (result) => {
        if (this.disposed || seq !== this.seq) return;
        this.onChange({ status: "done", display, result });
      },
      (error) => {
        if (this.disposed || seq !== this.seq) return;
        this.onChange({ status: "idle" });
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
