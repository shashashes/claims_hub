import { useState, useEffect, useCallback, useRef } from "react";
import storage from "../storage";

const CARRIERS = {
  AMAZON: { name: "Amazon", color: "#FF9900", prefix: "TBA", icon: "📦" },
  USPS: { name: "USPS", color: "#004B87", prefix: "USPS", icon: "🏛️" },
  UPS: { name: "UPS", color: "#351C15", prefix: "1Z", icon: "🟤" },
  UNKNOWN: { name: "Неизвестный", color: "#666", prefix: "?", icon: "❓" },
};

const CLAIM_RULES = {
  AMAZON: { minDays: 0, maxDays: Infinity, reviewDays: "3–5 р.д.", portal: "Amazon Seller Central → Help → Get support → Shipping/Delivery issue" },
  USPS: { minDays: 7, maxDays: 60, reviewDays: "5–10 р.д.", portal: "usps.com/help/claims.htm → File a Claim" },
  UPS: { minDays: 1, maxDays: 60, reviewDays: "8–15 р.д.", portal: "ups.com → Help & Support → File a Claim → Start a Claim" },
};

const STATUSES = {
  NEW: { label: "Новый", color: "#64748b", bg: "#f1f5f9" },
  TOO_EARLY: { label: "Рано подавать", color: "#d97706", bg: "#fffbeb" },
  READY: { label: "Готов к подаче", color: "#059669", bg: "#ecfdf5" },
  FILED: { label: "Клейм подан", color: "#2563eb", bg: "#eff6ff" },
  APPROVED: { label: "Одобрен", color: "#16a34a", bg: "#f0fdf4" },
  DENIED: { label: "Отклонён", color: "#dc2626", bg: "#fef2f2" },
  APPEAL: { label: "Апелляция", color: "#9333ea", bg: "#faf5ff" },
  EXPIRED: { label: "Просрочен", color: "#991b1b", bg: "#fef2f2" },
  RESOLVED: { label: "Закрыт", color: "#374151", bg: "#f3f4f6" },
};

const TRACK_STATUSES_LIST = ["Info Received", "Exception", "In Transit", "Delivered", "Expired", "Pending"];

// ─── Helpers ─────────────────────────────────────────────────────────
function detectCarrier(trackingNumber) {
  const tn = (trackingNumber || "").trim().toUpperCase();
  if (tn.startsWith("TBA")) return "AMAZON";
  if (tn.startsWith("1Z")) return "UPS";
  if (/^(9400|9205|9361|9261|EC|CP|LN|LX)/.test(tn)) return "USPS";
  if (/^9[234]\d{19,}$/.test(tn)) return "USPS";
  return "UNKNOWN";
}

function daysSince(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d)) return null;
  return Math.floor((new Date() - d) / 86400000);
}

