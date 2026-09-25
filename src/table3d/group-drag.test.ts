/** T4.3：暗词组的收拢与整组拖动 */

import { describe, expect, it } from "vitest";
import { LOOSE_SLOTS } from "./layout";
import { compactGroup, insertLoose, moveGroupLoose, splitsGroup, type LooseSlots } from "./loose-reconcile";
import { Movement } from "./movement";
import { makeSlots } from "./setup-slots";
import type { Slot } from "./slot";
import { Thing } from "./thing";
import { ThingType } from "./types";
import { slotOf } from "./test-helpers";
import { rng } from "./test-helpers";

/** `.` 是空格；每个字符按出现顺序发 tileId（从 1 起） */
function row(pattern: string): LooseSlots {
  let id = 1;
  const out: LooseSlots = new Array(LOOSE_SLOTS).fill(null);
  [...pattern.padEnd(LOOSE_SLOTS, ".")].forEach((c, i) => {
    if (c !== ".") out[i] = { tileId: id++, tile: c };
  });
  return out;
}
const show = (s: LooseSlots | null) => (s ? s.map((e) => e?.tile ?? ".").join("") : null);
const idsAt = (s: LooseSlots, ...slots: number[]) => slots.map((i) => s[i]!.tileId);

describe("compactGroup", () => {
  it("C . A T → C A T . ：向左收拢到第一张成员起", () => {
    const s = row("xc.at.y");
    const next = compactGroup(s, idsAt(s, 1, 3, 4))!;
    expect(show(next)!.slice(0, 7)).toBe("xcat..y");
  });

  it("只动成员：别的牌 tileId 和格子都不变；成员顺序不变", () => {
    const s = row("ab.c..d.e.f");
    const members = idsAt(s, 3, 6, 8); // c d e，中间夹着空格
    const next = compactGroup(s, members)!;
    for (let i = 0; i < s.length; i++) {
      const e = s[i];
      if (e && !members.includes(e.tileId)) expect(next[i]?.tileId).toBe(e.tileId);
    }
    expect(next.slice(3, 6).map((e) => e!.tileId)).toEqual(members);
  });

  it("传进来的 id 顺序不影响结果（按槽位排）", () => {
    const s = row("c.a.t");
    const a = compactGroup(s, idsAt(s, 0, 2, 4));
    const b = compactGroup(s, idsAt(s, 4, 0, 2));
    expect(show(a)).toBe(show(b));
  });

  it("成员之间夹着非成员 → null，不收拢", () => {
    const s = row("c.xat");
    expect(compactGroup(s, idsAt(s, 0, 3, 4))).toBeNull();
  });

  it("随机：成员之间只有空格时，收拢后只有成员动了、读出的词不变", () => {
    const rand = rng(43);
    for (let round = 0; round < 300; round++) {
      const s: LooseSlots = new Array(LOOSE_SLOTS).fill(null);
      let id = 1;
      for (let i = 0; i < LOOSE_SLOTS; i++) if (rand() < 0.6) s[i] = { tileId: id++, tile: "abcdefg"[Math.floor(rand() * 7)] };
      // 随机挑一段 [lo, hi]，把其中的牌全当成员（和框选一样是连续一段）
      const lo = Math.floor(rand() * LOOSE_SLOTS);
      const hi = Math.min(LOOSE_SLOTS - 1, lo + Math.floor(rand() * 6));
      const members = s.slice(lo, hi + 1).flatMap((e) => (e ? [e.tileId] : []));
      const next = compactGroup(s, members)!;
      const word = (x: LooseSlots) => x.filter((e) => e && members.includes(e.tileId)).map((e) => e!.tile).join("");
      expect(word(next)).toBe(word(s));
      for (let i = 0; i < LOOSE_SLOTS; i++) {
        const e = s[i];
        if (e && !members.includes(e.tileId)) expect(next[i]?.tileId).toBe(e.tileId);
      }
    }
  });
});

/** 自己散牌区那一排，按下标排好 */
function looseRow(): Slot[] {
  return [...makeSlots().values()]
    .filter((s) => s.group === "loose" && s.seat === 0)
    .sort((a, b) => a.indexes[0] - b.indexes[0]);
}

