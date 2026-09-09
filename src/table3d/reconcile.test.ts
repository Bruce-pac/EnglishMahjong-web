/**
 * T1.4 方案 §7 的不变式 1、3、4、5，外加 fixture 回放。
 * 不变式 2（增量 ≡ 全量重绘）在 `render-commit.test.ts`——那条要测在渲染提交层。
 */

import { describe, expect, it } from "vitest";
import type { Me, State } from "../api";
import { LOOSE_SLOTS } from "./layout";
import {
  declareWild,
  initialOffset,
  moveLoose,
  rebuildLoose,
  reconcileLoose,
  type LooseSlots,
} from "./loose-reconcile";
import { isValidFace, layout, orderByWord } from "./placement";
import { assignThings } from "./thing-assign";
import { fixtureGames, localOps, rng, slotOf, wildOf } from "./test-helpers";

/** 全副牌 108 张（`rules.DECK_SIZE`）。Thing 池就是这么大，**零余量** */
const DECK_SIZE = 108;

const me = (hand: string[], groups: Me["groups"] = []): { hand: string[]; groups: Me["groups"] } => ({
  hand,
  groups,
});

describe("A 层：散牌区对账", () => {
  it("比对基是 me.hand 不是 me.loose——组暗词不该让牌从散牌区蒸发", () => {
    // 玩家把 C A T 组成暗词。此时 me.loose 只剩 ['e']，但 me.hand 还是四张
    const before = rebuildLoose(me(["c", "a", "t", "e"]), 1);
    const after = reconcileLoose(
      me(["c", "a", "t", "e"], [{ tiles: "act", word: "CAT" }]),
      before.slots,
      before.nextTileId,
    );
    expect(after.slots.filter((e) => e).length).toBe(4);
    // 三张被标进同一组，第四张没有
    const grouped = after.slots.filter((e) => e?.groupId !== undefined);
    expect(grouped.length).toBe(3);
    expect(new Set(grouped.map((e) => e!.groupId)).size).toBe(1);
    expect(after.slots.find((e) => e?.tile === "e")?.groupId).toBeUndefined();
  });

  it("初始铺牌居中——满手 14 张正好落在正中间那 14 格", () => {
    const full = rebuildLoose(me("abcdefghijklmn".split("")), 1);
    const at = full.slots.findIndex((e) => e !== null);
    expect(at).toBe(2); // 18 格排，左右各留 2 格
    expect(full.slots.slice(2, 16).every((e) => e !== null)).toBe(true);
    expect(full.slots[0]).toBeNull();
    expect(full.slots[LOOSE_SLOTS - 1]).toBeNull();

    // 13 张（非庄）同样居中
    const thirteen = rebuildLoose(me("abcdefghijklm".split("")), 1);
    expect(thirteen.slots.findIndex((e) => e !== null)).toBe(2);
  });

  it("摸到的牌一律从右端加", () => {
    // 居中铺开之后左边空着两格。若按「第一个空格」摆，摸的牌会跳到最左边，
    // 和整手牌之间隔着个洞，看着像掉了一张
    const a = rebuildLoose(me(["c", "a", "t"]), 1);
    const at = initialOffset(3);
    const b = reconcileLoose(me(["c", "a", "t", "s"]), a.slots, a.nextTileId);
    expect(b.slots[at + 3]?.tile).toBe("s");
    expect(b.slots.slice(0, at).every((e) => e === null)).toBe(true);
  });

  it("右端满了就整体左移腾位置——顺序和空隙都跟着走，不压实", () => {
    // 把牌铺到最右一格：[· … · C A · T]，右端一格不剩
    let a = rebuildLoose(me(["c", "a", "t"]), 1);
    let s = moveLoose(a.slots, initialOffset(3) + 0, LOOSE_SLOTS - 4);
    s = moveLoose(s, initialOffset(3) + 1, LOOSE_SLOTS - 3);
    s = moveLoose(s, initialOffset(3) + 2, LOOSE_SLOTS - 1); // T 和 A 之间留一个洞
    const before = slotOf(s);
    expect(s[LOOSE_SLOTS - 1]).not.toBeNull();

    const b = reconcileLoose(me(["c", "a", "t", "s"]), s, a.nextTileId);

    // 新牌在最右端
    expect(b.slots[LOOSE_SLOTS - 1]?.tile).toBe("s");
    // 幸存的三张整体左移了同一个量（= 1），中间那个洞原样跟着走
    const deltas = new Set<number>();
    for (const [tileId, at] of slotOf(b.slots)) {
      if (before.has(tileId)) deltas.add(at - before.get(tileId)!);
    }
    expect([...deltas]).toEqual([-1]);
    expect(b.slots[LOOSE_SLOTS - 3]).toBeNull(); // 洞还在，没被压实
  });

  it("留下来的牌一格都不动", () => {
    const a = rebuildLoose(me(["c", "a", "t", "e", "o"]), 1);
    const moved = moveLoose(moveLoose(a.slots, 0, 9), 4, 12);
    const before = slotOf(moved);
    // 摸进一张 s，打掉 e
    const b = reconcileLoose(me(["c", "a", "t", "o", "s"]), moved, a.nextTileId);
    for (const [tileId, at] of slotOf(b.slots)) {
      if (before.has(tileId)) expect(at, `tileId ${tileId} 动了`).toBe(before.get(tileId));
    }
  });

  it("consumedTileIds 消解重复字母的歧义", () => {
    // [C][A][T][A]：打掉的是**前面**那个 A 时，剩下必须是 C _ T A，
    // 而不是把后面那个 A 挪上来变成 C A T _
    const a = rebuildLoose(me(["c", "a", "t", "a"]), 1);
    // rebuildLoose 把牌**居中**铺开，所以下标要从居中起点算起
    const at = initialOffset(4);
    const firstA = a.slots[at + 1]!.tileId;
    const lastA = a.slots[at + 3]!.tileId;

    const hinted = reconcileLoose(me(["c", "a", "t"]), a.slots, a.nextTileId, [firstA]);
    expect(hinted.slots.map((e) => e?.tile ?? null).slice(at, at + 4)).toEqual([
      "c", null, "t", "a",
    ]);
    expect(hinted.slots[at + 3]!.tileId).toBe(lastA); // 活下来的是后面那张，没被顶替

    // 不给提示就退化到「从左到右留、多出来的从右边腾」。规则是确定的，
    // 只是未必是玩家心里想的那一张——这就是 consumedTileIds 存在的理由
    const blind = reconcileLoose(me(["c", "a", "t"]), a.slots, a.nextTileId);
    expect(blind.slots.map((e) => e?.tile ?? null).slice(at, at + 4)).toEqual([
      "c", "a", "t", null,
    ]);
    expect(blind.slots[at + 1]!.tileId).toBe(firstA);
  });

  it("**绝不压实散牌区**——空格要留在原地", () => {
    // 这条是不变式 3 的另一面，也是不变式 4 成立的前提：只要留下来的牌不换格子，
    // 「白搭声明挂 tileId」和「挂槽位」才是等价的。哪天有人图好看把数组压实，
    // 玩家排好的顺序会整体左移，白搭声明也会跟着张冠李戴
    const a = rebuildLoose(me(["c", "a", "t", "e", "o"]), 1);
    const at = initialOffset(5);
    const b = reconcileLoose(me(["c", "t", "o"]), a.slots, a.nextTileId);
    expect(b.slots.map((e) => e?.tile ?? null).slice(at, at + 5)).toEqual([
      "c", null, "t", null, "o",
    ]);
  });

  it("tileId 永不回收——不制造 ABA", () => {
    let r = rebuildLoose(me(["c", "a"]), 1);
    const seen = new Set(r.slots.filter((e) => e).map((e) => e!.tileId));
    for (let i = 0; i < 20; i++) {
      r = reconcileLoose(me(i % 2 ? ["c", "a", "t"] : ["c", "a"]), r.slots, r.nextTileId);
      for (const e of r.slots) {
        if (!e) continue;
        if (!seen.has(e.tileId)) seen.add(e.tileId);
      }
    }
    // 发出去的 id 数量 == 见过的不同 id 数量，说明没有被复用
    expect(r.nextTileId - 1).toBe(seen.size);
  });

  it("存档结构不对就从零重建，不能崩", () => {
    for (const bad of [
      [] as LooseSlots,
      new Array(LOOSE_SLOTS).fill(null).map((_, i) => (i < 2 ? { tileId: 1, tile: "a" } : null)),
      new Array(LOOSE_SLOTS).fill(null).map((_, i) => (i === 0 ? { tileId: -1, tile: "a" } : null)),
    ] as LooseSlots[]) {
      const r = reconcileLoose(me(["c", "a"]), bad, 50);
      expect(r.rebuilt).toBe(true);
      expect(r.slots.filter((e) => e).length).toBe(2);
    }
  });
});

