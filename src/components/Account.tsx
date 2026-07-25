/**
 * 账号弹窗。**随登录态变脸**（测试bug.md）：
 *
 * - 未登录：注册 / 登录两个 tab。注册＝把当前匿名 playerId 原地升级成账号，
 *   已攒的单词本、战绩全留在名下；登录＝把另一台设备上建的账号接管过来。
 * - 已登录：显示「当前登录：X」+ 退出登录 / 切换账号。没有这一屏，用户就会
 *   对着裸的注册表单反复撞「当前身份已绑定」，还搞不清自己是谁。
 *
 * 退出登录 = 领一个全新匿名身份，于是共享设备（课堂机房）上换个人能建别的账号。
 */

import { useState } from "react";
import { api, type AccountState } from "../api";

type Tab = "register" | "login";

// 和后端 accounts.py 的规则对齐——前端先拦一道，空表单/明显不合法不发请求
const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;
const MIN_PASSWORD = 6;

export function Account({
  account,
  initialTab = "register",
  onClose,
  onDone,
  onLogout,
}: {
  account: AccountState | null;
  initialTab?: Tab;
  onClose: () => void;
  onDone: (displayName: string) => void;
  onLogout: () => void;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 「切换账号」＝在已登录状态下展开登录/注册表单，但**先不动身份**。
  // 真正的登出推迟到新登录/注册成功那一刻——否则点了切换又反悔（以后再说），
  // 人已经被登出、匿名 id 也换了，回不去（测试bug.md）。
  const [switching, setSwitching] = useState(false);

  // ---- 已登录且没在切换：只显示身份 + 退出/切换，不给裸表单 ----
  if (account?.bound && !switching) {
    return (
      <div className="overlay" onClick={onClose}>
        <div className="sheet sheet-account" onClick={(e) => e.stopPropagation()}>
          <p className="account-loggedin">
            当前登录：<b>{account.displayName}</b>
          </p>
          <p className="account-note">
            单词本和战绩都存在这个账号名下，换设备登录就能找回。
          </p>
          <div className="account-actions">
            <button className="btn btn-ghost" onClick={() => setSwitching(true)}>
              切换账号
            </button>
            <button
              className="btn btn-primary"
              onClick={async () => {
                setBusy(true);
                await api.logout();
                onLogout();
                onClose();
              }}
              disabled={busy}
            >
              退出登录
            </button>
          </div>
          <button className="account-close" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
    );
  }

  const validate = (): string | null => {
    if (!USERNAME_RE.test(username)) return "用户名要 3–20 位，只能用字母、数字、下划线";
    if (password.length < MIN_PASSWORD) return `密码至少 ${MIN_PASSWORD} 位`;
    return null;
  };

  const submit = async () => {
    const bad = validate();
    if (bad) {
      setError(bad);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      let r: { displayName: string };
      if (tab === "login") {
        // 登录会用对方账号的 playerId 覆盖本地身份，无需先登出——就算当前登着别的号
        r = await api.login(username, password);
      } else {
        // 注册＝绑定当前 playerId。若正从某个账号「切换」过来，当前 id 已绑定，
        // 得先登出换一个干净的匿名 id，新账号才不会撞 409、也不会继承旧号的数据。
        if (account?.bound) {
          await api.logout();
          onLogout();
        }
        r = await api.register(username, password, displayName);
      }
      onDone(r.displayName);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  // 表单页的「以后再说」：正在切换的话只是收起表单、退回身份态，绝不动登录状态
  const cancel = () => {
    if (switching) setSwitching(false);
    else onClose();
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet sheet-account" onClick={(e) => e.stopPropagation()}>
        <div className="account-tabs">
          <button
            className={tab === "register" ? "account-tab on" : "account-tab"}
            onClick={() => {
              setTab("register");
              setError(null);
            }}
          >
            注册
          </button>
          <button
            className={tab === "login" ? "account-tab on" : "account-tab"}
            onClick={() => {
              setTab("login");
              setError(null);
            }}
          >
            登录
          </button>
        </div>

        <p className="account-note">
          {tab === "register"
            ? "把当前的单词本和战绩存成账号——换设备、清缓存后都能找回。"
            : "在别的设备注册过？登录把那份档案接管过来。"}
        </p>

        <label className="account-field">
          用户名
          <input
            autoFocus
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="3–20 位字母、数字、下划线"
          />
        </label>

        {tab === "register" && (
          <label className="account-field">
            显示名<span className="account-hint">（上榜用，可留空）</span>
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="留空就用用户名"
            />
          </label>
        )}

        <label className="account-field">
          密码
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !busy && submit()}
            placeholder="至少 6 位"
          />
        </label>

        {error && <p className="account-error">{error}</p>}

        <div className="account-actions">
          <button className="btn btn-ghost" onClick={cancel}>
            {switching ? "返回" : "以后再说"}
          </button>
          <button className="btn btn-primary" onClick={submit} disabled={busy}>
            {busy ? "…" : tab === "register" ? "创建账号" : "登录"}
          </button>
        </div>
      </div>
    </div>
  );
}
