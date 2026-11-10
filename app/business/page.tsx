"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { TOPICS } from "@/lib/product";
import styles from "./business.module.css";

type Section = { id: string; label: string; title: string; rows: { a: string; b: string }[] };
type Mapping = { gesture: string; sectionId: string; part: string; mode: string };
type BusinessConfig = { productName: string; documentName: string; modelName: string; sections: Section[]; mappings: Mapping[] };

const DEMO_SECTIONS: Section[] = TOPICS.map((topic) => ({
  id: topic.id,
  label: topic.short,
  title: topic.title,
  rows: topic.rows.map(({ a, b }) => ({ a, b })),
}));
const START_MAPPINGS: Mapping[] = [
  { gesture: "1 swipe right", sectionId: "what", part: "Whole product", mode: "Slow turn" },
  { gesture: "2 swipes right", sectionId: "how", part: "Driver", mode: "Explode apart" },
  { gesture: "3 swipes right", sectionId: "different", part: "Microphones", mode: "Highlight" },
  { gesture: "Swipe up", sectionId: "specs", part: "Battery", mode: "Highlight" },
  { gesture: "Swipe left", sectionId: "what", part: "Whole product", mode: "Put back together" },
];
const STORAGE_KEY = "playform.business.draft.v1";
const PARTS = ["Whole product", "Ear tip", "Driver", "Battery", "Chip board", "Microphones", "Charging case", "None"];
const MODES = ["Slow turn", "Explode apart", "Highlight", "Zoom in", "Put back together"];
const defaultConfig: BusinessConfig = {
  productName: "Orbit Earbuds",
  documentName: "",
  modelName: "",
  sections: DEMO_SECTIONS,
  mappings: START_MAPPINGS,
};