function fmtDate(dateStr) {
  if (!dateStr) return "—";
  try { const d = new Date(dateStr); return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" }); } catch { return dateStr; }
}

function calcClaimWindow(carrier, shipDate) {
  const rules = CLAIM_RULES[carrier];
  if (!rules) return { status: "NEW", note: "Перевозчик не определён" };
  const days = daysSince(shipDate);
  if (days === null) return { status: "NEW", note: "Нет даты отправки" };
  if (days < rules.minDays) return { status: "TOO_EARLY", note: `Ещё ${rules.minDays - days} дн. до подачи (мин. ${rules.minDays} дн.)` };
  if (rules.maxDays !== Infinity && days > rules.maxDays) return { status: "EXPIRED", note: `Прошло ${days} дн. — дедлайн ${rules.maxDays} дн.` };
  if (rules.maxDays !== Infinity) return { status: "READY", note: `Готов! Осталось ${rules.maxDays - days} дн. до дедлайна` };
  return { status: "READY", note: `Готов к подаче (${days} дн. с отправки)` };
}

function generateClaimText(track) {
  const { carrier, trackingNumber, orderNumber, shipDate, lastEvent } = track;
  const base = `Tracking: ${trackingNumber}${orderNumber ? `, Order: ${orderNumber}` : ""}. Ship date: ${shipDate ? fmtDate(shipDate) : "N/A"}. Last update: ${lastEvent || "No updates"}.`;
  if (carrier === "AMAZON") return `Hello,\n\nI am writing to request an investigation into a shipment that appears to be lost.\n\n${base}\n\nThe package has shown no tracking updates for an extended period. It was never picked up or scanned into the carrier network. I kindly request that you investigate this shipment and provide either a reshipment or compensation for the lost package.\n\nThank you for your prompt attention to this matter.`;
  if (carrier === "USPS") return `USPS Missing Mail Claim\n\nClaim Type: Missing Mail (Lost Package)\n\n${base}\n\nThe package was shipped via USPS and has not been delivered. Tracking has not updated since ${lastEvent || "[date]"}.\n\nRequested resolution: Full reimbursement of the declared value.\n\nAttachments needed:\n• Shipping receipt / label proof\n• Invoice showing item value\n• Screenshot of tracking history`;
  if (carrier === "UPS") return `UPS Lost Package Claim\n\nClaim Type: Lost Package\n\n${base}\n\nThis package has not been delivered and shows no movement. Last scan: ${lastEvent || "[date]"}.\n\nDeclared value: [insert value]\n\nAttachments needed:\n• Commercial invoice\n• Shipping receipt\n• Tracking history screenshot`;
  return `Claim for undelivered package\n\n${base}\n\nPlease investigate this shipment.`;
}

function generateUPSContact(track) {
  const { trackingNumber, shipDate, lastEvent, orderNumber, productTitle } = track;
  return [
    "UPS Claim Request — Lost Package",
    "",
    `Tracking: ${trackingNumber}`,
    orderNumber ? `Order/Ref: ${orderNumber}` : "Order/Ref: [add if any]",
    `Ship date: ${shipDate || "[yyyy-mm-dd]"}`,
    `Last update: ${lastEvent || "No events recorded"}`,
    `Contents: ${productTitle || "[item description]"}`,
    "Claim type: Lost Package",
    "Declared value: [enter amount]",
    "",
    "Attachments prepared:",
    "- Commercial invoice (value proof)",
    "- Shipping receipt / label",
    "- Tracking history screenshot",
    "",
    "Please open an investigation or issue compensation. Thank you."
  ].join("\n");
}

function generateStepsTaken(track) {
  const { carrier, trackingNumber, trackStatus, lastEvent } = track;
  if (carrier === "AMAZON") return `I checked the tracking status on track.amazon.com for ${trackingNumber}. The status has been stuck on "${trackStatus || "Info Received"}" with no scans or movement since the label was created. The package was never picked up by the carrier. I am requesting an investigation and compensation for this lost shipment.`;
  if (carrier === "USPS") return `I tracked ${trackingNumber} on tools.usps.com. Status: "${trackStatus || "Info Received"}" — no delivery scans. Last event: ${lastEvent || "N/A"}. Filing a Missing Mail claim.`;
  if (carrier === "UPS") return `I tracked ${trackingNumber} on ups.com. Status: "${trackStatus || "Info Received"}" — no scans since label creation. Last event: ${lastEvent || "N/A"}. Filing a lost package claim.`;
  return `Checked tracking for ${trackingNumber}. Status: ${trackStatus || "unknown"}. No delivery confirmed.`;
}

function uid() { return `t-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`; }

// ─── TrackingMore API ────────────────────────────────────────────────
async function fetchTrackingMore(statusFilter = "inforeceived,exception") {
  const params = new URLSearchParams({
    endpoint: '/trackings/get',
    delivery_status: statusFilter,
    page_size: '200',
    created_date_min: '2026-01-01T00:00:00+00:00',
  });
  const res = await fetch(`/api/trackingmore?${params}`);
  return res.json();
}

function tmToLocal(item) {
  const tn = item.tracking_number || "";
  const carrier = detectCarrier(tn);
  const shipDate = (item.order_create_time || item.created_at || "").split("T")[0];
  const st = item.delivery_status || "";
  const trackStatus = st === "inforeceived" ? "Info Received" : st === "exception" ? "Exception" : st === "intransit" ? "In Transit" : st === "delivered" ? "Delivered" : st || "Unknown";
  const w = calcClaimWindow(carrier, shipDate);
  return {
    id: `tm-${tn}-${Date.now()}`, trackingNumber: tn, carrier, carrierCode: item.courier_code || "",
    trackStatus, shipDate, orderNumber: item.order_number || item.order_id || "",
    lastEvent: item.latest_event || "", lastEventDate: (item.latest_checkpoint_time || "").split("T")[0],
    productTitle: item.title || "", claimStatus: w.status, claimNote: w.note,
    claimFiledDate: "", carrierResponse: "", internalNotes: "",
    tmRaw: item, createdAt: new Date().toISOString(), syncedAt: new Date().toISOString(),
  };
}

// ─── CSV ─────────────────────────────────────────────────────────────
function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];
  const hdr = lines[0].split(",").map(h => h.trim().toLowerCase().replace(/["']/g, ""));
  const f = (keys) => { for (const k of keys) { const i = hdr.findIndex(h => h.includes(k)); if (i !== -1) return i; } return -1; };
  const tc = f(["tracking","track","number"]), sc = f(["status"]), dc = f(["created","date","ship"]), oc = f(["order","reference"]), lc = f(["last","event"]), pc = f(["title","product"]);
  if (tc === -1) return [];
  return lines.slice(1).map((line, i) => {
    const c = line.split(",").map(v => v.trim().replace(/^["']|["']$/g, ""));
    const tn = c[tc]; if (!tn) return null;
    const carrier = detectCarrier(tn), shipDate = dc !== -1 ? c[dc] : "", w = calcClaimWindow(carrier, shipDate);
    return { id: `csv-${Date.now()}-${i}`, trackingNumber: tn, carrier, carrierCode: "", trackStatus: sc !== -1 ? c[sc] : "", shipDate, orderNumber: oc !== -1 ? c[oc] : "", lastEvent: lc !== -1 ? c[lc] : "", lastEventDate: "", productTitle: pc !== -1 ? c[pc] : "", claimStatus: w.status, claimNote: w.note, claimFiledDate: "", carrierResponse: "", internalNotes: "", tmRaw: null, createdAt: new Date().toISOString(), syncedAt: "" };
  }).filter(Boolean);
}

// ─── Storage ─────────────────────────────────────────────────────────
async function loadTracks() {
  try {
    const r = await storage.get("claims-v3");
    return r ? JSON.parse(r.value) : [];
  } catch {
    return [];
  }
}

async function saveTracks(tracks) {
  try {
    await storage.set("claims-v3", JSON.stringify(tracks));
  } catch (e) {
    console.error(e);
  }
}

// ═══════════════════════════════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════════════════════════════
export default function ClaimsHub() {
  const [tracks, setTracks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState(null);
  const [view, setView] = useState("dashboard");
  const [sel, setSel] = useState(null);
  const [filter, setFilter] = useState("ALL");
  const [cFilter, setCFilter] = useState("ALL");
  const [search, setSearch] = useState("");
  const [bulk, setBulk] = useState("");
  const [csv, setCsv] = useState("");
  const [toast, setToast] = useState(null);
  const fileRef = useRef(null);

  useEffect(() => { loadTracks().then(t => { setTracks(t); setLoading(false); }); }, []);
  useEffect(() => { if (!loading) saveTracks(tracks); }, [tracks, loading]);
  const showToast = (m) => { setToast(m); setTimeout(() => setToast(null), 3500); };

  // Sync TrackingMore
  const syncTM = async () => {
    setSyncing(true); setSyncMsg(null);
    try {
      const data = await fetchTrackingMore();
      if (data.meta?.code !== 200 && data.code !== 200) { setSyncMsg({ ok: false, text: `API: ${data.meta?.message || data.message || "Ошибка"}` }); setSyncing(false); return; }
      const items = data.data?.items || data.data || [];
      if (!items.length) { setSyncMsg({ ok: true, text: "Нет треков Info Received / Exception с 2026" }); setSyncing(false); return; }
      const newT = items.map(tmToLocal);
      let added = 0, updated = 0;
      setTracks(prev => {
        const map = new Map(prev.map(t => [t.trackingNumber, t]));
        const out = [...prev];
        for (const nt of newT) {
          const ex = map.get(nt.trackingNumber);
          if (ex) {
            const idx = out.findIndex(t => t.id === ex.id);
            if (idx !== -1) {
              const locked = ["FILED","APPROVED","DENIED","APPEAL","RESOLVED"].includes(ex.claimStatus);
              out[idx] = { ...ex, trackStatus: nt.trackStatus, lastEvent: nt.lastEvent, lastEventDate: nt.lastEventDate, tmRaw: nt.tmRaw, syncedAt: new Date().toISOString(), ...(locked ? {} : { claimStatus: nt.claimStatus, claimNote: nt.claimNote }) };
              updated++;
            }
          } else { out.unshift(nt); added++; }
        }
        return out;
      });
      setSyncMsg({ ok: true, text: `✅ ${items.length} треков: +${added} новых, ${updated} обновлено` });
    } catch (err) {
      setSyncMsg({ ok: false, text: `Сеть: ${err.message}` });
    }
    setSyncing(false);
  };

  const addBulk = () => {
    const nums = bulk.split(/[\n,;\s]+/).map(s => s.trim()).filter(Boolean);
    if (!nums.length) return;
    const nt = nums.map(tn => ({ id: uid(), trackingNumber: tn, carrier: detectCarrier(tn), carrierCode: "", trackStatus: "Info Received", shipDate: "", orderNumber: "", lastEvent: "", lastEventDate: "", productTitle: "", claimStatus: "NEW", claimNote: "Добавьте дату отправки", claimFiledDate: "", carrierResponse: "", internalNotes: "", tmRaw: null, createdAt: new Date().toISOString(), syncedAt: "" }));
    setTracks(p => [...nt, ...p]); setBulk(""); showToast(`+${nt.length} треков`);
  };

  const doCSV = (t) => { const p = parseCSV(t); if (!p.length) { showToast("CSV не распарсился"); return; } setTracks(prev => [...p, ...prev]); setCsv(""); showToast(`+${p.length} из CSV`); };
  const handleFile = (e) => { const f = e.target.files[0]; if (!f) return; const r = new FileReader(); r.onload = (ev) => doCSV(ev.target.result); r.readAsText(f); };
  const updateTrack = (id, u) => setTracks(p => p.map(t => { if (t.id !== id) return t; const up = { ...t, ...u }; if (u.shipDate || u.carrier) { const w = calcClaimWindow(u.carrier || t.carrier, u.shipDate || t.shipDate); if (!["FILED","APPROVED","DENIED","APPEAL","RESOLVED"].includes(up.claimStatus)) { up.claimStatus = w.status; } up.claimNote = w.note; } return up; }));
  const deleteTrack = (id) => { setTracks(p => p.filter(t => t.id !== id)); if (sel?.id === id) { setSel(null); setView("dashboard"); } showToast("Удалён"); };
  const recalcAll = () => { setTracks(p => p.map(t => { const w = calcClaimWindow(t.carrier, t.shipDate); const locked = ["FILED","APPROVED","DENIED","APPEAL","RESOLVED"].includes(t.claimStatus); return { ...t, claimNote: w.note, ...(locked ? {} : { claimStatus: w.status }) }; })); showToast("Окна пересчитаны"); };

  const filtered = tracks.filter(t => {
    if (filter !== "ALL" && t.claimStatus !== filter) return false;
    if (cFilter !== "ALL" && t.carrier !== cFilter) return false;
    if (search && !t.trackingNumber.toLowerCase().includes(search.toLowerCase()) && !(t.orderNumber||"").toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const st = { total: tracks.length, ready: tracks.filter(t=>t.claimStatus==="READY").length, filed: tracks.filter(t=>t.claimStatus==="FILED").length, tooEarly: tracks.filter(t=>t.claimStatus==="TOO_EARLY").length, expired: tracks.filter(t=>t.claimStatus==="EXPIRED").length, approved: tracks.filter(t=>t.claimStatus==="APPROVED").length, denied: tracks.filter(t=>t.claimStatus==="DENIED").length, amazon: tracks.filter(t=>t.carrier==="AMAZON").length, usps: tracks.filter(t=>t.carrier==="USPS").length, ups: tracks.filter(t=>t.carrier==="UPS").length };

  if (loading) return <div style={S.loader}><div style={S.spinner}/><p style={{color:"#94a3b8",marginTop:16}}>Загрузка…</p></div>;

  return (
    <div style={S.root}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=DM+Sans:wght@400;500;600;700&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        input,textarea,select,button{font-family:'DM Sans',sans-serif}
        input:focus,textarea:focus,select:focus{outline:none;border-color:#3b82f6!important;box-shadow:0 0 0 3px rgba(59,130,246,.15)}
        button:hover{filter:brightness(1.05)} button:active{transform:scale(.98)}
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes fadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
        @keyframes slideIn{from{opacity:0;transform:translateX(-12px)}to{opacity:1;transform:translateX(0)}}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}
        .rh:hover{background:#f8fafc!important}
      `}</style>

      {toast && <div style={S.toast}>{toast}</div>}

      {/* Header */}
      <div style={S.header}>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <div style={S.logo}>📋</div>
          <div>
            <h1 style={S.title}>Claims Hub</h1>
            <p style={{fontSize:12,color:"#059669",fontWeight:600}}>Owleys · TrackingMore API ●</p>
          </div>
        </div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
          <button style={{...S.btn,...S.btnSync,...(syncing?{animation:"pulse 1s infinite"}:{})}} onClick={syncTM} disabled={syncing}>
            {syncing?"⏳ Загрузка…":"🔄 Синхронизация TM"}
          </button>
          <button style={{...S.btn,...S.btnGhost}} onClick={recalcAll}>⏰ Пересчёт</button>
          <button style={{...S.btn,...S.btnPrimary}} onClick={()=>setView(view==="add"?"dashboard":"add")}>
            {view==="add"?"✕":"＋ Добавить"}
          </button>
        </div>
      </div>

      {/* Sync message */}
      {syncMsg && (
        <div style={{margin:"0 20px",padding:"10px 16px",borderRadius:8,border:`1px solid ${syncMsg.ok?"#86efac":"#fca5a5"}`,background:syncMsg.ok?"#f0fdf4":"#fef2f2",color:syncMsg.ok?"#166534":"#991b1b",fontSize:13,fontWeight:500,display:"flex",justifyContent:"space-between",alignItems:"center",animation:"fadeIn .3s ease"}}>
          <span>{syncMsg.text}</span>
          <button style={{...S.btn,fontSize:11,padding:"2px 8px",background:"transparent",color:syncMsg.ok?"#166534":"#991b1b"}} onClick={()=>setSyncMsg(null)}>✕</button>
        </div>
      )}

      {/* Stats */}
      <div style={S.statsBar}>
        {[{l:"Всего",v:st.total,c:"#475569",k:"ALL"},{l:"К подаче",v:st.ready,c:"#059669",k:"READY"},{l:"Подан",v:st.filed,c:"#2563eb",k:"FILED"},{l:"Рано",v:st.tooEarly,c:"#d97706",k:"TOO_EARLY"},{l:"Просрочен",v:st.expired,c:"#991b1b",k:"EXPIRED"},{l:"Одобрен",v:st.approved,c:"#16a34a",k:"APPROVED"},{l:"Отклонён",v:st.denied,c:"#dc2626",k:"DENIED"}].map(s=>(
          <button key={s.k} onClick={()=>setFilter(filter===s.k?"ALL":s.k)}
            style={{...S.statCard,borderLeft:`3px solid ${s.c}`,background:filter===s.k&&s.k!=="ALL"?"#f0f7ff":"#fff"}}>
            <span style={{fontSize:22,fontWeight:700,color:s.c,fontFamily:"'JetBrains Mono',monospace"}}>{s.v}</span>
            <span style={{fontSize:11,color:"#64748b",fontWeight:500}}>{s.l}</span>
          </button>
        ))}
      </div>

      {/* Carrier chips */}
      <div style={{display:"flex",gap:8,padding:"0 20px",flexWrap:"wrap"}}>
        <button style={{...S.chip,background:cFilter==="ALL"?"#1e293b":"#f1f5f9",color:cFilter==="ALL"?"#fff":"#475569"}} onClick={()=>setCFilter("ALL")}>Все</button>
        {Object.entries(CARRIERS).filter(([k])=>k!=="UNKNOWN").map(([k,c])=>(
          <button key={k} style={{...S.chip,background:cFilter===k?c.color:"#f1f5f9",color:cFilter===k?"#fff":"#475569"}} onClick={()=>setCFilter(cFilter===k?"ALL":k)}>
            {c.icon} {c.name} ({st[k.toLowerCase()]||0})
          </button>
        ))}
      </div>

      {/* Add panel */}
      {view==="add"&&(
        <div style={{...S.panel,animation:"fadeIn .3s ease"}}>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:20}}>
            <div>
              <h3 style={S.panelTitle}>📝 Вставить треки</h3>
              <textarea style={S.textarea} rows={5} value={bulk} onChange={e=>setBulk(e.target.value)} placeholder="TBA123456789&#10;9400111899223&#10;1Z999AA101234"/>
              <button style={{...S.btn,...S.btnPrimary,width:"100%",marginTop:8}} onClick={addBulk}>Добавить</button>
            </div>
            <div>
              <h3 style={S.panelTitle}>📄 Импорт CSV</h3>
              <input ref={fileRef} type="file" accept=".csv,.txt" onChange={handleFile} style={{display:"none"}}/>
              <button style={{...S.btn,...S.btnOutline,width:"100%",height:80,border:"2px dashed #cbd5e1"}} onClick={()=>fileRef.current?.click()}>📂 Выбрать CSV</button>
              <textarea style={{...S.textarea,marginTop:8}} rows={3} value={csv} onChange={e=>setCsv(e.target.value)} placeholder="tracking_number,status,date..."/>
              {csv&&<button style={{...S.btn,...S.btnPrimary,width:"100%",marginTop:8}} onClick={()=>doCSV(csv)}>Импорт</button>}
            </div>
          </div>
        </div>
      )}

      <div style={{padding:"0 20px"}}><input style={S.searchInput} placeholder="🔍  Поиск…" value={search} onChange={e=>setSearch(e.target.value)}/></div>

      {/* Detail */}
      {view==="detail"&&sel&&(
        <TrackDetail track={tracks.find(t=>t.id===sel.id)||sel} onUpdate={u=>updateTrack(sel.id,u)} onDelete={()=>deleteTrack(sel.id)} onBack={()=>{setView("dashboard");setSel(null);}}/>
      )}

      {/* Table */}
      {view!=="detail"&&(
        <div style={S.tableWrap}>
          {!filtered.length?(
            <div style={{padding:60,textAlign:"center",color:"#94a3b8"}}>
              <div style={{fontSize:48,marginBottom:12}}>📭</div>
              <p style={{fontSize:15,fontWeight:500}}>Нет треков</p>
              <p style={{fontSize:13,marginTop:4}}>Нажмите «Синхронизация TM» или добавьте вручную</p>
            </div>
          ):(
            <table style={S.table}><thead><tr style={S.tableHead}>
              <th style={S.th}>Перевозчик</th><th style={S.th}>Трек</th><th style={S.th}>Статус</th><th style={S.th}>Отправлен</th><th style={S.th}>Дн.</th><th style={S.th}>Окно</th><th style={S.th}>Клейм</th><th style={S.th}>Ответ</th>
            </tr></thead><tbody>
              {filtered.map((t,i)=>{const d=daysSince(t.shipDate);return(
                <tr key={t.id} className="rh" style={{...S.tr,cursor:"pointer",animation:`slideIn .15s ease ${i*.015}s both`}} onClick={()=>{setSel(t);setView("detail");}}>
                  <td style={S.td}><span style={{...S.badge,background:CARRIERS[t.carrier]?.color||"#666",color:"#fff"}}>{CARRIERS[t.carrier]?.icon} {CARRIERS[t.carrier]?.name}</span></td>
                  <td style={{...S.td,fontFamily:"'JetBrains Mono',monospace",fontSize:12,fontWeight:500}}>{t.trackingNumber}</td>
                  <td style={S.td}><span style={{fontSize:12,fontWeight:500,color:t.trackStatus==="Exception"?"#dc2626":t.trackStatus==="Info Received"?"#d97706":"#475569"}}>{t.trackStatus||"—"}</span></td>
                  <td style={{...S.td,fontSize:12}}>{fmtDate(t.shipDate)}</td>
                  <td style={{...S.td,fontFamily:"'JetBrains Mono',monospace",fontSize:12,fontWeight:600,color:d!==null&&d>30?"#dc2626":d!==null&&d>14?"#d97706":"#475569"}}>{d!==null?`${d}`:""}</td>
                  <td style={{...S.td,fontSize:11,color:"#64748b",maxWidth:160}}>{t.claimNote}</td>
                  <td style={S.td}><span style={{...S.statusPill,background:STATUSES[t.claimStatus]?.bg,color:STATUSES[t.claimStatus]?.color}}>{STATUSES[t.claimStatus]?.label}</span></td>
                  <td style={{...S.td,fontSize:12,color:"#64748b",maxWidth:120,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.carrierResponse||"—"}</td>
                </tr>
              );})}
            </tbody></table>
          )}
        </div>
      )}

      <div style={S.footer}>
        <span>{tracks.length} треков · {st.ready} к подаче · {st.filed} в работе</span>
        <button style={{...S.btn,...S.btnGhost,fontSize:11,padding:"4px 10px",color:"#94a3b8"}} onClick={()=>{if(confirm("Удалить всё?"))setTracks([])}}>Очистить</button>
      </div>
    </div>
  );
}

// ─── Track Detail ────────────────────────────────────────────────────
function TrackDetail({track,onUpdate,onDelete,onBack}) {
  const [showClaim,setShowClaim]=useState(false);
  const [showSteps,setShowSteps]=useState(false);
  const [showUPS,setShowUPS]=useState(false);
  const [copied,setCopied]=useState("");
  const carrier=CARRIERS[track.carrier]||CARRIERS.UNKNOWN;
  const rules=CLAIM_RULES[track.carrier];
  const days=daysSince(track.shipDate);
  const copy=(text,label)=>{navigator.clipboard.writeText(text).then(()=>{setCopied(label);setTimeout(()=>setCopied(""),2000);});};

  return(
    <div style={{...S.panel,animation:"fadeIn .25s ease"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:20}}>
        <div>
          <button style={{...S.btn,...S.btnGhost,marginBottom:8,fontSize:12}} onClick={onBack}>← Назад</button>
          <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
            <span style={{...S.badge,background:carrier.color,color:"#fff",fontSize:13,padding:"5px 12px"}}>{carrier.icon} {carrier.name}</span>
            <span style={{fontFamily:"'JetBrains Mono',monospace",fontSize:16,fontWeight:600}}>{track.trackingNumber}</span>
            {days!==null&&<span style={{fontSize:12,color:days>30?"#dc2626":"#64748b",fontWeight:600,background:days>30?"#fef2f2":"#f1f5f9",padding:"2px 8px",borderRadius:12}}>{days} дн.</span>}
          </div>
        </div>
        <span style={{...S.statusPill,fontSize:13,padding:"6px 14px",background:STATUSES[track.claimStatus]?.bg,color:STATUSES[track.claimStatus]?.color}}>{STATUSES[track.claimStatus]?.label}</span>
      </div>

      {track.lastEvent&&(
        <div style={{background:"#fffbeb",border:"1px solid #fde68a",borderRadius:8,padding:12,marginBottom:16,fontSize:12}}>
          <span style={{fontWeight:600,color:"#92400e"}}>Последнее событие: </span>
          <span style={{color:"#78350f"}}>{track.lastEvent}</span>
          {track.lastEventDate&&<span style={{color:"#a16207",marginLeft:8}}>({fmtDate(track.lastEventDate)})</span>}
        </div>
      )}

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12,marginBottom:20}}>
        <Field label="Номер заказа" value={track.orderNumber} onChange={v=>onUpdate({orderNumber:v})}/>
        <Field label="Дата отправки" value={track.shipDate} onChange={v=>onUpdate({shipDate:v})} type="date"/>
        <Field label="Статус трека" value={track.trackStatus} onChange={v=>onUpdate({trackStatus:v})} select={TRACK_STATUSES_LIST}/>
        <Field label="Последнее событие" value={track.lastEvent} onChange={v=>onUpdate({lastEvent:v})}/>
        <Field label="Товар" value={track.productTitle} onChange={v=>onUpdate({productTitle:v})}/>
        <Field label="Статус клейма" value={track.claimStatus} onChange={v=>onUpdate({claimStatus:v})} select={Object.keys(STATUSES)} selectLabels={Object.values(STATUSES).map(s=>s.label)}/>
      </div>

      <div style={{background:"#f8fafc",borderRadius:8,padding:14,marginBottom:16,border:"1px solid #e2e8f0"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div><span style={{fontSize:12,fontWeight:600,color:"#475569"}}>⏰ Окно: </span><span style={{fontSize:13,color:STATUSES[track.claimStatus]?.color,fontWeight:600}}>{track.claimNote}</span></div>
          {rules&&<span style={{fontSize:11,color:"#94a3b8"}}>Рассмотрение: {rules.reviewDays}</span>}
        </div>
        {rules&&<p style={{fontSize:11,color:"#94a3b8",marginTop:6}}>📍 {rules.portal}</p>}
      </div>

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:16}}>
        <Field label="Дата подачи клейма" value={track.claimFiledDate} onChange={v=>onUpdate({claimFiledDate:v})} type="date"/>
        <Field label="Ответ перевозчика" value={track.carrierResponse} onChange={v=>onUpdate({carrierResponse:v})}/>
      </div>
      <Field label="Заметки" value={track.internalNotes} onChange={v=>onUpdate({internalNotes:v})} multiline/>

      <div style={{marginTop:16,display:"flex",gap:8,flexWrap:"wrap"}}>
        <button style={{...S.btn,...S.btnPrimary}} onClick={()=>setShowClaim(!showClaim)}>{showClaim?"Скрыть":"📄 Текст клейма"}</button>
        <button style={{...S.btn,background:"#eff6ff",color:"#2563eb",border:"1px solid #bfdbfe"}} onClick={()=>setShowSteps(!showSteps)}>{showSteps?"Скрыть":"📋 Steps Taken"}</button>
        <button style={{...S.btn,background:"#f0f9ff",color:"#0ea5e9",border:"1px solid #bae6fd"}} onClick={()=>setShowUPS(!showUPS)} disabled={track.carrier!=="UPS"}>{showUPS?"Скрыть":"✉️ Запрос в UPS"}</button>
        <button style={{...S.btn,background:"#f0fdf4",color:"#16a34a",border:"1px solid #bbf7d0"}} onClick={()=>onUpdate({claimStatus:"FILED",claimFiledDate:new Date().toISOString().split("T")[0]})}>✓ Отметить «Подан»</button>
        <button style={{...S.btn,background:"#fef2f2",color:"#dc2626",border:"1px solid #fecaca"}} onClick={onDelete}>🗑️</button>
      </div>

      {showClaim&&<CopyBlock text={generateClaimText(track)} label="claim" copied={copied} onCopy={()=>copy(generateClaimText(track),"claim")}/>}
      {showSteps&&<CopyBlock text={generateStepsTaken(track)} label="steps" copied={copied} onCopy={()=>copy(generateStepsTaken(track),"steps")}/>}
      {showUPS&&track.carrier==="UPS"&&(
        <div style={{marginTop:12}}>
          <CopyBlock text={generateUPSContact(track)} label="ups" copied={copied} onCopy={()=>copy(generateUPSContact(track),"ups")}/>
          <a href="https://www.ups.com/claim" target="_blank" rel="noreferrer" style={{fontSize:12,color:"#0ea5e9",textDecoration:"underline",marginTop:6,display:"inline-block"}}>
            Открыть форму UPS Claims
          </a>
        </div>
      )}

      {track.syncedAt&&<p style={{fontSize:11,color:"#94a3b8",marginTop:12}}>Синхр.: {fmtDate(track.syncedAt)}</p>}
    </div>
  );
}

function CopyBlock({text,label,copied,onCopy}) {
  return(
    <div style={{marginTop:12,position:"relative",animation:"fadeIn .2s ease"}}>
      <pre style={{background:"#1e293b",color:"#e2e8f0",padding:16,borderRadius:8,fontSize:12,lineHeight:1.6,whiteSpace:"pre-wrap",fontFamily:"'JetBrains Mono',monospace",maxHeight:280,overflow:"auto"}}>{text}</pre>
      <button style={{position:"absolute",top:8,right:8,...S.btn,background:copied===label?"#059669":"#334155",color:"#fff",fontSize:11,padding:"4px 10px"}} onClick={onCopy}>{copied===label?"✓ Скопировано":"📋 Копировать"}</button>
    </div>
  );
}

function Field({label,value,onChange,type="text",select,selectLabels,multiline}) {
  return(
    <div style={{display:"flex",flexDirection:"column",gap:3}}>
      <label style={{fontSize:11,fontWeight:600,color:"#64748b",textTransform:"uppercase",letterSpacing:"0.5px"}}>{label}</label>
      {select?<select style={S.input} value={value} onChange={e=>onChange(e.target.value)}>{select.map((o,i)=><option key={i} value={o}>{selectLabels?selectLabels[i]:o}</option>)}</select>
      :multiline?<textarea style={{...S.input,minHeight:60,resize:"vertical"}} value={value} onChange={e=>onChange(e.target.value)}/>
      :<input style={S.input} type={type} value={value} onChange={e=>onChange(e.target.value)}/>}
    </div>
  );
}

const S = {
  root:{fontFamily:"'DM Sans',sans-serif",background:"#f8fafc",minHeight:"100vh",display:"flex",flexDirection:"column",gap:16,paddingBottom:20},
  loader:{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:"100vh"},
  spinner:{width:32,height:32,border:"3px solid #e2e8f0",borderTopColor:"#3b82f6",borderRadius:"50%",animation:"spin .8s linear infinite"},
  header:{background:"#fff",borderBottom:"1px solid #e2e8f0",padding:"16px 20px",display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:12},
  logo:{width:40,height:40,borderRadius:10,background:"linear-gradient(135deg,#1e293b,#334155)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:20},
  title:{fontSize:18,fontWeight:700,color:"#0f172a",letterSpacing:"-.3px"},
  statsBar:{display:"flex",gap:8,padding:"0 20px",overflowX:"auto"},
  statCard:{display:"flex",flexDirection:"column",alignItems:"center",padding:"10px 16px",borderRadius:8,background:"#fff",border:"1px solid #e2e8f0",cursor:"pointer",minWidth:80,transition:"all .15s"},
  chip:{padding:"5px 12px",borderRadius:20,fontSize:12,fontWeight:600,border:"none",cursor:"pointer",transition:"all .15s",whiteSpace:"nowrap"},
  panel:{background:"#fff",margin:"0 20px",padding:20,borderRadius:12,border:"1px solid #e2e8f0",boxShadow:"0 1px 3px rgba(0,0,0,.04)"},
  panelTitle:{fontSize:14,fontWeight:700,color:"#0f172a",marginBottom:6},
  btn:{padding:"8px 16px",borderRadius:8,fontSize:13,fontWeight:600,border:"none",cursor:"pointer",display:"inline-flex",alignItems:"center",gap:6,transition:"all .15s"},
  btnPrimary:{background:"#1e293b",color:"#fff"},
  btnSync:{background:"linear-gradient(135deg,#059669,#10b981)",color:"#fff"},
  btnGhost:{background:"transparent",color:"#475569"},
  btnOutline:{background:"#fff",color:"#475569",border:"1px solid #e2e8f0"},
  textarea:{width:"100%",padding:10,borderRadius:8,border:"1px solid #e2e8f0",fontSize:13,fontFamily:"'JetBrains Mono',monospace",resize:"vertical",lineHeight:1.5},
  searchInput:{width:"100%",padding:"10px 14px",borderRadius:8,border:"1px solid #e2e8f0",fontSize:13,background:"#fff"},
  input:{width:"100%",padding:"7px 10px",borderRadius:6,border:"1px solid #e2e8f0",fontSize:13,background:"#fff"},
  tableWrap:{margin:"0 20px",borderRadius:12,border:"1px solid #e2e8f0",background:"#fff",overflow:"auto",boxShadow:"0 1px 3px rgba(0,0,0,.04)"},
  table:{width:"100%",borderCollapse:"collapse"},
  tableHead:{background:"#f8fafc"},
  th:{padding:"10px 12px",fontSize:11,fontWeight:700,color:"#64748b",textAlign:"left",textTransform:"uppercase",letterSpacing:".5px",borderBottom:"1px solid #e2e8f0"},
  tr:{borderBottom:"1px solid #f1f5f9",transition:"background .15s"},
  td:{padding:"10px 12px",fontSize:13,color:"#334155"},
  badge:{padding:"3px 8px",borderRadius:5,fontSize:11,fontWeight:600,whiteSpace:"nowrap"},
  statusPill:{display:"inline-block",padding:"3px 10px",borderRadius:20,fontSize:11,fontWeight:600},
  toast:{position:"fixed",top:16,right:16,background:"#1e293b",color:"#fff",padding:"10px 20px",borderRadius:8,fontSize:13,fontWeight:500,zIndex:9999,boxShadow:"0 8px 24px rgba(0,0,0,.15)",animation:"fadeIn .3s ease"},
  footer:{padding:"8px 20px",display:"flex",justifyContent:"space-between",alignItems:"center",fontSize:12,color:"#94a3b8"},
};
