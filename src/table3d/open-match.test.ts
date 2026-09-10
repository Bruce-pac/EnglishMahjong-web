/**
 * 刷新恢复时，哪些错误该丢掉原来那局（T1.4 方案 §6：只有 404）。
 */

import { describe, expect, it, vi } from "vitest";
import { ApiError, type Envelope, type MatchConfig } from "../api";
import { openMatch, type OpenMatchDeps } from "./open-match";

const CONFIG = { tier: "junior" } as MatchConfig;
const OLD = { matchId: "old" } as Envelope;
const FRESH = { matchId: "fresh" } as Envelope;

function deps(resumeError?: unknown) {
  return {
    resume: vi.fn(async (_id: string) => {
      if (resumeError !== undefined) throw resumeError;
      return OLD;
    }),
    newMatch: vi.fn(async (_config: MatchConfig) => FRESH),
    clearSave: vi.fn((_id: string) => {}),
  } satisfies OpenMatchDeps;
}

describe("openMatch", () => {
  it("地址栏没有牌局 → 直接开新局", async () => {
    const d = deps();
    expect(await openMatch(null, CONFIG, d)).toBe(FRESH);
    expect(d.resume).not.toHaveBeenCalled();
    expect(d.clearSave).not.toHaveBeenCalled();
  });

  it("恢复成功 → 接管原来那局，不碰存档", async () => {
    const d = deps();
    expect(await openMatch("old", CONFIG, d)).toBe(OLD);
    expect(d.clearSave).not.toHaveBeenCalled();
    expect(d.newMatch).not.toHaveBeenCalled();
  });

  it("404（服务器重启、牌局已不存在）→ 清存档并开新局", async () => {
    const d = deps(new ApiError("牌局不存在", 404));
    expect(await openMatch("old", CONFIG, d)).toBe(FRESH);
    expect(d.clearSave).toHaveBeenCalledWith("old");
    expect(d.newMatch).toHaveBeenCalledOnce();
  });

  it.each([
    ["429 限流", new ApiError("请求太频繁", 429)],
    ["500 服务端出错", new ApiError("请求失败", 500)],
    ["断网（fetch 自己抛 TypeError，没有 status）", new TypeError("Failed to fetch")],
    ["响应不是 JSON（代理错误页之类）", new SyntaxError("Unexpected token <")],
  ])("%s → 原样抛出，保留存档、不开新局", async (_, err) => {
    const d = deps(err);
    await expect(openMatch("old", CONFIG, d)).rejects.toBe(err);
    expect(d.clearSave).not.toHaveBeenCalled();
    expect(d.newMatch).not.toHaveBeenCalled();
  });

  it("ApiError 的 message 就是服务端的 detail——2.5D 的 useGame 只读 message", () => {
    const e = new ApiError("牌局不存在", 404);
    expect(e).toBeInstanceOf(Error);
    expect(e.message).toBe("牌局不存在");
    expect(e.status).toBe(404);
  });
});