describe("不变式 4：白搭声明不串位", () => {
  it("两张同种白搭声明不同字母，转移后各自的字母不对调", () => {
    const a = rebuildLoose(me(["1", "c", "1"]), 1);
    const at = initialOffset(3);
    const first = a.slots[at]!.tileId;
    const second = a.slots[at + 2]!.tileId;
    let s = declareWild(a.slots, first, "a");
    s = declareWild(s, second, "e");

    // 前面那张牌被打掉，后面的整体不动——声明必须跟着 tileId 走，不能留在原格
    const b = reconcileLoose(me(["1", "1"]), s, a.nextTileId, [
      s.find((e) => e?.tile === "c")!.tileId,
    ]);
    const w = wildOf(b.slots);
    expect(w.get(first)).toBe("a");
    expect(w.get(second)).toBe("e");
  });

  it("声明挂在 tileId 上，拖动之后仍然跟着牌走", () => {
    const a = rebuildLoose(me(["1", "c", "2"]), 1);
    const at = initialOffset(3);
    const vowel = a.slots[at]!.tileId;
    let s = declareWild(a.slots, vowel, "o");
    s = moveLoose(s, at, at + 7);
    expect(s[at + 7]!.tileId).toBe(vowel);
    expect(s[at + 7]!.wildLetter).toBe("o");
    expect(s[at]).toBeNull();
  });
});