/** 用 Movement 一次 move 多张做预览，读回预览后的一排；非法返回 null */
function preview(s: LooseSlots, members: readonly number[], from: number, to: number): LooseSlots | null {
  const lrow = looseRow();
  const things: Thing[] = [];
  const byThing = new Map<Thing, NonNullable<LooseSlots[number]>>();
  s.forEach((e, i) => {
    if (!e) return;
    const t = new Thing(things.length, ThingType.TILE, 0, lrow[i]);
    things.push(t);
    byThing.set(t, e);
  });
  const held = things.filter((t) => members.includes(byThing.get(t)!.tileId)).sort((a, b) => a.slot.indexes[0] - b.slot.indexes[0]);
  const m = new Movement();
  for (const t of held) {
    const target = lrow[t.slot.indexes[0] + (to - from)];
    if (!target) return null;
    m.move(t, target);
  }
  if (!m.findShift(things) || !m.valid()) return null;
  const out: LooseSlots = new Array(LOOSE_SLOTS).fill(null);
  for (const t of things) {
    const slot = m.get(t) ?? m.shifts().get(t) ?? t.slot;
    expect(out[slot.indexes[0]], "两张牌抢同一格").toBeNull();
    out[slot.indexes[0]] = byThing.get(t)!;
  }
  return out;
}

describe("moveGroupLoose", () => {
  it("CAT 整组拖到最左边：别的牌被挤开，成员相对格距不变", () => {
    const s = row("..xycat.");
    const cat = idsAt(s, 4, 5, 6);
    const next = moveGroupLoose(s, cat, 4, 0)!;
    // X 先试往左让，左边全是成员要落的格子、走到头失败；改往右，把 Y 一起挤开
    expect(show(next)!.slice(0, 8)).toBe("catxy...");
  });

  it("散开的暗词（没收拢过）也整体平移，格距保持", () => {
    const s = row("c.a.t....");
    const ids = idsAt(s, 0, 2, 4);
    const next = moveGroupLoose(s, ids, 0, 3)!;
    expect(show(next)!.slice(0, 9)).toBe("...c.a.t.");
  });

  it("任何一张越界 → null", () => {
    const s = row("..cat");
    expect(moveGroupLoose(s, idsAt(s, 2, 3, 4), 2, LOOSE_SLOTS - 2)).toBeNull();
    expect(moveGroupLoose(s, idsAt(s, 2, 3, 4), 4, 1)).toBeNull();
  });

  it("随机：与 Movement 一次 move 多张的预览逐格一致（含两边都判非法）", () => {
    const rand = rng(44);
    let legal = 0, illegal = 0;
    for (let round = 0; round < 400; round++) {
      const s: LooseSlots = new Array(LOOSE_SLOTS).fill(null);
      let id = 1;
      for (let i = 0; i < LOOSE_SLOTS; i++) if (rand() < 0.65) s[i] = { tileId: id++, tile: "abcdefg"[Math.floor(rand() * 7)] };
      const filled = s.flatMap((e, i) => (e ? [i] : []));
      if (filled.length < 2) continue;
      // 随机挑 1-4 张当成员（可以是散的）
      const k = 1 + Math.floor(rand() * Math.min(4, filled.length));
      const picked = [...filled].sort(() => rand() - 0.5).slice(0, k);
      const members = picked.map((i) => s[i]!.tileId);
      const from = picked[Math.floor(rand() * picked.length)];
      const to = Math.floor(rand() * LOOSE_SLOTS);
      const a = moveGroupLoose(s, members, from, to);
      const b = preview(s, members, from, to);
      if (a) legal++; else illegal++;
      expect(a === null, `${show(s)} 成员 ${picked} ${from}→${to}`).toBe(b === null);
      if (a && b) expect(slotOf(a)).toEqual(slotOf(b));
    }
    // 两种结果都要真的被覆盖到
    expect(legal).toBeGreaterThan(50);
    expect(illegal).toBeGreaterThan(20);
  });
});


