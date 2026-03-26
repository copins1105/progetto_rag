// src/pages/AdminPanel.jsx
import { useState, useEffect, useRef, useCallback } from "react";
import { useIngestion } from "../context/IngestionContext";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

const API = "http://127.0.0.1:8080";
const WS  = "ws://127.0.0.1:8080";

// ─────────────────────────────────────────────
// STILI INLINE — usano le CSS var di App.css
// ─────────────────────────────────────────────
const s = {
  // Layout
  root: {
    display: "flex", flexDirection: "column", height: "100%",
    background: "var(--bg)", color: "var(--text)",
    fontFamily: "'DM Sans', sans-serif", overflow: "hidden",
  },
  body: { display: "flex", flex: 1, overflow: "hidden", minHeight: 0 },

  // Sidebar
  sidebar: {
    width: "260px", flexShrink: 0, display: "flex", flexDirection: "column",
    background: "var(--surface)", borderRight: "1px solid var(--border)",
    overflow: "hidden", height: "100%",
  },
  sidebarHeader: {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "16px 16px 12px",
    borderBottom: "1px solid var(--border)",
    flexShrink: 0,
  },
  sidebarTitle: { fontSize: "0.88rem", fontWeight: 600, color: "var(--text)" },
  sidebarCount: { fontSize: "0.72rem", color: "var(--text-muted)", marginTop: 2 },
  iconBtn: {
    background: "none", border: "none", cursor: "pointer",
    color: "var(--text-muted)", padding: "4px", borderRadius: "6px",
    display: "flex", alignItems: "center", transition: "color 0.15s",
  },
  pdfList: { flex: 1, overflowY: "auto", padding: "8px", minHeight: 0 },
  pdfItem: (selected) => ({
    width: "100%", textAlign: "left", background: selected ? "rgba(79,142,247,0.1)" : "none",
    border: selected ? "1px solid rgba(79,142,247,0.3)" : "1px solid transparent",
    borderRadius: "8px", padding: "10px 12px", cursor: "pointer",
    marginBottom: "2px", transition: "all 0.15s",
  }),
  pdfName: (selected) => ({
    fontSize: "0.8rem", fontWeight: 500, color: selected ? "var(--accent)" : "var(--text)",
    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", display: "block",
  }),
  pdfSize: { fontSize: "0.7rem", color: "var(--text-muted)", marginTop: 2 },
  pdfRow: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 },

  // Upload zone
  uploadZone: (dragging) => ({
    margin: "12px", padding: "12px", borderRadius: "10px",
    border: `2px dashed ${dragging ? "var(--accent)" : "var(--border-strong)"}`,
    background: dragging ? "var(--accent-dim)" : "var(--surface2)",
    cursor: "pointer", display: "flex", flexDirection: "column",
    alignItems: "center", gap: 6, transition: "all 0.2s",
    flexShrink: 0,
  }),
  uploadText: { fontSize: "0.75rem", color: "var(--text-muted)", textAlign: "center", lineHeight: 1.5 },

  // Viewer
  viewer: {
    flex: 1, display: "flex", flexDirection: "column",
    background: "var(--bg)", borderRight: "1px solid var(--border)", overflow: "hidden",
  },
  viewerToolbar: {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "8px 16px", background: "var(--surface)", borderBottom: "1px solid var(--border)",
    flexShrink: 0,
  },
  viewerFilename: {
    fontSize: "0.75rem", color: "var(--text-muted)", fontFamily: "'DM Mono', monospace",
    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 200,
  },
  viewerControls: { display: "flex", alignItems: "center", gap: 16 },
  viewerBtn: {
    background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)",
    padding: "4px 6px", borderRadius: "4px", fontSize: "0.9rem", transition: "color 0.15s",
  },
  viewerPageNum: { fontSize: "0.72rem", color: "var(--text-muted)", fontFamily: "'DM Mono', monospace" },
  viewerZoom: { fontSize: "0.72rem", color: "var(--text-muted)", fontFamily: "'DM Mono', monospace", minWidth: 36, textAlign: "center" },
  viewerContent: { flex: 1, overflowY: "auto", display: "flex", justifyContent: "center", padding: "24px 16px" },
  viewerEmpty: {
    display: "flex", flexDirection: "column", alignItems: "center",
    justifyContent: "center", height: "100%", color: "var(--text-muted)", gap: 12,
  },

  // Right panel
  right: {
    width: "400px", flexShrink: 0, display: "flex", flexDirection: "column",
    background: "var(--surface)", overflow: "hidden",
  },
  rightHeader: {
    padding: "16px", borderBottom: "1px solid var(--border)", flexShrink: 0,
  },
  rightFilename: {
    fontSize: "0.82rem", fontWeight: 600, color: "var(--text)",
    wordBreak: "break-all", lineHeight: 1.4, marginBottom: 4,
  },
  rightSize: { fontSize: "0.7rem", color: "var(--text-muted)" },
  rightBody: { flex: 1, overflowY: "auto", padding: "16px" },
  rightEmpty: {
    display: "flex", flexDirection: "column", alignItems: "center",
    justifyContent: "center", height: "100%", color: "var(--text-muted)", gap: 8, padding: 24,
  },

  // Tabs
  tabs: { display: "flex", borderBottom: "1px solid var(--border)", padding: "0 16px", flexShrink: 0 },
  tab: (active) => ({
    fontSize: "0.78rem", fontWeight: 500, padding: "10px 0", marginRight: 20,
    background: "none", border: "none", cursor: "pointer",
    color: active ? "var(--accent)" : "var(--text-muted)",
    borderBottom: active ? "2px solid var(--accent)" : "2px solid transparent",
    transition: "all 0.15s",
  }),



  // Ingestion
  ingestBtn: {
    width: "100%", padding: "10px", background: "var(--accent)", color: "white",
    border: "none", borderRadius: "8px", cursor: "pointer", fontSize: "0.85rem",
    fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center",
    gap: 8, transition: "opacity 0.2s", marginBottom: 12,
  },
  successBanner: {
    background: "rgba(52,211,153,0.1)", border: "1px solid rgba(52,211,153,0.25)",
    borderRadius: "8px", padding: "10px 14px", fontSize: "0.82rem",
    color: "#34d399", display: "flex", alignItems: "center", gap: 8, marginBottom: 12,
  },
  errorBanner: {
    background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.25)",
    borderRadius: "8px", padding: "10px 14px", fontSize: "0.82rem",
    color: "#f87171", display: "flex", alignItems: "center", gap: 8, marginBottom: 12,
  },
  logBox: {
    background: "var(--bg)", border: "1px solid var(--border)",
    borderRadius: "8px", overflow: "hidden",
  },
  logHeader: {
    display: "flex", alignItems: "center", gap: 8,
    padding: "6px 12px", background: "var(--surface2)",
    borderBottom: "1px solid var(--border)",
    fontSize: "0.7rem", fontFamily: "'DM Mono', monospace", color: "var(--text-muted)",
  },
  logDot: (active) => ({
    width: 7, height: 7, borderRadius: "50%",
    background: active ? "#f59e0b" : "var(--text-muted)",
    animation: active ? "pulse-dot 2s infinite" : "none",
  }),
  logContent: { height: 200, overflowY: "auto", padding: "10px 12px" },
  logLine: { fontSize: "0.7rem", fontFamily: "'DM Mono', monospace", color: "var(--text-dim)", lineHeight: 1.8 },

  // Chunks
  chunkStats: {
    display: "flex", justifyContent: "space-between", alignItems: "center",
    marginBottom: 12, fontSize: "0.75rem", color: "var(--text-muted)",
  },
  chunkItem: {
    background: "var(--surface2)", border: "1px solid var(--border)",
    borderRadius: "8px", overflow: "hidden", marginBottom: 6,
  },
  chunkHeader: {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "8px 12px", cursor: "pointer", background: "none",
    border: "none", width: "100%", textAlign: "left", gap: 8,
  },
  chunkIdx: { fontSize: "0.68rem", fontFamily: "'DM Mono', monospace", color: "var(--accent)", flexShrink: 0 },
  chunkPreview: {
    fontSize: "0.72rem", color: "var(--text-dim)", overflow: "hidden",
    textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1,
  },
  chunkBody: {
    padding: "10px 12px", borderTop: "1px solid var(--border)",
    fontSize: "0.72rem", fontFamily: "'DM Mono', monospace",
    color: "var(--text-dim)", whiteSpace: "pre-wrap", lineHeight: 1.7,
  },
  pagination: {
    display: "flex", justifyContent: "space-between", marginTop: 8,
    paddingTop: 8, borderTop: "1px solid var(--border)",
  },
  pageBtn: {
    background: "none", border: "none", cursor: "pointer",
    fontSize: "0.75rem", color: "var(--text-muted)", transition: "color 0.15s",
  },

  // Loader form
  formGroup: { marginBottom: 12 },
  formLabel: { fontSize: "0.72rem", color: "var(--text-muted)", fontWeight: 600, display: "block", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em" },
  formSelect: {
    width: "100%", padding: "8px 10px", background: "var(--surface2)",
    border: "1px solid var(--border-strong)", borderRadius: "6px",
    color: "var(--text)", fontFamily: "inherit", fontSize: "0.82rem", outline: "none",
  },
  formInput: {
    width: "100%", padding: "8px 10px", background: "var(--surface2)",
    border: "1px solid var(--border-strong)", borderRadius: "6px",
    color: "var(--text)", fontFamily: "inherit", fontSize: "0.82rem", outline: "none",
  },
  loaderBtn: {
    width: "100%", padding: "10px", background: "#10b981", color: "white",
    border: "none", borderRadius: "8px", cursor: "pointer", fontSize: "0.85rem",
    fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center",
    gap: 8, transition: "opacity 0.2s", marginTop: 4,
  },
  warnBanner: {
    background: "rgba(251,191,36,0.1)", border: "1px solid rgba(251,191,36,0.3)",
    borderRadius: "8px", padding: "10px 14px", fontSize: "0.78rem",
    color: "#fbbf24", marginBottom: 12,
  },

  // Sync panel
  syncItem: (stato) => {
    const colors = {
      synced:        { bg: "rgba(52,211,153,0.08)",  border: "rgba(52,211,153,0.2)",  dot: "#34d399" },
      solo_postgres: { bg: "rgba(251,191,36,0.08)",  border: "rgba(251,191,36,0.2)",  dot: "#fbbf24" },
      solo_chroma:   { bg: "rgba(251,191,36,0.08)",  border: "rgba(251,191,36,0.2)",  dot: "#fbbf24" },
      mismatch:      { bg: "rgba(239,68,68,0.08)",   border: "rgba(239,68,68,0.2)",   dot: "#f87171" },
      error:         { bg: "rgba(239,68,68,0.08)",   border: "rgba(239,68,68,0.2)",   dot: "#f87171" },
      pending:       { bg: "rgba(251,191,36,0.08)",  border: "rgba(251,191,36,0.2)",  dot: "#fbbf24" },
      not_found:     { bg: "var(--surface2)",         border: "var(--border)",          dot: "var(--text-muted)" },
    };
    const c = colors[stato] || colors.not_found;
    return { background: c.bg, border: `1px solid ${c.border}`, borderRadius: 8, padding: "10px 12px", marginBottom: 6 };
  },
  syncDot: (stato) => {
    const dots = { synced: "#34d399", solo_postgres: "#fbbf24", solo_chroma: "#fbbf24", mismatch: "#f87171", error: "#f87171", pending: "#fbbf24" };
    return { width: 7, height: 7, borderRadius: "50%", background: dots[stato] || "var(--text-muted)", flexShrink: 0, marginTop: 3 };
  },

  // Dialog conferma delete
  overlay: {
    position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)",
    display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
  },
  dialog: {
    background: "var(--surface)", border: "1px solid var(--border-strong)",
    borderRadius: 14, padding: "28px 28px 24px", width: 360, boxShadow: "0 24px 48px rgba(0,0,0,0.5)",
  },
  dialogTitle: { fontSize: "0.95rem", fontWeight: 600, color: "var(--text)", marginBottom: 8 },
  dialogText:  { fontSize: "0.8rem", color: "var(--text-muted)", lineHeight: 1.6, marginBottom: 20 },
  dialogBtns:  { display: "flex", gap: 8, justifyContent: "flex-end" },
  dialogCancel: {
    padding: "8px 16px", background: "none", border: "1px solid var(--border-strong)",
    borderRadius: 8, color: "var(--text-muted)", cursor: "pointer", fontFamily: "inherit", fontSize: "0.82rem",
  },
  dialogConfirm: {
    padding: "8px 16px", background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.3)",
    borderRadius: 8, color: "#f87171", cursor: "pointer", fontFamily: "inherit", fontSize: "0.82rem", fontWeight: 600,
  },
};

