"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { MODEL, PRODUCT, STAFF, STAFF_ETA, TOPICS, type PartId } from "@/lib/product";
import { exploredTopics, longestTopic, minutesAt, type LeadMethod, type Session } from "@/lib/session";
import Model3D from "./Model3D";
import styles from "./kiosk.module.css";

// Hold a hand over anything marked data-dwell for that many ms and it activates (Kiosk.tsx runs it).
// Topics also open when the mouse rests on them (data-dwell-mouse), as in the design.
export const DWELL_TOPIC_MS = 900;
export const DWELL_BUTTON_MS = 1200;

const HandIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#BFD8FF" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9 11V5a1.5 1.5 0 0 1 3 0v5" />
    <path d="M12 10V4a1.5 1.5 0 0 1 3 0v6" />
    <path d="M15 10V6a1.5 1.5 0 0 1 3 0v7a7 7 0 0 1-7 7h-.5a6 6 0 0 1-5-2.7L3 14a1.6 1.6 0 0 1 2.6-1.8L9 15V11" />
  </svg>
);

/** A button a hand can hold over to press: shows a filling bar while the hand dwells. */
function HandButton(props: { className: string; onClick: () => void; children: ReactNode; ms?: number; label?: string }) {
  return (
    <button type="button" className={props.className} onClick={props.onClick} data-dwell={props.ms ?? DWELL_BUTTON_MS} aria-label={props.label}>
      {props.children}
      <span className={styles.dwellBar} aria-hidden="true" />
    </button>
  );
}

// ---- Topic hub ---------------------------------------------------------------
export function Hub(props: {
  topic: number;
  onPick: (i: number) => void;
  hoverPart: PartId | null;
  explode: number;
  accent: string;
  guide: { title: string; sub: string; tip: boolean };
  attract: boolean;
  onTeam: () => void;
  onBrochure: () => void;
}) {
  const t = TOPICS[props.topic];
  const { hoverPart } = props;
  const highlight = useMemo(() => (hoverPart ? [hoverPart] : t.highlight), [hoverPart, t]);
  return (
    <>
      <div className={styles.eyebrow}>
        {PRODUCT.name} / {PRODUCT.brand} · {PRODUCT.booth}
      </div>
      <HandButton className={styles.teamLink} onClick={props.onTeam}>
        <HandIcon />
        TALK TO OUR TEAM
      </HandButton>

      <nav className={styles.topics} aria-label="Topics">
        <span className={styles.topicsLabel}>WHAT DO YOU WANT TO KNOW?</span>
        {TOPICS.map((tp, i) => {
          const on = i === props.topic;
          return (
            <button
              key={tp.id}
              type="button"
              className={styles.topic}
              data-dwell={DWELL_TOPIC_MS}
              data-dwell-mouse=""
              data-current={on ? "" : undefined}
              aria-current={on ? "true" : undefined}
              onClick={() => props.onPick(i)}
            >
              <span className={styles.topicNum}>
                <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden="true">
                  <circle cx="20" cy="20" r="18" fill="none" stroke="rgba(255,255,255,0.14)" strokeWidth="1.5" />
                  <circle cx="20" cy="20" r="18" fill="none" stroke={props.accent} strokeWidth="2.5" strokeLinecap="round" strokeDasharray="113" className={styles.dwellRing} />
                </svg>
                {tp.n}
              </span>
              <span className={styles.topicLabel}>{tp.label}</span>
            </button>
          );
        })}
      </nav>

      <Model3D geo={MODEL} accent={props.accent} explode={props.explode} highlight={highlight} />

      <section key={t.id} className={styles.panel} aria-live="polite">
        <span className={styles.panelKicker}>
          {t.n} · {t.label}
        </span>
        <h1 className={styles.panelTitle}>{t.title}</h1>
        <div className={styles.rows}>
          {t.rows.map((r) => (
            <div
              key={r.a}
              className={styles.row}
              data-part={r.part}
              style={r.part && r.part === props.hoverPart ? { color: props.accent } : undefined}
            >
              <span className={styles.rowA}>{r.a}</span>
              {r.b && <span className={styles.rowB}>{r.b}</span>}
            </div>
          ))}
        </div>
      </section>

      <div className={styles.guide}>
        <span key={props.guide.title} className={styles.guideTitle}>
          {props.guide.title}
        </span>
        <span className={styles.guideSub} style={props.guide.tip ? { color: props.accent } : undefined}>
          {props.guide.sub}
        </span>
        {props.attract && (
          <span className={styles.attractDots} aria-hidden="true">
            {TOPICS.map((tp, i) => (
              <span key={tp.id} data-on={i === props.topic ? "" : undefined} />
            ))}
          </span>
        )}
      </div>
      <HandButton className={styles.brochureLink} onClick={props.onBrochure}>
        GET THE BROCHURE <span aria-hidden="true">→</span>
      </HandButton>
    </>
  );
}

