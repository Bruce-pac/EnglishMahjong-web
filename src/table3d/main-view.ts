import {
  AmbientLight,
  Camera,
  DirectionalLight,
  Group,
  Mesh,
  Object3D,
  OrthographicCamera,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutlinePass } from "three/examples/jsm/postprocessing/OutlinePass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { WORLD_SIZE } from "./layout";

/**
 * 画面的宽高比。固定住而不是跟着窗口走——牌桌是个正方形，比例乱变的话
 * 「所有牌一样大、能公平比较」就没了。窗口不是这个比例就上下/左右留黑边。
 */
const RATIO = 1.5;

/** 暗词框的颜色（T4.3）。选中是浅黄 0xffff99，暗词用青蓝，两者一眼分得开。用户定（P9，2026-09-20） */
const GROUP_EDGE_COLOR = 0x4fd1ff;

/**
 * 场景、相机、灯光、后处理。**不管牌，也不管交互**——那是 T1.2 / T3.x 的事。
 *
 * 结构照抄 Autotable（研究笔记 §3.1）：
 *
 * ```
 * Scene (matrixWorldAutoUpdate = false)
 * ├── mainGroup   桌面与牌，世界坐标，永不旋转
 * └── viewGroup   相机 + 4 盏灯，绕桌心旋转 seat*90°
 * ```
 *
 * **换座位是转相机组，不是转桌子。** 灯挂在 viewGroup 里，所以光照跟着视角走，
 * 四家看到的明暗才一致；桌子若跟着转，牌面的世界坐标就变了，槽位那套整数索引
 * （T1.1）也就没意义了。
 *
 * 单人对局座位恒为 0，但机制留着——观战和调试要用。
 */
export class MainView {
  private readonly scene: Scene;
  private readonly viewGroup: Group;
  private readonly renderer: WebGLRenderer;

  /** 一个 0×0 的空 mesh，只用来把 OutlinePass 的 shader 提前编译出来 */
  private readonly dummyObject: Object3D;

  camera: Camera = null!;
  private composer: EffectComposer = null!;
  private outlinePass: OutlinePass = null!;
  /**
   * 暗词框（T4.3）。和选中的金边分开 pass，颜色才能一眼分得开。
   * 两个通道、同色：相邻暗词分在不同通道，才能各描一个完整的框（P8）
   */
  private groupOutlinePasses: [OutlinePass, OutlinePass] = [null!, null!];

  private perspective = false;
  private width = 0;
  private height = 0;

  constructor(
    private readonly container: HTMLElement,
    mainGroup: Group,
  ) {
    this.scene = new Scene();
    // 全手动矩阵：牌大部分帧不动，省掉 three.js 每帧遍历整棵树（研究笔记 §3.1）。
    // 代价是**所有 mesh 改完 position/rotation 都要自己 updateMatrix()**。
    this.scene.matrixWorldAutoUpdate = false;

    this.viewGroup = new Group();
    // 相机组的原点放在桌心，绕它转就是绕桌心转
    this.viewGroup.position.set(WORLD_SIZE / 2, WORLD_SIZE / 2, 0);

    this.scene.add(mainGroup);
    this.scene.add(this.viewGroup);
    mainGroup.updateMatrixWorld();

    this.dummyObject = new Mesh(new PlaneGeometry(0, 0));

    this.renderer = new WebGLRenderer({
      // P16：透明清屏，页面的暖色渐变透过画布——宽屏时画布内外是同一张底，边缘没有接缝
      alpha: true,
      // 用了 EffectComposer，MSAA 在后处理链里本来就不生效，开着只是白费显存
      antialias: false,
      // 少了它 OutlinePass 在某些浏览器上会闪（Autotable 踩过，注释原话是
      // "Apparently needed for OutlinePass not to cause glitching on some browsers"）
      logarithmicDepthBuffer: true,
    });
    this.container.appendChild(this.renderer.domElement);

    this.setupLights();
    this.setupRendering();
  }

  /**
   * 四盏灯，全部挂在 viewGroup 里（跟着视角转）。
   * **没有一盏开 castShadow**——影子是贴地的半透明平面，不走 shadow map（研究笔记 §3.4）。
   */
  private setupLights(): void {
    const white = 0xffffff;
    this.viewGroup.add(new AmbientLight(white, 1.45));

    const topLight = new DirectionalLight(white, 1.45);
    topLight.position.set(0, 0, 10000);
    this.viewGroup.add(topLight);

    const frontLight = new DirectionalLight(white, 0.45);
    frontLight.position.set(0, -10000, 0);
    this.viewGroup.add(frontLight);

    const sideLight = new DirectionalLight(white, 0.45);
    sideLight.position.set(-10000, -10000, 0);
    this.viewGroup.add(sideLight);
  }

