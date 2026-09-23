/** T2.3b：偏好面板的渲染 + 大小写是全局偏好（不跟牌局走） */

import { Group } from "three";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Envelope, State } from "../api";
import { fakeAssetLoader } from "./fake-assets";
import { readHandCase, writeHandCase } from "./hand-case";
import { ObjectView } from "./object-view";
import { PrefsPanel } from "./PrefsPanel";
import { makeSlots } from "./setup-slots";
import { TableView } from "./table-view";
import { fixtureGames } from "./test-helpers";

function fakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
  } as Storage;
}
beforeEach(() => vi.stubGlobal("window", { localStorage: fakeStorage() }));
afterEach(() => vi.unstubAllGlobals());

const render = (open: boolean, lowercase: boolean) =>
  renderToStaticMarkup(
    <PrefsPanel open={open} lowercase={lowercase} soundOn onToggleOpen={() => {}} onLowercase={() => {}} onSound={() => {}} />,
  );

describe("⚙ 面板", () => {
  it("收起时只有图标；展开时两个选项都在", () => {
    const closed = render(false, false);
    expect(closed).toContain("⚙");
    expect(closed).not.toContain("大写");
    const open = render(true, false);
    expect(open).toContain("大写");
    expect(open).toContain("小写");
    expect(open).toContain('aria-expanded="true"');
  });

  it("当前那一档被标出来（aria-pressed + on）", () => {
    expect(render(true, false)).toMatch(/大写[\s\S]*?/);
    const upper = render(true, false);
    const lower = render(true, true);
    // 大写档开着时，「大写」那个按钮 aria-pressed=true；切到小写则反过来
    expect(upper.indexOf('aria-pressed="true"')).toBeLessThan(upper.indexOf("小写"));
    expect(lower.indexOf('aria-pressed="true"')).toBeGreaterThan(lower.indexOf("大写"));
    expect(lower).toContain("table3d-prefs-opt on");
  });
});

const envOf = (state: State, matchId = "m-prefs"): Envelope => ({
  matchId,
  events: [],
  state,
  pending: null,
  result: null,
  matchFinished: false,
});
const stateWith = (hand: string[]): State => {
  const s = structuredClone(fixtureGames()[0].steps[2].state);
  s.me.hand = hand;
  s.me.groups = [];
  return s;
};
const newView = () => new TableView(new ObjectView(new Group(), fakeAssetLoader()), makeSlots());
/** 某组槽位上的牌面编号 */
function facesOf(view: TableView, pick: (slotName: string) => boolean): number[] {
  const out: number[] = [];
  for (const [thing, slotName] of view.slotNames) if (pick(slotName)) out.push(view.faceOfThing(thing));
  return out;
}

describe("大小写只作用于手牌区", () => {
  it("切小写后自己手牌落在小写段（26..51），牌河与别家仍是大写段", () => {
    const view = newView();
    view.apply(envOf(stateWith(["c", "a", "t"])));
    const mine = () => facesOf(view, (n) => n.startsWith("loose.") && n.endsWith("@0"));
    const river = () => facesOf(view, (n) => n.startsWith("discard."));
    const others = () => facesOf(view, (n) => n.startsWith("loose.") && !n.endsWith("@0"));
    expect(mine().every((f) => f < 26)).toBe(true);

    view.setLowercase(true);
    expect(mine().length).toBeGreaterThan(0);
    expect(mine().every((f) => f >= 26 && f <= 51)).toBe(true);
    expect(river().length).toBeGreaterThan(0);
    expect(river().every((f) => f < 26)).toBe(true);
    // 别家的手牌是背面哑值 0，照样不在小写段
    expect(others().every((f) => f < 26)).toBe(true);

    view.setLowercase(false);
    expect(mine().every((f) => f < 26)).toBe(true);
  });
});

describe("全局偏好为准", () => {
  it("存档里写着小写、全局键是大写：开局按大写", () => {
    const first = newView();
    first.apply(envOf(stateWith(["c", "a", "t"])));
    first.setLowercase(true); // 会连同 display.lowercase=true 一起存档

    writeHandCase(false); // 但玩家的全局偏好是大写
    const again = newView();
    again.setLowercase(readHandCase());
    again.apply(envOf(stateWith(["c", "a", "t"])));
    const mine = facesOf(again, (n) => n.startsWith("loose.") && n.endsWith("@0"));
    expect(mine.every((f) => f < 26)).toBe(true);
  });

  it("换一局也记得：全局键是小写时，新一局照样小写", () => {
    writeHandCase(true);
    const view = newView();
    view.setLowercase(readHandCase());
    view.apply(envOf(stateWith(["c", "a", "t"])));
    const next = stateWith(["d", "o", "g"]);
    next.gamesPlayed = 1; // 同一场的下一局
    view.apply(envOf(next));
    const mine = facesOf(view, (n) => n.startsWith("loose.") && n.endsWith("@0"));
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((f) => f >= 26 && f <= 51)).toBe(true);
  });

  it("读写全局键", () => {
    writeHandCase(true);
    expect(readHandCase()).toBe(true);
    expect(window.localStorage.getItem("emj-hand-case")).toBe("lower");
    writeHandCase(false);
    expect(readHandCase()).toBe(false);
  });
});
