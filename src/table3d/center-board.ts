/**
 * T2.2 中央记分盘：画法那一层。只吃 `BoardModel`，key 没变就不重画、不置 needsUpdate。
 *
 * 一块平面挂在 mainGroup 上，盖住中央 42×42 的空地（世界坐标 90..132），略高于桌面（z=0）
 * 以免 z-fighting、低于影子（z≈0.2）。**不进 Thing 池**（108 是零余量）、不进拾取、不进 OutlinePass——
 * 它只是一张贴图。参照 Autotable `center.ts`：dirty 标记 + `ctx.rotate` 画四家
 *
 * 画布坐标与世界坐标：平面朝 +z，CanvasTexture 默认 flipY，画布**上边**在世界 +y（对家那侧），
 * **下边**是自己（座位 0）。座位 s 在世界里是绕 z 逆时针转 s×90°；从上往下看画布没有镜像，
 * 所以在画布上也是逆时针——`ctx.rotate(-s·π/2)`（画布 y 朝下，正角是顺时针）
 */

import { CanvasTexture, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace } from "three";
import { WORLD_SIZE } from "./layout";
import { boardKey, type BoardModel, type BoardSide } from "./board-model";

/** 中央空地边长（= 牌河宽度 7×6，见 setup-slots.ts 文件头约束 ①） */
export const BOARD_SIZE = 42;
/** 比桌面高一点点：别和桌面打架，也别盖住贴地影子（z≈0.2） */
const BOARD_Z = 0.05;
/** 画布边长。盘面在 1400×933 默认视角下约 220×155 像素，1024 足够 45° 斜看不糊 */
const PX = 1024;

const FONT = `-apple-system, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif`;

const COLORS = {
  ground: "#12372a",
  frame: "#2f6f55",
  text: "#dfeee6",
  dim: "#8fb8a4",
  east: "#ff8a5c",
  lit: "#ffd24a",
  litGlow: "rgba(255, 210, 74, 0.22)",
};

export class CenterBoard {
  readonly mesh: Mesh;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly texture: CanvasTexture;
  private readonly geometry: PlaneGeometry;
  private readonly material: MeshBasicMaterial;
  private key = "";
  /** 重画了几次（测试用：model 不变时不该重画） */
  drawCount = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    anisotropy = 1,
  ) {
    canvas.width = PX;
    canvas.height = PX;
    this.ctx = canvas.getContext("2d")!;
    this.texture = new CanvasTexture(canvas);
    // 后面有 OutputPass：不标 sRGB，颜色会被当成线性再转一遍，发灰
    this.texture.colorSpace = SRGBColorSpace;
    this.texture.anisotropy = anisotropy;
    this.geometry = new PlaneGeometry(BOARD_SIZE, BOARD_SIZE);
    // 不受光照：盘面的颜色就是画布上的颜色
    this.material = new MeshBasicMaterial({ map: this.texture });
    this.mesh = new Mesh(this.geometry, this.material);
    this.mesh.position.set(WORLD_SIZE / 2, WORLD_SIZE / 2, BOARD_Z);
    this.mesh.matrixAutoUpdate = false;
    this.mesh.updateMatrix();
    // 平时看不见也不该挡拾取；拾取走 MouseUi 自己的代理体，本来就碰不到它
    this.mesh.raycast = () => {};
  }

  /** 吃一个 model。key 没变什么都不做 */
  update(model: BoardModel): void {
    const key = boardKey(model);
    if (key === this.key) return;
    this.key = key;
    this.draw(model);
    this.drawCount++;
    this.texture.needsUpdate = true;
  }

  private draw(m: BoardModel): void {
    const c = this.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, PX, PX);
    c.fillStyle = COLORS.ground;
    c.fillRect(0, 0, PX, PX);
    c.strokeStyle = COLORS.frame;
    c.lineWidth = 12;
    c.strokeRect(6, 6, PX - 12, PX - 12);

    // 四条边：先平移到盘心，每家转到自己那一侧，都按「座位 0 在下边」的样子画
    for (const side of m.sides) {
      c.setTransform(1, 0, 0, 1, PX / 2, PX / 2);
      c.rotate((-side.seat * Math.PI) / 2);
      this.drawSide(side);
    }

    // 中央：牌墙剩余（大数字）+ Game N/M（小字），都朝自己
    c.setTransform(1, 0, 0, 1, PX / 2, PX / 2);
    c.textAlign = "center";
    c.textBaseline = "alphabetic";
    c.fillStyle = COLORS.text;
    c.font = `700 210px ${FONT}`;
    c.fillText(String(m.wallLeft), 0, 60);
    c.fillStyle = COLORS.dim;
    c.font = `600 64px ${FONT}`;
    c.fillText(`Game ${m.game}/${m.maxGames}`, 0, 150);
  }

  /** 一条边，按座位 0 的朝向画在下边（原点是盘心） */
  private drawSide(s: BoardSide): void {
    const c = this.ctx;
    const half = PX / 2;
    if (s.lit) {
      // 行动方：整条边的底色提亮 + 贴边一道亮色边条
      c.fillStyle = COLORS.litGlow;
      c.fillRect(-half + 150, half - 170, PX - 300, 158);
      c.fillStyle = COLORS.lit;
      c.fillRect(-half + 150, half - 34, PX - 300, 22);
    }
    const east = s.wind === "East";
    c.textBaseline = "alphabetic";
    c.font = `700 80px ${FONT}`;
    c.textAlign = "right";
    c.fillStyle = east ? COLORS.east : s.lit ? COLORS.lit : COLORS.dim;
    c.fillText(s.wind, -24, half - 66);
    c.textAlign = "left";
    c.fillStyle = s.lit ? COLORS.lit : COLORS.text;
    c.fillText(String(s.score), 24, half - 66);
  }

  dispose(): void {
    this.texture.dispose();
    this.material.dispose();
    this.geometry.dispose();
    this.canvas.width = 0;
  }
}