// ─────────────────────────────────────────────
// BADGE
// ─────────────────────────────────────────────
const BADGE_STYLE = {
  completed:    { label: "Completato",     bg: "rgba(52,211,153,0.12)", color: "#34d399", border: "rgba(52,211,153,0.3)" },
  ready:        { label: "Pronto",         bg: "rgba(99,153,34,0.12)",  color: "#7ec850", border: "rgba(99,153,34,0.3)"  },
  processing:   { label: "In corso…",     bg: "rgba(251,191,36,0.12)", color: "#fbbf24", border: "rgba(251,191,36,0.3)" },
  not_ingested: { label: "Da indicizzare", bg: "var(--surface2)",       color: "var(--text-muted)", border: "var(--border-strong)" },
};

const SYNC_LABEL = {
  synced:        "✅ Sincronizzato",
  solo_postgres: "⚠️ Solo PostgreSQL",
  solo_chroma:   "⚠️ Solo ChromaDB",
  mismatch:      "❌ Mismatch",
  error:         "❌ Errore sync",
  pending:       "⏳ In attesa",
  not_found:     "— Non trovato",
};

function Badge({ status }) {
  const b = BADGE_STYLE[status] || BADGE_STYLE.not_ingested;
  return (
    <span style={{
      fontSize: "0.65rem", fontWeight: 600, fontFamily: "'DM Mono', monospace",
      padding: "2px 7px", borderRadius: 20,
      background: b.bg, color: b.color, border: `1px solid ${b.border}`,
      whiteSpace: "nowrap", flexShrink: 0,
    }}>
      {b.label}
    </span>
  );
}

