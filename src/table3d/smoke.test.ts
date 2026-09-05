// 样板测试：只用来证明 vitest 装好了、npm test 跑得起来。
// 真正的测试从 T1.1（Slot 模型）和 T1.4（牌张身份对账）开始写。
import { describe, expect, it } from "vitest";

describe("测试环境", () => {
  it("vitest 跑得起来", () => {
    expect(1 + 1).toBe(2);
  });
});