  /** 建相机与后处理链。切正交/透视时要整条重建，因为 Pass 里存了相机引用 */
  private setupRendering(): void {
    if (this.camera !== null) {
      this.viewGroup.remove(this.camera);
    }
    this.composer?.dispose();

    this.camera = this.makeCamera(this.perspective);
    this.viewGroup.add(this.camera);

    const w = Math.max(1, this.renderer.domElement.clientWidth);
    const h = Math.max(1, this.renderer.domElement.clientHeight);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));

    // 暗词框先画，选中的金边后画：两者叠在同一张牌上时金边在上面。
    // 两个暗词通道必须在这里跟金边一起建——切透视会整条重建后处理链
    for (const i of [0, 1] as const) {
      const pass = new OutlinePass(new Vector2(w, h), this.scene, this.camera);
      pass.visibleEdgeColor.setHex(GROUP_EDGE_COLOR);
      pass.hiddenEdgeColor.setHex(0x333333);
      this.composer.addPass(pass);
      this.groupOutlinePasses[i] = pass;
    }

    this.outlinePass = new OutlinePass(new Vector2(w, h), this.scene, this.camera);
    // 金色描边：T4.3 的暗词组要靠它围金边（0xffff99）
    this.outlinePass.visibleEdgeColor.setHex(0xffff99);
    this.outlinePass.hiddenEdgeColor.setHex(0x333333);
    this.composer.addPass(this.outlinePass);

    // 后处理链的最后一环，做线性 → sRGB 的转换。
    // **少了它整个画面会暗一大截**——EffectComposer 的中间 render target 是线性的，
    // renderer.outputColorSpace 只作用于直接渲染到屏幕的那一次。
    // （Autotable 那版 three 里对应的是被注释掉的 GammaCorrectionPass。）
    this.composer.addPass(new OutputPass());

    // 逼 OutlinePass 现在就把 shader 编译掉，否则第一次选中牌会卡一下
    this.outlinePass.selectedObjects.push(this.dummyObject);
    for (const p of this.groupOutlinePasses) p.selectedObjects.push(this.dummyObject);
    this.composer.render();
    this.outlinePass.selectedObjects.pop();
    for (const p of this.groupOutlinePasses) p.selectedObjects.pop();

    // 尺寸是在 updateViewport 里定的，这里重建之后要重新同步一次
    this.width = 0;
    this.height = 0;
  }

  private makeCamera(perspective: boolean): Camera {
    if (perspective) {
      return new PerspectiveCamera(30, RATIO, 0.1, 1000);
    }
    const w = WORLD_SIZE * 1.2;
    const h = w / RATIO;
    return new OrthographicCamera(-w / 2, w / 2, h / 2, -h / 2, 0.1, 1000);
  }

  /**
   * 每帧摆一次相机。
   *
   * @param seat     视角坐在哪一家；null = 从正上方俯视（观战/调试）
   * @param lookDown 0..1，「低头」看清自己面前
   * @param zoom     -1..1，正数放大、负数拉远
   * @param mouse2   鼠标在画面里的归一化坐标（-1..1），放大时相机跟着它平移
   */
  updateCamera(seat: number | null, lookDown: number, zoom: number, mouse2: Vector2 | null): void {
    if (this.perspective) {
      this.updatePerspectiveCamera(seat === null, lookDown, zoom, mouse2);
    } else {
      this.updateOrthographicCamera(seat === null, lookDown, zoom, mouse2);
    }
    this.camera.updateMatrix();

    this.viewGroup.rotation.set(0, 0, (seat ?? 0) * Math.PI * 0.5);
    this.viewGroup.updateMatrix();
    this.viewGroup.updateMatrixWorld(true);
  }

  private updatePerspectiveCamera(
    fromTop: boolean,
    lookDown: number,
    zoom: number,
    mouse2: Vector2 | null,
  ): void {
    if (fromTop) {
      this.camera.position.set(0, 0, 400);
      this.camera.rotation.set(0, 0, 0);
      return;
    }
    this.camera.position.set(0, -WORLD_SIZE * 1.44, WORLD_SIZE * 1.05);
    this.camera.rotation.set(Math.PI * 0.3 - lookDown * 0.2, 0, 0);
    if (zoom !== 0) {
      this.camera.position.add(new Vector3(0, 1.37, -1).multiplyScalar(zoom * 55));
    }
    if (zoom > 0 && mouse2) {
      // 系数不能超过 0.5——再大就能把镜头推到左右两家的牌上去了（Autotable 的原注释
      // 明确标了这是防作弊参数）。英语麻将的别家散牌区渲染的是背面，但别家的
      // 亮词区是公开的、牌河也是公开的，仍然按同一个上限守着
      this.camera.position.x += mouse2.x * zoom * WORLD_SIZE * 0.5;
      this.camera.position.y += mouse2.y * zoom * WORLD_SIZE * 0.5;
    }
  }

  private updateOrthographicCamera(
    fromTop: boolean,
    lookDown: number,
    zoom: number,
    mouse2: Vector2 | null,
  ): void {
    if (fromTop) {
      this.camera.position.set(0, 0, 100);
      this.camera.rotation.set(0, 0, 0);
      this.setOrthoZoom(1 / 1.55);
      return;
    }
    // 正交相机没有「离得近就大」，缩放改的是 camera.zoom，不是 position.z
    this.camera.position.set(0, -53 * lookDown - WORLD_SIZE, WORLD_SIZE);
    this.camera.rotation.set(Math.PI * 0.25, 0, 0);
    this.setOrthoZoom(1 / (1 - 0.45 * zoom));

    if (zoom > 0 && mouse2) {
      this.camera.position.x += mouse2.x * zoom * WORLD_SIZE * 0.6;
      this.camera.position.y += mouse2.y * zoom * WORLD_SIZE * 0.6;
    }
  }

  /**
   * 正交相机的缩放走 `camera.zoom`，**不走 `camera.scale`**。
   *
   * Autotable 用 `scale.setScalar()` 做缩放和俯视，那是老版本 three 的行为。
   * three r185 的 `Camera.updateMatrixWorld` 会把 scale 从视图矩阵里剔掉
   * （注释是 "exclude scale from view matrix to be glTF conform"），scale 设了等于没设。
   * T1.3 起正交模式按 z 只会平移、不会放大，俯视的 1.55 也不生效，就是这个原因。
   *
   * 换算：Autotable 的 scale 放大的是视野（越大看到的越多），zoom 正好相反，所以取倒数。
   */
  private setOrthoZoom(value: number): void {
    const camera = this.camera as OrthographicCamera;
    if (camera.zoom === value) return;
    camera.zoom = value;
    camera.updateProjectionMatrix();
  }

  /** 要描金边的 mesh。T3.3 框选、T4.3 暗词组都往这里塞 */
  updateOutline(selectedObjects: Array<Object3D>): void {
    this.outlinePass.selectedObjects = selectedObjects;
  }

  /** 暗词的牌（T4.3），描暗词框。两个列表各交一个通道（P8） */
  updateGroupOutline(groupedObjects: readonly [Array<Object3D>, Array<Object3D>]): void {
    this.groupOutlinePasses[0].selectedObjects = groupedObjects[0];
    this.groupOutlinePasses[1].selectedObjects = groupedObjects[1];
  }

  setPerspective(perspective: boolean): void {
    if (this.perspective === perspective) return;
    this.perspective = perspective;
    this.setupRendering();
  }

  get isPerspective(): boolean {
    return this.perspective;
  }

  render(): void {
    this.composer.render();
  }

  /** 每帧对齐一次画布尺寸。尺寸没变就什么都不做——setSize 会重建 render target */
  updateViewport(): void {
    const cw = this.container.parentElement?.clientWidth ?? 0;
    const ch = this.container.parentElement?.clientHeight ?? 0;
    if (cw === this.width && ch === this.height) return;
    if (cw === 0 || ch === 0) return;

    this.width = cw;
    this.height = ch;

    let renderWidth: number;
    let renderHeight: number;
    if (cw / ch > RATIO) {
      renderWidth = Math.floor(ch * RATIO);
      renderHeight = Math.floor(ch);
    } else {
      renderWidth = Math.floor(cw);
      renderHeight = Math.floor(cw / RATIO);
    }
    // 对齐到偶数像素：后处理的半分辨率 pass 遇到奇数尺寸会错半像素，边缘发虚
    renderWidth -= renderWidth % 2;
    renderHeight -= renderHeight % 2;

    const pixelRatio = Math.min(window.devicePixelRatio, 3);

    this.container.style.width = `${renderWidth}px`;
    this.container.style.height = `${renderHeight}px`;
    this.renderer.setSize(renderWidth, renderHeight);
    this.renderer.setPixelRatio(pixelRatio);
    this.composer.setSize(renderWidth, renderHeight);
    this.composer.setPixelRatio(pixelRatio);
  }

  /** three.js 建的那块 canvas。鼠标坐标要按它的位置换算，不是按容器 div */
  get canvas(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  /** 每帧的 draw call 数。验收用（T1.2 要求 108 张牌只占 1 个 draw call） */
  get drawCalls(): number {
    return this.renderer.info.render.calls;
  }

  /** 渲染器支持的最大各向异性过滤。中央记分盘 45° 斜看，不开会糊（T2.2） */
  get maxAnisotropy(): number {
    return this.renderer.capabilities.getMaxAnisotropy();
  }

  dispose(): void {
    this.composer.dispose();
    this.renderer.dispose();
    (this.dummyObject as Mesh).geometry.dispose();
    this.renderer.domElement.remove();
  }
}
