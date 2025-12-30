
import React, { useEffect, useRef, useState } from "react";
import MonacoEditor from "@monaco-editor/react";
import * as runtime from "react/jsx-runtime";
import { MDXProvider } from "@mdx-js/react";
import "./App.css";

let rawInitialMDX = `

export const Badge = ({ children }) => (
  <span style={{
    border: "1px solid #000",
    padding: "0.1em 0.4em",
    marginLeft: "0.4em",
    fontSize: "0.85em"
  }}>
    {children}
  </span>
)

export const Box = ({ title, children }) => (
  <div style={{
    border: "1px solid #000",
    padding: "1em",
    margin: "1.5em 0"
  }}>
    <strong>{title}</strong>
    <div style={{ marginTop: "0.5em" }}>
      {children}
    </div>
  </div>
)

# MDX 動作確認デモ

これは **CommonMark / GFM / MDX(JSX) / 制御構文** をまとめて確認するためのデモです。

---

## 1. CommonMark 基本

### 強調・打消し

- *italic*
- **bold**
- ~~strikethrough~~

### 引用

> これは引用です  
> LaTeX の quote 環境相当

### インラインコード

\`inline code\`

### コードブロック

\`\`\`ts
function add(a: number, b: number): number {
  return a + b
}
\`\`\`

---

## 2. GFM（GitHub Flavored Markdown）

### チェックボックス

- [x] 完了
- [ ] 未完了

### 表

| name | value | note |
|------|-------|------|
| a    | 1     | test |
| b    | 2     | demo |

### 自動リンク

https://example.com

---

## 3. MDX（JSX 埋め込み）

### JSX コンポーネント

<Badge>MDX</Badge>はMarkdownとJSXを混在できます。

<Box title="Box コンポーネント">
  Markdown **強調** も JSX の中で使えます。
</Box>

---

## 4. 条件分岐（JSX）


---
`

rawInitialMDX = "Lorem ipsum dolor sit amet, consectetur adipiscing elit. \n\n".repeat(100) + rawInitialMDX + "\n" + "Vestibulum ante ipsum primis in faucibus orci luctus et ultrices posuere cubilia Curae; \n\n".repeat(100);



function extractStyles(value: string) {
  let css = "";
  const without = value.replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, (m, g1) => {
    css += (g1 || "") + "\n";
    const nl = (m.match(/\n/g) || []).length || 1;
    return "\n".repeat(nl);
  });
  return { css: css.trim(), content: without };
}

// エラーバウンダリ: MDXレンダリング時の例外をキャッチしてフォールバックUIを表示
type EBProps = { children: React.ReactNode; resetKey?: any };
type EBState = { error: Error | null; info?: React.ErrorInfo | null };
class ErrorBoundary extends React.Component<EBProps, EBState> {
  constructor(props: EBProps) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    this.setState({ error, info });
    // ここでログ送信なども可能
    // console.error(error, info);
  }

  componentDidUpdate(prevProps: EBProps) {
    if (this.props.resetKey !== prevProps.resetKey && this.state.error) {
      this.setState({ error: null, info: null });
    }
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 12, color: "#900", background: "#fff6f6", borderRadius: 6 }}>
          <strong>レンダリングエラー:</strong>
          <div style={{ whiteSpace: "pre-wrap", marginTop: 8 }}>{String(this.state.error)}</div>
        </div>
      );
    }
    return this.props.children;
  }
}