// ---- Ask for a team member --------------------------------------------------
export function Staff(props: {
  session: Session;
  onBack: () => void;
  onLead: () => void;
  onAccept: () => void;
  onPass: () => void;
}) {
  const s = props.session;
  const staff = STAFF[s.staff % STAFF.length];
  const explored = exploredTopics(s);
  const longest = longestTopic(s);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(id);
  }, []);
  const askedFor = s.staffAsked ? Math.max(0, Math.round((now - s.staffAsked) / 60000)) : 0;

  return (
    <>
      <div className={styles.eyebrow}>{PRODUCT.name} / ASK OUR TEAM</div>

      <div className={styles.staffBlock}>
        <div className={styles.staffWho}>
          <span className={styles.avatar}>{staff.initials}</span>
          <span className={styles.staffWhoText}>
            <span className={styles.kicker}>{s.staffAccepted ? "ON THE WAY" : "LETTING THEM KNOW"}</span>
            <span className={styles.staffName}>{staff.name}</span>
          </span>
        </div>
        <span className={styles.staffHeading}>A TEAM MEMBER WILL BE WITH YOU IN ABOUT {STAFF_ETA}</span>
        <span className={styles.staffBody}>
          They already know what you looked at, so you can skip the basics and go straight to your questions.
        </span>
        <div className={styles.staffButtons}>
          <HandButton className={styles.btnFilled} onClick={props.onBack}>
            KEEP EXPLORING
          </HandButton>
          <HandButton className={styles.btnOutline} onClick={props.onLead}>
            CAN’T WAIT? GET A FOLLOW-UP
          </HandButton>
        </div>
      </div>

      {/* Prototype stand-in for the staff tablet: the buttons work with a mouse or touch. */}
      <span className={styles.tabletCaption}>WHAT THE SALESPERSON SEES · STAFF TABLET</span>
      <div className={styles.tablet}>
        <div className={styles.tabletCard}>
          <div className={styles.tabletHead}>
            <span className={styles.tabletKicker}>
              PLAYFORM · {PRODUCT.kiosk} · VISITOR WAITING
            </span>
            <span className={styles.tabletNow}>{s.staffAccepted ? "Accepted" : askedFor ? `${askedFor} min ago` : "Now"}</span>
          </div>
          <div className={styles.tabletWho}>
            <span className={styles.tabletName}>{s.sent === "email" && s.email ? s.email : "[Visitor name]"}</span>
            <span className={styles.tabletSub}>
              {s.sent === "email" ? `${s.company || "[Company]"} — typed at the kiosk` : `[Job title] · ${s.company || "[Company]"} — from badge scan`}
            </span>
          </div>
          <div className={styles.tabletExplored}>
            <span className={styles.tabletKicker}>EXPLORED</span>
            <div className={styles.chips}>
              {explored.length ? (
                explored.map((t) => (
                  <span key={t.id} className={styles.tabletChip}>
                    {t.short}
                  </span>
                ))
              ) : (
                <span className={styles.tabletEmpty}>Nothing yet: start with the overview</span>
              )}
            </div>
          </div>
          <div className={styles.tabletRows}>
            <div>
              <span>Spent longest on</span>
              <b>{longest ? longest.short : "—"}</b>
            </div>
            <div>
              <span>Time at kiosk</span>
              <b>{minutesAt(s, now)}</b>
            </div>
            <div>
              <span>Wants pricing follow-up</span>
              <b>{s.pricing ? "Yes" : "No"}</b>
            </div>
          </div>
          <div className={styles.tabletButtons}>
            <button type="button" className={styles.tabletPrimary} onClick={props.onAccept} disabled={s.staffAccepted}>
              {s.staffAccepted ? "ON MY WAY ✓" : "I’M ON MY WAY"}
            </button>
            <button type="button" className={styles.tabletSecondary} onClick={props.onPass}>
              PASS TO TEAMMATE
            </button>
          </div>
        </div>
      </div>

      <div className={styles.guide}>
        <span className={styles.guideTitleSmall}>YOUR SPOT IS SAVED</span>
        <span className={styles.guideSub}>Feel free to keep looking around the booth</span>
      </div>
    </>
  );
}