describe("TableView 整组拖动", () => {
  // 延迟 import，避免上面的纯函数测试依赖 three 的场景对象
  async function setup() {
    const { Group, Vector3 } = await import("three");
    const { ObjectView } = await import("./object-view");
    const { TableView } = await import("./table-view");
    const { fakeAssetLoader } = await import("./fake-assets");
    const { fixtureGames } = await import("./test-helpers");
    const objectView = new ObjectView(new Group(), fakeAssetLoader());
    const view = new TableView(objectView, makeSlots());
    const state = structuredClone(fixtureGames()[0].steps[2].state);
    state.me.hand = ["x", "c", "a", "t", "y"];
    state.me.groups = [{ tiles: "act", word: "cat" }];
    view.apply({ matchId: "m-group", events: [], state, pending: null, result: null, matchFinished: false });
    const thingAt = (slot: number) => view.pickables.find((t) => t.place.position.equals(view.slots.get(`loose.${slot}@0`)!.place(0).position))!.id;
    const posOf = (name: string) => view.slots.get(name)!.place(0).position;
    const drag = (fromSlot: number, toName: string) => {
      const a = posOf(`loose.${fromSlot}@0`);
      const b = posOf(toName);
      view.setHovered(thingAt(fromSlot));
      expect(view.dragStart(new Vector3(a.x, a.y, 4))).toBe(true);
      view.dragMove(new Vector3(b.x, b.y, 4));
      return view.dragEnd();
    };
    return { view, objectView, drag };
  }
  const slotOfTile = (s: LooseSlots, tile: string) => s.findIndex((e) => e?.tile === tile);

  it("暗词的牌走 Custom 轨、进暗词框列表", async () => {
    const { view, objectView } = await setup();
    expect(view.looseSlots.filter((e) => e?.groupId !== undefined)).toHaveLength(3);
    expect(objectView.groupedObjects[0]).toHaveLength(3);
    expect(objectView.groupedObjects[1]).toHaveLength(0);
  });

  it("拖动中的帧（update 路径，不经 refreshFlags）暗词框也在：CAT、DOG 仍各占一个通道（P8）", async () => {
    const { view, objectView } = await setup();
    const { Vector3 } = await import("three");
    const { fixtureGames } = await import("./test-helpers");
    const state = structuredClone(fixtureGames()[0].steps[2].state);
    state.me.hand = ["x", "c", "a", "t", "d", "o", "g", "y"];
    state.me.groups = [
      { tiles: "act", word: "cat" },
      { tiles: "dgo", word: "dog" },
    ];
    view.apply({ matchId: "m-group", events: [], state, pending: null, result: null, matchFinished: false });
    const oSlot = slotOfTile(view.looseSlots, "o");
    const a = view.slots.get(`loose.${oSlot}@0`)!.place(0).position;
    view.setHovered(view.pickables.find((t) => t.place.position.equals(a))!.id);
    expect(view.dragStart(new Vector3(a.x, a.y, 4))).toBe(true);
    view.dragMove(new Vector3(a.x + 9, a.y + 5, 4));
    // mainLoop 拖动时每帧走的是 update()：它自己建 render 直接提交，不经 refreshFlags
    view.update(performance.now());
    expect(objectView.groupedObjects[0]).toHaveLength(3);
    expect(objectView.groupedObjects[1]).toHaveLength(3);
    view.dragEnd();
  });

  it("按住 A 整组拖到左边：和 moveGroupLoose 一致，成员格距不变", async () => {
    const { view, drag } = await setup();
    const before = view.looseSlots;
    const aSlot = slotOfTile(before, "a");
    const ids = before.flatMap((e) => (e && e.groupId !== undefined ? [e.tileId] : []));
    expect(drag(aSlot, "loose.2@0")).toBeNull();
    expect(slotOf(view.looseSlots)).toEqual(slotOf(moveGroupLoose(before, ids, aSlot, 2)!));
    expect([slotOfTile(view.looseSlots, "c"), slotOfTile(view.looseSlots, "a"), slotOfTile(view.looseSlots, "t")]).toEqual([1, 2, 3]);
  });

  it("整组拖到牌河：不算打牌（即使现在能打），整组滑回", async () => {
    const { view, drag } = await setup();
    view.setDiscardAllowed(true);
    const before = slotOf(view.looseSlots);
    expect(drag(slotOfTile(view.looseSlots, "a"), "discard.0.2@0")).toBeNull();
    expect(slotOf(view.looseSlots)).toEqual(before);
  });

  it("任何一张越界 → 非法落点，整组回原处", async () => {
    const { view, drag } = await setup();
    const before = slotOf(view.looseSlots);
    // 按住最左边的 C 拖到第 16 格：T 会落到第 18 格，越界
    expect(drag(slotOfTile(view.looseSlots, "c"), "loose.16@0")).toBeNull();
    expect(slotOf(view.looseSlots)).toEqual(before);
  });

  it("把别的牌拖进暗词中间 → 非法落点，散牌区不变（暗词除非拆开不能被分开）", async () => {
    const { view, drag } = await setup();
    const before = slotOf(view.looseSlots);
    // Y 放到 A 的格子：A 往左让，Y 会落进 A 和 T 之间
    expect(drag(slotOfTile(view.looseSlots, "y"), `loose.${slotOfTile(view.looseSlots, "a")}@0`)).toBeNull();
    expect(slotOf(view.looseSlots)).toEqual(before);
  });

  it("把别的牌拖到暗词外面、暗词被挤着整组平移 → 合法", async () => {
    const { view, drag } = await setup();
    // Y 放到 T 的格子：X C A T 整体往左让一格，Y 落在 T 右边
    expect(drag(slotOfTile(view.looseSlots, "y"), `loose.${slotOfTile(view.looseSlots, "t")}@0`)).toBeNull();
    const at = (t: string) => slotOfTile(view.looseSlots, t);
    expect([at("c"), at("a"), at("t"), at("y")]).toEqual([at("c"), at("c") + 1, at("c") + 2, at("c") + 3]);
  });
});