function useMDXComponent(code: string) {
  const [Component, setComponent] = useState<React.ComponentType>(() => () => <div>Loading...</div>);
  useEffect(() => {
    let cancelled = false;
    import("@mdx-js/mdx").then(async (mdx) => {
      try {
        // strip top-level import statements so the browser doesn't need to
        // resolve bare specifiers like 'react'. We currently support mapping
        // imports from 'react' into the runtime object. Other imports will
        // produce a helpful error in the preview.
        const imports: Array<{ spec: string; from: string }> = [];
        const cleaned = code.replace(/^\s*import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"];?\s*$/gm, (m, spec, from) => {
          imports.push({ spec: spec.trim(), from: from.trim() });
          // preserve original line count so positions remain stable
          const nl = (m.match(/\n/g) || []).length || 1;
          return "\n".repeat(nl);
        });

        const nonReact = imports.filter((i) => i.from !== "react");
        if (nonReact.length > 0) {
          const msg = `Unsupported imports in MDX: ${nonReact.map((i) => i.from).join(", ")}. Only imports from 'react' are supported in-browser.`;
          setComponent(() => () => <pre style={{ color: 'red' }}>{msg}</pre>);
          return;
        }

        // build runtime object merging jsx-runtime and React named exports
        const runtimeForEval: Record<string, any> = { ...runtime, React };
        for (const im of imports) {
          if (im.from === "react") {
            const spec = im.spec;
            const namedMatch = spec.match(/^{\s*([\s\S]*?)\s*}$/);
            if (namedMatch) {
              const names = namedMatch[1].split(',').map(s => s.trim().replace(/ as .*$/, ''));
              for (const n of names) {
                if (n) runtimeForEval[n] = (React as any)[n];
              }
            }
            const nsMatch = spec.match(/\*\s+as\s+(\w+)/);
            if (nsMatch) {
              runtimeForEval[nsMatch[1]] = React;
            }
            if (!namedMatch && !nsMatch && spec) {
              runtimeForEval[spec] = React;
            }
          }
        }

        // rehype plugin: add data-source-line attributes from node.position
        const rehypeAddSourceLine = () => (tree: any) => {
          function walk(node: any) {
            if (!node || typeof node !== "object") return;
            if (node.type === "element" || node.type === "root") {
              if (node.position && node.position.start && node.type === "element") {
                node.properties = node.properties || {};
                // use data-source-line to map back to editor lines
                node.properties["data-source-line"] = node.position.start.line;
              }
              if (node.children && Array.isArray(node.children)) {
                for (const c of node.children) walk(c);
              }
            }
          }
          walk(tree);
        };

        const { default: Comp } = await mdx.evaluate(cleaned, {
          ...runtimeForEval,
          useDynamicImport: false,
          baseUrl: import.meta.url,
          rehypePlugins: [rehypeAddSourceLine],
        });
        if (!cancelled) setComponent(() => Comp);
      } catch (e) {
        setComponent(() => () => <pre style={{ color: 'red' }}>{String(e)}</pre>);
      }
    });
    return () => { cancelled = true; };
  }, [code]);
  return Component;
}

