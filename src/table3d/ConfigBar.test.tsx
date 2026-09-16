/** T2.3a：右上角玩法配置条的文案 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { State } from "../api";
import { ConfigBar, configRows } from "./ConfigBar";

const config = (over: Partial<State["config"]> = {}): State["config"] => ({
  tier: "cet4",
  minWordLen: 3,
  minWinWordLen: 5,
  hints: false,
  bloody: true,
  difficulty: "hard",
  ...over,
});
const text = (c: State["config"] | null) => renderToStaticMarkup(<ConfigBar config={c} />).replace(/<[^>]+>/g, " ");

describe("配置条", () => {
  it("六项文案都对", () => {
    expect(configRows(config())).toEqual([
      { label: "词库", value: "四级" },
      { label: "难度", value: "困难" },
      { label: "词长", value: "≥3", title: expect.any(String) },
      { label: "起胡", value: "≥5", title: expect.any(String) },
      { label: "血战", value: "开", title: expect.any(String) },
      { label: "提示", value: "关", title: expect.any(String) },
    ]);
    const html = text(config());
    for (const s of ["词库", "四级", "难度", "困难", "词长", "≥3", "起胡", "≥5", "血战", "提示"]) {
      expect(html).toContain(s);
    }
  });

  it("每个词库档位都有中文名", () => {
    for (const [tier, name] of [["junior", "初中"], ["senior", "高中"], ["cet4", "四级"], ["cet6", "六级"], ["kaoyan", "考研"], ["toefl", "托福"], ["gre", "GRE"]]) {
      expect(configRows(config({ tier }))[0].value).toBe(name);
    }
    for (const [d, name] of [["easy", "简单"], ["normal", "普通"], ["hard", "困难"]]) {
      expect(configRows(config({ difficulty: d }))[1].value).toBe(name);
    }
  });

  it("起胡为 0 显示「关」，非 0 显示 ≥N", () => {
    expect(configRows(config({ minWinWordLen: 0 }))[3].value).toBe("关");
    expect(configRows(config({ minWinWordLen: 7 }))[3].value).toBe("≥7");
  });

  it("血战、提示的开关文案两种都对", () => {
    expect(configRows(config({ bloody: true, hints: true })).slice(4).map((r) => r.value)).toEqual(["开", "开"]);
    expect(configRows(config({ bloody: false, hints: false })).slice(4).map((r) => r.value)).toEqual(["关", "关"]);
  });

  it("还没拿到 envelope 时什么都不画", () => {
    expect(renderToStaticMarkup(<ConfigBar config={null} />)).toBe("");
  });
});
