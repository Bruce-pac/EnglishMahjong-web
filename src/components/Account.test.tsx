/** T6.6：账号弹窗的 registerOnly（3D 牌局里用）；默认值下与原来相同 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Account } from "./Account";

const noop = () => {};
const render = (bound: boolean, registerOnly?: boolean) =>
  renderToStaticMarkup(
    <Account
      account={bound ? { bound: true, displayName: "小明" } : { bound: false }}
      onClose={noop}
      onDone={noop}
      onLogout={noop}
      {...(registerOnly === undefined ? {} : { registerOnly })}
    />,
  );

describe("Account registerOnly", () => {
  it("未登录：只有注册表单，没有登录标签", () => {
    const h = render(false, true);
    expect(h).toContain("注册");
    expect(h).toContain("创建账号");
    expect(h).not.toContain(">登录<");
  });

  it("已登录：只显示当前登录，不出切换 / 退出，提示回首页", () => {
    const h = render(true, true);
    expect(h).toContain("当前登录：<b>小明</b>");
    // 提示语里会提到「切换账号或退出登录」，所以按按钮查：两个按钮都不在
    expect(h).not.toMatch(/<button[^>]*>切换账号<\/button>/);
    expect(h).not.toMatch(/<button[^>]*>退出登录<\/button>/);
    expect(h).toContain("请先回到首页");
  });

  it("默认值下行为不变：显式传 false 与不传逐字节相同，且有登录 / 切换 / 退出", () => {
    expect(render(false)).toBe(render(false, false));
    expect(render(true)).toBe(render(true, false));
    expect(render(false)).toContain(">登录<");
    expect(render(true)).toContain("切换账号");
    expect(render(true)).toContain("退出登录");
  });
});