function App() {
  const initial = extractStyles(rawInitialMDX);
  const [css, setCss] = useState(initial.css);
  const [mdx, setMdx] = useState(initial.content);
  const [raw, setRaw] = useState(rawInitialMDX);
  const Comp = useMDXComponent(mdx);

  const editorRef = useRef<any>(null);
  const previewRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [anchors, setAnchors] = useState<number[]>([]);
  const anchorsRef = useRef<number[]>([]);
  const syncingEditorToPreview = useRef(false);
  const syncingPreviewToEditor = useRef(false);
  const editorListenersAttached = useRef(false);

  const attachEditorListeners = (editor: any) => {
    if (!editor || editorListenersAttached.current) return;
    if (typeof editor.onDidScrollChange === 'function') {
      editor.onDidScrollChange(() => onEditorScroll());
    }
    const dom = editor.getDomNode?.();
    if (dom && dom.addEventListener) {
      dom.addEventListener('scroll', onEditorScroll, { passive: true });
      editor.onDidDispose?.(() => dom.removeEventListener('scroll', onEditorScroll));
    }
    // polling fallback: some embed environments don't emit events reliably
    try {
      let lastTop: number | null = null;
      const poll = () => {
        try {
          const st = typeof editor.getScrollTop === 'function' ? editor.getScrollTop() : null;
          if (st !== null && lastTop !== st) {
            lastTop = st;
            onEditorScroll();
          }
        } catch (e) { }
        (attachEditorListeners as any)._pollId = window.setTimeout(poll, 120);
      };
      (attachEditorListeners as any)._pollId = window.setTimeout(poll, 120);
      editor.onDidDispose?.(() => {
        try { const id = (attachEditorListeners as any)._pollId; if (id) clearTimeout(id); } catch { }
      });
    } catch (e) { }

    editorListenersAttached.current = true;
  };

  const lineCount = raw ? raw.split("\n").length : 0;

  const recomputeAnchors = () => {
    const contentEl = contentRef.current;
    const previewEl = previewRef.current;
    if (!contentEl || !previewEl || lineCount === 0) {
      setAnchors([]);
      return;
    }
    // Try to build accurate anchors from rendered elements that have
    // been annotated with `data-source-line` by the rehype plugin.
    const nodes = contentEl.querySelectorAll('[data-source-line]');
    const firstOffsetForLine: Map<number, number> = new Map();
    nodes.forEach((n) => {
      const el = n as HTMLElement;
      const v = el.getAttribute('data-source-line');
      if (!v) return;
      const line = Number(v);
      if (!firstOffsetForLine.has(line)) {
        firstOffsetForLine.set(line, el.offsetTop);
      }
    });

    // recomputeAnchors: nodes and mapped lines are available in the maps above

    const newAnchors: number[] = [];
    let lastKnown = 0;
    for (let i = 1; i <= lineCount; i++) {
      const top = firstOffsetForLine.get(i);
      if (typeof top === 'number') {
        newAnchors.push(top);
        lastKnown = top;
      } else {
        // fallback: use last known anchor or 0
        newAnchors.push(lastKnown);
      }
    }
    // update ref first so listeners see anchors immediately
    anchorsRef.current = newAnchors;
    setAnchors(newAnchors);
  };

  useEffect(() => {
    const id = setTimeout(recomputeAnchors, 120);
    window.addEventListener("resize", recomputeAnchors);
    return () => { clearTimeout(id); window.removeEventListener("resize", recomputeAnchors); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raw, mdx]);

  // observe content mutations to recompute anchors when rendered DOM changes
  useEffect(() => {
    const contentEl = contentRef.current;
    if (!contentEl) return;
    const obs = new MutationObserver(() => {
      setTimeout(recomputeAnchors, 30);
    });
    obs.observe(contentEl, { childList: true, subtree: true });
    return () => obs.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentRef.current]);

  const onEditorScroll = () => {
    const editor = editorRef.current;
    const previewEl = previewRef.current;
    if (!editor) return;
    if (!previewEl) return;
    if (anchorsRef.current.length === 0) return;
    if (syncingPreviewToEditor.current) return;
    let startLine = 1;
    try {
      const ranges = (editor as any).getVisibleRanges?.();
      if (ranges && ranges.length > 0 && ranges[0].startLineNumber) {
        startLine = ranges[0].startLineNumber;
      } else if (typeof (editor as any).getScrollTop === 'function' && typeof (editor as any).getTopForLineNumber === 'function') {
        // fallback: compute first visible line from scrollTop
        const scrollTop = (editor as any).getScrollTop();
        const model = (editor as any).getModel?.();
        const totalLines = model ? model.getLineCount() : lineCount;
        // binary search for first line whose top >= scrollTop
        let lo = 1, hi = totalLines, found = 1;
        while (lo <= hi) {
          const mid = Math.floor((lo + hi) / 2);
          const top = (editor as any).getTopForLineNumber(mid);
          if (top < scrollTop) {
            lo = mid + 1;
          } else {
            found = mid;
            hi = mid - 1;
          }
        }
        startLine = found;
      }
    } catch (e) {
      // if anything goes wrong, keep startLine=1
    }
    const idx = Math.max(0, Math.min(lineCount - 1, startLine - 1));
    const top = anchorsRef.current[idx] ?? 0;
    // mark that the following scroll is originated from editor
    syncingEditorToPreview.current = true;
    previewEl.scrollTo({ top, behavior: "auto" });
    // clear flag after short debounce to allow reciprocal events
    window.clearTimeout((syncingEditorToPreview as any).timer);
    (syncingEditorToPreview as any).timer = window.setTimeout(() => { syncingEditorToPreview.current = false; }, 250);
  };

  const onPreviewScroll = () => {
    const editor = editorRef.current;
    const previewEl = previewRef.current;
    if (!editor || !previewEl || anchorsRef.current.length === 0) return;
    if (syncingEditorToPreview.current) return; // ignore when editor initiated
    const st = previewEl.scrollTop;
    let idx = anchorsRef.current.findIndex((a) => a >= st);
    if (idx === -1) idx = anchorsRef.current.length - 1;
    const line = Math.max(1, Math.min(lineCount, idx + 1));
    // mark that editor reveal is triggered by preview
    syncingPreviewToEditor.current = true;
    (editor as any).revealLineNearTop?.(line);
    window.clearTimeout((syncingPreviewToEditor as any).timer);
    (syncingPreviewToEditor as any).timer = window.setTimeout(() => { syncingPreviewToEditor.current = false; }, 250);
  };

  return (
    <main className="mdx-main">
      <div className="mdx-editor-pane">
        <MonacoEditor
          height="80vh"
          defaultLanguage="markdown"
          value={raw /* show raw editor content including <style> */}
          onChange={(value) => {
            const v = value ?? "";
            setRaw(v);
            const { css: newCss, content } = extractStyles(v);
            setCss(newCss);
            setMdx(content);
            setTimeout(recomputeAnchors, 120);
          }}
          options={{ minimap: { enabled: false } }}
          onMount={(editor) => {
            editorRef.current = editor;
            attachEditorListeners(editor);
          }}
        />
      </div>
      <div className="mdx-preview-pane" ref={previewRef} onScroll={() => onPreviewScroll()}>
        <div className="mdx-preview-html">
          {/* ユーザー定義CSSをプレビュー領域に挿入 */}
          {css ? <style>{css}</style> : null}
          <div style={{ position: "relative" }}>
            <div ref={contentRef}>
              <MDXProvider>
                <ErrorBoundary resetKey={mdx}>
                  <Comp />
                </ErrorBoundary>
              </MDXProvider>
            </div>
            <div style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, pointerEvents: "none" }}>
              {anchors.map((top, i) => (
                <div key={i} data-line={i + 1} style={{ position: "absolute", top: top + "px", height: 1 }} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

export default App;
