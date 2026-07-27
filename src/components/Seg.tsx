/**
 * 分段选择：一排大按钮，选中态高亮。移动端也点得准，不用下拉框。
 *
 * 设置页（词库档位、难度…）和排行榜页（三个榜切换）共用。
 */

export function Seg({
  options,
  value,
  onChange,
}: {
  options: [string | number, string][];
  value: string | number;
  onChange: (v: string | number) => void;
}) {
  return (
    <div className="seg">
      {options.map(([v, label]) => (
        <button
          key={v}
          className={v === value ? "seg-btn seg-on" : "seg-btn"}
          onClick={() => onChange(v)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
