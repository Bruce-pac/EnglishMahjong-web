/**
 * T2.3b：右上角的偏好面板（⚙，点击展开）。
 *
 * 和 T2.3a 的 ⓘ 分开是有意的（用户定）：ⓘ 里是**本局规则**，只读、服务端说了算；
 * 这里是**本机偏好**，可改、服务端不知道。混在一起玩家会以为规则也能点着改。
 * 而且悬停展开的面板里放开关很难用——鼠标移过去点，中途滑出就收起了。
 * 所以：**只读的悬停展开，可点的点击展开**。
 *
 * 两项：手牌区字母大小写、音效开关（P1）。
 * 音效开关的状态由 Table3D 持有、走 props——这里**不能** import `../sound`：
 * 它在模块顶层读全局 localStorage，测试环境一加载就崩。
 */

export function PrefsPanel({
  open,
  lowercase,
  soundOn,
  onToggleOpen,
  onLowercase,
  onSound,
}: {
  open: boolean;
  lowercase: boolean;
  /** 音效开着没有（P1）。和 2.5D 共用 sound.ts 的开关，两边切着玩习惯一致 */
  soundOn: boolean;
  onToggleOpen: () => void;
  onLowercase: (lowercase: boolean) => void;
  onSound: (on: boolean) => void;
}) {
  return (
    <div className="table3d-prefs">
      <button
        className="table3d-prefs-btn"
        aria-expanded={open}
        aria-label="偏好设置"
        title="偏好设置"
        onClick={onToggleOpen}
      >
        ⚙
      </button>
      {open && (
        <div className="table3d-prefs-panel" role="group" aria-label="偏好设置">
          <div className="table3d-prefs-row">
            <span className="table3d-prefs-label">字母</span>
            <div className="table3d-prefs-seg">
              <button
                className={`table3d-prefs-opt${lowercase ? "" : " on"}`}
                aria-pressed={!lowercase}
                onClick={() => onLowercase(false)}
              >
                大写
              </button>
              <button
                className={`table3d-prefs-opt${lowercase ? " on" : ""}`}
                aria-pressed={lowercase}
                onClick={() => onLowercase(true)}
              >
                小写
              </button>
            </div>
          </div>
          <p className="table3d-prefs-note">只改自己手牌区的显示，牌河与别家不变</p>
          <div className="table3d-prefs-row">
            <span className="table3d-prefs-label">音效</span>
            <div className="table3d-prefs-seg">
              <button
                className={`table3d-prefs-opt${soundOn ? " on" : ""}`}
                aria-pressed={soundOn}
                onClick={() => onSound(true)}
              >
                开
              </button>
              <button
                className={`table3d-prefs-opt${soundOn ? "" : " on"}`}
                aria-pressed={!soundOn}
                onClick={() => onSound(false)}
              >
                关
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