export default function BusinessPage() {
  const [step, setStep] = useState(0);
  const [config, setConfig] = useState<BusinessConfig>(defaultConfig);
  const [ready, setReady] = useState(false);
  const [selected, setSelected] = useState("what");
  const [notice, setNotice] = useState("");
  const [extraFileNames, setExtraFileNames] = useState<string[]>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as BusinessConfig;
        if (saved && Array.isArray(saved.sections) && Array.isArray(saved.mappings)) setConfig(saved);
      }
    } catch { /* Start fresh when storage is unavailable */ }
    setReady(true);
  }, []);

  const save = (next: BusinessConfig) => {
    setConfig(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      setNotice("Draft saved in this browser.");
    } catch {
      setNotice("Storage unavailable. Changes will last until you refresh.");
    }
  };
  const updateSection = (id: string, transform: (section: Section) => Section) =>
    save({ ...config, sections: config.sections.map((section) => section.id === id ? transform(section) : section) });
  const upload = (kind: "documentName" | "modelName", files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    const allowed = kind === "documentName" ? /\.(pdf|docx?)$/i : /\.(svg|png|jpe?g|glb|gltf|obj|stl|fbx)$/i;
    if (!allowed.test(file.name)) {
      setNotice("Unsupported file type. Please choose one of the listed formats.");
      return;
    }
    // The browser stores the filename only. Real file processing and uploading are not yet connected.
    save({ ...config, [kind]: file.name });
    if (files && files.length > 1) setExtraFileNames(Array.from(files).slice(1).map(f => f.name));
  };

  const current = config.sections.find(section => section.id === selected) || config.sections[0];
  return (
    <main className={styles.root}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <div><div className={styles.eyebrow}>PLAYFORM / BUSINESS SETUP</div><h1>SET UP YOUR DEMO</h1></div>
          <div className={styles.headerRight}><span className={styles.prototype}>PROTOTYPE · LOCAL DRAFT</span><Link href="/" target="_blank" rel="noopener noreferrer">VIEW EXISTING KIOSK ↗</Link></div>
        </header>

        <nav className={styles.steps} aria-label="Setup steps">
          {["UPLOAD", "REVIEW CONTENT", "MAP INTERACTIONS"].map((label, index) => (
            <button key={label} type="button" className={step === index ? styles.activeStep : ""} onClick={() => setStep(index)}>
              <span>{index + 1}</span>{label}
            </button>
          ))}
        </nav>

        {step === 0 && <section className={styles.panel}>
          <div className={styles.sectionTop}><div><div className={styles.eyebrow}>STEP 01 / AUTO INPUT</div><h2>QUICK SETUP</h2><p>Upload what you already have. For now, the Orbit Earbuds demonstration is used as a sample output.</p></div></div>
          <label className={styles.fieldLabel} htmlFor="product-name">PRODUCT NAME</label>
          <input id="product-name" className={styles.textInput} value={config.productName} onChange={event => save({ ...config, productName: event.target.value })} />
          <div className={styles.uploadGrid}>
            <label className={styles.upload}>
              <strong>1 · PRODUCT DOCUMENT</strong><span className={styles.uploadIcon}>↑</span>
              <span>{config.documentName || "Choose PDF, DOC, or DOCX"}</span>
              <small>Click to select a file</small>
              <input type="file" accept=".pdf,.doc,.docx" onChange={event => upload("documentName", event.target.files)} />
            </label>
            <label className={styles.upload}>
              <strong>2 · PRODUCT IMAGE OR 3D MODEL</strong><span className={styles.uploadIcon}>◇</span>
              <span>{config.modelName || "Choose SVG, PNG, JPG, GLB, GLTF, OBJ, STL, or FBX"}</span>
              <small>Click to select a file</small>
              <input type="file" accept=".svg,.png,.jpg,.jpeg,.glb,.gltf,.obj,.stl,.fbx" onChange={event => upload("modelName", event.target.files)} />
            </label>
          </div>
          {extraFileNames.length > 0 && <p className={styles.muted}>Additional files selected: {extraFileNames.join(", ")} (not processed in this version)</p>}
          <div className={styles.info}>DEMO LIMITATION · Files are selected locally, but not uploaded to a server or analyzed. The next screen is a predefined sample, not an AI-generated result from your files.</div>
          <div className={styles.actions}><button className={styles.primary} onClick={() => { setStep(1); setNotice("Showing predefined Orbit Earbuds demo content."); }}>REVIEW SAMPLE DEMO →</button></div>
        </section>}

        {step === 1 && <section className={styles.panel}>
          <div className={styles.sectionTop}><div><div className={styles.eyebrow}>STEP 02 / CONTENT</div><h2>REVIEW YOUR DEMO</h2><p>Edit the sample sections that would appear in the kiosk. Your edits are saved locally.</p></div><span className={styles.prototype}>PREDEFINED SAMPLE · NOT AI OUTPUT</span></div>
          <div className={styles.cards}>
            {config.sections.map(section => <button key={section.id} className={selected === section.id ? styles.selectedCard : styles.topicCard} onClick={() => setSelected(section.id)}>
              <strong>{section.label.toUpperCase()}</strong><span>{section.title}</span><small>{section.rows.length} content items · EDIT ↗</small>
            </button>)}
          </div>
          <div className={styles.editor}>
            <div><div className={styles.eyebrow}>EDIT SECTION / {current.label.toUpperCase()}</div>
              <label className={styles.fieldLabel} htmlFor="section-title">SECTION HEADLINE</label>
              <input id="section-title" className={styles.textInput} value={current.title} onChange={event => updateSection(current.id, s => ({ ...s, title: event.target.value }))} />
              <div className={styles.fieldLabel}>EXPLANATION ROWS</div>
              {current.rows.map((row, index) => <div className={styles.rowInputs} key={index}>
                <input aria-label={`Item ${index + 1} title`} value={row.a} onChange={event => updateSection(current.id, s => ({ ...s, rows: s.rows.map((r, i) => i === index ? { ...r, a: event.target.value } : r) }))} />
                <input aria-label={`Item ${index + 1} detail`} value={row.b} onChange={event => updateSection(current.id, s => ({ ...s, rows: s.rows.map((r, i) => i === index ? { ...r, b: event.target.value } : r) }))} placeholder="Supporting explanation" />
              </div>)}
              <button className={styles.secondary} onClick={() => updateSection(current.id, s => ({ ...s, rows: [...s.rows, { a: "New detail", b: "" }] }))}>+ ADD DETAIL</button>
            </div>
            <aside className={styles.insight}><div className={styles.eyebrow}>WHAT VISITORS WILL SEE</div><h3>{current.label}</h3><p>{current.title}</p>{current.rows.map((row, i) => <div className={styles.previewRow} key={i}><b>{row.a}</b><span>{row.b}</span></div>)}</aside>
          </div>
          <div className={styles.actions}><button className={styles.secondary} onClick={() => setStep(0)}>← BACK</button><button className={styles.primary} onClick={() => setStep(2)}>CHECK GESTURES →</button></div>
        </section>}

        {step === 2 && <section className={styles.panel}>
          <div className={styles.sectionTop}><div><div className={styles.eyebrow}>STEP 03 / INTERACTIONS</div><h2>MAP INTERACTIONS</h2><p>Choose which content and model action each gesture should show. These mappings are a configuration mockup; the current kiosk still uses its original gestures.</p></div></div>
          <div className={styles.mappingHeading}><span>GESTURE</span><span>SHOW THIS SECTION</span><span>HIGHLIGHT THIS PART</span><span>MODEL ACTION</span><span /></div>
          {config.mappings.map((mapping, index) => <div className={styles.mappingRow} key={index}>
            <input aria-label="Gesture" value={mapping.gesture} onChange={event => save({ ...config, mappings: config.mappings.map((m, i) => i === index ? { ...m, gesture: event.target.value } : m) })} />
            <select aria-label="Section" value={mapping.sectionId} onChange={event => save({ ...config, mappings: config.mappings.map((m, i) => i === index ? { ...m, sectionId: event.target.value } : m) })}>{config.sections.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}</select>
            <select aria-label="Part" value={mapping.part} onChange={event => save({ ...config, mappings: config.mappings.map((m, i) => i === index ? { ...m, part: event.target.value } : m) })}>{PARTS.map(p => <option key={p}>{p}</option>)}</select>
            <select aria-label="Model action" value={mapping.mode} onChange={event => save({ ...config, mappings: config.mappings.map((m, i) => i === index ? { ...m, mode: event.target.value } : m) })}>{MODES.map(m => <option key={m}>{m}</option>)}</select>
            <button className={styles.deleteButton} aria-label="Remove mapping" onClick={() => save({ ...config, mappings: config.mappings.filter((_, i) => i !== index) })}>×</button>
          </div>)}
          <button className={styles.secondary} onClick={() => save({ ...config, mappings: [...config.mappings, { gesture: "New gesture", sectionId: "what", part: "None", mode: "Highlight" }] })}>+ ADD INTERACTION</button>
          <div className={styles.info}>NOT YET CONNECTED · Editing this table saves a draft only. Gesture mapping and model changes have not been applied to the existing kiosk.</div>
          <div className={styles.actions}><button className={styles.secondary} onClick={() => setStep(1)}>← BACK</button><button className={styles.secondary} onClick={() => { const blob = new Blob([JSON.stringify(config, null, 2)], { type: "application/json" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = "playform-product-config.json"; a.click(); URL.revokeObjectURL(url); setNotice("Configuration JSON downloaded."); }}>DOWNLOAD CONFIG ↓</button><Link className={styles.primary} href="/" target="_blank" rel="noopener noreferrer">OPEN EXISTING KIOSK ↗</Link></div>
        </section>}

        {ready && notice && <div role="status" className={styles.status}>{notice}</div>}
        <footer className={styles.footer}><span>PLAYFORM / BUSINESS PORTAL · WORK IN PROGRESS</span><span>Changes are stored only in this browser. Nothing has been published to the kiosk.</span></footer>
      </div>
    </main>
  );
}