describe("TableView 单击暗词（[拆开] 的状态）", () => {
  async function setup(groups: { tiles: string; word: string }[]) {
    const { Group } = await import("three");
    const { ObjectView } = await import("./object-view");
    const { TableView } = await import("./table-view");
    const { fakeAssetLoader } = await import("./fake-assets");
    const { fixtureGames } = await import("./test-helpers");
    const view = new TableView(new ObjectView(new Group(), fakeAssetLoader()), makeSlots());
    const base = fixtureGames()[0].steps[2].state;
    const envOf = (g: typeof groups) => {
      const state = structuredClone(base);
      state.me.hand = ["x", "c", "a", "t", "y"];
      state.me.groups = g;
      return { matchId: "m-focus", events: [], state, pending: null, result: null, matchFinished: false };
    };
    view.apply(envOf(groups));
    const thingOfTile = (tile: string) => {
      const i = view.looseSlots.findIndex((e) => e?.tile === tile);
      const p = view.slots.get(`loose.${i}@0`)!.place(0).position;
      return view.pickables.find((t) => t.place.position.equals(p))!.id;
    };
    return { view, envOf, thingOfTile };
  }

  it("单击暗词里的一张：聚焦这个暗词、拿到拆开要提交的牌面，但不选中（不出校验条）", async () => {
    const { view, thingOfTile } = await setup([{ tiles: "act", word: "cat" }]);
    view.setSelected([thingOfTile("x"), thingOfTile("y")]); // 之前残留的选中
    expect(view.focusGroupAt(thingOfTile("a"))).toBe(true);
    const info = view.focusedGroupInfo()!;
    expect(info.tiles).toBe("cat");
    expect(view.selectedTileIds()).toEqual([]);
    // 锚点在最右边那张（T）的上方
    const tPos = view.pickables.find((t) => t.id === thingOfTile("t"))!.place.position;
    expect(info.anchor.x).toBeCloseTo(tPos.x);
    expect(info.anchor.z).toBeGreaterThan(tPos.z);
  });

  it("点的不是暗词里的牌：不聚焦", async () => {
    const { view, thingOfTile } = await setup([{ tiles: "act", word: "cat" }]);
    expect(view.focusGroupAt(thingOfTile("x"))).toBe(false);
    expect(view.focusedGroupInfo()).toBeNull();
  });

  it("点空白（clearSelection）后聚焦消失", async () => {
    const { view, thingOfTile } = await setup([{ tiles: "act", word: "cat" }]);
    view.focusGroupAt(thingOfTile("a"));
    view.clearSelection();
    expect(view.focusedGroupInfo()).toBeNull();
  });

  it("服务端拆开暗词之后（groups 里没了）：聚焦自然消失，牌原地不动", async () => {
    const { view, envOf, thingOfTile } = await setup([{ tiles: "act", word: "cat" }]);
    view.focusGroupAt(thingOfTile("a"));
    const before = slotOf(view.looseSlots);
    view.apply(envOf([]));
    expect(view.focusedGroupInfo()).toBeNull();
    expect(slotOf(view.looseSlots)).toEqual(before);
    expect(view.looseSlots.filter((e) => e?.groupKey)).toHaveLength(0);
  });
});

