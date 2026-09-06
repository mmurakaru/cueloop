const { useState, useRef, useEffect, useCallback } = React;

/* ---------------------------------------------------------------- icons */
function Icon({ name, size = 15 }) {
  const s = { width: size, height: size, fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round" };
  const paths = {
    gear: <><circle cx="8" cy="8" r="2.2" /><path d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M12.6 3.4l-1.1 1.1M4.5 11.5l-1.1 1.1" /></>,
    sidebarLeft: <><rect x="1.6" y="2.4" width="12.8" height="11.2" rx="1.4" /><path d="M6 2.4v11.2" /><rect x="2.8" y="4" width="1.8" height="1.4" fill="currentColor" stroke="none" /></>,
    sidebarRight: <><rect x="1.6" y="2.4" width="12.8" height="11.2" rx="1.4" /><path d="M10 2.4v11.2" /></>,
    folder: <path d="M1.8 4.2c0-.6.4-1 1-1h3l1.2 1.3h5.2c.6 0 1 .4 1 1v6c0 .6-.4 1-1 1H2.8c-.6 0-1-.4-1-1z" />,
    folderOpen: <path d="M2 4.2c0-.6.4-1 1-1h3l1.2 1.3h5c.6 0 1 .4 1 1M1.6 6.4h12.8l-1.4 6c-.1.4-.4.6-.8.6H3c-.5 0-.8-.4-.8-.9z" />,
    file: <><path d="M4 1.8h5l3 3v9.4H4z" /><path d="M9 1.8v3h3" /></>,
    chevron: <path d="M6 4l4 4-4 4" />,
    close: <path d="M4 4l8 8M12 4l-8 8" />,
    plusminus: null,
    tree: <><path d="M3 3.5h10M6 8h7M6 12.5h7" /><path d="M3 3.5v9M3 8h3M3 12.5" /></>,
    zoom: <><path d="M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4" /></>,
    split: <><rect x="1.8" y="2.4" width="12.4" height="11.2" rx="1.2" /><path d="M8 2.4v11.2" /></>,
    search: <><circle cx="7" cy="7" r="4" /><path d="M10 10l3 3" /></>,
    comment: <path d="M2 3.5h12v7H6l-3 2.5v-2.5H2z" />,
    dots: <><circle cx="3.5" cy="8" r="1" fill="currentColor" stroke="none"/><circle cx="8" cy="8" r="1" fill="currentColor" stroke="none"/><circle cx="12.5" cy="8" r="1" fill="currentColor" stroke="none"/></>,
    flag: <path d="M3.5 2v12M3.5 2.5h8l-1.5 2.5 1.5 2.5h-8" />,
  };
  if (name === "plusminus") return <span style={{ fontSize: size, lineHeight: 1 }}>±</span>;
  return <svg viewBox="0 0 16 16" style={s}>{paths[name]}</svg>;
}
function Tip({ label, children }) {
  return <span className="tt">{children}<span className="tt-body">{label}</span></span>;
}
function IconBtn({ icon, tip, active, onClick, children }) {
  const btn = <span className={"iconbtn" + (active ? " active" : "")} onClick={onClick}>{children || <Icon name={icon} />}</span>;
  return tip ? <Tip label={tip}>{btn}</Tip> : btn;
}

/* ------------------------------------------------------------- fixtures */
const PROJECT_TREE = {
  name: "cueloop", type: "dir", children: [
    { name: ".changeset", type: "dir", children: [] },
    { name: ".claude-plugin", type: "dir", children: [
      { name: "marketplace.json", type: "file" }, { name: "plugin.json", type: "file" } ] },
    { name: ".github", type: "dir", children: [] },
    { name: "assets", type: "dir", children: [ { name: "cueloop-logo.svg", type: "file" } ] },
    { name: "examples", type: "dir", children: [] },
    { name: "Formula", type: "dir", children: [ { name: "cueloop.rb", type: "file" } ] },
    { name: "hooks", type: "dir", children: [ { name: "hooks.json", type: "file" } ] },
    { name: "packages", type: "dir", children: [] },
    { name: "scripts", type: "dir", children: [
      { name: "check-publish-integrity.ts", type: "file" }, { name: "rewrite-internal-deps.ts", type: "file" },
      { name: "sync-dist-tags.ts", type: "file" }, { name: "update-formula.ts", type: "file" } ] },
    { name: "site", type: "dir", children: [] },
    { name: "skills", type: "dir", children: [] },
    { name: "snapshots", type: "dir", children: [] },
    { name: "test", type: "dir", children: [
      { name: "cli", type: "dir", children: [] }, { name: "helpers", type: "dir", children: [] },
      { name: "preload.ts", type: "file" } ] },
    { name: ".gitignore", type: "file" }, { name: ".oxfmtrc.json", type: "file" },
    { name: "AGENTS.md", type: "file" }, { name: "bun.lock", type: "file" },
    { name: "package.json", type: "file" }, { name: "README.md", type: "file" },
    { name: "tsconfig.json", type: "file" } ]
};
const CHANGED_FILES = ["packages/client/src/App.tsx", "packages/client/src/components/AppShell.tsx"];
const FILE_TEXT = {
  "plugin.json": `{\n  "name": "cueloop",\n  "description": "Review surface for coding agents: plan gate, reply review, diff review, PR review, prototype review",\n  "version": "0.1.0-alpha.62",\n  "author": {\n    "name": "cueloop"\n  }\n}`,
  "cueloop-logo.svg": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">\n  <mask id="outer-mask">\n    <rect width="32" height="32" fill="#fff"/>\n    <path d="M 24.10 16.17 C 23.38 18.90, 20.52 22.17, 18.04 23.20"/>\n  </mask>\n  <circle cx="16" cy="16" r="12" fill="#9a9ca6"/>\n</svg>`,
  "__aggregate__": `diff --git a/packages/client/src/App.tsx\n@@ -47,8 +47,9 @@\n-import { ThreadsSidebar } from "./components/ThreadsSidebar";\n+import { InboxList } from "./components/InboxList";\n+import { AppShell } from "./components/AppShell";\n\ndiff --git a/packages/client/src/components/AppShell.tsx\n@@ -1,4 +1,6 @@\n+// The one app shell: four full-height panes.\n export function AppShell() {\n-  return null;\n+  return <Grid />;\n }`,
};
function fileText(label) {
  if (label === "Changes") return FILE_TEXT.__aggregate__;
  return FILE_TEXT[label] || `// ${label}\n// (prototype: file contents would render here)\nexport const placeholder = true;\n`;
}

/* --------------------------------------------------------- pane tree ops
   Model borrowed from VSCode's editor grid (src/vs/base/browser/ui/grid):
   - the Changes panel is a GRID of GridNodes: a LEAF is an EDITOR GROUP (a tab
     strip + one active editor), a BRANCH holds child nodes along an ORIENTATION.
   - "Split Left/Right/Up/Down" is a DIRECTION; Left/Right => horizontal branch
     (row), Up/Down => vertical branch (column). New group takes even space
     (Sizing.Distribute). The focused group is the ACTIVE GROUP.
   The TUI port should reuse these names: EditorGroup, GridNode, Orientation,
   Direction, activeGroup, Sizing.Distribute. */
let uid = 1;
const nid = () => "n" + uid++;
function leaf(tabs) { return { id: nid(), type: "leaf", tabs, active: tabs[0]?.id ?? null }; }
function mapLeaf(node, id, fn) {
  if (node.type === "leaf") return node.id === id ? fn(node) : node;
  return { ...node, children: node.children.map((c) => mapLeaf(c, id, fn)) };
}
function firstLeafId(node) { return node.type === "leaf" ? node.id : firstLeafId(node.children[0]); }
function pruneEmpty(node) {
  if (node.type === "leaf") return node.tabs.length ? node : null;
  const kids = node.children.map(pruneEmpty).filter(Boolean);
  if (kids.length === 0) return null;
  if (kids.length === 1) return kids[0];
  return { ...node, children: kids };
}

/* ------------------------------------------------------------- comments */
function LineComments({ list }) {
  return list.map((c, i) => (
    <div key={i} className="ml-6 my-1 px-2 py-1 rounded" style={{ background: "var(--elevated)", border: "1px solid var(--border)", borderLeft: "2px solid var(--accent)" }}>
      <span style={{ color: "var(--accent)" }}>◆ </span>{c}
    </div>
  ));
}
function CodeView({ label, comments, onComment }) {
  const [draft, setDraft] = useState(null); // line index
  const [text, setText] = useState("");
  const lines = fileText(label).split("\n");
  const isDiff = label === "Changes";
  return (
    <div className="overflow-auto h-full py-2 text-[12.5px] leading-5">
      {lines.map((ln, i) => {
        const sign = isDiff && ln[0] === "+" ? "add" : isDiff && ln[0] === "-" ? "del" : null;
        const bg = sign === "add" ? "rgba(127,224,200,.08)" : sign === "del" ? "rgba(255,120,120,.08)" : "transparent";
        return (
          <div key={i}>
            <div className="flex px-2 hover:bg-[#171b26] cursor-text group" style={{ background: bg }}
                 onClick={() => { setDraft(i); setText(""); }}>
              <span className="w-8 text-right pr-3 select-none" style={{ color: "var(--dim)" }}>{i + 1}</span>
              <span className="whitespace-pre" style={{ color: sign === "add" ? "var(--green)" : sign === "del" ? "#ff9c9c" : "var(--text)" }}>{ln || " "}</span>
              <span className="ml-auto opacity-0 group-hover:opacity-100 pl-2" style={{ color: "var(--dim)" }}><Icon name="comment" size={13} /></span>
            </div>
            {comments[i]?.length ? <LineComments list={comments[i]} /> : null}
            {draft === i ? (
              <div className="ml-8 my-1 px-2 py-1 rounded" style={{ background: "var(--elevated)", border: "1px solid var(--accent)" }}>
                <input autoFocus value={text} onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && text.trim()) { onComment(i, text.trim()); setDraft(null); } if (e.key === "Escape") setDraft(null); }}
                  placeholder={`comment on line ${i + 1}...`} className="bg-transparent outline-none w-full" style={{ color: "var(--text)" }} />
                <div className="text-[11px] mt-1" style={{ color: "var(--dim)" }}>enter to save · esc to cancel</div>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/* --------------------------------------------------------------- panels */
function PanelHeader({ children, right }) {
  return (
    <div className="flex items-center h-9 px-2 accent-underline shrink-0" style={{ background: "var(--panel)" }}>
      {children}<div className="flex-1" />{right}
    </div>
  );
}

function ThreadsPanel({ onGear, onToggle }) {
  return (
    <div className="w-56 shrink-0 rule-r flex flex-col" style={{ background: "var(--bg)" }}>
      <PanelHeader>
        <IconBtn icon="gear" tip="Settings" onClick={onGear} />
        <IconBtn icon="sidebarLeft" tip="Toggle Threads" onClick={onToggle} />
        <span className="ml-2" style={{ color: "var(--accent)" }}>cueloop</span>
      </PanelHeader>
      <div className="p-2 overflow-auto">
        <div style={{ color: "var(--dim)" }}>Pinned</div>
        <div className="flex items-center gap-1 mt-1"><Icon name="flag" size={12} /><span style={{ color: "var(--accent)" }}>Read Cueloop Repository</span></div>
        <div className="mt-3" style={{ color: "var(--dim)" }}>Threads</div>
        <div className="flex items-center gap-1 mt-1 pl-3"><span style={{ color: "var(--muted)" }}>A standalone thought</span></div>
      </div>
    </div>
  );
}

function Bubble({ who, text, mark }) {
  return (
    <div className="flex gap-2 my-1">
      <div className="w-4 h-4 rounded-full mt-0.5 shrink-0" style={{ background: "#39415a" }} />
      <div style={{ background: mark ? "var(--mark)" : "transparent", color: mark ? "var(--text)" : "var(--muted)" }} className="px-1 rounded">{text}</div>
    </div>
  );
}
// The thread header owns the thread only - title + owner actions. Right-region toggles never live here.
function ThreadPanel({ collapsedLeftToggle, onOpenLeft }) {
  return (
    <div className="flex-1 min-w-0 flex flex-col rule-r" style={{ background: "var(--bg)" }}>
      <PanelHeader
        right={<><span className="mr-3" style={{ color: "var(--dim)" }}>Edit</span><span style={{ color: "var(--dim)" }}>Share</span></>}>
        {collapsedLeftToggle ? <IconBtn icon="sidebarLeft" tip="Toggle Threads" onClick={onOpenLeft} /> : null}
        <span className={collapsedLeftToggle ? "ml-2" : ""} style={{ color: "var(--muted)" }}>Read Cueloop Repository</span>
      </PanelHeader>
      <div className="flex-1 overflow-auto px-3 py-2">
        <div style={{ color: "var(--dim)" }}>1 comment ›</div>
        <div className="my-1">hello world</div>
        <div className="border rounded p-2 my-2" style={{ borderColor: "var(--border)" }}>
          <Bubble text="you're thinking?" /><Bubble text="wow" /><Bubble text="d" /><Bubble text="m" />
        </div>
        <div className="border rounded p-2 my-2" style={{ borderColor: "var(--border)" }}>
          <div style={{ color: "var(--muted)" }}>markdown.test.ts</div>
          <div className="my-1"><span style={{ color: "var(--dim)" }}>15 </span><span style={{ color: "var(--accent)" }}>const x = 1;</span></div>
          <Bubble text="hello world" />
        </div>
        <div className="my-2" style={{ color: "var(--muted)" }}>↩ Hello! I see <span style={{ background: "var(--mark)" }}>your comment on line 15</span> - it's working.</div>
        <Bubble mark text="this is cool" />
        <div className="h-40" />
      </div>
      <div className="h-9 flex items-center px-3 rule-t shrink-0" style={{ background: "var(--panel)" }}>
        <Icon name="folder" size={13} /><span className="ml-1" style={{ color: "var(--muted)" }}>cueloop</span><span style={{ color: "var(--dim)" }}>&nbsp;/ main</span>
        <div className="flex-1" /><span style={{ color: "var(--accent)" }}>send message</span>
      </div>
    </div>
  );
}

/* project file tree ------------------------------------------------------ */
function TreeNode({ node, path, depth, expanded, toggle, onOpenFile, changedOnly }) {
  const full = path ? path + "/" + node.name : node.name;
  if (node.type === "file") {
    return (
      <div className="flex items-center gap-1 py-0.5 pr-2 hover:bg-[#171b26] cursor-pointer" style={{ paddingLeft: depth * 12 + 8 }}
           onClick={() => onOpenFile(node.name, full)}>
        <Icon name="file" size={12} /><span style={{ color: "var(--muted)" }}>{node.name}</span>
      </div>
    );
  }
  const open = expanded.has(full);
  return (
    <div>
      <div className="flex items-center gap-1 py-0.5 pr-2 hover:bg-[#171b26] cursor-pointer" style={{ paddingLeft: depth * 12 + 8 }}
           onClick={() => toggle(full)}>
        <span style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform .1s", color: "var(--dim)" }}><Icon name="chevron" size={11} /></span>
        <Icon name={open ? "folderOpen" : "folder"} size={13} /><span style={{ color: "var(--text)" }}>{node.name}</span>
      </div>
      {open ? node.children.map((c, i) => (
        <TreeNode key={i} node={c} path={full} depth={depth + 1} expanded={expanded} toggle={toggle} onOpenFile={onOpenFile} changedOnly={changedOnly} />
      )) : null}
    </div>
  );
}
// The collapsed right region: a thin rail on the far right whose only job is to reopen the sidebar.
function CollapsedRightRail({ onToggleRight }) {
  return (
    <div className="shrink-0 rule-l flex flex-col" style={{ width: 34, background: "var(--bg)" }}>
      <div className="flex items-center justify-center h-9 accent-underline" style={{ background: "var(--panel)" }}>
        <IconBtn icon="sidebarRight" tip="Toggle Right Sidebar" onClick={onToggleRight} />
      </div>
    </div>
  );
}
// The Project panel is the right sidebar. Its header owns the right-region toggles: the navigator
// mode (changed files / tree), a Changes toggle, and the master sidebar collapse.
function ProjectPanel({ mode, setMode, changesOpen, onToggleChanges, onToggleRight, onOpenFile }) {
  const [expanded, setExpanded] = useState(new Set(["cueloop"]));
  const toggle = (p) => setExpanded((s) => { const n = new Set(s); n.has(p) ? n.delete(p) : n.add(p); return n; });
  return (
    <div className="w-64 shrink-0 rule-l flex flex-col" style={{ background: "var(--bg)" }}>
      <PanelHeader right={<>
        <IconBtn icon="plusminus" tip="Changed files" active={mode === "changes"} onClick={() => setMode("changes")} />
        <IconBtn icon="tree" tip="Project tree" active={mode === "tree"} onClick={() => setMode("tree")} />
        <IconBtn icon="split" tip="Toggle Changes Panel" active={changesOpen} onClick={onToggleChanges} />
        <IconBtn icon="sidebarRight" tip="Toggle Right Sidebar" onClick={onToggleRight} />
      </>} />
      <div className="overflow-auto py-1 flex-1">
        {mode === "tree"
          ? <TreeNode node={PROJECT_TREE} path="" depth={0} expanded={expanded} toggle={toggle} onOpenFile={onOpenFile} />
          : (CHANGED_FILES.length
              ? CHANGED_FILES.map((f, i) => (
                  <div key={i} className="flex items-center gap-1 py-0.5 px-2 hover:bg-[#171b26] cursor-pointer" onClick={() => onOpenFile(f.split("/").pop(), f)}>
                    <Icon name="file" size={12} /><span style={{ color: "var(--muted)" }}>{f}</span>
                  </div>))
              : <div className="px-3 py-2" style={{ color: "var(--dim)" }}>No changes</div>)}
      </div>
    </div>
  );
}

/* changes panel: recursive splittable pane tree --------------------------- */
function LeafPane({ node, focused, onFocus, onActivate, onCloseTab, onOpenFileHere, onSplit, comments, addComment }) {
  const [menu, setMenu] = useState(false);
  const active = node.tabs.find((t) => t.id === node.active) || node.tabs[0];
  const isFile = active && active.kind === "file";
  return (
    <div className="flex flex-col min-w-0 min-h-0 flex-1" onMouseDown={() => onFocus(node.id)}
         style={{ outline: focused ? "1px solid var(--accent)" : "none", outlineOffset: "-1px" }}>
      <div className="flex items-stretch h-9 accent-underline shrink-0" style={{ background: "var(--panel)" }}>
        <div className="flex items-stretch overflow-x-auto">
          {node.tabs.map((t) => (
            <div key={t.id} onClick={() => onActivate(node.id, t.id)}
                 className="group flex items-center gap-2 px-3 rule-r cursor-pointer whitespace-nowrap"
                 style={{ background: t.id === active.id ? "var(--bg)" : "transparent", color: t.id === active.id ? "var(--accent)" : "var(--dim)" }}>
              {t.kind === "file" ? <Icon name="file" size={12} /> : null}{t.label}
              <span className="opacity-0 group-hover:opacity-100 iconbtn" style={{ width: 14, height: 14 }}
                    onClick={(e) => { e.stopPropagation(); onCloseTab(node.id, t.id); }}><Icon name="close" size={11} /></span>
            </div>
          ))}
        </div>
        <div className="flex-1" />
        <div className="flex items-center px-2 gap-1 relative">
          <IconBtn icon="search" tip="Search" />
          <IconBtn icon="comment" tip="Comments" />
          {isFile ? <IconBtn icon="dots" tip="Split Pane" onClick={() => setMenu((m) => !m)} /> : null}
          {menu ? (
            <div className="menu" style={{ top: 30, right: 0 }} onMouseLeave={() => setMenu(false)}>
              {[["Split Left", "left"], ["Split Right", "right"], ["Split Up", "up"], ["Split Down", "down"]].map(([lbl, dir]) => (
                <div key={dir} className="menu-item" onClick={() => { setMenu(false); onSplit(node.id, dir); }}>
                  <span>{lbl}</span><span style={{ color: "var(--dim)" }}>⌘⇧K</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>
      <div className="px-3 py-1 text-[12px] rule-b shrink-0" style={{ color: "var(--dim)" }}>
        {active ? (active.kind === "file" ? active.path : "Since Last Turn ⌄") : ""}
      </div>
      <div className="flex-1 min-h-0">
        {active ? <CodeView label={active.label} comments={comments[active.id] || {}} onComment={(line, txt) => addComment(active.id, line, txt)} />
          : <div className="h-full flex items-center justify-center" style={{ color: "var(--dim)" }}>No changes</div>}
      </div>
    </div>
  );
}
function PaneNode(props) {
  const { node } = props;
  if (node.type === "leaf") return <LeafPane {...props} focused={props.focusedLeaf === node.id} />;
  return (
    <div className="flex min-w-0 min-h-0 flex-1" style={{ flexDirection: node.dir === "row" ? "row" : "column" }}>
      {node.children.map((c, i) => (
        <React.Fragment key={c.id}>
          {i > 0 ? <div className={node.dir === "row" ? "rule-l" : "rule-t"} /> : null}
          <PaneNode {...props} node={c} />
        </React.Fragment>
      ))}
    </div>
  );
}
function ChangesPanel({ tree, setTree, focusedLeaf, setFocusedLeaf, onToggle, onZoom, zoomed, comments, setComments }) {
  const activate = (lid, tid) => setTree((t) => mapLeaf(t, lid, (l) => ({ ...l, active: tid })));
  const closeTab = (lid, tid) => setTree((t) => pruneEmpty(mapLeaf(t, lid, (l) => {
    const tabs = l.tabs.filter((x) => x.id !== tid);
    return { ...l, tabs, active: l.active === tid ? tabs[0]?.id ?? null : l.active };
  })) || leaf([{ id: nid(), kind: "changes", label: "Changes" }]));
  const split = (lid, dir) => setTree((t) => mapLeaf(t, lid, (l) => {
    const act = l.tabs.find((x) => x.id === l.active) || l.tabs[0];
    const moved = { ...act, id: nid() };
    const newLeaf = leaf([moved]);
    const keep = { ...l, tabs: l.tabs, active: l.active };
    const row = dir === "left" || dir === "right";
    const children = dir === "left" || dir === "up" ? [newLeaf, keep] : [keep, newLeaf];
    setFocusedLeaf(newLeaf.id);
    return { id: nid(), type: "split", dir: row ? "row" : "col", children };
  }));
  return (
    <div className="flex-1 min-w-0 flex flex-col rule-r" style={{ background: "var(--bg)" }}>
      {/* top strip: zoom + right-sidebar toggle live at the very top-right of the pane region */}
      <div className="flex-1 min-h-0 flex flex-col relative">
        <div className="absolute right-2 top-1.5 z-10 flex gap-1">
          <IconBtn icon="zoom" tip={zoomed ? "Restore" : "Zoom In"} active={zoomed} onClick={onZoom} />
          <IconBtn icon="split" tip="Toggle Changes Panel" onClick={onToggle} />
        </div>
        <PaneNode node={tree} focusedLeaf={focusedLeaf} onFocus={setFocusedLeaf}
          onActivate={activate} onCloseTab={closeTab} onSplit={split}
          comments={comments} addComment={(tid, line, txt) => setComments((c) => {
            const f = { ...(c[tid] || {}) }; f[line] = [...(f[line] || []), txt]; return { ...c, [tid]: f };
          })} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------- app */
// deep-link panel state so a layout is shareable: ?threads=1&changes=1&project=1&mode=tree&zoom=1
const Q = new URLSearchParams(location.search);
const qbool = (k, d) => (Q.has(k) ? Q.get(k) !== "0" : d);
function App() {
  const [threadsOpen, setThreadsOpen] = useState(qbool("threads", true));
  // the right sidebar IS the Project panel; Changes rides on top of it and never stands alone
  const [projectOpen, setProjectOpen] = useState(qbool("project", false) || qbool("changes", false));
  const [changesOpen, setChangesOpen] = useState(qbool("changes", false));
  const [projectMode, setProjectMode] = useState(Q.get("mode") || "tree");
  const [zoomed, setZoomed] = useState(qbool("zoom", false));
  const [tree, setTree] = useState(() => leaf([{ id: nid(), kind: "changes", label: "Changes" }]));
  const [focusedLeaf, setFocusedLeaf] = useState(null);
  const [comments, setComments] = useState({});
  const rememberedChanges = useRef(qbool("changes", false));

  useEffect(() => { if (!focusedLeaf) setFocusedLeaf(firstLeafId(tree)); }, [tree, focusedLeaf]);

  // Toggling the right sidebar opens/closes the whole right region: Project always shows when on,
  // and Changes is restored to whatever it was. Turning it off closes Changes too.
  const toggleRight = () => {
    if (projectOpen) { rememberedChanges.current = changesOpen; setChangesOpen(false); setProjectOpen(false); }
    else { setProjectOpen(true); setChangesOpen(rememberedChanges.current); }
  };
  // Changes cannot stand alone: opening it forces Project open; closing it leaves Project up.
  const toggleChanges = () => {
    if (changesOpen) setChangesOpen(false);
    else { setChangesOpen(true); setProjectOpen(true); }
  };
  const openFileTab = (label, path) => {
    setProjectOpen(true);
    setChangesOpen(true);
    setTree((t) => {
      const target = focusedLeaf || firstLeafId(t);
      return mapLeaf(t, target, (l) => {
        const tab = { id: nid(), kind: "file", label, path };
        return { ...l, tabs: [...l.tabs, tab], active: tab.id };
      });
    });
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 min-h-0 flex">
        {threadsOpen ? <ThreadsPanel onGear={() => {}} onToggle={() => setThreadsOpen(false)} /> : null}
        {!zoomed ? <ThreadPanel collapsedLeftToggle={!threadsOpen} onOpenLeft={() => setThreadsOpen(true)} /> : null}
        {changesOpen ? (
          <ChangesPanel tree={tree} setTree={setTree} focusedLeaf={focusedLeaf} setFocusedLeaf={setFocusedLeaf}
            onToggle={toggleChanges} onZoom={() => setZoomed((z) => !z)} zoomed={zoomed}
            comments={comments} setComments={setComments} />
        ) : null}
        {projectOpen ? (
          <ProjectPanel mode={projectMode} setMode={setProjectMode} changesOpen={changesOpen}
            onToggleChanges={toggleChanges} onToggleRight={toggleRight} onOpenFile={openFileTab} />
        ) : (
          <CollapsedRightRail onToggleRight={toggleRight} />
        )}
      </div>
    </div>
  );
}
ReactDOM.createRoot(document.getElementById("root")).render(<App />);
