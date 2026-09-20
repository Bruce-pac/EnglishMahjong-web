/**
 * T3.1：代理体拾取与可抬升平面。
 *
 * `Raycaster` / `Mesh` / 相机都是纯 JS，node 环境就能跑，不需要 GL。
 * 鼠标坐标用「把目标点投影到相机」反推——这样验的是拾取的数学，不依赖屏幕尺寸。
 */

import { Group, OrthographicCamera, PerspectiveCamera, Vector2, Vector3, type Camera } from "three";
import { describe, expect, it, vi } from "vitest";
import type { Envelope, State } from "../api";
import { fakeAssetLoader } from "./fake-assets";
import { WORLD_SIZE } from "./layout";
import { MouseUi } from "./mouse-ui";
import { ObjectView } from "./object-view";
import { makeSlots } from "./setup-slots";
import { TableView } from "./table-view";
import { fixtureGames } from "./test-helpers";

function envelopeOf(state: State): Envelope {
  return { matchId: "m-pick", events: [], state, pending: null, result: null, matchFinished: false };
}

/**
 * 照 main-view.ts 摆相机：相机挂在绕桌心的 viewGroup 里，座位 0。
 *
 * 正交相机的缩放和 main-view 一样走 `camera.zoom`（俯视 1/1.55、放大到头 1/0.55）。
 *
 * `scaleGuard` 专门守 three r185 的那个坑：视图矩阵不含 scale，`setFromCamera` 却含。
 * main-view 已经不设 scale 了，但拾取仍按渲染用的视图矩阵反投影，这台相机保证
 * 以后谁再给相机设 scale，指着的牌和高亮的牌也不会错开。
 */
function cameras(): Record<string, Camera> {
  const make = (camera: Camera, pos: Vector3, rotX: number, opts: { zoom?: number; scale?: number } = {}) => {
    const viewGroup = new Group();
    viewGroup.position.set(WORLD_SIZE / 2, WORLD_SIZE / 2, 0);
    viewGroup.add(camera);
    camera.position.copy(pos);
    camera.rotation.set(rotX, 0, 0);
    camera.scale.setScalar(opts.scale ?? 1);
    if (camera instanceof OrthographicCamera && opts.zoom !== undefined) {
      camera.zoom = opts.zoom;
      camera.updateProjectionMatrix();
    }
    viewGroup.updateMatrixWorld(true);
    return camera;
  };
  const w = WORLD_SIZE * 1.2;
  const h = w / 1.5;
  return {
    top: make(new OrthographicCamera(-w / 2, w / 2, h / 2, -h / 2, 0.1, 1000), new Vector3(0, 0, 100), 0, { zoom: 1 / 1.55 }),
    ortho: make(
      new OrthographicCamera(-w / 2, w / 2, h / 2, -h / 2, 0.1, 1000),
      new Vector3(0, -WORLD_SIZE, WORLD_SIZE),
      Math.PI * 0.25,
    ),
    // 按住 z 放大到头、鼠标在右上：zoom 1/0.55，镜头往右上平移
    orthoZoom: make(
      new OrthographicCamera(-w / 2, w / 2, h / 2, -h / 2, 0.1, 1000),
      new Vector3(0.3 * WORLD_SIZE * 0.6, -WORLD_SIZE + -0.4 * WORLD_SIZE * 0.6, WORLD_SIZE),
      Math.PI * 0.25,
      { zoom: 1 / 0.55 },
    ),
    // 回归防线：相机带 scale 时，拾取仍要和渲染（剔除 scale 的视图矩阵）一致
    scaleGuard: make(
      new OrthographicCamera(-w / 2, w / 2, h / 2, -h / 2, 0.1, 1000),
      new Vector3(0, -WORLD_SIZE, WORLD_SIZE),
      Math.PI * 0.25,
      { scale: 0.55 },
    ),
    // 按住空格低头
    orthoLookDown: make(
      new OrthographicCamera(-w / 2, w / 2, h / 2, -h / 2, 0.1, 1000),
      new Vector3(0, -53 - WORLD_SIZE, WORLD_SIZE),
      Math.PI * 0.25,
    ),
    perspectiveZoom: make(
      new PerspectiveCamera(30, 1.5, 0.1, 1000),
      new Vector3(0, -WORLD_SIZE * 1.44 + 1.37 * 55, WORLD_SIZE * 1.05 - 55),
      Math.PI * 0.3 - 0.2,
    ),
    perspective: make(
      new PerspectiveCamera(30, 1.5, 0.1, 1000),
      new Vector3(0, -WORLD_SIZE * 1.44, WORLD_SIZE * 1.05),
      Math.PI * 0.3,
    ),
  };
}

