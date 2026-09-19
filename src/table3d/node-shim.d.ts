/**
 * 单测里读产物文件（`characters.test.ts`）要用 `node:fs`，但 tsconfig 只装了 `vite/client` 的类型、
 * 没有 `@types/node`——为一个函数加一整套 node 类型不值得，这里只声明用到的那一个。
 * 运行时 vitest 跑在 node 里，返回的 Buffer 本来就是 Uint8Array 的子类
 */
declare module "node:fs" {
  export function readFileSync(path: string): Uint8Array;
}