describe("两个完全相同的暗词（P12）", () => {
  it("单击其中一组：[拆开] 只交这一组的牌，另一组不受影响", async () => {
    const { Group } = await import("three");
    const { ObjectView } = await import("./object-view");
    const { TableView } = await import("./table-view");
    const { fakeAssetLoader } = await import("./fake-assets");
    const { fixtureGames } = await import("./test-helpers");
    const view = new TableView(new ObjectView(new Group(), fakeAssetLoader()), makeSlots());
    const state = structuredClone(fixtureGames()[0].steps[2].state);
    state.me.hand = ["a", "t", "a", "t", "x"];
    state.me.groups = [
      { tiles: "at", word: "at" },
      { tiles: "at", word: "at" },
    ];
    view.apply({ matchId: "m-p12", events: [], state, pending: null, result: null, matchFinished: false });
    // 两组各两张、key 相同，groupId 不同
    const grouped = view.looseSlots.filter((e) => e?.groupId !== undefined);
    expect(grouped).toHaveLength(4);
    expect(new Set(grouped.map((e) => e!.groupKey)).size).toBe(1);
    const thingAt = (slot: number) => {
      const p = view.slots.get(`loose.${slot}@0`)!.place(0).position;
      return view.pickables.find((t) => t.place.position.equals(p))!.id;
    };
    for (const e of grouped) {
      const slot = view.looseSlots.indexOf(e);
      expect(view.focusGroupAt(thingAt(slot))).toBe(true);
      const info = view.focusedGroupInfo()!;
      expect(info.tiles).toHaveLength(2); // 修之前是 4：两组的牌一起交，服务端回 400
      expect([...info.tiles].sort().join("")).toBe("at");
    }
  });

  it("拆开其中一组后，剩下的那组仍是没点的那一组（先摘 key 再对账）", async () => {
    const { Group } = await import("three");
    const { ObjectView } = await import("./object-view");
    const { TableView } = await import("./table-view");
    const { fakeAssetLoader } = await import("./fake-assets");
    const { fixtureGames } = await import("./test-helpers");
    const view = new TableView(new ObjectView(new Group(), fakeAssetLoader()), makeSlots());
    const state = structuredClone(fixtureGames()[0].steps[2].state);
    state.me.hand = ["a", "t", "a", "t", "x"];
    const two = [
      { tiles: "at", word: "at" },
      { tiles: "at", word: "at" },
    ];
    const env = (groups: typeof two) => ({ matchId: "m-p12b", events: [], state: { ...state, me: { ...state.me, groups } }, pending: null, result: null, matchFinished: false });
    view.apply(env(two));
    const grouped = () => view.looseSlots.flatMap((e) => (e?.groupId !== undefined ? [e.tileId] : []));
    const thingAt = (slot: number) => {
      const p = view.slots.get(`loose.${slot}@0`)!.place(0).position;
      return view.pickables.find((t) => t.place.position.equals(p))!.id;
    };
    // 点最左边那组（对账把最左的 A、最左的 T 配给第 0 组）
    const first = view.looseSlots.findIndex((e) => e?.groupId !== undefined);
    view.focusGroupAt(thingAt(first));
    const clicked = view.focusedGroupInfo()!.tileIds;
    const others = grouped().filter((id) => !clicked.includes(id));
    // 服务端拆掉一组：和 Table3D 一样，先摘 key 再对账
    view.unmarkGroup(clicked);
    view.apply(env(two.slice(1)));
    expect(grouped().sort()).toEqual(others.sort());
  });
});

/** 造一排，并把指定格子标成暗词 groupId（`groups` 的每一项是一组格子下标） */
function rowWithGroups(pattern: string, groups: number[][]): LooseSlots {
  const s = row(pattern);
  groups.forEach((slots, gid) => {
    for (const i of slots) s[i] = { ...s[i]!, groupId: gid, groupKey: `k${gid}` };
  });
  return s;
}

