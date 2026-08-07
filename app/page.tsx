"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Phase = "idle" | "ping" | "download" | "upload" | "done";
type Result = { ping: number; jitter: number; download: number; upload: number; loss: number };
type NetInfo = { ip?: string; provider?: string; city?: string; region?: string; country?: string; colo?: string };

const initial: Result = { ping: 0, jitter: 0, download: 0, upload: 0, loss: 0 };
const labels: Record<Phase, string> = { idle: "Pronto para medir", ping: "Medindo latência", download: "Medindo download", upload: "Medindo upload", done: "Teste concluído" };

function buildPath(data: number[], w: number, h: number, maxVal: number, isArea: boolean) {
  if (!data.length) return "";
  const avg = data.reduce((a, b) => a + b, 0) / data.length;
  const max = maxVal || Math.max(avg * 2, 10);
  const totalPoints = 100; // 10s at 100ms
  const pts = data.map((val, i) => `${(i / totalPoints) * w},${h - (Math.min(val, max) / max) * h}`);
  if (isArea) return `M 0,${h} L ${pts.join(" L ")} L ${( (data.length - 1) / totalPoints ) * w},${h} Z`;
  return `M ${pts.join(" L ")}`;
}

function quality(r: Result) {
  if (!r.download) return { label: "—", score: 0, tone: "neutral" };
  let score = 100;
  score -= Math.min(35, r.ping / 4);
  score -= Math.min(20, r.jitter * 1.5);
  score -= Math.min(30, r.loss * 8);
  if (r.download < 25) score -= 18;
  if (r.upload < 8) score -= 12;
  score = Math.max(0, Math.round(score));
  return score >= 85 ? { label: "Excelente", score, tone: "great" } : score >= 65 ? { label: "Boa", score, tone: "good" } : score >= 45 ? { label: "Regular", score, tone: "warn" } : { label: "Ruim", score, tone: "bad" };
}

function describeArc(cx: number, cy: number, r: number, startAngleDeg: number, endAngleDeg: number) {
  if (endAngleDeg <= startAngleDeg + 0.1) return "";
  const startRad = (startAngleDeg * Math.PI) / 180;
  const endRad = (endAngleDeg * Math.PI) / 180;
  const x1 = cx + r * Math.cos(startRad);
  const y1 = cy + r * Math.sin(startRad);
  const x2 = cx + r * Math.cos(endRad);
  const y2 = cy + r * Math.sin(endRad);
  const largeArcFlag = endAngleDeg - startAngleDeg <= 180 ? "0" : "1";
  return `M ${x1} ${y1} A ${r} ${r} 0 ${largeArcFlag} 1 ${x2} ${y2}`;
}

