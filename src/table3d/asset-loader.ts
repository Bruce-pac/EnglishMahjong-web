import {
  Box3,
  LinearSRGBColorSpace,
  Material,
  Mesh,
  MeshLambertMaterial,
  MeshStandardMaterial,
  Texture,
  TextureLoader,
  Vector3,
} from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { Size, ThingType } from "./types";

// ⚠️ Autotable 这里写的是 Parcel 专有的 `import x from 'url:../img/y.png'`，
// Vite 下直接报错。Vite 的等价写法是 `?url` 后缀。
import modelsUrl from "../../img/models.glb?url";
import tilesUrl from "../../img/tiles.png?url";

/**
 * 加载 T0.2 产出的资源：图集 `tiles.png` 与模型 `models.glb`。
 *
 * 运行时零外部依赖——课堂网络不可靠，资源全部随前端打包（需求文档 §7）。
 */
export class AssetLoader {
  textures: Record<string, Texture> = {};
  meshes: Record<string, Mesh> = {};

  async loadAll(): Promise<void> {
    await Promise.all([this.loadTexture(tilesUrl, "tiles"), this.loadModels(modelsUrl)]);

    // 图集来自 web/img/tiles.png，glb 里没有贴图。
    //
    // `art/export.py` 用 `export_image_format="NONE"` 导出，图集不烘进 glb——我们只有
    // 一张图集，内嵌就是同一张图打包两遍（实测多 214KB）。glb 只负责几何体和 UV。
    // 所以材质从 glTF 出来时 map 是空的，这里补上。
    for (const mesh of Object.values(this.meshes)) {
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of materials) {
        (m as MeshLambertMaterial).map = this.textures.tiles;
        m.needsUpdate = true;
      }
    }
  }

  /** 复制一份 mesh，材质也要复制——Simple/Custom 双轨里每张牌要能单独改 emissive */
  cloneMesh(mesh: Mesh): Mesh {
    const copy = mesh.clone();
    copy.material = Array.isArray(mesh.material)
      ? mesh.material.map((m) => m.clone())
      : mesh.material.clone();
    return copy;
  }

  make(what: string): Mesh {
    const mesh = this.meshes[what];
    if (!mesh) throw new Error(`models.glb 里没有名为 ${what} 的 mesh`);
    return this.cloneMesh(mesh);
  }

  private loadTexture(url: string, name: string): Promise<void> {
    return new Promise((resolve, reject) => {
      new TextureLoader().load(
        url,
        (texture) => {
          this.textures[name] = this.processTexture(texture);
          resolve();
        },
        undefined,
        reject,
      );
    });
  }

  private loadModels(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      new GLTFLoader().load(
        url,
        (gltf) => {
          for (const obj of gltf.scene.children) {
            if ((obj as Mesh).isMesh) {
              this.meshes[obj.name] = this.processMesh(obj as Mesh);
            } else {
              console.warn("models.glb 里有不认识的对象", obj);
            }
          }
          resolve();
        },
        undefined,
        reject,
      );
    });
  }

  /**
   * 纹理三件套，缺一不可：
   * - `flipY = false`：glTF 的 UV 原点在左上，three.js 默认按左下翻，翻了就采错格子
   * - `colorSpace = LinearSRGBColorSpace`：图集是设计稿直出的平涂色，
   *   按 sRGB 解释会被再做一次 gamma，牌面发灰
   * - `anisotropy = 4`：牌是斜着看的，各向异性过滤不开的话远处字母糊成一团
   */
  private processTexture(texture: Texture): Texture {
    texture.flipY = false;
    texture.anisotropy = 4;
    texture.colorSpace = LinearSRGBColorSpace;
    return texture;
  }

  private processMesh(mesh: Mesh): Mesh {
    mesh.material = Array.isArray(mesh.material)
      ? mesh.material.map((m) => this.processMaterial(m))
      : this.processMaterial(mesh.material);
    this.checkOrientation(mesh);
    return mesh;
  }

  /**
   * 校验模型的朝向与尺寸。**不做任何旋转**——朝向是在 Blender 里摆好的。
   *
   * glTF 规定 Y 轴朝上，Blender 是 Z-up，导出器会做 `glTF (x,y,z) = Blender (x,z,-y)`
   * 的变换。所以 `art/make_model.py` 把牌**立着**建（Blender 里 6×4×9、正面朝 −Y），
   * 变换之后正好是我们要的 6×9×4、正面朝 +Z。Autotable 的 models.blend 也是这么建的，
   * 它的前端同样一行旋转都没有。
   *
   * 躺着建的话导出来是 6×4×9、正面朝 +Y，后果不是报错，而是**每张牌都侧面朝着相机**
   * ——渲染出来是一桌没有字母的米色方块，看起来像「贴图没加载」，很难往坐标轴上想。
   * 所以这里当场校验包围盒等于 Size.TILE：谁重新导出 glb 时改了朝向约定，
   * 会在这儿直接炸掉，而不是又渲染出一桌白板。
   */
  private checkOrientation(mesh: Mesh): void {
    mesh.geometry.computeBoundingBox();
    const box = mesh.geometry.boundingBox as Box3;
    const size = box.getSize(new Vector3());
    const want = Size[ThingType.TILE];
    const off = Math.max(
      Math.abs(size.x - want.x),
      Math.abs(size.y - want.y),
      Math.abs(size.z - want.z),
    );
    if (off > 0.01) {
      throw new Error(
        `models.glb 的 ${mesh.name} 尺寸是 ${size.x}×${size.y}×${size.z}，` +
          `与 Size.TILE ${want.x}×${want.y}×${want.z} 对不上——朝向约定变了？`,
      );
    }
  }

  /**
   * 把 glTF 带来的 `MeshStandardMaterial` **降级成 `MeshLambertMaterial`**，只留 `map`。
   *
   * Lambert 没有 PBR 计算，配合手调的几盏灯视觉上完全够用，而且省掉一大截着色器——
   * 这是 Autotable 的既有结论（研究笔记 §3.7），照抄。
   */
  private processMaterial(material: Material): Material {
    // map 在 loadAll() 末尾统一换成我们自己加载的 tiles.png，这里不用 glb 那份
    return new MeshLambertMaterial({ map: (material as MeshStandardMaterial).map });
  }
}