describe("splitsGroup（暗词不能被别的牌分开）", () => {
  it("把 B 拖进 CAT 中间（CABT）→ 分开了", () => {
    const s = rowWithGroups("cat..b", [[0, 1, 2]]);
    const after = insertLoose(s, 5, 2)!; // B 插到 T 的格子，T 往右让
    expect(show(after)!.slice(0, 5)).toBe("cabt.");
    expect(splitsGroup(s, after)).toBe(true);
  });

  it("另一组整组插进来也算分开", () => {
    const s = rowWithGroups("cat....be", [[0, 1, 2], [7, 8]]);
    const be = [s[7]!.tileId, s[8]!.tileId];
    const after = moveGroupLoose(s, be, 7, 1)!;
    expect(splitsGroup(s, after)).toBe(true);
  });

  it("B 放到 C 的格子、C 往左让：B 落进 C 和 A 之间，也算分开", () => {
    const s = rowWithGroups(".cat.b", [[1, 2, 3]]);
    const after = insertLoose(s, 5, 1)!;
    expect(show(after)!.slice(0, 5)).toBe("cbat.");
    expect(splitsGroup(s, after)).toBe(true);
  });

  it("暗词整组被挤着平移、B 落在暗词外面，不算分开", () => {
    const s = rowWithGroups("cat.b", [[0, 1, 2]]);
    const after = insertLoose(s, 4, 0)!; // 左边到头，C A T 整体往右让一格
    expect(show(after)!.slice(0, 5)).toBe("bcat.");
    expect(splitsGroup(s, after)).toBe(false);
  });

  it("成员之间只有空格（2.5D 组的散开暗词）不算分开", () => {
    const s = rowWithGroups("c.a.t...x", [[0, 2, 4]]);
    const after = insertLoose(s, 8, 6)!; // X 挪到暗词外面
    expect(splitsGroup(s, after)).toBe(false);
  });

  it("本来就夹着别的牌的暗词：已有的不追究，新塞进来的才算", () => {
    const s = rowWithGroups("cxa.t..y", [[0, 2, 4]]);
    // X 本来就在 C 和 A 之间：挪一下 X 自己（仍在范围内）不算
    expect(splitsGroup(s, insertLoose(s, 1, 3)!)).toBe(false);
    // Y 塞进 A 和 T 之间的空格：新的，算
    expect(splitsGroup(s, insertLoose(s, 7, 3)!)).toBe(true);
  });

  it("没有暗词时永远不算", () => {
    const s = row("abc.d");
    expect(splitsGroup(s, insertLoose(s, 4, 1)!)).toBe(false);
  });
});


describe("暗词里的牌不单独参与操作（T4.3 补修）", () => {
  // 原 bug：暗词 LOST 右边还有一张散的 T，右键暗词里的 T，服务端按字母打掉了散的那张，
  // 前端却把暗词里的 T 当成打出的牌移除，下一次对账 LOST 就配到了散的那张 T 上
  async function setup() {
    const { Group } = await import("three");
    const { ObjectView } = await import("./object-view");
    const { TableView } = await import("./table-view");
    const { fakeAssetLoader } = await import("./fake-assets");
    const { fixtureGames } = await import("./test-helpers");
    const view = new TableView(new ObjectView(new Group(), fakeAssetLoader()), makeSlots());
    const state = structuredClone(fixtureGames()[0].steps[2].state);
    state.me.hand = ["l", "o", "s", "t", "x", "t"];
    state.me.groups = [{ tiles: "lost", word: "lost" }];
    view.apply({ matchId: "m-lost", events: [], state, pending: null, result: null, matchFinished: false });
    /** 散牌区第 k 张某字母对应的 Thing 编号 */
    const thingOf = (tile: string, k = 0) => {
      const i = view.looseSlots.flatMap((e, j) => (e?.tile === tile ? [j] : []))[k];
      const p = view.slots.get(`loose.${i}@0`)!.place(0).position;
      return view.pickables.find((t) => t.place.position.equals(p))!.id;
    };
    return { view, thingOf };
  }
  const members = (s: LooseSlots) => s.flatMap((e) => (e && e.groupId !== undefined ? [e.tileId] : []));

  it("右键暗词里的 T：没有打牌意图，散牌区和暗词成员都不变", async () => {
    const { view, thingOf } = await setup();
    const before = slotOf(view.looseSlots);
    const groupBefore = members(view.looseSlots);
    // 左边那张 T 在暗词里，右边那张是散的
    expect(view.looseSlots.find((e) => e?.tile === "t" && e.groupId !== undefined)).toBeTruthy();
    expect(view.discardIntentOf(thingOf("t", 0))).toBeNull();
    expect(view.discardIntentOf(thingOf("t", 1))).not.toBeNull(); // 散的那张照常能打
    expect(slotOf(view.looseSlots)).toEqual(before);
    expect(members(view.looseSlots)).toEqual(groupBefore);
  });

  it("框选同时框进暗词里的牌和散牌：只有散牌被选中", async () => {
    const { view, thingOf } = await setup();
    view.setSelected([thingOf("l"), thingOf("o"), thingOf("x")]);
    const x = view.looseSlots.find((e) => e?.tile === "x")!.tileId;
    expect(view.selectedTileIds()).toEqual([x]);
  });
});
