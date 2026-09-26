/**
 * T2.2 → P2 中央记分盘：「中控台」。画法那一层，只吃 `BoardModel`，key 没变就不重画、不置 needsUpdate。
 *
 * 仿自动麻将桌的中控台（参考 Autotable 的中央盘，它本身就是一个 8 顶点的方盒，字全画在贴图上）：
 * 一块凸起的木色台座（42×42、厚 1.5，与桌沿木框同色、吃灯光），顶面正中嵌一块 38×38 的墨绿显示屏
 * （画布贴图、不吃光）。每家两排字、朝各自座位：外排七段数码管分数、内排方位全称；中央朝自己写局数（大）与牌墙剩余（小）。
 *
 * 台座底面贴桌面（z 0 → 1.5），正好铺满中央 42×42 的空地（世界坐标 90..132），四边贴着牌河内沿、不压牌河。
 * **不进 Thing 池**（108 是零余量）、不进拾取（每个子网格 `raycast` 置空）、不进 OutlinePass。
 *
 * 画布坐标与世界坐标：屏幕平面朝 +z，CanvasTexture 默认 flipY，画布**上边**在世界 +y（对家那侧），
 * **下边**是自己（座位 0）。座位 s 在世界里是绕 z 逆时针转 s×90°；从上往下看画布没有镜像，
 * 所以在画布上也是逆时针——`ctx.rotate(-s·π/2)`（画布 y 朝下，正角是顺时针）
 */

import {
  BoxGeometry,
  CanvasTexture,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  SRGBColorSpace,
} from "three";
import segment7Url from "../../fonts/Segment7Standard.otf?url";
import { DISCARD_COLS, WORLD_SIZE } from "./layout";
import { Size, ThingType } from "./types";
import { boardKey, type BoardModel, type BoardSide } from "./board-model";
import { WOOD_SIDE, WOOD_TOP } from "./nameplate";

/**
 * 台座边长 = 中央空地边长（牌河宽度 7 格 × 牌宽 6 = 42），四条边与四家牌河的内沿**完全贴合**
 * （用户 2026-09-26 看过实物后定：40 的话四周各空出 1，看着没贴上）。厚度 1.5（Autotable 中央盘的厚度）
 */
export const BOARD_SIZE = DISCARD_COLS * Size[ThingType.TILE].x;
export const BOARD_THICK = 1.5;
/** 嵌在顶面正中的显示屏：四周留 2 的木边，和效果图（40 台座 / 36 屏）同样的边宽 */
export const SCREEN_SIZE = BOARD_SIZE - 4;
/** 屏幕浮在顶面上方一点点，别和台座顶面打架 */
const SCREEN_LIFT = 0.02;
/** 画布边长。1400×933 默认视角下屏幕约 190 像素见方，1024 足够 45° 斜看不糊 */
const PX = 1024;

const SANS = `-apple-system, "Helvetica Neue", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif`;
/** 七段数码管。字体没加载上（或加载失败）时浏览器自动退到 monospace */
const DIGITS = `Segment7, monospace`;

/** 中央局数那行最宽能画多宽（画布像素）：左右两家方位字之间的空档留一点余量 */
const CENTER_MAX_WIDTH = 360;

const COLORS = {
  groundIn: "#0f2a20",
  groundOut: "#050d0a",
  score: "#f3ead2",
  wind: "#c9b27a",
  east: "#ff9a5c",
  lit: "#ffd24a",
  sub: "#8fb8a4",
};

/** 加载 Segment7。成功返回 true；环境不支持（node 测试）或加载失败返回 false，**不抛** */
export async function loadSegment7(): Promise<boolean> {
  if (typeof FontFace === "undefined" || typeof document === "undefined") return false;
  try {
    const face = new FontFace("Segment7", `url(${segment7Url})`);
    await face.load();
    document.fonts.add(face);
    return true;
  } catch {
    return false;
  }
}