// ---- Take the brochure (lead capture) -----------------------------------------
const BADGE_SCAN_MS = 2500; // prototype: the badge "scan" is simulated

export function Lead(props: {
  session: Session;
  onChange: (patch: Partial<Session>) => void;
  onSent: (method: LeadMethod) => void;
  onBack: () => void;
  onTeam: () => void;
}) {
  const s = props.session;
  const [method, setMethod] = useState<LeadMethod>("badge");
  const [scanning, setScanning] = useState(false);
  const [emailError, setEmailError] = useState(false);
  const scanTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(scanTimer.current), []);
  const explored = exploredTopics(s);

  const scanBadge = () => {
    setMethod("badge");
    if (scanning) return;
    setScanning(true);
    scanTimer.current = setTimeout(() => {
      setScanning(false);
      props.onSent("badge");
    }, BADGE_SCAN_MS);
  };
  const sendEmail = () => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.email.trim())) {
      setEmailError(true);
      return;
    }
    props.onSent("email");
  };

  if (s.sent) {
    const to =
      s.sent === "email" ? s.email : s.sent === "badge" ? "the email on your badge" : "your phone";
    return (
      <>
        <div className={styles.eyebrow}>{PRODUCT.name} / TAKE IT WITH YOU</div>
        <div className={styles.sentBlock}>
          <span className={styles.sentCheck} aria-hidden="true">
            ✓
          </span>
          <span className={styles.staffHeading}>THE BROCHURE IS ON ITS WAY</span>
          <span className={styles.staffBody}>
            We’ll send it to {to}, with the topics you explored and pricing.{s.pricing ? " Someone from our team will also follow up about pricing." : ""}
          </span>
          <div className={styles.staffButtons}>
            <HandButton className={styles.btnFilled} onClick={props.onBack}>
              KEEP EXPLORING
            </HandButton>
            <HandButton className={styles.btnOutline} onClick={props.onTeam}>
              TALK TO OUR TEAM
            </HandButton>
          </div>
        </div>
        <div className={styles.guide}>
          <span className={styles.guideTitleSmall}>THANKS FOR STOPPING BY</span>
        </div>
      </>
    );
  }

  return (
    <>
      <div className={styles.eyebrow}>{PRODUCT.name} / TAKE IT WITH YOU</div>
      <HandButton className={styles.backLink} onClick={props.onBack}>
        ← BACK TO EXPLORING
      </HandButton>

      <div className={styles.leadHead}>
        <span className={styles.leadTitle}>GET THE FULL BROCHURE</span>
        <span className={styles.staffBody}>Pick the easiest way. We’ll include the topics you explored, plus pricing.</span>
      </div>

      <div className={styles.leadGrid}>
        <button
          type="button"
          className={styles.leadCard}
          data-selected={method === "badge" ? "" : undefined}
          data-dwell={DWELL_BUTTON_MS}
          onClick={scanBadge}
        >
          <span className={styles.leadCardTop}>
            <svg width="56" height="56" viewBox="0 0 56 56" fill="none" stroke="#BFD8FF" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="12" y="8" width="32" height="44" rx="5" />
              <path d="M23 8V4h10v4" />
              <rect x="19" y="20" width="18" height="18" rx="2" />
              <path d="M23 24h4v4h-4zM29 30h4v4h-4zM29 24h4M23 34h4" />
            </svg>
            <span className={styles.fastest}>FASTEST</span>
          </span>
          <span className={styles.leadCardTitle}>SCAN YOUR BADGE</span>
          <span className={styles.leadCardBody}>
            {scanning
              ? "Looking for your badge… hold it still in front of the camera."
              : "Hold your conference badge up to the camera. We’ll send it to the email on your badge."}
          </span>
          {scanning && <span className={styles.scanBar} aria-hidden="true" />}
          <span className={styles.dwellBar} aria-hidden="true" />
        </button>

        <button
          type="button"
          className={styles.leadCard}
          data-selected={method === "phone" ? "" : undefined}
          data-dwell={DWELL_BUTTON_MS}
          onClick={() => setMethod("phone")}
        >
          <span className={styles.qr}>[QR]</span>
          <span className={styles.leadCardTitle}>SCAN WITH YOUR PHONE</span>
          <span className={styles.leadCardBody}>
            {method === "phone" ? "Point your phone’s camera at the code. It opens right away." : "Opens the brochure on your phone. Nothing to type."}
          </span>
          <span className={styles.dwellBar} aria-hidden="true" />
        </button>

        <form
          className={styles.leadCard}
          data-selected={method === "email" ? "" : undefined}
          onFocus={() => setMethod("email")}
          onSubmit={(e) => {
            e.preventDefault();
            sendEmail();
          }}
        >
          <label htmlFor="lead-email" className={styles.leadCardTitle}>
            TYPE YOUR EMAIL
          </label>
          <input
            id="lead-email"
            type="email"
            placeholder="you@company.com"
            autoComplete="off"
            className={styles.input}
            aria-invalid={emailError || undefined}
            value={s.email}
            onChange={(e) => {
              setEmailError(false);
              props.onChange({ email: e.target.value });
            }}
          />
          <label htmlFor="lead-company" className={styles.inputLabel}>
            COMPANY (OPTIONAL)
          </label>
          <input
            id="lead-company"
            type="text"
            placeholder="[Company]"
            autoComplete="off"
            className={`${styles.input} ${styles.inputSmall}`}
            value={s.company}
            onChange={(e) => props.onChange({ company: e.target.value })}
          />
          {(method === "email" || s.email) && (
            <button type="submit" className={styles.sendBtn}>
              {emailError ? "CHECK THE EMAIL ADDRESS" : "SEND IT"}
            </button>
          )}
        </form>
      </div>

      <div className={styles.leadFoot}>
        <div className={styles.chips}>
          <span className={styles.chipsLabel}>YOU LOOKED AT</span>
          {explored.length ? (
            explored.map((t) => (
              <span key={t.id} className={styles.chip}>
                {t.short}
              </span>
            ))
          ) : (
            <span className={styles.chip}>The overview</span>
          )}
        </div>
        <label className={styles.check} data-dwell={DWELL_BUTTON_MS}>
          <input type="checkbox" checked={s.pricing} onChange={(e) => props.onChange({ pricing: e.target.checked })} />
          Have someone follow up about pricing
        </label>
      </div>
      <p className={styles.consent}>
        [Consent wording — e.g. “By sharing your details you agree that {PRODUCT.brand} can contact you about this product.” Privacy
        policy: [link]]
      </p>

      <div className={styles.guide}>
        <span className={styles.guideTitleSmall}>NO APP OR SIGN-UP NEEDED</span>
      </div>
    </>
  );
}