describe("B 层：排序串还原成单词顺序", () => {
  it("无白搭时按 word 摆", () => {
    expect(orderByWord("act", "CAT").map((c) => c.tile)).toEqual(["c", "a", "t"]);
  });

  it("含白搭时按 WILD_CANDIDATES 反推哪一位是白搭", () => {
    // word=COD、tiles=1cd：真字母 c/d 各就各位，元音白搭只能顶中间那个 O
    expect(orderByWord("1cd", "COD")).toEqual([
      { tile: "c" },
      { tile: "1", wild: "o" },
      { tile: "d" },
    ]);
    // 换成辅音白搭顶 C
    expect(orderByWord("2do", "COD")).toEqual([
      { tile: "2", wild: "c" },
      { tile: "o" },
      { tile: "d" },
    ]);
  });

  it("辅音白搭不能认领元音位", () => {
    // word=CAT, tiles=2at —— 辅音白搭只能顶 C，不能顶 A
    const cells = orderByWord("2at", "CAT");
    expect(cells[0]).toEqual({ tile: "2", wild: "c" });
    expect(cells[1].tile).toBe("a");
    expect(cells[2].tile).toBe("t");
  });
});

describe("B 层：concealed 与 handCount 是同一批牌", () => {
  const other = (handCount: number, concealed: { tiles: string; word: string }[]) => ({
    seat: 1,
    handCount,
    melds: [],
    won: true,
    winOrder: 0,
    concealed,
  });

  const stateWith = (o: ReturnType<typeof other>): State =>
    ({
      wallLeft: 0,
      turn: 0,
      discards: [],
      discardSeats: [],
      finished: false,
      exhausted: false,
      me: { seat: 0, hand: [], groups: [], loose: [], drawn: [], melds: [], budgetLeft: 14, won: false, winOrder: null, concealed: [] },
      others: [o],
      matchScores: [],
      gamesPlayed: 0,
      maxGames: 1,
      config: {} as State["config"],
    }) as State;

  const looseOf = (state: State) =>
    layout(state, new Array(LOOSE_SLOTS).fill(null), { lowercase: false }).filter((p) =>
      p.slotName.endsWith("@1"),
    );

  it("胡牌：concealed 恰好铺满整手，全部摊开，总数不变", () => {
    const p = looseOf(stateWith(other(5, [{ tiles: "act", word: "CAT" }, { tiles: "no", word: "ON" }])));
    expect(p.length).toBe(5); // 不是 5 + 5
    expect(p.every((x) => x.rotationIndex === 0)).toBe(true); // 全部正面
  });

  it("荒牌：concealed 有余数，**剩下的仍然是背面**，不能凭空消失", () => {
    // greedy_words 拼不出词就 return，剩下的散牌被丢掉；真人更极端，可能是空数组
    const p = looseOf(stateWith(other(7, [{ tiles: "act", word: "CAT" }])));
    expect(p.length).toBe(7); // 3 张摊开 + 4 张背面，总数还是 handCount
    expect(p.filter((x) => x.rotationIndex === 0).length).toBe(3);
    expect(p.filter((x) => x.rotationIndex === 1).length).toBe(4);
  });

  it("没胡的人：concealed 为空，整手都是背面且牌面是哑值", () => {
    const p = looseOf(stateWith(other(13, [])));
    expect(p.length).toBe(13);
    expect(p.every((x) => x.rotationIndex === 1 && x.typeIndex === 0)).toBe(true);
  });
});

