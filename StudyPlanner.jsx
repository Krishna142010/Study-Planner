import React, { useState, useMemo } from "react";
import {
  Home,
  Settings2,
  ListOrdered,
  CalendarClock,
  NotebookPen,
  CheckCircle2,
  Plus,
  X,
  GripVertical,
  Flame,
  Clock,
  History as HistoryIcon,
  TrendingUp,
  Coffee,
  Moon,
  Sun,
} from "lucide-react";

// ---------------------------------------------------------------------------
// FUTURE SUPABASE MIGRATION NOTE
// Every piece of state below (fixed, subjects, homework, disruption, history)
// is a flat array/object that maps 1:1 onto a table:
//   users            (from Supabase Auth)
//   fixed_commitments(id, user_id, label, start, end, buffer)
//   subjects         (id, user_id, name, exam_date)
//   topics           (id, subject_id, name, est_minutes, done, position)
//   homework         (id, user_id, label, est_minutes, due_in_days, done)
//   disruptions      (id, user_id, type, start_date, end_date)
//   history          (id, user_id, date, summary jsonb)
// Swap each useState for a query on mount + writes on mutation once auth is in.
// ---------------------------------------------------------------------------

// ---------- Design tokens ----------
// ink navy panels, warm paper text, amber = urgent, teal = calm study, rose = disruption
const C = {
  bg: "#12141C",
  panel: "#1B1F2A",
  panel2: "#212636",
  paper: "#ECE7DD",
  muted: "#8B93A1",
  line: "#2B3040",
  amber: "#E8A33D",
  teal: "#4FA69C",
  rose: "#D8674F",
  violet: "#9C8CD6",
};

const FONT_DISPLAY = "'Fraunces', Georgia, serif";
const FONT_BODY = "'Inter', system-ui, sans-serif";
const FONT_MONO = "'IBM Plex Mono', monospace";

const uid = () => Math.random().toString(36).slice(2, 9);
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

// ---------- Deterministic topic-ordering heuristic ----------
const FRONT_WORDS = ["intro", "basic", "fundamental", "definition", "overview", "foundation"];
const BACK_WORDS = ["advance", "application", "project", "revision", "practice test", "case study"];
function heuristicOrder(topics) {
  const score = (t) => {
    const s = t.name.toLowerCase();
    if (FRONT_WORDS.some((w) => s.includes(w))) return 0;
    if (BACK_WORDS.some((w) => s.includes(w))) return 2;
    return 1;
  };
  return [...topics].sort((a, b) => score(a) - score(b));
}

// ---------- Time helpers ----------
// Wake/sleep are no longer hardcoded — they come from what the person enters
// in Setup, so someone who wakes at 5am and someone who wakes at 9am both get
// a plan built around their own day, not an assumed one.
function toMin(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}
function toHHMM(min) {
  min = clamp(Math.round(min), 0, 24 * 60 - 1);
  const h = Math.floor(min / 60);
  const m = min % 60;
  const suffix = h >= 12 ? "pm" : "am";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")}${suffix}`;
}

// ---------- Core scheduling algorithm (pure logic, no AI, no API key) ----------
function buildFreeWindows(fixedBlocks, dayStart, dayEnd) {
  const BUFFER = 40;
  const busy = fixedBlocks
    .map((b) => ({
      start: toMin(b.start) - (b.buffer ? BUFFER : 0),
      end: toMin(b.end) + (b.buffer ? BUFFER : 0),
    }))
    .sort((a, b) => a.start - b.start);

  let windows = [{ start: dayStart, end: dayEnd }];
  for (const b of busy) {
    const next = [];
    for (const w of windows) {
      if (b.end <= w.start || b.start >= w.end) {
        next.push(w);
        continue;
      }
      if (b.start > w.start) next.push({ start: w.start, end: Math.max(w.start, b.start) });
      if (b.end < w.end) next.push({ start: Math.min(w.end, b.end), end: w.end });
    }
    windows = next.filter((w) => w.end - w.start >= 15);
  }
  return windows;
}

