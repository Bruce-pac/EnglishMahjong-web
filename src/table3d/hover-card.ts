/**
 * P22：悬停别家的亮词 / 摊开的暗词时，浮层列出那一家的词和释义。
 *
 * 这里只有纯逻辑：浮层内容（标题、小标题、词列表）和释义缓存。拾取在 TableView / MouseUi，
 * DOM 在 Table3D。**只列服务端已经下发的、公开的词**（亮词、胡牌 / 荒牌摊开的暗词）——
 * 不列「还能拼什么」，那是提示功能的专属职责（教学红线）。
 */

import type { State } from "../api";
import { AI_NAMES } from "./names";

/** 悬停到的是哪一家的哪一片 */
export interface HoverHit {
  seat: number;
  kind: "meld" | "concealed";
}

export interface HoverCard {
  title: string;
  subtitle: string;
  /** 按亮出 / 摊开的顺序 */
  words: string[];
}

/** 浮层内容。悬停的那家不在 others 里（是自己、或座位不存在）返回 null */
export function hoverCard(state: State, hit: HoverHit): HoverCard | null {
  const o = state.others.find((x) => x.seat === hit.seat);
  if (!o) return null;
  const name = AI_NAMES[o.seat] ?? `${o.seat} 号`;
  const title = o.won && o.winOrder != null ? `${name} · 第 ${o.winOrder + 1} 胡` : name;
  if (hit.kind === "meld") {
    return { title, subtitle: `亮词 ${o.melds.length} 个`, words: o.melds.map((w) => w.word) };
  }
  // 胡了摊开的是「胡牌时的暗词」；没胡但 concealed 非空，是荒牌时摊开的
  return {
    title,
    subtitle: o.won ? "胡牌时的暗词" : "摊开的暗词",
    words: o.concealed.map((w) => w.word),
  };
}

export type Definition =
  | { status: "loading" }
  | { status: "found"; text: string }
  | { status: "missing" }
  | { status: "error" };

export type DefineFn = (word: string) => Promise<{ found: boolean; definition?: string }>;

/**
 * 释义缓存。同一个词只请求一次、在途的请求去重；**失败不缓存**（下次悬停再试）。
 * 整个 3D 页共用一份，换局不清；只在真的悬停到时才查，不预取
 */
export class DefinitionCache {
  private readonly done = new Map<string, Definition>();
  private readonly inflight = new Map<string, Promise<void>>();
  /** 失败过的：浮层里显示「没取到」，但下次 request 会再发 */
  private readonly failed = new Set<string>();

  constructor(
    private readonly define: DefineFn,
    private readonly onUpdate: () => void,
  ) {}

  get(word: string): Definition {
    const hit = this.done.get(word);
    if (hit) return hit;
    if (this.inflight.has(word)) return { status: "loading" };
    if (this.failed.has(word)) return { status: "error" };
    return { status: "loading" };
  }

  /** 确保这个词在查（或已查到）。已缓存、在途的都不再发 */
  request(word: string): void {
    if (this.done.has(word) || this.inflight.has(word)) return;
    const p = this.define(word).then(
      (r) => {
        this.done.set(word, r.found && r.definition ? { status: "found", text: r.definition } : { status: "missing" });
        this.failed.delete(word);
      },
      () => {
        this.failed.add(word);
      },
    );
    this.inflight.set(
      word,
      p.finally(() => {
        this.inflight.delete(word);
        this.onUpdate();
      }),
    );
  }
}