describe("fixture 回放：注入本地操作的完整序列", () => {
  for (const game of fixtureGames()) {
    it(`${game.name}（${game.steps.length} 步）`, () => {
      const rand = rng(20260906);
      let r = rebuildLoose(game.steps[0].state.me, 1);
      let lastSlotName = new Map<number, string>();
      let lastType = new Map<number, number>();
      const pool = Array.from({ length: DECK_SIZE }, (_, i) => i);
      const poolSet = new Set(pool);

      for (let step = 0; step < game.steps.length; step++) {
        const state: State = game.steps[step].state;

        // envelope 之间注入本地操作，否则不变式 3、4 根本没机会被触发
        const withLocal = localOps(r.slots, rand);
        const before = slotOf(withLocal);
        const wildBefore = wildOf(withLocal);

        r = reconcileLoose(state.me, withLocal, r.nextTileId);

        if (!r.rebuilt) {
          // 不变式 3（修订）：两帧都在、且不在 consumedTileIds 里的牌，**要么原地不动，
          // 要么整体平移同一个量**——右端放不下新牌时，整块牌会左移腾位置。
          //
          // 「同一个量」是这条仍然有牙齿的关键：只要有任何一张牌相对别人动了，
          // deltas 就会多出一个值。乱序、压实、局部挪动全都会被这条抓住，
          // 唯独放过刚性平移。平移量还必须 ≤ 0：只会往左让，不会凭空右移。
          const deltas = new Set<number>();
          for (const [tileId, at] of slotOf(r.slots)) {
            if (before.has(tileId)) deltas.add(at - before.get(tileId)!);
          }
          expect(deltas.size, `第 ${step} 步：幸存的牌不是整体平移`).toBeLessThanOrEqual(1);
          for (const d of deltas) {
            expect(d, `第 ${step} 步：整体右移了 ${d}`).toBeLessThanOrEqual(0);
          }
          // 不变式 4：白搭声明跟着 tileId
          for (const [tileId, letter] of wildOf(r.slots)) {
            if (wildBefore.has(tileId)) {
              expect(letter, `第 ${step} 步 tileId ${tileId} 的白搭声明串了`).toBe(
                wildBefore.get(tileId),
              );
            }
          }
        }

        const placements = layout(state, r.slots, { lowercase: step % 3 === 0 });

        // Thing 池是零余量的 108。摆多了说明有牌被数了两遍
        // （最典型的是把 concealed 当成 handCount 之外的额外一批）
        expect(placements.length, `第 ${step} 步摆了 ${placements.length} 张`).toBeLessThanOrEqual(
          DECK_SIZE,
        );

        // 槽位不能重名——两张牌摆进同一格是显示错误
        expect(new Set(placements.map((p) => p.slotName)).size).toBe(placements.length);

        for (const p of placements) {
          expect(isValidFace(p.typeIndex), `牌面越界：${p.slotName} → ${p.typeIndex}`).toBe(true);
          // rotationIndex 是槽位局部下标；牌墙只有一种朝向，写成 1 会取到 undefined
          if (p.slotName.startsWith("wall") || p.slotName.startsWith("meld") ||
              p.slotName.startsWith("discard")) {
            expect(p.rotationIndex, `${p.slotName} 的 rotationIndex 越界`).toBe(0);
          } else {
            expect(p.rotationIndex).toBeLessThanOrEqual(1);
          }
        }

        // 不变式 1：分配是双射
        const assign = assignThings(placements, lastSlotName, (i) => lastType.get(i) ?? -1, pool);
        expect(assign.length).toBe(placements.length);
        expect(new Set(assign).size, `第 ${step} 步有 Thing 被派了两次`).toBe(assign.length);
        for (const t of assign) expect(poolSet.has(t)).toBe(true);

        lastSlotName = new Map(assign.map((t, i) => [t, placements[i].slotName]));
        lastType = new Map(assign.map((t, i) => [t, placements[i].typeIndex]));
      }
    });
  }
});

describe("不变式 5：刷新等价", () => {
  it("存档 → 重建 → 对账，与刷新前逐格相同", () => {
    const game = fixtureGames()[0];
    const rand = rng(7);
    let r = rebuildLoose(game.steps[0].state.me, 1);
    for (let i = 1; i < Math.min(12, game.steps.length); i++) {
      r = reconcileLoose(game.steps[i].state.me, localOps(r.slots, rand), r.nextTileId);
    }

    const state = game.steps[Math.min(11, game.steps.length - 1)].state;
    // 存档走一遍 JSON——真实路径是 localStorage，序列化会丢掉 undefined 字段
    const revived = JSON.parse(JSON.stringify(r.slots)) as LooseSlots;
    const after = reconcileLoose(state.me, revived, r.nextTileId);

    expect(after.rebuilt).toBe(false);
    expect(after.slots).toEqual(r.slots);
  });
});