function generatePlan({ fixedBlocks, homework, subjects, disruption, isDisruptedToday, daysUntil, dayStart, dayEnd }) {
  const windows = buildFreeWindows(fixedBlocks, dayStart, dayEnd).map((w) => ({ ...w }));
  const blocks = [];

  function place(minutesNeeded, task) {
    let remaining = minutesNeeded;
    for (const w of windows) {
      if (remaining <= 0) break;
      const avail = w.end - w.start;
      if (avail < 15) continue;
      const take = Math.min(avail, remaining);
      blocks.push({
        id: uid(),
        start: w.start,
        end: w.start + take,
        ...task,
        partial: take < minutesNeeded,
      });
      w.start += take;
      remaining -= take;
    }
    return remaining <= 0;
  }

  // 1) Homework due soonest — non-negotiable, highest priority
  const urgentHW = homework
    .filter((h) => !h.done)
    .sort((a, b) => a.dueInDays - b.dueInDays);
  for (const h of urgentHW) {
    place(h.estMinutes, {
      kind: "homework",
      label: h.label,
      reason:
        h.dueInDays <= 0
          ? `Due today — locked in first`
          : `Due in ${h.dueInDays}d — scheduled before syllabus work`,
      color: C.rose,
      refId: h.id,
    });
  }

  if (isDisruptedToday) {
    const lastDone = subjects
      .flatMap((s) => s.topics.filter((t) => t.done).map((t) => ({ ...t, subject: s.name })))
      .slice(-2);
    for (const t of lastDone) {
      place(20, {
        kind: "revision",
        label: `${t.subject}: ${t.name}`,
        reason: `Quick recap while you're away/unwell — keeps it fresh, no new load`,
        color: C.muted,
      });
    }
    return blocks.sort((a, b) => a.start - b.start);
  }

  // Returning today from a disruption that just ended — insert a revision block first
  if (disruption?.justEnded) {
    const lastDone = subjects
      .flatMap((s) => s.topics.filter((t) => t.done).map((t) => ({ ...t, subject: s.name })))
      .slice(-2);
    for (const t of lastDone) {
      place(25, {
        kind: "revision",
        label: `${t.subject}: ${t.name}`,
        reason: `Welcome back — quick refresh before new material`,
        color: C.muted,
      });
    }
  }

  // 2) Exam-imminent topics (within 7 days), unfinished
  for (const s of subjects) {
    const days = daysUntil(s.examDate);
    if (days !== null && days <= 7 && days >= 0) {
      const next = s.topics.find((t) => !t.done);
      if (next) {
        place(Math.min(next.estMinutes, 60), {
          kind: "revision-priority",
          label: `${s.name}: ${next.name}`,
          reason: `Exam in ${days}d — takes priority right now`,
          color: C.amber,
          refId: next.id,
          subjectId: s.id,
        });
      }
    }
  }

  // 3) Next syllabus topic per subject (skip subjects already handled above)
  const handledSubjectIds = new Set(
    blocks.filter((b) => b.kind === "revision-priority").map((b) => b.subjectId)
  );
  for (const s of subjects) {
    if (handledSubjectIds.has(s.id)) continue;
    const next = s.topics.find((t) => !t.done);
    if (next) {
      place(next.estMinutes, {
        kind: "syllabus",
        label: `${s.name}: ${next.name}`,
        reason: `Next in your ${s.name} syllabus`,
        color: C.teal,
        refId: next.id,
        subjectId: s.id,
      });
    }
  }

  // 4) Second pass — if the day has room left, give subjects another block.
  // No hardcoded universal extras: whatever's left goes back into whatever the
  // person actually added, so the plan reflects their own mix, not a preset one.
  for (const s of subjects) {
    const next = s.topics.find((t) => !t.done && !blocks.some((b) => b.refId === t.id));
    if (next) {
      place(Math.min(next.estMinutes, 30), {
        kind: "syllabus-extra",
        label: `${s.name}: ${next.name}`,
        reason: `Extra time today — getting ahead on ${s.name}`,
        color: C.violet,
        refId: next.id,
        subjectId: s.id,
      });
    }
  }

  return blocks.sort((a, b) => a.start - b.start);
}

// ---------- Small UI atoms ----------
function Section({ title, eyebrow, children, right, icon: Icon }) {
  return (
    <div style={{ marginBottom: 36, animation: "fadeUp .35s ease both" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
        <div>
          {eyebrow && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: FONT_MONO, fontSize: 11, letterSpacing: 2, color: C.muted, textTransform: "uppercase", marginBottom: 6 }}>
              {Icon && <Icon size={12} />} {eyebrow}
            </div>
          )}
          <h2 style={{ fontFamily: FONT_DISPLAY, fontSize: 23, color: C.paper, margin: 0, fontWeight: 600 }}>{title}</h2>
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}

function Btn({ children, onClick, variant = "primary", style, disabled }) {
  const base = {
    fontFamily: FONT_BODY,
    fontSize: 14,
    fontWeight: 600,
    padding: "10px 18px",
    borderRadius: 8,
    border: "none",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.4 : 1,
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    transition: "transform .12s ease, opacity .12s ease, box-shadow .15s ease",
  };
  const variants = {
    primary: { background: C.amber, color: "#1A1200" },
    ghost: { background: "transparent", color: C.paper, border: `1px solid ${C.line}` },
    teal: { background: C.teal, color: "#062421" },
  };
  return (
    <button
      onClick={disabled ? undefined : onClick}
      style={{ ...base, ...variants[variant], ...style }}
      onMouseDown={(e) => !disabled && (e.currentTarget.style.transform = "scale(0.97)")}
      onMouseUp={(e) => (e.currentTarget.style.transform = "scale(1)")}
      onMouseEnter={(e) => !disabled && (e.currentTarget.style.boxShadow = "0 4px 14px rgba(0,0,0,.25)")}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = "scale(1)";
        e.currentTarget.style.boxShadow = "none";
      }}
    >
      {children}
    </button>
  );
}

function Input({ value, onChange, placeholder, type = "text", style }) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      type={type}
      style={{
        background: C.panel2,
        border: `1px solid ${C.line}`,
        borderRadius: 8,
        padding: "10px 12px",
        color: C.paper,
        fontFamily: FONT_BODY,
        fontSize: 14,
        outline: "none",
        width: "100%",
        boxSizing: "border-box",
        ...style,
      }}
    />
  );
}

function ProgressBar({ pct, color = C.teal }) {
  return (
    <div style={{ background: C.panel2, borderRadius: 6, height: 6, overflow: "hidden" }}>
      <div style={{ width: `${clamp(pct, 0, 100)}%`, height: "100%", background: color, transition: "width .4s ease" }} />
    </div>
  );
}