// ─────────────────────────────────────────────
// UPLOAD ZONE
// ─────────────────────────────────────────────
function UploadZone({ onUploaded }) {
  const [dragging, setDragging]   = useState(false);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef();

  const upload = async (file) => {
    if (!file || !file.name.toLowerCase().endsWith(".pdf")) return;
    setUploading(true);
    const fd = new FormData();
    fd.append("file", file);
    try {
      const res  = await fetch(`${API}/api/v1/admin/upload`, { method: "POST", body: fd });
      const data = await res.json();
      onUploaded(data);
    } catch (e) {
      console.error("Upload error:", e);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div
      style={s.uploadZone(dragging)}
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => { e.preventDefault(); setDragging(false); upload(e.dataTransfer.files[0]); }}
    >
      <input ref={inputRef} type="file" accept=".pdf" style={{ display: "none" }}
        onChange={(e) => upload(e.target.files[0])} />
      {uploading ? (
        <span style={s.uploadText}>Caricamento…</span>
      ) : (
        <>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
          </svg>
          <span style={s.uploadText}>Trascina un PDF qui<br/><span style={{ color: "var(--border-strong)" }}>o clicca per scegliere</span></span>
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// SIDEBAR
// ─────────────────────────────────────────────
function Sidebar({ pdfs, selected, onSelect, onUploaded, onRefresh }) {
  return (
    <aside style={s.sidebar}>
      <div style={s.sidebarHeader}>
        <div>
          <div style={s.sidebarTitle}>Knowledge Base</div>
          <div style={s.sidebarCount}>{pdfs.length} document{pdfs.length !== 1 ? "i" : "o"}</div>
        </div>
        <button style={s.iconBtn} onClick={onRefresh} title="Aggiorna">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/>
          </svg>
        </button>
      </div>

      <UploadZone onUploaded={(doc) => { onUploaded(doc); onRefresh(); }} />

      <div style={{ borderTop: "1px solid var(--border)", margin: "0 12px 8px" }} />

      <div style={s.pdfList}>
        {pdfs.length === 0 && (
          <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", textAlign: "center", padding: "24px 12px" }}>
            Nessun documento.<br/>Carica un PDF per iniziare.
          </p>
        )}
        {pdfs.map((pdf) => {
          const sel = selected?.filename === pdf.filename;
          return (
            <button key={pdf.filename} style={s.pdfItem(sel)} onClick={() => onSelect(pdf)}>
              <div style={s.pdfRow}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <span style={s.pdfName(sel)}>{pdf.filename}</span>
                  <div style={s.pdfSize}>{pdf.size_kb} KB</div>
                </div>
                <Badge status={pdf.status} />
              </div>
            </button>
          );
        })}
      </div>
    </aside>
  );
}

// ─────────────────────────────────────────────
// PDF VIEWER
// ─────────────────────────────────────────────
function PdfViewer({ filename }) {
  const [numPages, setNumPages]   = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [scale, setScale]         = useState(1.0);
  const url = `${API}/api/v1/admin/pdf/${encodeURIComponent(filename)}`;

  useEffect(() => { setCurrentPage(1); setNumPages(null); }, [filename]);

  return (
    <div style={s.viewer}>
      {/* Toolbar */}
      <div style={s.viewerToolbar}>
        <span style={s.viewerFilename}>{filename}</span>
        <div style={s.viewerControls}>
          {/* Zoom */}
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <button style={s.viewerBtn} onClick={() => setScale(sc => Math.max(0.5, sc - 0.2))}>−</button>
            <span style={s.viewerZoom}>{Math.round(scale * 100)}%</span>
            <button style={s.viewerBtn} onClick={() => setScale(sc => Math.min(2.5, sc + 0.2))}>+</button>
          </div>
          {/* Pagine */}
          {numPages && (
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <button style={{ ...s.viewerBtn, opacity: currentPage <= 1 ? 0.3 : 1 }}
                disabled={currentPage <= 1} onClick={() => setCurrentPage(p => p - 1)}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
              </button>
              <span style={s.viewerPageNum}>{currentPage} / {numPages}</span>
              <button style={{ ...s.viewerBtn, opacity: currentPage >= numPages ? 0.3 : 1 }}
                disabled={currentPage >= numPages} onClick={() => setCurrentPage(p => p + 1)}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* PDF */}
      <div style={s.viewerContent}>
        <Document
          file={url}
          onLoadSuccess={({ numPages }) => setNumPages(numPages)}
          loading={<div style={{ color: "var(--text-muted)", fontSize: "0.82rem", paddingTop: 40 }}>Caricamento PDF…</div>}
          error={<div style={{ color: "#f87171", fontSize: "0.82rem", paddingTop: 40 }}>Impossibile caricare il PDF.</div>}
        >
          <Page
            pageNumber={currentPage}
            scale={scale}
            renderTextLayer
            renderAnnotationLayer={false}
          />
        </Document>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// INGESTION PANEL
// legge/scrive i job dal Context globale
// così i log sopravvivono alla navigazione
// ─────────────────────────────────────────────
function IngestionPanel({ pdf, onIngested }) {
  const { getJob, startIngestion } = useIngestion();
  const logsEndRef = useRef();

  const job    = getJob(pdf.filename);
  const status = job.status;
  const logs   = job.logs;

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const start = () => startIngestion(pdf.filename, onIngested);

  return (
    <div>
      {status === null && (
        <button style={s.ingestBtn} onClick={start}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          Avvia ingestion
        </button>
      )}
      {status === "done" && (
        <div style={s.successBanner}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          Documento indicizzato con successo
        </div>
      )}
      {status === "error" && (
        <div style={s.errorBanner}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          Pipeline terminata con errore
        </div>
      )}
      {logs.length > 0 && (
        <div style={s.logBox}>
          <div style={s.logHeader}>
            <div style={s.logDot(status === "processing")} />
            log output
          </div>
          <div style={s.logContent}>
            {logs.map((line, i) => <div key={i} style={s.logLine}>{line}</div>)}
            <div ref={logsEndRef} />
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// CHUNK EXPLORER
// ─────────────────────────────────────────────
function ChunkExplorer({ filename }) {
  const [chunks, setChunks]     = useState([]);
  const [total, setTotal]       = useState(0);
  const [page, setPage]         = useState(0);
  const [loading, setLoading]   = useState(false);
  const [expanded, setExpanded] = useState(null);
  const PAGE_SIZE = 15;

  const fetch_ = useCallback(async (p = 0) => {
    setLoading(true);
    try {
      const res  = await fetch(`${API}/api/v1/admin/chunks/${encodeURIComponent(filename)}?page=${p}&page_size=${PAGE_SIZE}`);
      const data = await res.json();
      setChunks(data.chunks || []); setTotal(data.total || 0); setPage(p);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [filename]);

  useEffect(() => { fetch_(0); }, [fetch_]);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div>
      <div style={s.chunkStats}>
        <span>{total} chunk indicizzati</span>
        <span style={{ fontFamily: "'DM Mono', monospace", fontSize: "0.68rem" }}>
          pag. {page + 1}/{Math.max(totalPages, 1)}
        </span>
      </div>

      {loading && <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", textAlign: "center", padding: 16 }}>Caricamento…</div>}

      {!loading && chunks.map((chunk, i) => (
        <div key={chunk.id} style={s.chunkItem}>
          <button style={s.chunkHeader} onClick={() => setExpanded(expanded === i ? null : i)}>
            <span style={s.chunkIdx}>#{page * PAGE_SIZE + i + 1}</span>
            <span style={s.chunkPreview}>{chunk.preview}</span>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              style={{ transform: expanded === i ? "rotate(180deg)" : "none", transition: "transform 0.15s", flexShrink: 0 }}>
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </button>
          {expanded === i && (
            <div style={s.chunkBody}>
              {chunk.text}
              {chunk.metadata && Object.keys(chunk.metadata).length > 0 && (
                <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 4 }}>
                  {Object.entries(chunk.metadata).map(([k, v]) => v && (
                    <span key={k} style={{
                      fontSize: "0.65rem", padding: "2px 6px", borderRadius: 4,
                      background: "var(--surface)", color: "var(--text-muted)",
                      border: "1px solid var(--border)",
                    }}>{k}: {String(v)}</span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      ))}

      {totalPages > 1 && (
        <div style={s.pagination}>
          <button style={{ ...s.pageBtn, opacity: page <= 0 ? 0.3 : 1 }}
            disabled={page <= 0} onClick={() => fetch_(page - 1)}>← Precedente</button>
          <button style={{ ...s.pageBtn, opacity: page >= totalPages - 1 ? 0.3 : 1 }}
            disabled={page >= totalPages - 1} onClick={() => fetch_(page + 1)}>Successiva →</button>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// LOADER PANEL — carica in PostgreSQL + ChromaDB
// stato (logs, status) vive in IngestionContext
// così sopravvive alla navigazione
// ─────────────────────────────────────────────
function LoaderPanel({ pdf, onLoaded }) {
  const { getLoaderJob, startLoader, resetLoaderJob } = useIngestion();
  const [tipi, setTipi]           = useState([]);
  const [livelli, setLivelli]     = useState([]);
  const [idTipo, setIdTipo]       = useState("");
  const [idLivello, setIdLivello] = useState("");
  const [dataVal, setDataVal]     = useState("");
  const [dataSca, setDataSca]     = useState("");
  const logsEndRef                = useRef();

  const job       = getLoaderJob(pdf.filename);
  const status    = job.status;
  const logs      = job.logs;
  const duplicato = job.duplicato;
  const loading   = status === "processing";

  useEffect(() => {
    fetch(`${API}/api/v1/admin/tipi-documento`).then(r => r.json()).then(d => setTipi(d.tipi || []));
    fetch(`${API}/api/v1/admin/livelli-riservatezza`).then(r => r.json()).then(d => {
      setLivelli(d.livelli || []);
      if (d.livelli?.length) setIdLivello(String(d.livelli[0].id));
    });
  }, []);

  useEffect(() => { logsEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [logs]);

  const avvia = (forza = false) => {
    if (!idLivello || !dataVal) return;
    startLoader(pdf.filename, {
      id_tipo: idTipo ? parseInt(idTipo) : null,
      id_livello: parseInt(idLivello),
      data_validita: dataVal,
      data_scadenza: dataSca || null,
      forza_sovrascrivi: forza,
    }, onLoaded);
  };

  return (
    <div>
      {status === "ok" && (
        <div style={s.successBanner}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          Caricato in PostgreSQL e ChromaDB!
        </div>
      )}
      {status === "error" && (
        <div style={s.errorBanner}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          Caricamento fallito
        </div>
      )}
      {status === "duplicato" && duplicato && (
        <div style={s.warnBanner}>
          ⚠️ Documento già presente in <strong>{duplicato.dove}</strong>.
          <div style={{ marginTop: 8, display: "flex", gap: 6 }}>
            <button style={{ ...s.loaderBtn, background: "#f59e0b", marginTop: 0, flex: 1 }}
              onClick={() => avvia(true)}>Sovrascrivi</button>
            <button style={{ ...s.loaderBtn, background: "var(--surface2)", color: "var(--text-muted)", marginTop: 0, flex: 1 }}
              onClick={() => resetLoaderJob(pdf.filename)}>Annulla</button>
          </div>
        </div>
      )}

      {(status === null || status === "error") && (
        <>
          <div style={s.formGroup}>
            <label style={s.formLabel}>Tipo documento</label>
            <select style={s.formSelect} value={idTipo} onChange={e => setIdTipo(e.target.value)}>
              <option value=""> Nessuno </option>
              {tipi.map(t => <option key={t.id} value={t.id}>{t.nome}</option>)}
            </select>
          </div>
          <div style={s.formGroup}>
            <label style={s.formLabel}>Livello riservatezza </label>
            <select style={s.formSelect} value={idLivello} onChange={e => setIdLivello(e.target.value)}>
              {livelli.map(l => <option key={l.id} value={l.id}>{l.nome}</option>)}
            </select>
          </div>
          <div style={s.formGroup}>
            <label style={s.formLabel}>Data validità </label>
            <input style={s.formInput} type="date" value={dataVal} onChange={e => setDataVal(e.target.value)} />
          </div>
          <div style={s.formGroup}>
            <label style={s.formLabel}>Data scadenza</label>
            <input style={s.formInput} type="date" value={dataSca} onChange={e => setDataSca(e.target.value)} />
          </div>
          {dataSca && dataVal && dataSca < dataVal && (
            <div style={{ fontSize: "0.72rem", color: "#f87171", marginBottom: 8 }}>
              ⚠️ La data di scadenza deve essere successiva alla data di validità.
            </div>
          )}
          <button
            style={{ ...s.loaderBtn, opacity: (!idTipo || !idLivello || !dataVal || loading || (dataSca && dataSca < dataVal)) ? 0.5 : 1 }}
            disabled={!idTipo || !idLivello || !dataVal || loading || (dataSca && dataSca < dataVal)}
            onClick={() => avvia(false)}>
            {loading ? "Caricamento…" : "⬆ Carica in ChromaDB + DB"}
          </button>
        </>
      )}

      {logs.length > 0 && (
        <div style={{ ...s.logBox, marginTop: 12 }}>
          <div style={s.logHeader}>
            <div style={s.logDot(loading)} /> log output
          </div>
          <div style={s.logContent}>
            {logs.map((line, i) => <div key={i} style={s.logLine}>{line}</div>)}
            <div ref={logsEndRef} />
          </div>
        </div>
      )}
    </div>
  );
}


// ─────────────────────────────────────────────
// SYNC PANEL — health check sincronizzazione
// ─────────────────────────────────────────────
function SyncPanel() {
  const [docs, setDocs]     = useState([]);
  const [loading, setLoading] = useState(false);

  const fetch_ = async () => {
    setLoading(true);
    try {
      const res  = await fetch(`${API}/api/v1/admin/sync-status`);
      const data = await res.json();
      setDocs(data.documenti || []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetch_(); }, []);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>{docs.length} documenti monitorati</span>
        <button style={{ ...s.pageBtn, color: "var(--accent)" }} onClick={fetch_}>↻ Aggiorna</button>
      </div>

      {loading && <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", textAlign: "center", padding: 16 }}>Caricamento…</div>}

      {!loading && docs.map((doc, i) => (
        <div key={i} style={s.syncItem(doc.stato)}>
          <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
            <div style={s.syncDot(doc.stato)} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: "0.78rem", fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {doc.titolo}
              </div>
              <div style={{ fontSize: "0.68rem", color: "var(--text-muted)", marginTop: 2 }}>
                {SYNC_LABEL[doc.stato] || doc.stato}
              </div>
              <div style={{ fontSize: "0.65rem", color: "var(--text-muted)", marginTop: 2 }}>
                {doc.dettaglio}
              </div>
            </div>
          </div>
        </div>
      ))}

      {!loading && docs.length === 0 && (
        <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", textAlign: "center", padding: 24 }}>
          Nessun documento trovato nei DB.
        </div>
      )}
    </div>
  );
}


// ─────────────────────────────────────────────
// DELETE DIALOG — conferma eliminazione
// ─────────────────────────────────────────────
function DeleteDialog({ filename, onConfirm, onCancel }) {
  return (
    <div style={s.overlay}>
      <div style={s.dialog}>
        <div style={s.dialogTitle}>Elimina documento</div>
        <div style={s.dialogText}>
          Stai per eliminare <strong>{filename}</strong> da tutti i livelli:<br/>
          file fisico, file locali, PostgreSQL e ChromaDB.<br/><br/>
          Questa operazione è <strong>irreversibile</strong>.
        </div>
        <div style={s.dialogBtns}>
          <button style={s.dialogCancel} onClick={onCancel}>Annulla</button>
          <button style={s.dialogConfirm} onClick={onConfirm}>Elimina tutto</button>
        </div>
      </div>
    </div>
  );
}


// ─────────────────────────────────────────────
// EDIT PANEL — modifica metadati documento
// ─────────────────────────────────────────────
function EditPanel({ pdf, onUpdated }) {
  const [tipi, setTipi]         = useState([]);
  const [livelli, setLivelli]   = useState([]);
  const [idTipo, setIdTipo]     = useState("");
  const [idLivello, setIdLivello] = useState("");
  const [versione, setVersione] = useState("");
  const [dataVal, setDataVal]   = useState("");
  const [dataSca, setDataSca]   = useState("");
  const [docId, setDocId]       = useState(null);
  const [loading, setLoading]   = useState(false);
  const [fetching, setFetching] = useState(true);
  const [result, setResult]     = useState(null); // "ok" | "error"
  const [errMsg, setErrMsg]     = useState("");

  // Carica tipi, livelli e metadati attuali
  useEffect(() => {
    setResult(null); setFetching(true);
    Promise.all([
      fetch(`${API}/api/v1/admin/tipi-documento`).then(r => r.json()),
      fetch(`${API}/api/v1/admin/livelli-riservatezza`).then(r => r.json()),
      fetch(`${API}/api/v1/admin/document/${encodeURIComponent(pdf.filename)}/metadata`).then(r => r.json()),
    ]).then(([t, l, meta]) => {
      setTipi(t.tipi || []);
      setLivelli(l.livelli || []);
      setDocId(meta.documento_id);
      setIdTipo(meta.id_tipo ? String(meta.id_tipo) : "");
      setIdLivello(meta.id_livello ? String(meta.id_livello) : "");
      setVersione(meta.versione || "");
      setDataVal(meta.data_validita || "");
      setDataSca(meta.data_scadenza || "");
    }).catch(() => setErrMsg("Documento non trovato in PostgreSQL."))
    .finally(() => setFetching(false));
  }, [pdf.filename]);

  const salva = async () => {
    if (!idLivello || !versione || !dataVal) return;
    setLoading(true); setResult(null); setErrMsg("");
    try {
      const res = await fetch(`${API}/api/v1/admin/document/${encodeURIComponent(pdf.filename)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documento_id:  docId,
          id_tipo:       idTipo ? parseInt(idTipo) : null,
          id_livello:    parseInt(idLivello),
          versione,
          data_validita: dataVal,
          data_scadenza: dataSca || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setErrMsg(data.detail || "Errore"); setResult("error"); }
      else { setResult("ok"); if (onUpdated) onUpdated(); }
    } catch (e) {
      setErrMsg(e.message); setResult("error");
    } finally {
      setLoading(false);
    }
  };

  if (fetching) return <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", padding: 16, textAlign: "center" }}>Caricamento…</div>;
  if (errMsg && !docId) return <div style={{ ...s.errorBanner, marginTop: 0 }}>⚠️ {errMsg}</div>;

  const dateInvalid = dataSca && dataVal && dataSca < dataVal;
  const canSave = idLivello && versione && dataVal && !dateInvalid && !loading;

  return (
    <div>
      {result === "ok" && (
        <div style={s.successBanner}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          Documento aggiornato in PostgreSQL e ChromaDB!
        </div>
      )}
      {result === "error" && (
        <div style={s.errorBanner}>❌ {errMsg}</div>
      )}

      <div style={s.formGroup}>
        <label style={s.formLabel}>Tipo documento</label>
        <select style={s.formSelect} value={idTipo} onChange={e => setIdTipo(e.target.value)}>
          <option value=""> Nessuno </option>
          {tipi.map(t => <option key={t.id} value={t.id}>{t.nome}</option>)}
        </select>
      </div>
      <div style={s.formGroup}>
        <label style={s.formLabel}>Livello riservatezza </label>
        <select style={s.formSelect} value={idLivello} onChange={e => setIdLivello(e.target.value)}>
          {livelli.map(l => <option key={l.id} value={l.id}>{l.nome}</option>)}
        </select>
      </div>
      <div style={s.formGroup}>
        <label style={s.formLabel}>Versione </label>
        <input style={s.formInput} type="text" value={versione} onChange={e => setVersione(e.target.value)} placeholder="es. 1.0" />
      </div>
      <div style={s.formGroup}>
        <label style={s.formLabel}>Data validità </label>
        <input style={s.formInput} type="date" value={dataVal} onChange={e => setDataVal(e.target.value)} />
      </div>
      <div style={s.formGroup}>
        <label style={s.formLabel}>Data scadenza</label>
        <input style={s.formInput} type="date" value={dataSca} onChange={e => setDataSca(e.target.value)} />
      </div>
      {dateInvalid && (
        <div style={{ fontSize: "0.72rem", color: "#f87171", marginBottom: 8 }}>
          ⚠️ La data di scadenza deve essere successiva alla data di validità.
        </div>
      )}
      <button
        style={{ ...s.loaderBtn, background: "var(--accent)", opacity: canSave ? 1 : 0.5 }}
        disabled={!canSave}
        onClick={salva}
      >
        {loading ? "Salvataggio…" : "💾 Salva modifiche"}
      </button>
    </div>
  );
}


// ─────────────────────────────────────────────
// RIGHT PANEL
// ─────────────────────────────────────────────
function RightPanel({ pdf, onStatusChange, onDeleted, onRefresh }) {
  const [activeTab, setActiveTab]   = useState("ingest");
  const [showDelete, setShowDelete] = useState(false);
  const [deleting, setDeleting]     = useState(false);

  useEffect(() => {
    if (!pdf) return;
    if (pdf.status === "ready")      setActiveTab("loader");
    else if (pdf.status === "completed") setActiveTab("chunks");
    else setActiveTab("ingest");
  }, [pdf?.filename]);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await fetch(`${API}/api/v1/admin/document/${encodeURIComponent(pdf.filename)}`, { method: "DELETE" });
      setShowDelete(false);
      if (onDeleted) onDeleted(pdf.filename);
    } catch (e) { console.error(e); }
    finally { setDeleting(false); }
  };

  if (!pdf) {
    return (
      <div style={s.right}>
        <div style={s.rightEmpty}>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.25 }}>
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
          </svg>
          <p style={{ fontSize: "0.78rem", textAlign: "center", lineHeight: 1.6 }}>
            Seleziona un documento per vederne i dettagli
          </p>
        </div>
      </div>
    );
  }

  const allTabs = [
    { id: "ingest",  label: "Ingestion" },
    { id: "loader",  label: "Loader",   disabled: pdf.status === "not_ingested" || pdf.status === "processing" },
    { id: "chunks",  label: "Chunks",   disabled: pdf.status !== "completed" },
    { id: "modifica",label: "Modifica", disabled: pdf.status !== "completed" },
    { id: "sync",    label: "Sync" },
  ];

  return (
    <div style={s.right}>
      {showDelete && (
        <DeleteDialog
          filename={pdf.filename}
          onConfirm={handleDelete}
          onCancel={() => setShowDelete(false)}
        />
      )}

      {/* Header */}
      <div style={s.rightHeader}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
          <div style={s.rightFilename}>{pdf.filename}</div>
          <Badge status={pdf.status} />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4 }}>
          <div style={s.rightSize}>{pdf.size_kb} KB</div>
          <button
            onClick={() => setShowDelete(true)}
            style={{ background: "none", border: "none", cursor: "pointer", color: "#f87171", fontSize: "0.72rem", padding: "2px 6px" }}
            title="Elimina documento"
          >
            🗑 Elimina
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div style={s.tabs}>
        {allTabs.map(t => (
          <button
            key={t.id}
            style={{ ...s.tab(activeTab === t.id), opacity: t.disabled ? 0.35 : 1 }}
            disabled={t.disabled}
            onClick={() => !t.disabled && setActiveTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={s.rightBody}>
        {activeTab === "ingest" && (
          <IngestionPanel
            pdf={pdf}
            onIngested={() => onStatusChange(pdf.filename, "ready")}
          />
        )}
        {activeTab === "loader" && (
          <LoaderPanel
            pdf={pdf}
            onLoaded={() => { onStatusChange(pdf.filename, "completed"); onRefresh(); }}
          />
        )}
        {activeTab === "chunks" && pdf.status === "completed" && (
          <ChunkExplorer filename={pdf.filename} />
        )}
        {activeTab === "modifica" && pdf.status === "completed" && (
          <EditPanel
            pdf={pdf}
            onUpdated={() => {}}
          />
        )}
        {activeTab === "sync" && (
          <SyncPanel />
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// ROOT
// ─────────────────────────────────────────────
export default function AdminPanel() {
  const [pdfs, setPdfs]           = useState([]);
  const [selected, setSelected]   = useState(null);
  const [leftOpen, setLeftOpen]   = useState(true);
  const [rightOpen, setRightOpen] = useState(true);

  const fetchPdfs = useCallback(async () => {
    try {
      const res  = await fetch(`${API}/api/v1/admin/pdfs`);
      const data = await res.json();
      setPdfs(data.pdfs || []);
    } catch (e) { console.error("Fetch pdfs error:", e); }
  }, []);

  useEffect(() => { fetchPdfs(); }, [fetchPdfs]);



  const handleStatusChange = (filename, newStatus) => {
    setPdfs(prev => prev.map(p => p.filename === filename ? { ...p, status: newStatus } : p));
    setSelected(prev => prev?.filename === filename ? { ...prev, status: newStatus } : prev);
  };

  return (
    <div style={s.root}>
      {/* Barra toggle pannelli */}
      <div style={{
        display: "flex", gap: 8, padding: "6px 12px",
        background: "var(--surface)", borderBottom: "1px solid var(--border)",
        flexShrink: 0,
      }}>
        <button
          onClick={() => setLeftOpen(o => !o)}
          style={{
            padding: "5px 12px", borderRadius: 6, border: "1px solid var(--border-strong)",
            background: leftOpen ? "var(--accent-dim)" : "none",
            color: leftOpen ? "var(--accent)" : "var(--text-muted)",
            cursor: "pointer", fontFamily: "inherit", fontSize: "0.75rem", fontWeight: 600,
            display: "flex", alignItems: "center", gap: 6, transition: "all 0.15s",
          }}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/>
          </svg>
          Lista documenti
        </button>
        <button
          onClick={() => setRightOpen(o => !o)}
          style={{
            padding: "5px 12px", borderRadius: 6, border: "1px solid var(--border-strong)",
            background: rightOpen ? "var(--accent-dim)" : "none",
            color: rightOpen ? "var(--accent)" : "var(--text-muted)",
            cursor: "pointer", fontFamily: "inherit", fontSize: "0.75rem", fontWeight: 600,
            display: "flex", alignItems: "center", gap: 6, transition: "all 0.15s",
          }}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2"/><line x1="15" y1="3" x2="15" y2="21"/>
          </svg>
          Dettagli
        </button>
      </div>

      <div style={s.body}>
        {leftOpen && (
          <Sidebar
            pdfs={pdfs}
            selected={selected}
            onSelect={setSelected}
            onUploaded={(doc) => setPdfs(prev => prev.find(p => p.filename === doc.filename) ? prev : [...prev, doc])}
            onRefresh={fetchPdfs}
          />
        )}

        {selected ? (
          <PdfViewer filename={selected.filename} />
        ) : (
          <div style={{ ...s.viewer, ...s.viewerEmpty }}>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.15 }}>
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
            </svg>
            <p style={{ fontSize: "0.82rem" }}>Seleziona un PDF per visualizzarlo</p>
          </div>
        )}

        {rightOpen && (
          <RightPanel
            pdf={selected}
            onStatusChange={handleStatusChange}
            onRefresh={fetchPdfs}
            onDeleted={(filename) => {
              setPdfs(prev => prev.filter(p => p.filename !== filename));
              setSelected(null);
            }}
          />
        )}
      </div>
    </div>
  );
}