/** 世界点 → 鼠标归一化坐标。场景里 mainGroup 是单位矩阵，局部 = 世界 */
function mouseAt(p: Vector3, camera: Camera): Vector2 {
  const v = p.clone().project(camera);
  return new Vector2(v.x, v.y);
}

function setup() {
  const mainGroup = new Group();
  const objectView = new ObjectView(mainGroup, fakeAssetLoader());
  const tableView = new TableView(objectView, makeSlots());
  // 取一个中盘局面：别家有牌、牌河有牌
  const steps = fixtureGames()[0].steps;
  tableView.apply(envelopeOf(steps[Math.floor(steps.length / 2)].state));
  const mouseUi = new MouseUi(mainGroup);
  mouseUi.updateObjects(tableView.pickables);
  return { mainGroup, objectView, tableView, mouseUi };
}

describe("MouseUi 拾取", () => {
  it("只有自己散牌区的牌进代理体池", () => {
    const { tableView } = setup();
    expect(tableView.pickables.length).toBeGreaterThan(0);
    for (const t of tableView.pickables) {
      expect(tableView.slotNames.get(t.id)).toMatch(/^loose\.\d+@0$/);
    }
    // 反过来：loose@0 的每一张都在
    const mine = [...tableView.slotNames].filter(([, n]) => /^loose\.\d+@0$/.test(n));
    expect(tableView.pickables.length).toBe(mine.length);
  });

  for (const [name, camera] of Object.entries(cameras())) {
    it(`${name}：指着散牌区每一张牌的中心都命中那一张`, () => {
      const { tableView, mouseUi } = setup();
      for (const t of tableView.pickables) {
        // 瞄正面中心（顶面），避开相邻牌侧面的遮挡
        const top = t.place.position.clone();
        top.z += t.place.size.z / 2;
        expect(mouseUi.pick(mouseAt(top, camera), camera)).toBe(t.id);
      }
    });
  }

  it("别家的牌、牌墙、亮词区、牌河都不命中", () => {
    const { tableView, mouseUi } = setup();
    const camera = cameras().top; // 正上方看，不会被自己散牌区的代理体挡住
    const slots = makeSlots();
    let checked = 0;
    for (const [id, name] of tableView.slotNames) {
      if (/^loose\.\d+@0$/.test(name)) continue;
      const place = slots.get(name)!.place(0);
      expect(mouseUi.pick(mouseAt(place.position, camera), camera), name).toBeNull();
      checked++;
      void id;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("桌面空白处不命中", () => {
    const { mouseUi } = setup();
    const camera = cameras().top;
    expect(mouseUi.pick(mouseAt(new Vector3(WORLD_SIZE / 2, WORLD_SIZE / 2, 0), camera), camera)).toBeNull();
  });
});

describe("MouseUi 抬升平面", () => {
  for (const [name, camera] of Object.entries(cameras())) {
    it(`${name}：在给定 z 上返回鼠标下的那个点`, () => {
      const { mouseUi } = setup();
      for (const z of [0, 4, 12.5]) {
        for (const target of [new Vector3(60, 40, z), new Vector3(150, 120, z), new Vector3(-30, 250, z)]) {
          const got = mouseUi.raycastLevel(mouseAt(target, camera), camera, z);
          expect(got, `${name} z=${z}`).not.toBeNull();
          expect(got!.x).toBeCloseTo(target.x, 3);
          expect(got!.y).toBeCloseTo(target.y, 3);
          expect(got!.z).toBeCloseTo(z, 5);
        }
      }
    });
  }

  it("坐标转回 mainGroup 局部坐标", () => {
    const mainGroup = new Group();
    mainGroup.position.set(10, -5, 2);
    mainGroup.updateMatrixWorld(true);
    const mouseUi = new MouseUi(mainGroup);
    const camera = cameras().top;
    // 局部 (100,100,3) 的世界坐标是 (110,95,5)
    const world = new Vector3(110, 95, 5);
    const got = mouseUi.raycastLevel(mouseAt(world, camera), camera, 3)!;
    expect(got.x).toBeCloseTo(100, 3);
    expect(got.y).toBeCloseTo(100, 3);
    expect(got.z).toBeCloseTo(3, 5);
  });
});

describe("TableView 悬停", () => {
  it("指上去走 Custom 轨发光，移开回到 Simple 轨", () => {
    const { tableView, objectView } = setup();
    const [a, b] = tableView.pickables;
    const meshOf = (i: number) => {
      const found = objectView.mainGroup.children.find(
        (c) => c.type === "Mesh" && c.visible && c.position.equals(tableView.pickables.find((t) => t.id === i)!.place.position),
      );
      return found;
    };

    expect(tableView.setHovered(a.id)).toBe(true);
    expect(tableView.hoveredThing).toBe(a.id);
    const m = meshOf(a.id) as unknown as { material: { emissive: { r: number } } } | undefined;
    expect(m).toBeDefined();
    expect(m!.material.emissive.r).toBeGreaterThan(0);

    tableView.setHovered(b.id);
    expect(meshOf(a.id)).toBeUndefined(); // 离开的那张回 Simple：独立 mesh 藏起来
    expect(meshOf(b.id)).toBeDefined();

    tableView.setHovered(null);
    expect(meshOf(b.id)).toBeUndefined();
  });

  it("悬停没变的帧不重新提交", () => {
    const { tableView, objectView } = setup();
    const spy = vi.spyOn(objectView, "updateThings");
    const id = tableView.pickables[0].id;
    tableView.setHovered(id);
    tableView.setHovered(id);
    tableView.setHovered(id);
    expect(spy).toHaveBeenCalledTimes(1);
    tableView.setHovered(null);
    tableView.setHovered(null);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("不可拾取的编号当作没指着", () => {
    const { tableView } = setup();
    const other = [...tableView.slotNames].find(([, n]) => !n.endsWith("@0"))![0];
    expect(tableView.setHovered(other)).toBe(false);
    expect(tableView.hoveredThing).toBeNull();
  });
});

describe("MouseUi 框选（T3.3）", () => {
  /** 散牌区的牌按 x 从左到右排好 */
  const row = (tv: TableView) => [...tv.pickables].sort((a, b) => a.place.position.x - b.place.position.x);
  const topOf = (t: { place: { position: Vector3; size: Vector3 } }) =>
    t.place.position.clone().setZ(t.place.position.z + t.place.size.z / 2);

  it("退化矩形（单击，宽高为 0）不崩，还能选中点下去的那张", () => {
    const { tableView, mouseUi } = setup();
    for (const camera of Object.values(cameras())) {
      const t = row(tableView)[3];
      const p = mouseAt(topOf(t), camera);
      const hits = mouseUi.select(p, p.clone(), camera);
      expect(hits).toEqual([t.id]);
    }
  });

  for (const [name, camera] of Object.entries(cameras())) {
    it(`${name}：从一张牌的中心框到另一张的中心，正好选中这一段`, () => {
      const { tableView, mouseUi } = setup();
      const r = row(tableView);
      const a = mouseAt(topOf(r[2]), camera);
      const b = mouseAt(topOf(r[5]), camera);
      const hits = mouseUi.select(a, b, camera);
      expect(new Set(hits)).toEqual(new Set(r.slice(2, 6).map((t) => t.id)));
    });
  }

  it("框住整张桌子也只选自己散牌区的牌", () => {
    const { tableView, mouseUi } = setup();
    const camera = cameras().top;
    const hits = mouseUi.select(new Vector2(-1, -1), new Vector2(1, 1), camera);
    expect(new Set(hits)).toEqual(new Set(tableView.pickables.map((t) => t.id)));
  });

  it("框别家的牌、牌墙、牌河的区域什么都不选", () => {
    const { tableView, mouseUi } = setup();
    const camera = cameras().top;
    const slots = makeSlots();
    const areas = ["loose.5@2", "wall.3.0@1", "discard.0.0@0", "discard.0.3@2"];
    for (const name of areas) {
      const p = slots.get(name)!.place(0).position;
      const a = mouseAt(p.clone().add(new Vector3(-4, -4, 0)), camera);
      const b = mouseAt(p.clone().add(new Vector3(4, 4, 0)), camera);
      expect(mouseUi.select(a, b, camera), name).toEqual([]);
    }
    void tableView;
  });

  it("project 与 raycastLevel 互逆：桌面上的点投到屏幕再打回来还是它", () => {
    const { mouseUi } = setup();
    for (const camera of Object.values(cameras())) {
      const p = new Vector3(80, 50, 0);
      const back = mouseUi.raycastLevel(mouseUi.project(p, camera), camera, 0)!;
      expect(back.x).toBeCloseTo(80, 3);
      expect(back.y).toBeCloseTo(50, 3);
    }
  });
});

describe("TableView 选中（T3.3）", () => {
  it("按 tileId 记、按槽位顺序取出，并交给描边", () => {
    const { tableView, objectView } = setup();
    const r = [...tableView.pickables].sort((a, b) => a.place.position.x - b.place.position.x);
    expect(tableView.setSelected([r[4].id, r[1].id])).toBe(true);
    const ids = tableView.selectedTileIds();
    const expected = tableView.looseSlots.flatMap((e) => (e ? [e.tileId] : []));
    // 散牌区从左往右第 1、第 4 张
    expect(ids).toEqual([expected[1], expected[4]]);
    expect(objectView.selectedObjects.length).toBe(2);
    // 同一组再设一次不重新提交
    expect(tableView.setSelected([r[1].id, r[4].id])).toBe(false);
  });

  it("不可拾取的编号忽略", () => {
    const { tableView } = setup();
    const other = [...tableView.slotNames].find(([, n]) => !n.startsWith("loose.") || !n.endsWith("@0"))![0];
    tableView.setSelected([other]);
    expect(tableView.selectedTileIds()).toEqual([]);
  });

  it("新 envelope 到来后，还在散牌区的牌保持选中，离开的去掉", () => {
    const steps = fixtureGames()[0].steps;
    const mid = Math.floor(steps.length / 2);
    const { tableView } = setup();
    tableView.setSelected(tableView.pickables.map((t) => t.id));
    const before = tableView.selectedTileIds();
    // 往后走几步，保证有牌打出去、有牌摸进来
    tableView.apply(envelopeOf(steps[mid + 3].state));
    const live = new Set(tableView.looseSlots.flatMap((e) => (e ? [e.tileId] : [])));
    const after = tableView.selectedTileIds();
    expect(after).toEqual(before.filter((id) => live.has(id)));
    expect(after.length).toBeGreaterThan(0);
    expect(after.length).toBeLessThan(live.size + 1);
    // 描边的牌数跟着走
    expect(new Set(after).size).toBe(after.length);
  });

  // P20 起：按住**选中的牌之一**是整批拖动，选中留到松手才清；按住没选中的才立刻清
  it("拖动选中的牌之一：选中留着，松手才清空", () => {
    const { tableView } = setup();
    tableView.setSelected(tableView.pickables.map((t) => t.id));
    const t = tableView.pickables[0];
    tableView.setHovered(t.id);
    expect(tableView.dragStart(t.place.position.clone())).toBe(true);
    expect(tableView.selectedTileIds().length).toBeGreaterThan(0);
    tableView.cancelDrag();
    expect(tableView.selectedTileIds()).toEqual([]);
  });

  it("拖动没选中的那张：立刻清空选中", () => {
    const { tableView } = setup();
    const [first, ...rest] = tableView.pickables;
    tableView.setSelected(rest.map((t) => t.id));
    tableView.setHovered(first.id);
    expect(tableView.dragStart(first.place.position.clone())).toBe(true);
    expect(tableView.selectedTileIds()).toEqual([]);
    tableView.cancelDrag();
  });
});