export default function Home() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<Result>(initial);
  const [display, setDisplay] = useState(0);
  const [info, setInfo] = useState<NetInfo>({});
  const [historyDl, setHistoryDl] = useState<number[]>([]);
  const [historyUl, setHistoryUl] = useState<number[]>([]);
  const running = useRef(false);
  const q = useMemo(() => quality(result), [result]);
  const max = phase === "ping" ? 200 : 2000;
  const gaugeValue = phase === "ping" ? display : phase === "upload" ? display : phase === "done" ? result.download : display;
  const angle = -90 + Math.min(1, Math.max(0, gaugeValue / max)) * 180;

  useEffect(() => { fetch("/api/info").then(r => r.json()).then((data: any) => setInfo(data)).catch(() => {}); }, []);

  async function measurePing() {
    const samples: number[] = []; let failed = 0;
    for (let i = 0; i < 12; i++) {
      const t = performance.now();
      try { const res = await fetch(`/api/ping?t=${Date.now()}-${i}`, { cache: "no-store" }); if (!res.ok) throw new Error(); await res.text(); samples.push(performance.now() - t); setDisplay(samples.at(-1) || 0); }
      catch { failed++; }
    }
    const avg = samples.reduce((a,b)=>a+b,0) / Math.max(1,samples.length);
    const jitter = samples.length > 1 ? samples.slice(1).reduce((a,v,i)=>a+Math.abs(v-samples[i]),0)/(samples.length-1) : 0;
    return { ping: avg, jitter, loss: failed / 12 * 100 };
  }

  async function measureDownload() {
    const started = performance.now(); 
    let bytes = 0;
    let running = true;
    let localHist: number[] = [];
    
    const timer = setInterval(() => {
      const elapsed = (performance.now() - started) / 1000;
      if (elapsed > 0.1) {
        const speed = bytes * 8 / elapsed / 1_000_000;
        setDisplay(speed);
        localHist.push(speed);
        setHistoryDl([...localHist]);
      }
    }, 100);

    async function streamWorker(id: number) {
      let n = 0;
      while (running && performance.now() - started < 10000) {
        try {
          const res = await fetch(`/api/download?bytes=25000000&n=${n++}&id=${id}`, { cache: "no-store" });
          if (!res.body) break;
          const reader = res.body.getReader();
          while (running && performance.now() - started < 10000) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) bytes += value.byteLength;
          }
          await reader.cancel().catch(()=>{});
        } catch {}
      }
    }

    Array.from({ length: 6 }, (_, i) => streamWorker(i));
    await new Promise(r => setTimeout(r, 10000));
    running = false;
    clearInterval(timer);
    
    const elapsed = (performance.now() - started) / 1000;
    return bytes * 8 / Math.max(elapsed, 0.1) / 1_000_000;
  }

  async function measureUpload() {
    const payload = new Uint8Array(5_000_000); crypto.getRandomValues(payload.subarray(0, 65536));
    const started = performance.now(); 
    let bytes = 0;
    let running = true;
    let localHist: number[] = [];
    
    const timer = setInterval(() => {
      const elapsed = (performance.now() - started) / 1000;
      if (elapsed > 0.1) {
        const speed = bytes * 8 / elapsed / 1_000_000;
        setDisplay(speed);
        localHist.push(speed);
        setHistoryUl([...localHist]);
      }
    }, 100);

    async function streamWorker() {
      while (running && performance.now() - started < 10000) {
        try {
          const res = await fetch(`/api/upload?_t=${Date.now()}-${Math.random()}`, { method: "POST", body: payload, cache: "no-store" }); 
          if (!res.ok) throw new Error(); 
          if (running) bytes += payload.byteLength;
        } catch {}
      }
    }

    Array.from({ length: 6 }, () => streamWorker());
    await new Promise(r => setTimeout(r, 10000));
    running = false;
    clearInterval(timer);
    
    const elapsed = (performance.now() - started) / 1000;
    return bytes * 8 / Math.max(elapsed, 0.1) / 1_000_000;
  }

  async function start() {
    if (running.current) return; running.current = true; setResult(initial);
    setHistoryDl([]); setHistoryUl([]);
    try {
      setPhase("ping"); setDisplay(0); const latency = await measurePing(); setResult(r => ({...r,...latency}));
      setPhase("download"); setDisplay(0); const download = await measureDownload(); setResult(r => ({...r,download}));
      setPhase("upload"); setDisplay(0); const upload = await measureUpload(); setResult(r => ({...r,upload}));
      setPhase("done");
    } catch { setPhase("idle"); }
    finally { running.current = false; }
  }

  const unit = phase === "ping" ? "ms" : "Mbps";
  const scaleMarkers = phase === "ping"
    ? [{ val: "0", cls: "s0" }, { val: "50", cls: "s1" }, { val: "100", cls: "s2" }, { val: "150", cls: "s3" }, { val: "200+", cls: "s4" }]
    : [{ val: "0", cls: "s0" }, { val: "500", cls: "s1" }, { val: "1000", cls: "s2" }, { val: "1500", cls: "s3" }, { val: "2000+", cls: "s4" }];

  const dlVal = phase === "download" ? display : result.download;
  const ulVal = phase === "upload" ? display : result.upload;

  const dlEndAngle = 180 + Math.min(1, Math.max(0, (phase === "ping" ? 0 : dlVal) / max)) * 180;
  const ulEndAngle = 180 + Math.min(1, Math.max(0, (phase === "ping" ? 0 : ulVal) / max)) * 180;

  const angleDlPin = -90 + Math.min(1, Math.max(0, result.download / max)) * 180;
  const angleUlPin = -90 + Math.min(1, Math.max(0, result.upload / max)) * 180;

  return <main>
    <nav><div className="brand"><span className="brandMark">N</span><span>NÍVEL<span className="accent">NET</span></span></div><span className="live"><i/> diagnóstico ao vivo</span></nav>
    <section className="hero">
      <div className="intro"><p className="eyebrow">TESTE DE CONEXÃO</p><h1>Descubra a força<br/>da sua <em>internet.</em></h1><p className="sub">Velocidade é só o começo. Meça estabilidade, resposta e qualidade real da sua conexão.</p></div>
      <div className="tester">
        <div className="gauge" aria-label={`Velocidade atual ${gaugeValue.toFixed(1)} ${unit}`}>
          <div className="ticks"/>
          <svg className="svgGauge" viewBox="0 0 470 300">
            {/* Background Base Track */}
            <path d={describeArc(235, 224, 175, 180, 360)} fill="none" stroke="#e3e8e1" strokeWidth="22" strokeLinecap="round"/>
            {/* Download Arc (Emerald Green - Outer Border) */}
            {dlEndAngle > 180.1 && (
              <path d={describeArc(235, 224, 175, 180, dlEndAngle)} fill="none" stroke="#10b981" strokeWidth="22" strokeLinecap="round" className="arcPath dlPath"/>
            )}
            {/* Upload Arc (Royal Blue - Inner Concentric Arc) */}
            {ulEndAngle > 180.1 && (
              <path d={describeArc(235, 224, 150, 180, ulEndAngle)} fill="none" stroke="#3b82f6" strokeWidth="14" strokeLinecap="round" className="arcPath ulPath"/>
            )}
          </svg>
          {phase !== "ping" && result.download > 0 && (
            <div className="markerPin downloadPin" style={{ transform: `rotate(${angleDlPin}deg)` }} />
          )}
          {phase !== "ping" && result.upload > 0 && (
            <div className="markerPin uploadPin" style={{ transform: `rotate(${angleUlPin}deg)` }} />
          )}
          <div className="needle" style={{ transform: `rotate(${angle}deg)` }}><span/></div>
          <div className="hub"/>
          <div className="reading"><strong>{gaugeValue < 10 ? gaugeValue.toFixed(1) : Math.round(gaugeValue)}</strong><span>{unit}</span></div>
          {scaleMarkers.map(m => <span key={m.val} className={`scale ${m.cls}`}>{m.val}</span>)}
        </div>
        <p className={`status ${phase}`}><i/>{labels[phase]}</p>
        <div className="btnWrapper">
          <button onClick={start} disabled={running.current}>
            <span>{phase === "idle" || phase === "done" ? "INICIAR TESTE" : "TESTANDO..."}</span>
            <b>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="4" y1="12" x2="20" y2="12" />
                <polyline points="13 5 20 12 13 19" />
              </svg>
            </b>
          </button>
        </div>
      </div>
    </section>
    <section className="metrics">
      <article><span className="metricIcon">↓</span><div><small>DOWNLOAD</small><strong>{result.download ? result.download.toFixed(1) : "—"}<i> Mbps</i></strong></div></article>
      <article><span className="metricIcon">↑</span><div><small>UPLOAD</small><strong>{result.upload ? result.upload.toFixed(1) : "—"}<i> Mbps</i></strong></div></article>
      <article><span className="metricIcon">⌁</span><div><small>PING</small><strong>{result.ping ? Math.round(result.ping) : "—"}<i> ms</i></strong><p>Jitter {result.jitter ? result.jitter.toFixed(1) : "—"} ms</p></div></article>
      <article><span className="metricIcon">◇</span><div><small>PERDA</small><strong>{phase === "done" ? result.loss.toFixed(1) : "—"}<i>%</i></strong></div></article>
    </section>
    
    <section className="chartSection">
      <div className="chartHeader">
        <p className="eyebrow">ESTABILIDADE DE REDE</p>
        <div className="chartLegend">
          <span className="legendDl"><i></i> Download</span>
          <span className="legendUl"><i></i> Upload</span>
        </div>
      </div>
      <div className="chartWrapper">
        <div className="chartGrid">
          <span/> <span/> <span/> <span/> <span/>
        </div>
        <svg viewBox="0 0 1000 200" preserveAspectRatio="none" className="chartSvgData">
          <defs>
            <linearGradient id="dlGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgba(16, 185, 129, 0.35)" />
              <stop offset="100%" stopColor="rgba(16, 185, 129, 0)" />
            </linearGradient>
            <linearGradient id="ulGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgba(59, 130, 246, 0.35)" />
              <stop offset="100%" stopColor="rgba(59, 130, 246, 0)" />
            </linearGradient>
          </defs>
          
          {historyDl.length > 0 && (
            <>
              <path d={buildPath(historyDl, 1000, 200, 0, true)} fill="url(#dlGrad)" />
              <path d={buildPath(historyDl, 1000, 200, 0, false)} fill="none" stroke="#10b981" strokeWidth="4" strokeLinejoin="round" />
            </>
          )}
          {historyUl.length > 0 && (
            <>
              <path d={buildPath(historyUl, 1000, 200, 0, true)} fill="url(#ulGrad)" />
              <path d={buildPath(historyUl, 1000, 200, 0, false)} fill="none" stroke="#3b82f6" strokeWidth="4" strokeLinejoin="round" />
            </>
          )}
        </svg>
      </div>
    </section>
    <section className="details">
      <div className="connection"><p className="eyebrow">SUA CONEXÃO</p><h2>{info.provider || "Provedor será identificado"}</h2><div className="infoGrid"><p><span>IP PÚBLICO</span>{info.ip || "Detectando..."}</p><p><span>LOCALIZAÇÃO</span>{[info.city,info.region,info.country].filter(Boolean).join(", ") || "Detectando..."}</p><p><span>SERVIDOR</span>{info.colo ? `Cloudflare ${info.colo}` : "Cloudflare Edge"}</p><p><span>PROTOCOLO</span>HTTPS seguro</p></div></div>
      <div className={`score ${q.tone}`}><div className="scoreRing"><strong>{q.score || "—"}</strong><span>/100</span></div><div><small>QUALIDADE GERAL</small><h3>{q.label}</h3><p>{q.score >= 85 ? "Ótima para jogos, streaming em 4K e videochamadas." : q.score >= 65 ? "Boa para o uso diário e streaming." : q.score ? "A conexão pode oscilar em tarefas exigentes." : "Faça o teste para receber sua avaliação."}</p></div></div>
    </section>
    <footer><span>Os resultados podem variar conforme Wi‑Fi, dispositivo e horário.</span><span>Teste até a borda Cloudflare mais próxima.</span></footer>
  </main>;
}
