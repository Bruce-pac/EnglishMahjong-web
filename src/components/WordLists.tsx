/**
 * 设置页的「自建词单」「胡牌至少需要几个词单词」两组，以及「我的词单」弹窗（需求 §2.1、§2.2）。
 *
 * 前端零规则：哪些词收下、为什么拒收、长词提示，全由服务端给，这里原样展示。
 * 弹窗只在设置页出现，由这里自己管，不经过 App。
 */

import { useEffect, useRef, useState } from "react";
import { api, type WordListSummary, type WordListUpload } from "../api";
import {
  bytesToBase64,
  defaultListName,
  formatListDate,
  readRememberedList,
  resolveRemembered,
  writeRememberedList,
} from "../wordLists";
import { Seg } from "./Seg";

export function WordListSetting({
  listId,
  need,
  onChange,
}: {
  /** 选中的词单；null = 不用 */
  listId: number | null;
  need: number;
  onChange: (listId: number | null, need: number) => void;
}) {
  const [lists, setLists] = useState<WordListSummary[]>([]);
  const [managing, setManaging] = useState(false);

  // 挂载时拉列表，并把上次选的那份选回来；已经删了（或换了账号）就回落到「不用」
  useEffect(() => {
    let alive = true;
    api
      .wordLists()
      .then((ls) => {
        if (!alive) return;
        setLists(ls);
        const id = resolveRemembered(readRememberedList(), ls);
        if (id === null) writeRememberedList(null);
        onChange(id, 1);
      })
      .catch(() => {
        /* 拉不到列表就当没有词单，照样能开局 */
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const select = (id: number | null) => {
    writeRememberedList(id);
    onChange(id, 1);
  };

  // 弹窗里删了、传了：更新列表；删掉的正是选中的就回落到「不用」
  const listsChanged = (ls: WordListSummary[]) => {
    setLists(ls);
    if (listId !== null && !ls.some((l) => l.id === listId)) select(null);
  };

  const selected = lists.find((l) => l.id === listId) ?? null;
  const manageLink = (
    <button className="link-btn" onClick={() => setManaging(true)}>
      管理我的词单
    </button>
  );

  return (
    <>
      <div className="setup-group">
        <div className="setup-group-label">自建词单</div>
        <div className="seg">
          <button className={selected ? "seg-btn" : "seg-btn seg-on"} onClick={() => select(null)}>
            不用
          </button>
          {lists.map((l) => (
            <button
              key={l.id}
              className={l.id === listId ? "seg-btn seg-on" : "seg-btn"}
              onClick={() => select(l.id)}
            >
              {l.name}
            </button>
          ))}
          <button className="seg-btn seg-add" onClick={() => setManaging(true)}>
            ＋ 上传词单
          </button>
        </div>
        <p className="setup-group-hint">
          {selected
            ? `${selected.name} · ${selected.wordCount} 个词。胡牌时亮词和暗词里要有足够的词单词。`
            : "上传自己的 .txt 词单，专练一小批词。"}{" "}
          {manageLink}
        </p>
      </div>

      {selected && (
        <div className="setup-group">
          <div className="setup-group-label">胡牌至少需要几个词单词</div>
          <Seg
            options={[
              [1, "1 个"],
              [2, "2 个"],
            ]}
            value={need}
            onChange={(v) => onChange(listId, +v)}
          />
          <p className="setup-group-hint">亮词和暗词里合计至少要有这么多个词单词才能胡。</p>
        </div>
      )}

      {managing && (
        <WordListsModal
          lists={lists}
          onListsChanged={listsChanged}
          onClose={(uploadedId) => {
            setManaging(false);
            if (uploadedId !== null) select(uploadedId);
          }}
        />
      )}
    </>
  );
}

/** 「我的词单」弹窗：上半列表 + 删除，下半上传 */
function WordListsModal({
  lists,
  onListsChanged,
  onClose,
}: {
  lists: WordListSummary[];
  onListsChanged: (lists: WordListSummary[]) => void;
  /** uploadedId：这次弹窗里最后一份上传成功的词单，设置页据此自动选中；没传过为 null */
  onClose: (uploadedId: number | null) => void;
}) {
  const [confirming, setConfirming] = useState<number | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<WordListUpload | null>(null);
  const uploadedId = useRef<number | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const close = () => onClose(uploadedId.current);

  const refresh = async () => onListsChanged(await api.wordLists());

  const remove = async (id: number) => {
    setBusy(true);
    setError(null);
    try {
      await api.deleteWordList(id);
      if (uploadedId.current === id) uploadedId.current = null;
      setConfirming(null);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const upload = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const content = bytesToBase64(new Uint8Array(await file.arrayBuffer()));
      const r = await api.uploadWordList(name, file.name, content);
      uploadedId.current = r.id;
      setResult(r);
      // 传完清空文件和名称：否则「上传」还能点，再点一次就把同一份又传一遍。
      // input 本身的值也要清，不然重新选同一个文件不会触发 onChange
      setFile(null);
      setName("");
      if (fileInput.current) fileInput.current.value = "";
      await refresh();
    } catch (e) {
      // 整份拒收（10 份已满、编码认不出、没有有效词…）：服务端的 detail 原样显示
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="overlay" onClick={close}>
      <div className="sheet sheet-account sheet-wordlists" onClick={(e) => e.stopPropagation()}>
        <h3 className="account-title">我的词单</h3>

        {lists.length === 0 ? (
          <p className="account-note">还没有词单</p>
        ) : (
          <ul className="wl-list">
            {lists.map((l) => (
              <li key={l.id} className="wl-row">
                <b className="wl-name">{l.name}</b>
                <span className="wl-meta">
                  {l.wordCount} 个词 · {formatListDate(l.createdAt)}
                </span>
                {confirming === l.id ? (
                  <span className="wl-confirm">
                    <button className="link-btn wl-danger" onClick={() => remove(l.id)} disabled={busy}>
                      确认删除
                    </button>
                    <button className="link-btn" onClick={() => setConfirming(null)}>
                      取消
                    </button>
                  </span>
                ) : (
                  <button className="link-btn" onClick={() => setConfirming(l.id)}>
                    删除
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        <div className="wl-upload-title">上传新词单</div>
        <p className="account-note">.txt 文件，一行一个词，词后面可以空一格写中文释义。最多 500 个词。</p>

        <label className="account-field">
          文件
          <input
            ref={fileInput}
            type="file"
            accept=".txt,text/plain"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setError(null);
            }}
          />
        </label>

        <label className="account-field">
          <span>
            名称<span className="account-hint">（不填就用文件名）</span>
          </span>
          <input
            value={name}
            maxLength={20}
            onChange={(e) => setName(e.target.value)}
            placeholder={file ? defaultListName(file.name) : ""}
          />
        </label>

        {error && <p className="account-error">{error}</p>}

        {result && (
          <div className="wl-result">
            <div>
              ✓ 收下 <b>{result.wordCount}</b> 个词
            </div>
            {result.warnings.map((w) => (
              <div key={w} className="wl-warn">
                ⚠ {w}
              </div>
            ))}
            {result.rejected.length > 0 && (
              <>
                <div>✗ 拒收 {result.rejected.length} 个：</div>
                {result.rejected.map((r) => (
                  <div key={r.word} className="wl-rejected">
                    {r.word} — {r.reason}
                  </div>
                ))}
              </>
            )}
          </div>
        )}

        <div className="account-actions">
          <button className="btn btn-ghost" onClick={upload} disabled={!file || busy}>
            {busy ? "…" : "上传"}
          </button>
          <button className="btn btn-primary" onClick={close}>
            完成
          </button>
        </div>
      </div>
    </div>
  );
}