// ---------- Timetable-style timeline (signature element) ----------
function Timeline({ plan, dayStart, dayEnd }) {
  const PX_PER_MIN = 1.5;
  const totalHeight = (dayEnd - dayStart) * PX_PER_MIN;
  const hours = [];
  for (let h = Math.ceil(dayStart / 60); h <= Math.floor(dayEnd / 60); h++) hours.push(h);

  return (
    <div style={{ display: "flex", gap: 0 }}>
      <div style={{ position: "relative", width: 54, height: totalHeight, flexShrink: 0 }}>
        {hours.map((h) => (
          <div
            key={h}
            style={{
              position: "absolute",
              top: (h * 60 - dayStart) * PX_PER_MIN - 6,
              right: 10,
              fontFamily: FONT_MONO,
              fontSize: 11,
              color: C.muted,
            }}
          >
            {toHHMM(h * 60)}
          </div>
        ))}
      </div>
      <div style={{ position: "relative", flex: 1, height: totalHeight, borderLeft: `2px solid ${C.line}` }}>
        {hours.map((h) => (
          <div
            key={h}
            style={{
              position: "absolute",
              top: (h * 60 - dayStart) * PX_PER_MIN,
              left: 0,
              width: 10,
              height: 1,
              background: C.line,
            }}
          />
        ))}
        {plan.map((b) => {
          const top = (b.start - dayStart) * PX_PER_MIN;
          const height = Math.max((b.end - b.start) * PX_PER_MIN, 26);
          return (
            <div
              key={b.id}
              style={{
                position: "absolute",
                top,
                left: 18,
                right: 4,
                height,
                background: C.panel,
                border: `1px solid ${b.overflow ? C.rose : C.line}`,
                borderLeft: `3px solid ${b.color}`,
                borderRadius: 8,
                padding: "8px 12px",
                overflow: "hidden",
                boxSizing: "border-box",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
                <span style={{ fontWeight: 600, fontSize: 13.5 }}>{b.label}</span>
                <span style={{ fontFamily: FONT_MONO, fontSize: 11, color: C.muted, whiteSpace: "nowrap" }}>
                  {toHHMM(b.start)}–{toHHMM(b.end)}
                </span>
              </div>
              {height > 40 && <div style={{ fontSize: 12, color: C.muted, marginTop: 3 }}>{b.reason}</div>}
              {b.partial && <div style={{ fontSize: 11, color: C.rose, marginTop: 2 }}>compressed to fit today</div>}
              {b.overflow && <div style={{ fontSize: 11, color: C.rose, marginTop: 2 }}>past bedtime — will carry to tomorrow</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AllocationBar({ plan }) {
  if (!plan || plan.length === 0) return null;
  const total = plan.reduce((s, b) => s + (b.end - b.start), 0);
  const byColor = {};
  for (const b of plan) {
    byColor[b.color] = (byColor[b.color] || 0) + (b.end - b.start);
  }
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ display: "flex", height: 10, borderRadius: 6, overflow: "hidden", marginBottom: 8 }}>
        {Object.entries(byColor).map(([color, mins]) => (
          <div key={color} style={{ width: `${(mins / total) * 100}%`, background: color }} />
        ))}
      </div>
      <div style={{ fontFamily: FONT_MONO, fontSize: 11, color: C.muted }}>
        {Math.round(total)} min planned today across {plan.length} blocks
      </div>
    </div>
  );
}

// Consecutive days (most recent first) with at least one "done" block logged
function streakDays(history) {
  let streak = 0;
  for (const day of history) {
    if (day.done > 0) streak++;
    else break;
  }
  return streak;
}

const NAV = [
  { key: "Overview", icon: Home },
  { key: "Setup", icon: Settings2 },
  { key: "Topic order", icon: ListOrdered },
  { key: "Today", icon: CalendarClock },
  { key: "Homework / Away", icon: NotebookPen },
  { key: "Check-in", icon: CheckCircle2 },
  { key: "History", icon: HistoryIcon },
];

export default function App() {
  const [tab, setTab] = useState("Overview");

  const [fixed, setFixed] = useState([]);
  const [subjects, setSubjects] = useState([]);

  // Wake/sleep bound the whole schedulable day — simple enough for someone
  // with no time-management experience to fill in, and everything else is
  // built around these two numbers instead of an assumed 6am–11pm day.
  const [wakeTime, setWakeTime] = useState("06:00");
  const [sleepTime, setSleepTime] = useState("23:00");

  // Planned breaks (e.g. dinner) — blocked out like a fixed commitment when
  // the schedule is generated, but kept separate so they render distinctly.
  const [breaks, setBreaks] = useState([]);

  const [homework, setHomework] = useState([]);
  const [hwLabel, setHwLabel] = useState("");
  const [hwMins, setHwMins] = useState("45");
  const [hwDue, setHwDue] = useState("0");

  const [disruption, setDisruption] = useState(null); // {type, startDate, endDate}
  const [disType, setDisType] = useState("sick");
  const [disStart, setDisStart] = useState("");
  const [disEnd, setDisEnd] = useState("");

  const [plan, setPlan] = useState(null);
  const [checked, setChecked] = useState({});
  const [history, setHistory] = useState([]); // [{date, done, partial, skipped, total, blocks:[{label,color,status}]}]

  function daysUntil(dateStr) {
    if (!dateStr) return null;
    const d = new Date(dateStr + "T00:00:00");
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return Math.round((d - now) / 86400000);
  }

  function addSubject() {
    setSubjects((s) => [...s, { id: uid(), name: "New subject", examDate: "", topicsRaw: "", topics: [] }]);
  }
  function updateSubject(id, patch) {
    setSubjects((s) => s.map((sub) => (sub.id === id ? { ...sub, ...patch } : sub)));
  }
  function removeSubject(id) {
    setSubjects((s) => s.filter((sub) => sub.id !== id));
  }
  function parseTopics(sub) {
    const lines = sub.topicsRaw.split("\n").map((l) => l.trim()).filter(Boolean);
    const rawTopics = lines.map((name) => ({ id: uid(), name, estMinutes: 40, done: false }));
    const ordered = heuristicOrder(rawTopics);
    updateSubject(sub.id, { topics: ordered });
  }

  function addFixed() {
    setFixed((f) => [...f, { id: uid(), label: "New block", start: "15:00", end: "16:00", buffer: false }]);
  }
  function updateFixed(id, patch) {
    setFixed((f) => f.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  }
  function removeFixed(id) {
    setFixed((f) => f.filter((b) => b.id !== id));
  }

  function addBreak() {
    setBreaks((b) => [...b, { id: uid(), label: "Dinner", start: "20:00", end: "20:30" }]);
  }
  function updateBreak(id, patch) {
    setBreaks((b) => b.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  }
  function removeBreak(id) {
    setBreaks((b) => b.filter((x) => x.id !== id));
  }

  function moveTopic(subId, fromIdx, toIdx) {
    setSubjects((subs) =>
      subs.map((s) => {
        if (s.id !== subId) return s;
        const t = [...s.topics];
        const [item] = t.splice(fromIdx, 1);
        t.splice(toIdx, 0, item);
        return { ...s, topics: t };
      })
    );
  }

  function addHomework() {
    if (!hwLabel.trim()) return;
    setHomework((h) => [
      ...h,
      { id: uid(), label: hwLabel.trim(), estMinutes: Number(hwMins) || 30, dueInDays: Number(hwDue) || 0, done: false },
    ]);
    setHwLabel("");
    setHwMins("45");
    setHwDue("0");
  }
  function removeHomework(id) {
    setHomework((h) => h.filter((x) => x.id !== id));
  }

  function setAway() {
    if (!disStart || !disEnd) return;
    setDisruption({ type: disType, startDate: disStart, endDate: disEnd });
  }
  function clearAway() {
    setDisruption(null);
  }

  const todayISO = new Date().toISOString().slice(0, 10);
  const isDisruptedToday = useMemo(() => {
    if (!disruption) return false;
    return todayISO >= disruption.startDate && todayISO <= disruption.endDate;
  }, [disruption, todayISO]);

  function handleGenerate() {
    // If a disruption's window has fully passed, treat today as a "welcome back"
    // day (one revision pass), then auto-clear it so it doesn't linger forever.
    const justEnded = !!disruption && todayISO > disruption.endDate;
    const breaksAsBlocks = breaks.map((b) => ({ ...b, buffer: false }));
    const p = generatePlan({
      fixedBlocks: [...fixed, ...breaksAsBlocks],
      homework,
      subjects,
      disruption: justEnded ? { ...disruption, justEnded: true } : disruption,
      isDisruptedToday,
      daysUntil,
      dayStart: toMin(wakeTime),
      dayEnd: toMin(sleepTime),
    });
    // Tag break blocks distinctly so the timeline can style/label them as breaks,
    // not study blocks — they don't come out of generatePlan since they're
    // pre-blocked windows, so we splice them back in as their own visible entries.
    const breakEntries = breaks.map((b) => ({
      id: uid(),
      start: toMin(b.start),
      end: toMin(b.end),
      label: b.label,
      reason: "Planned break",
      color: C.muted,
      kind: "break",
    }));
    const merged = [...p, ...breakEntries].sort((a, b) => a.start - b.start);
    setPlan(merged);
    setChecked({});
    if (justEnded) setDisruption(null);
    setTab("Today");
  }

  // Live "take a break now" — shifts everything not yet started later by
  // `mins`, inserts a break block at the current time, and flags anything
  // pushed past bedtime so it's visible it'll carry to tomorrow instead of
  // silently vanishing.
  function takeBreakNow(mins = 30) {
    if (!plan) return;
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const sleepMin = toMin(sleepTime);

    const shifted = plan.map((b) => {
      if (b.start >= nowMin) {
        const newStart = b.start + mins;
        const newEnd = b.end + mins;
        return { ...b, start: newStart, end: newEnd, overflow: newEnd > sleepMin };
      }
      return b;
    });

    const breakBlock = {
      id: uid(),
      start: nowMin,
      end: nowMin + mins,
      label: "Break",
      reason: "Taken now — rest of today shifted back",
      color: C.muted,
      kind: "break",
      overflow: nowMin + mins > sleepMin,
    };

    setPlan([...shifted, breakBlock].sort((a, b) => a.start - b.start));
  }

  function markBlock(id, status) {
    setChecked((c) => ({ ...c, [id]: status }));
  }
  function applyCheckIn() {
    // Archive today before mutating anything, so the log reflects what was
    // actually planned vs. actually done — this is what "History" shows later,
    // and later still, what a Supabase `history` row per day would store.
    const summaryBlocks = plan
      .filter((b) => b.kind !== "break")
      .map((b) => ({
      label: b.label,
      color: b.color,
      status: checked[b.id] || "skip",
    }));
    const doneCount = summaryBlocks.filter((b) => b.status === "done").length;
    const partialCount = summaryBlocks.filter((b) => b.status === "partial").length;
    const skipCount = summaryBlocks.filter((b) => b.status === "skip").length;
    setHistory((h) => [
      {
        date: todayISO,
        total: summaryBlocks.length,
        done: doneCount,
        partial: partialCount,
        skipped: skipCount,
        blocks: summaryBlocks,
      },
      ...h,
    ]);

    setSubjects((subs) =>
      subs.map((s) => ({
        ...s,
        topics: s.topics.map((t) => {
          const b = plan.find((b) => b.refId === t.id && b.subjectId === s.id);
          if (b && checked[b.id] === "done") return { ...t, done: true };
          return t;
        }),
      }))
    );
    setHomework((h) =>
      h
        .map((hw) => {
          const b = plan.find((b) => b.refId === hw.id);
          if (b && checked[b.id] === "done") return { ...hw, done: true };
          return hw;
        })
        .filter((hw) => !hw.done)
    );
    setPlan(null);
    setChecked({});
    setTab("History");
  }

  const hasAnySetup = fixed.length > 0 || subjects.length > 0;
  const pendingHomework = homework.filter((h) => !h.done);
  const nearestExam = subjects
    .map((s) => ({ ...s, days: daysUntil(s.examDate) }))
    .filter((s) => s.days !== null && s.days >= 0)
    .sort((a, b) => a.days - b.days)[0];

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: FONT_BODY, color: C.paper }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap');
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 8px; height: 8px; }
        ::-webkit-scrollbar-thumb { background: ${C.line}; border-radius: 4px; }
        @keyframes fadeUp { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
        input[type="date"]::-webkit-calendar-picker-indicator, input[type="time"]::-webkit-calendar-picker-indicator { filter: invert(0.7); cursor: pointer; }
        @media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }
      `}</style>

      {/* Header */}
      <div style={{ borderBottom: `1px solid ${C.line}`, padding: "20px 28px", position: "sticky", top: 0, background: C.bg, zIndex: 10 }}>
        <div style={{ maxWidth: 1000, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <div>
            <div style={{ fontFamily: FONT_MONO, fontSize: 11, letterSpacing: 3, color: C.amber, textTransform: "uppercase" }}>
              five things, one clock
            </div>
            <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: 27, margin: "2px 0 0", fontWeight: 700, color: C.paper }}>
              Split
            </h1>
          </div>
          <nav style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {NAV.map(({ key, icon: Icon }) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  fontFamily: FONT_BODY,
                  fontSize: 13,
                  fontWeight: 600,
                  padding: "8px 12px",
                  borderRadius: 7,
                  border: "none",
                  cursor: "pointer",
                  background: tab === key ? C.panel2 : "transparent",
                  color: tab === key ? C.amber : C.muted,
                  transition: "background .15s ease, color .15s ease",
                }}
              >
                <Icon size={14} />
                {key}
              </button>
            ))}
          </nav>
        </div>
      </div>

      <div style={{ maxWidth: 1000, margin: "0 auto", padding: "32px 28px 80px" }}>
        {/* ---------------- OVERVIEW ---------------- */}
        {tab === "Overview" && (
          <>
            {!hasAnySetup ? (
              <div
                style={{
                  border: `1px solid ${C.line}`,
                  background: `linear-gradient(160deg, ${C.panel}, ${C.panel2})`,
                  borderRadius: 16,
                  padding: "48px 36px",
                  textAlign: "center",
                  animation: "fadeUp .4s ease both",
                }}
              >
                <div style={{ fontFamily: FONT_MONO, fontSize: 11, letterSpacing: 3, color: C.amber, textTransform: "uppercase", marginBottom: 10 }}>
                  no ai, no api key, no login
                </div>
                <h2 style={{ fontFamily: FONT_DISPLAY, fontSize: 32, fontWeight: 700, margin: "0 0 14px", lineHeight: 1.25 }}>
                  One clock. Everything<br />you're actually juggling.
                </h2>
                <p style={{ color: C.muted, maxWidth: 460, margin: "0 auto 26px", fontSize: 14.5, lineHeight: 1.6 }}>
                  Boards, homework, a side project, an olympiad, a language — most planners assume you only have one kind of work.
                  Add what's really on your plate and get a day plan that explains itself.
                </p>
                <Btn onClick={() => setTab("Setup")} style={{ margin: "0 auto" }}>
                  <Plus size={16} /> Set up your plan
                </Btn>
              </div>
            ) : (
              <>
                <Section eyebrow="Right now" title="Your week at a glance" icon={Home}>
                  {isDisruptedToday && (
                    <div style={{ background: `${C.rose}18`, border: `1px solid ${C.rose}55`, borderRadius: 10, padding: 14, marginBottom: 16, fontSize: 13.5 }}>
                      Marked <b style={{ color: C.rose }}>{disruption.type}</b> until {disruption.endDate}. New topics are paused — only light revision until you're back.
                    </div>
                  )}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, marginBottom: 20 }}>
                    <StatCard icon={Flame} label="Current streak" value={`${streakDays(history)}d`} color={C.rose} />
                    <StatCard
                      icon={Clock}
                      label="Nearest exam"
                      value={nearestExam ? `${nearestExam.days}d · ${nearestExam.name}` : "—"}
                      color={C.amber}
                    />
                    <StatCard icon={CheckCircle2} label="Subjects tracked" value={subjects.length} color={C.teal} />
                  </div>

                  {subjects.length > 0 && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 24 }}>
                      {subjects.map((s) => {
                        const total = s.topics.length;
                        const done = s.topics.filter((t) => t.done).length;
                        const pct = total ? (done / total) * 100 : 0;
                        const d = daysUntil(s.examDate);
                        return (
                          <div key={s.id} style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 10, padding: 14 }}>
                            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13.5, marginBottom: 8 }}>
                              <span style={{ fontWeight: 600 }}>{s.name}</span>
                              <span style={{ color: C.muted, fontFamily: FONT_MONO, fontSize: 12 }}>
                                {total ? `${done}/${total} topics` : "no topics yet"}{d !== null ? ` · exam in ${d}d` : ""}
                              </span>
                            </div>
                            <ProgressBar pct={pct} color={d !== null && d <= 7 ? C.amber : C.teal} />
                          </div>
                        );
                      })}
                    </div>
                  )}

                  <Btn onClick={handleGenerate} style={{ fontSize: 15, padding: "12px 22px" }}>
                    <CalendarClock size={16} /> Build today's plan
                  </Btn>
                </Section>
              </>
            )}
          </>
        )}

        {/* ---------------- SETUP ---------------- */}
        {tab === "Setup" && (
          <>
            <Section eyebrow="Step 1" icon={Sun} title="Wake & sleep">
              <p style={{ color: C.muted, fontSize: 13, fontFamily: FONT_MONO, marginTop: -6, marginBottom: 12 }}>
                Everything below is built to fit inside this window. If you're not sure where to start with time management, this is the only thing you strictly need to get right.
              </p>
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                <div style={{ flex: 1, minWidth: 160 }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: C.muted, fontFamily: FONT_MONO, marginBottom: 6 }}>
                    <Sun size={13} /> Wake up
                  </label>
                  <Input type="time" value={wakeTime} onChange={setWakeTime} />
                </div>
                <div style={{ flex: 1, minWidth: 160 }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: C.muted, fontFamily: FONT_MONO, marginBottom: 6 }}>
                    <Moon size={13} /> Sleep
                  </label>
                  <Input type="time" value={sleepTime} onChange={setSleepTime} />
                </div>
              </div>
            </Section>

            <Section eyebrow="Step 2" icon={Settings2} title="Fixed commitments" right={<Btn variant="ghost" onClick={addFixed}><Plus size={14} /> Add block</Btn>}>
              {fixed.length === 0 && (
                <p style={{ color: C.muted, fontSize: 13, fontFamily: FONT_MONO, marginTop: -6, marginBottom: 12 }}>
                  Add anything that happens at a fixed time — school, tuition, practice. Everyone's is different, so start from scratch here.
                </p>
              )}
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {fixed.map((b) => (
                  <div key={b.id} style={{ display: "flex", gap: 10, alignItems: "center", background: C.panel, padding: 12, borderRadius: 10, border: `1px solid ${C.line}`, flexWrap: "wrap" }}>
                    <Input value={b.label} onChange={(v) => updateFixed(b.id, { label: v })} style={{ flex: 2, minWidth: 120 }} />
                    <Input type="time" value={b.start} onChange={(v) => updateFixed(b.id, { start: v })} style={{ flex: 1, minWidth: 100 }} />
                    <span style={{ color: C.muted, fontFamily: FONT_MONO, fontSize: 12 }}>to</span>
                    <Input type="time" value={b.end} onChange={(v) => updateFixed(b.id, { end: v })} style={{ flex: 1, minWidth: 100 }} />
                    <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: C.muted, fontFamily: FONT_MONO, whiteSpace: "nowrap" }}>
                      <input type="checkbox" checked={!!b.buffer} onChange={(e) => updateFixed(b.id, { buffer: e.target.checked })} />
                      40m buffer
                    </label>
                    <button onClick={() => removeFixed(b.id)} style={{ background: "none", border: "none", color: C.rose, cursor: "pointer" }}><X size={16} /></button>
                  </div>
                ))}
              </div>
              <p style={{ color: C.muted, fontSize: 12, marginTop: 8, fontFamily: FONT_MONO }}>
                "40m buffer" auto-adds rest/prep time before and after — e.g. school.
              </p>
            </Section>

            <Section eyebrow="Step 3" icon={Coffee} title="Breaks" right={<Btn variant="ghost" onClick={addBreak}><Plus size={14} /> Add break</Btn>}>
              {breaks.length === 0 && (
                <p style={{ color: C.muted, fontSize: 13, fontFamily: FONT_MONO, marginTop: -6, marginBottom: 12 }}>
                  Add dinner or any planned break — it's blocked out like a commitment so nothing gets scheduled over it. You can also take an unplanned one live from Today.
                </p>
              )}
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {breaks.map((b) => (
                  <div key={b.id} style={{ display: "flex", gap: 10, alignItems: "center", background: C.panel, padding: 12, borderRadius: 10, border: `1px solid ${C.line}`, flexWrap: "wrap" }}>
                    <Input value={b.label} onChange={(v) => updateBreak(b.id, { label: v })} style={{ flex: 2, minWidth: 120 }} />
                    <Input type="time" value={b.start} onChange={(v) => updateBreak(b.id, { start: v })} style={{ flex: 1, minWidth: 100 }} />
                    <span style={{ color: C.muted, fontFamily: FONT_MONO, fontSize: 12 }}>to</span>
                    <Input type="time" value={b.end} onChange={(v) => updateBreak(b.id, { end: v })} style={{ flex: 1, minWidth: 100 }} />
                    <button onClick={() => removeBreak(b.id)} style={{ background: "none", border: "none", color: C.rose, cursor: "pointer" }}><X size={16} /></button>
                  </div>
                ))}
              </div>
            </Section>

            <Section eyebrow="Step 4" icon={NotebookPen} title="Subjects & syllabus" right={<Btn variant="ghost" onClick={addSubject}><Plus size={14} /> Add subject</Btn>}>
              {subjects.length === 0 && (
                <p style={{ color: C.muted, fontSize: 13, fontFamily: FONT_MONO, marginTop: -6, marginBottom: 12 }}>
                  Add whatever you're studying — board subjects, an olympiad, a coding track, a language. Whatever your mix is.
                </p>
              )}
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                {subjects.map((s) => (
                  <div key={s.id} style={{ background: C.panel, padding: 16, borderRadius: 10, border: `1px solid ${C.line}` }}>
                    <div style={{ display: "flex", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
                      <Input value={s.name} onChange={(v) => updateSubject(s.id, { name: v })} style={{ flex: 2, minWidth: 140 }} placeholder="Subject name" />
                      <Input type="date" value={s.examDate} onChange={(v) => updateSubject(s.id, { examDate: v })} style={{ flex: 1, minWidth: 140 }} />
                      <button onClick={() => removeSubject(s.id)} style={{ background: "none", border: "none", color: C.rose, cursor: "pointer" }}><X size={16} /></button>
                    </div>
                    <textarea
                      value={s.topicsRaw}
                      onChange={(e) => updateSubject(s.id, { topicsRaw: e.target.value })}
                      placeholder={"Paste or type topics, one per line\ne.g.\nIntro to Kinematics\nNewton's Laws\nWork Energy Power"}
                      rows={4}
                      style={{ width: "100%", background: C.panel2, border: `1px solid ${C.line}`, borderRadius: 8, padding: 10, color: C.paper, fontFamily: FONT_MONO, fontSize: 13, resize: "vertical" }}
                    />
                    <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                      <Btn variant="teal" onClick={() => parseTopics(s)}><ListOrdered size={14} /> Order topics</Btn>
                      {s.topics.length > 0 && (
                        <span style={{ color: C.muted, fontSize: 12, fontFamily: FONT_MONO }}>
                          {s.topics.length} topics ordered — review in "Topic order"
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </Section>

            <Section title="Generate today's plan">
              <Btn onClick={handleGenerate} style={{ fontSize: 15, padding: "12px 24px" }} disabled={!hasAnySetup}>
                <CalendarClock size={16} /> Build my schedule
              </Btn>
              {!hasAnySetup && <p style={{ color: C.muted, fontSize: 12, marginTop: 8, fontFamily: FONT_MONO }}>Add at least one commitment or subject first.</p>}
            </Section>
          </>
        )}

        {/* ---------------- TOPIC ORDER ---------------- */}
        {tab === "Topic order" && (
          <Section eyebrow="Step 4b" icon={ListOrdered} title="Review topic order">
            <p style={{ color: C.muted, fontSize: 13, marginTop: -6, marginBottom: 18 }}>
              We propose an order (fundamentals first, applications last). Drag to reorder — this becomes the sequence your daily plan follows.
            </p>
            {subjects.filter((s) => s.topics.length > 0).length === 0 && (
              <p style={{ color: C.muted, fontFamily: FONT_MONO, fontSize: 13 }}>No ordered topics yet — go to Setup and click "Order topics".</p>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              {subjects.filter((s) => s.topics.length > 0).map((s) => (
                <div key={s.id}>
                  <h3 style={{ fontFamily: FONT_DISPLAY, fontSize: 16, color: C.teal, marginBottom: 8 }}>{s.name}</h3>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {s.topics.map((t, idx) => (
                      <div
                        key={t.id}
                        draggable
                        onDragStart={(e) => e.dataTransfer.setData("idx", idx)}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => {
                          const from = Number(e.dataTransfer.getData("idx"));
                          moveTopic(s.id, from, idx);
                        }}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 12,
                          background: C.panel,
                          border: `1px solid ${C.line}`,
                          borderRadius: 8,
                          padding: "10px 14px",
                          cursor: "grab",
                        }}
                      >
                        <span style={{ fontFamily: FONT_MONO, color: C.muted, fontSize: 12, width: 24 }}>{String(idx + 1).padStart(2, "0")}</span>
                        <span style={{ flex: 1 }}>{t.name}</span>
                        {t.done && <span style={{ color: C.teal, fontSize: 11, fontFamily: FONT_MONO }}>done</span>}
                        <GripVertical size={15} color={C.muted} />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* ---------------- TODAY ---------------- */}
        {tab === "Today" && (
          <Section
            eyebrow="Timetable"
            icon={CalendarClock}
            title={isDisruptedToday ? `Light day — ${disruption.type === "sick" ? "recovering" : "away"}` : "Today's plan"}
            right={
              plan && plan.length > 0 ? (
                <Btn variant="ghost" onClick={() => takeBreakNow(30)}>
                  <Coffee size={14} /> Take a break now (+30m)
                </Btn>
              ) : null
            }
          >
            {!plan && (
              <p style={{ color: C.muted, fontFamily: FONT_MONO, fontSize: 13 }}>
                No plan yet — go to Setup or Overview and click "Build my schedule".
              </p>
            )}
            {plan && plan.length === 0 && (
              <p style={{ color: C.muted, fontFamily: FONT_MONO, fontSize: 13 }}>
                Nothing to schedule — add subjects or homework first.
              </p>
            )}
            {plan && plan.length > 0 && (
              <>
                <AllocationBar plan={plan} />
                <Timeline plan={plan} dayStart={toMin(wakeTime)} dayEnd={toMin(sleepTime)} />
                <p style={{ color: C.muted, fontSize: 12, marginTop: 12, fontFamily: FONT_MONO }}>
                  "Take a break now" pushes everything not yet started back by 30 min — anything that no longer fits before {sleepTime} is flagged and carries to tomorrow.
                </p>
              </>
            )}
          </Section>
        )}

        {/* ---------------- HOMEWORK / AWAY ---------------- */}
        {tab === "Homework / Away" && (
          <>
            <Section eyebrow="Dynamic load" icon={NotebookPen} title="Add homework">
              <div style={{ display: "flex", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
                <Input value={hwLabel} onChange={setHwLabel} placeholder="e.g. Chemistry worksheet" style={{ flex: 2, minWidth: 160 }} />
                <Input value={hwMins} onChange={setHwMins} placeholder="mins" type="number" style={{ flex: 1, minWidth: 90 }} />
                <Input value={hwDue} onChange={setHwDue} placeholder="due in days" type="number" style={{ flex: 1, minWidth: 100 }} />
                <Btn onClick={addHomework}><Plus size={14} /> Add</Btn>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {homework.map((h) => (
                  <div key={h.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: C.panel, border: `1px solid ${C.line}`, borderRadius: 8, padding: "10px 14px" }}>
                    <span>{h.label}</span>
                    <span style={{ fontFamily: FONT_MONO, fontSize: 12, color: C.muted }}>
                      {h.estMinutes}m · due {h.dueInDays === 0 ? "today" : `in ${h.dueInDays}d`}
                    </span>
                    <button onClick={() => removeHomework(h.id)} style={{ background: "none", border: "none", color: C.rose, cursor: "pointer" }}><X size={16} /></button>
                  </div>
                ))}
                {homework.length === 0 && <p style={{ color: C.muted, fontSize: 13, fontFamily: FONT_MONO }}>No homework queued.</p>}
              </div>
            </Section>

            <Section eyebrow="Disruption" icon={Clock} title="Sick or away">
              {!disruption ? (
                <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <select value={disType} onChange={(e) => setDisType(e.target.value)} style={{ background: C.panel2, color: C.paper, border: `1px solid ${C.line}`, borderRadius: 8, padding: 10 }}>
                    <option value="sick">Sick</option>
                    <option value="away">Away / traveling</option>
                  </select>
                  <Input type="date" value={disStart} onChange={setDisStart} style={{ width: 160 }} />
                  <span style={{ color: C.muted, fontFamily: FONT_MONO, fontSize: 12 }}>to</span>
                  <Input type="date" value={disEnd} onChange={setDisEnd} style={{ width: 160 }} />
                  <Btn onClick={setAway}>Set</Btn>
                </div>
              ) : (
                <div style={{ background: C.panel, border: `1px solid ${C.rose}55`, borderRadius: 10, padding: 14, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
                  <span>
                    Marked <b style={{ color: C.rose }}>{disruption.type}</b> from {disruption.startDate} to {disruption.endDate}. New topics are frozen — only light revision until you're back.
                  </span>
                  <Btn variant="ghost" onClick={clearAway}>Clear</Btn>
                </div>
              )}
            </Section>
          </>
        )}

        {/* ---------------- HISTORY ---------------- */}
        {tab === "History" && (
          <Section eyebrow="Your log" icon={HistoryIcon} title="What you've actually done">
            {history.length === 0 ? (
              <p style={{ color: C.muted, fontFamily: FONT_MONO, fontSize: 13 }}>
                Nothing logged yet — check in at the end of a day and it'll show up here.
              </p>
            ) : (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, marginBottom: 24 }}>
                  <StatCard icon={HistoryIcon} label="Days logged" value={history.length} color={C.teal} />
                  <StatCard
                    icon={TrendingUp}
                    label="Avg. completion"
                    value={`${Math.round(
                      (history.reduce((s, d) => s + (d.total ? d.done / d.total : 0), 0) / history.length) * 100
                    )}%`}
                    color={C.amber}
                  />
                  <StatCard icon={Flame} label="Current streak" value={`${streakDays(history)}d`} color={C.rose} />
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {history.map((day, i) => {
                    const pct = day.total ? (day.done / day.total) * 100 : 0;
                    return (
                      <div key={i} style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 10, padding: 14 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8, flexWrap: "wrap", gap: 8 }}>
                          <span style={{ fontFamily: FONT_MONO, fontSize: 13, fontWeight: 600 }}>{day.date}</span>
                          <span style={{ fontFamily: FONT_MONO, fontSize: 12, color: C.muted }}>
                            {day.done} done · {day.partial} partial · {day.skipped} skipped
                          </span>
                        </div>
                        <ProgressBar pct={pct} color={pct >= 70 ? C.teal : pct >= 40 ? C.amber : C.rose} />
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
                          {day.blocks.map((b, j) => (
                            <span
                              key={j}
                              style={{
                                fontFamily: FONT_MONO,
                                fontSize: 11,
                                padding: "3px 8px",
                                borderRadius: 5,
                                background: C.panel2,
                                color: b.status === "done" ? C.teal : b.status === "partial" ? C.amber : C.muted,
                                border: `1px solid ${C.line}`,
                              }}
                            >
                              {b.label} · {b.status}
                            </span>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </Section>
        )}

        {/* ---------------- CHECK-IN ---------------- */}
        {tab === "Check-in" && (
          <Section eyebrow="End of day" icon={CheckCircle2} title="Did you get through it?">
            {!plan && <p style={{ color: C.muted, fontFamily: FONT_MONO, fontSize: 13 }}>Generate today's plan first.</p>}
            {plan && (
              <>
                <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
                  {plan.filter((b) => b.kind !== "break").map((b) => (
                    <div key={b.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: C.panel, border: `1px solid ${C.line}`, borderRadius: 10, padding: "12px 16px", flexWrap: "wrap", gap: 8 }}>
                      <span>{b.label}</span>
                      <div style={{ display: "flex", gap: 6 }}>
                        {["done", "partial", "skip"].map((status) => (
                          <button
                            key={status}
                            onClick={() => markBlock(b.id, status)}
                            style={{
                              fontFamily: FONT_MONO,
                              fontSize: 11,
                              padding: "6px 10px",
                              borderRadius: 6,
                              border: `1px solid ${checked[b.id] === status ? C.amber : C.line}`,
                              background: checked[b.id] === status ? C.amber : "transparent",
                              color: checked[b.id] === status ? "#1A1200" : C.muted,
                              cursor: "pointer",
                            }}
                          >
                            {status}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                <Btn onClick={applyCheckIn}><CheckCircle2 size={16} /> Save & carry forward what's missed</Btn>
                <p style={{ color: C.muted, fontSize: 12, marginTop: 10, fontFamily: FONT_MONO }}>
                  "done" advances your syllabus pointer. Anything else stays queued for tomorrow.
                </p>
              </>
            )}
          </Section>
        )}
      </div>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, color }) {
  return (
    <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 10, padding: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <Icon size={15} color={color} />
        <span style={{ fontFamily: FONT_MONO, fontSize: 11, color: C.muted, textTransform: "uppercase", letterSpacing: 1 }}>{label}</span>
      </div>
      <div style={{ fontFamily: FONT_DISPLAY, fontSize: 20, fontWeight: 600 }}>{value}</div>
    </div>
  );
}