export class CenterBoard {
  /** 台座 + 屏幕。Table3D 那边 `mainGroup.add(board.mesh)` + `updateMatrixWorld(true)` */
  readonly mesh: Group;
  /** 屏幕的画布贴图（只读，测试看它的 version 判断有没有重新上传） */
  readonly texture: CanvasTexture;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly disposables: Array<{ dispose(): void }> = [];
  private key = "";
  private last: BoardModel | null = null;
  private disposed = false;
  /** 重画了几次（测试用：model 不变时不该重画） */
  drawCount = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    anisotropy = 1,
    loadFont: () => Promise<boolean> = loadSegment7,
  ) {
    canvas.width = PX;
    canvas.height = PX;
    this.ctx = canvas.getContext("2d")!;
    this.texture = new CanvasTexture(canvas);
    // 后面有 OutputPass：不标 sRGB，颜色会被当成线性再转一遍，发灰
    this.texture.colorSpace = SRGBColorSpace;
    this.texture.anisotropy = anisotropy;

    const group = new Group();
    // 台座：侧面、顶面照桌沿木框的木色，吃灯光——立体感从这来。BoxGeometry 材质下标 4 是 +Z（顶面）
    const side = new MeshLambertMaterial({ color: WOOD_SIDE });
    const top = new MeshLambertMaterial({ color: WOOD_TOP });
    const baseGeo = new BoxGeometry(BOARD_SIZE, BOARD_SIZE, BOARD_THICK);
    const base = new Mesh(baseGeo, [side, side, side, side, top, side]);
    base.position.set(0, 0, BOARD_THICK / 2);
    // 屏幕：不受光照，颜色就是画布上的颜色
    const screenGeo = new PlaneGeometry(SCREEN_SIZE, SCREEN_SIZE);
    const screenMat = new MeshBasicMaterial({ map: this.texture });
    const screen = new Mesh(screenGeo, screenMat);
    screen.position.set(0, 0, BOARD_THICK + SCREEN_LIFT);
    group.add(base, screen);
    group.position.set(WORLD_SIZE / 2, WORLD_SIZE / 2, 0);
    // 全手动矩阵（main-view.ts）；平时看不见也不该挡拾取，拾取走 MouseUi 自己的代理体
    for (const o of [group, base, screen]) {
      o.matrixAutoUpdate = false;
      o.updateMatrix();
      o.raycast = () => {};
    }
    this.mesh = group;
    this.disposables.push(this.texture, side, top, baseGeo, screenGeo, screenMat);

    // 数码管字体加载完再强制重画一次：「model 不变不重画」会挡住，所以显式作废 key。
    // 加载失败就留着 monospace，不崩
    void loadFont().then((ok) => {
      if (!ok || this.disposed || !this.last) return;
      this.key = "";
      this.update(this.last);
    });
  }

  /** 吃一个 model。key 没变什么都不做 */
  update(model: BoardModel): void {
    this.last = model;
    const key = boardKey(model);
    if (key === this.key) return;
    this.key = key;
    this.draw(model);
    this.drawCount++;
    this.texture.needsUpdate = true;
  }

  private draw(m: BoardModel): void {
    const c = this.ctx;
    const h = PX / 2;
    c.setTransform(1, 0, 0, 1, 0, 0);
    const bg = c.createRadialGradient(h, h, 80, h, h, h * 1.4);
    bg.addColorStop(0, COLORS.groundIn);
    bg.addColorStop(1, COLORS.groundOut);
    c.fillStyle = bg;
    c.fillRect(0, 0, PX, PX);

    // 四条边：先平移到屏幕中心，每家转到自己那一侧，都按「座位 0 在下边」的样子画
    for (const side of m.sides) {
      c.setTransform(1, 0, 0, 1, h, h);
      c.rotate((-side.seat * Math.PI) / 2);
      this.drawSide(side);
    }

    // 中央朝自己，三行：小标签 GAME、局数「N/M」大字、牌墙剩余「N left」小字。
    // **局数是主角**（用户 2026-09-26 定：局数比剩余张数重要）。「Game 1/4」整句放大会压住左右两家的方位字，
    // 所以把 Game 拆成小标签、只放大数字
    c.setTransform(1, 0, 0, 1, h, h);
    c.textAlign = "center";
    c.textBaseline = "alphabetic";
    c.fillStyle = COLORS.sub;
    c.font = `600 44px ${SANS}`;
    c.fillText("GAME", 0, -78);
    // 左右两家的方位字最靠里的一笔离中心约 193px（基线 h−262、字高约 57），中间这行得窄于它；
    // 局数最多「8/8」，140px 下约 230px 宽，放得下。万一放不下就按比例缩字号，不压方位字
    const game = `${m.game}/${m.maxGames}`;
    let size = 140;
    c.font = `800 ${size}px ${SANS}`;
    const wide = c.measureText(game).width;
    if (wide > CENTER_MAX_WIDTH) {
      size = Math.floor((size * CENTER_MAX_WIDTH) / wide);
      c.font = `800 ${size}px ${SANS}`;
    }
    c.fillStyle = COLORS.score;
    c.fillText(game, 0, 48);
    c.fillStyle = COLORS.sub;
    c.font = `600 68px ${SANS}`;
    c.fillText(`${m.wallLeft} left`, 0, 130);
  }

  /** 一条边，按座位 0 的朝向画在下边（原点是屏幕中心）：外排分数、内排方位，不写名字 */
  private drawSide(s: BoardSide): void {
    const c = this.ctx;
    const h = PX / 2;
    if (s.lit) {
      // 行动方：贴边一道金条
      c.fillStyle = COLORS.lit;
      c.fillRect(-h + 60, h - 30, PX - 120, 20);
    }
    c.textAlign = "center";
    c.textBaseline = "alphabetic";
    c.font = `150px ${DIGITS}`;
    c.fillStyle = s.lit ? COLORS.lit : COLORS.score;
    c.fillText(String(s.score), 0, h - 64);
    c.font = `700 78px ${SANS}`;
    c.fillStyle = s.wind === "East" ? COLORS.east : COLORS.wind;
    c.fillText(s.wind, 0, h - 262);
  }

  dispose(): void {
    this.disposed = true;
    for (const d of this.disposables) d.dispose();
    this.canvas.width = 0;
  }
}
