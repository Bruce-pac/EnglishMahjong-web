import { describe, expect, it } from "vitest";
import { makeSlots } from "./setup-slots";
import { Thing } from "./thing";
import { ThingType } from "./types";

const slots = makeSlots();
const at = (name: string) => slots.get(name)!;

describe("Thing", () => {
  it("没有自己的坐标——位置来自所在格子", () => {
    const slot = at("loose.0@0");
    const t = new Thing(0, ThingType.TILE, 0, slot);
    expect(t.place().position).toEqual(slot.places[0].position);
    expect(slot.thing).toBe(t);
  });

  it("换格子：先腾空原格再落位", () => {
    const from = at("loose.1@0");
    const to = at("discard.0.0@0");
    const t = new Thing(1, ThingType.TILE, 3, from);
    t.prepareMove();
    expect(from.thing).toBeNull();
    t.moveTo(to);
    expect(to.thing).toBe(t);
    expect(t.place().position).toEqual(to.places[0].position);
    t.prepareMove();
  });

  it("落到非空格子要抛错——不能两张牌叠在一格", () => {
    const slot = at("loose.2@0");
    const a = new Thing(2, ThingType.TILE, 0, slot);
    const b = new Thing(3, ThingType.TILE, 0, at("loose.3@0"));
    b.prepareMove();
    expect(() => b.moveTo(slot)).toThrow(/格子非空/);
    expect(slot.thing).toBe(a);
  });

  it("flip 在该格子允许的朝向之间循环", () => {
    const slot = at("loose.4@0"); // 散牌区有正面 / 背面两种
    const t = new Thing(4, ThingType.TILE, 0, slot);
    expect(slot.rotations.length).toBe(2);
    expect(t.rotationIndex).toBe(0);
    t.flip();
    expect(t.rotationIndex).toBe(1);
    t.flip();
    expect(t.rotationIndex).toBe(0);
    t.flip(-1); // 负数也要落回合法区间
    expect(t.rotationIndex).toBe(1);
  });

  it("牌河只有一种朝向，flip 是空操作", () => {
    const t = new Thing(5, ThingType.TILE, 0, at("discard.1.0@0"));
    t.flip();
    expect(t.rotationIndex).toBe(0);
  });
});
