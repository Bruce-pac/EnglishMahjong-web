/**
 * P23：设置页「牌桌样式」的默认值随设备变。
 *
 * 3D 牌桌只支持鼠标（T6.4 定了不做触屏），而且 three r185 只支持 WebGL 2。
 * 手机、平板（主指针是粗指针）和拿不到 WebGL 2 的浏览器默认「经典」；其余照旧默认 3D。
 * 3D 仍然可以手动选，不置灰；不持久化（T7.1 用户定）。
 *
 * **放在主包、不 import `table3d/` 下的任何东西**——否则 3D 懒加载包会被拉进主包。
 */

/** 设置页里选的牌桌样式。只在前端分叉用，不进 MatchConfig */
export type TableStyle = "3d" | "classic";

export interface DeviceTraits {
  /** 主指针是粗指针（`(pointer: coarse)`）：手机、平板 */
  coarsePointer: boolean;
  /** 能拿到 WebGL 2 上下文 */
  webgl2: boolean;
}

/** 判定：触屏或没有 WebGL 2 → 经典；否则 3D */
export function defaultTableStyle({ coarsePointer, webgl2 }: DeviceTraits): TableStyle {
  return coarsePointer || !webgl2 ? "classic" : "3d";
}

/**
 * 探测当前设备。**在 node 环境（没有 `window.matchMedia`、没有 `document`）里不抛错**——
 * 设置页的单测就在 node 里渲染。探测不了的一律按「能用 3D」算（粗指针 false、WebGL 2 true），
 * 和改动之前的默认值一致
 */
export function detectDevice(): DeviceTraits {
  let coarsePointer = false;
  try {
    coarsePointer = typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(pointer: coarse)").matches
      : false;
  } catch {
    coarsePointer = false;
  }

  let webgl2 = true;
  if (typeof document !== "undefined" && typeof document.createElement === "function") {
    try {
      const canvas = document.createElement("canvas");
      const gl = canvas.getContext("webgl2");
      webgl2 = !!gl;
      // 立刻释放，别占着一个上下文名额（浏览器同时能开的 WebGL 上下文有限）
      gl?.getExtension("WEBGL_lose_context")?.loseContext();
    } catch {
      webgl2 = false;
    }
  }
  return { coarsePointer, webgl2 };
}
