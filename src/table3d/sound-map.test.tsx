/** P1：事件 → 音效的映射，以及 ⚙ 面板里的音效开关 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { GameEvent } from "../api";
import { PrefsPanel } from "./PrefsPanel";
import { soundOf } from "./replay";

describe("soundOf", () => {
  const ev = (t: GameEvent["t"]): GameEvent => ({ t, seat: 1 });
  it("打牌、吃、亮词、胡、荒牌各响同名音效", () => {
    expect(soundOf(ev("discard"))).toBe("discard");
    expect(soundOf(ev("chi"))).toBe("chi");
    expect(soundOf(ev("reveal"))).toBe("reveal");
    expect(soundOf(ev("win"))).toBe("win");
    expect(soundOf({ t: "exhausted" })).toBe("exhausted");
  });
  it("摸牌不响", () => {
    expect(soundOf(ev("draw"))).toBeNull();
  });
});

describe("⚙ 面板的音效开关", () => {
  const render = (soundOn: boolean) =>
    renderToStaticMarkup(
      <PrefsPanel open lowercase={false} soundOn={soundOn} onToggleOpen={() => {}} onLowercase={() => {}} onSound={() => {}} />,
    );
  it("渲染出音效那一行", () => {
    expect(render(true)).toContain("音效");
  });
  it("开：「开」按下、「关」没按下", () => {
    const html = render(true);
    expect(html).toMatch(/aria-pressed="true"[^>]*>开</);
    expect(html).toMatch(/aria-pressed="false"[^>]*>关</);
  });
  it("关：「关」按下、「开」没按下", () => {
    const html = render(false);
    expect(html).toMatch(/aria-pressed="false"[^>]*>开</);
    expect(html).toMatch(/aria-pressed="true"[^>]*>关</);
  });
});
