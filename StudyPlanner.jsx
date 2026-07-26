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
  Copy,
  Check,
  GraduationCap,
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

// ---------- Deterministic topic-ordering heuristic (no AI, no API — see Setup/Homework note) ----------
// Two signals, in priority order:
// 1) If topics already carry numbering ("1. Kinematics", "Chapter 2: ...", "Unit 3 —")
//    that's the strongest real signal a syllabus gives us — use it directly,
//    even if the pasted lines were out of order.
// 2) Otherwise, fall back to a broad keyword taxonomy spanning common subjects
//    (math, physics, chemistry, biology, CS, general olympiad/board vocabulary)
//    to bucket into fundamentals -> core -> applied -> advanced/practice.
const NUM_PREFIX = /^(?:chapter|unit|ch|topic|lesson|part)?\s*[:#-]?\s*(\d+)(?:[.):-]|\s)/i;

const TIER_WORDS = [
  // tier 0 — fundamentals / entry points
  [
    "intro", "introduction", "basic", "basics", "fundamental", "definition",
    "overview", "foundation", "number system", "notation", "terminology",
    "what is", "meaning of", "properties of", "types of",
  ],
  // tier 1 — core building blocks
  [
    "law", "laws", "theorem", "formula", "equation", "rule", "principle",
    "structure", "classification", "mechanism", "reaction", "function",
    "derivative", "integral", "limit", "vector", "matrix", "set theory",
  ],
  // tier 2 — applied / combined concepts
  [
    "application", "applications", "problem solving", "word problem",
    "graph", "diagram", "circuit", "experiment", "numerical", "case study",
    "comparative", "real world", "modeling", "model",
  ],
  // tier 3 — advanced / synthesis / practice
  [
    "advance", "advanced", "olympiad", "competition", "challenge",
    "project", "revision", "practice test", "mock test", "previous year",
    "mixed problems", "miscellaneous",
  ],
];

function extractLeadingNumber(name) {
  const m = name.match(NUM_PREFIX);
  return m ? parseInt(m[1], 10) : null;
}

function tierOf(name) {
  const s = name.toLowerCase();
  // Check from most specific (advanced/applied) down to most general
  // (fundamentals) — a name like "Applications of Newton's Laws" contains
  // both "application" and "laws"; we want the more specific signal
  // ("application") to win, not whichever tier happens to be checked first.
  for (let tier = TIER_WORDS.length - 1; tier >= 0; tier--) {
    if (TIER_WORDS[tier].some((w) => s.includes(w))) return tier;
  }
  return 1.5; // no keyword match — treat as "core", between building-blocks and applied
}

function heuristicOrder(topics) {
  const withNumbers = topics.map((t) => ({ ...t, _num: extractLeadingNumber(t.name) }));
  const allNumbered = withNumbers.length > 0 && withNumbers.every((t) => t._num !== null);

  if (allNumbered) {
    // Trust the syllabus's own numbering over any keyword guess.
    return [...withNumbers].sort((a, b) => a._num - b._num).map(({ _num, ...t }) => t);
  }

  // Mixed/no numbering: bucket by tier, keep original relative order within a tier
  // (a stable sort) so we're nudging, not scrambling, what the person typed.
  return [...topics]
    .map((t, i) => ({ ...t, _tier: tierOf(t.name), _i: i }))
    .sort((a, b) => a._tier - b._tier || a._i - b._i)
    .map(({ _tier, _i, ...t }) => t);
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
// toISOString() converts to UTC before formatting — in any timezone ahead of
// UTC, that can silently roll "today" back to what's still "yesterday" in
// UTC (e.g. 1am in India is still 7:30pm the previous day in UTC). Every
// date in this app must be built from *local* calendar fields instead.
function toLocalISODate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function todayLocalISO() {
  return toLocalISODate(new Date());
}
function addDaysISO(dateISO, n) {
  const d = new Date(dateISO + "T00:00:00");
  d.setDate(d.getDate() + n);
  return toLocalISODate(d);
}
function daysBetween(fromISO, toISO) {
  const a = new Date(fromISO + "T00:00:00");
  const b = new Date(toISO + "T00:00:00");
  return Math.round((b - a) / 86400000);
}
function weekdayLabel(dateISO) {
  return new Date(dateISO + "T00:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

// ---------- Core scheduling algorithm (pure logic, no AI, no API key) ----------
function buildFreeWindows(fixedBlocks, dayStart, dayEnd) {
  const BUFFER = 40;
  const busy = fixedBlocks
    .map((b) => {
      let s = toMin(b.start);
      let e = toMin(b.end);
      // A reversed interval (end typed before start — easy mistake with two
      // adjacent time fields) doesn't just fail to block time, it can make
      // the algorithm treat the busy period as free. Normalize it here.
      if (e <= s) [s, e] = [e, s];
      return {
        start: s - (b.buffer ? BUFFER : 0),
        end: e + (b.buffer ? BUFFER : 0),
      };
    })
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

function generatePlan({ fixedBlocks, homework, subjects, disruption, isDisruptedToday, daysUntil, dayStart, dayEnd, todayISO, examEntries = [] }) {
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

  // The one day right after the last exam on the timetable — a deliberate
  // rest day before easing back into the regular syllabus. Homework above
  // still goes ahead; nothing else does.
  const examDates = examEntries.map((e) => e.examDate).filter(Boolean).sort();
  const lastExamDate = examDates.length ? examDates[examDates.length - 1] : null;
  const isExamBreakDay = lastExamDate && todayISO === addDaysISO(lastExamDate, 1);
  if (isExamBreakDay) {
    blocks.push({
      id: uid(),
      start: dayStart,
      end: Math.min(dayStart + 30, dayEnd),
      kind: "rest",
      label: "Rest day",
      reason: "Your last exam was yesterday — a deliberate day off before easing back into your regular syllabus tomorrow.",
      color: C.teal,
    });
    return blocks.sort((a, b) => a.start - b.start);
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

  // Weak-flagged topics jump the queue for their subject — "struggling with
  // this" gets a sooner pass instead of waiting for its normal turn.
  // A topic skipped for today is passed over entirely for this generation —
  // it's not marked done, so it's simply next in line again once the date
  // changes, without any manual reordering needed.
  function nextTopicFor(s) {
    const eligible = (t) => !t.done && t.skippedForDate !== todayISO;
    const weakUndone = s.topics.find((t) => eligible(t) && t.weak);
    if (weakUndone) return weakUndone;
    return s.topics.find(eligible);
  }

  // Exam Timetable — a separate list of exams (date + subject + the specific
  // chapters coming up), independent of the regular syllabus. While any
  // exam on this list is still ahead, it takes over that subject's time
  // entirely: the regular syllabus for a matching subject pauses rather
  // than competing for the same slots, and resumes automatically once every
  // exam has passed (see isExamBreakDay above for the one rest day between).
  const activeExams = examEntries
    .map((e) => ({ ...e, days: daysUntil(e.examDate) }))
    .filter((e) => e.days !== null && e.days >= 0)
    .sort((a, b) => a.days - b.days);

  const examPausedSubjects = new Set(activeExams.map((e) => (e.subjectName || "").trim().toLowerCase()));

  for (const e of activeExams) {
    const next = (e.topics || []).find((t) => !t.done);
    if (next) {
      place(Math.min(next.estMinutes, 60), {
        kind: "exam-prep",
        label: `${e.subjectName}: ${next.name}`,
        reason: e.days === 0 ? `${e.subjectName} exam is today — final pass` : `${e.subjectName} exam in ${e.days}d — exam-specific prep`,
        color: C.rose,
        refId: next.id,
        examEntryId: e.id,
      });
    }
  }

  // 2) Exam-imminent topics (within 7 days), unfinished — skipped for any
  // subject currently paused for its own dedicated exam-timetable prep above.
  for (const s of subjects) {
    if (examPausedSubjects.has(s.name.trim().toLowerCase())) continue;
    const days = daysUntil(s.examDate);
    if (days !== null && days <= 7 && days >= 0) {
      const next = nextTopicFor(s);
      if (next) {
        place(Math.min(next.estMinutes, 60), {
          kind: "revision-priority",
          label: `${s.name}: ${next.name}`,
          reason: next.weak
            ? `Exam in ${days}d — and you flagged this one as weak, so it's front of the queue`
            : `Exam in ${days}d — takes priority right now`,
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
    if (examPausedSubjects.has(s.name.trim().toLowerCase())) continue;
    if (handledSubjectIds.has(s.id)) continue;
    const next = nextTopicFor(s);
    if (next) {
      place(next.estMinutes, {
        kind: "syllabus",
        label: `${s.name}: ${next.name}`,
        reason: next.weak
          ? `You flagged this as weak — bumped ahead for extra practice`
          : `Next in your ${s.name} syllabus`,
        color: s.color || C.teal,
        refId: next.id,
        subjectId: s.id,
      });
    }
  }

  // 4) Second pass — if the day has room left, give subjects another block.
  // No hardcoded universal extras: whatever's left goes back into whatever the
  // person actually added, so the plan reflects their own mix, not a preset one.
  for (const s of subjects) {
    if (examPausedSubjects.has(s.name.trim().toLowerCase())) continue;
    const next = s.topics.find((t) => !t.done && t.skippedForDate !== todayISO && !blocks.some((b) => b.refId === t.id));
    if (next) {
      place(Math.min(next.estMinutes, 30), {
        kind: "syllabus-extra",
        label: `${s.name}: ${next.name}`,
        reason: `Extra time today — getting ahead on ${s.name}`,
        color: s.color || C.violet,
        refId: next.id,
        subjectId: s.id,
      });
    }
  }

  return blocks.sort((a, b) => a.start - b.start);
}

// ---------- Multi-day projection ----------
// Away has a known window, so future days in the range correctly show as
// frozen. Sick has no known end date, so the freeze only applies to day 0
// (today) in this projection — days beyond that assume you're back to
// normal, since there's no honest way to guess otherwise. The UI says this
// explicitly rather than pretending the projection knows something it can't.
const CARRY_KINDS = ["syllabus", "revision-priority", "syllabus-extra"];

function simulateWeek({ days, todayISO, fixedBlocks, homework, subjects, disruption, dayStart, dayEnd, examEntries = [] }) {
  let simSubjects = subjects.map((s) => ({ ...s, topics: s.topics.map((t) => ({ ...t })) }));
  let simExams = examEntries.map((e) => ({ ...e, topics: (e.topics || []).map((t) => ({ ...t })) }));
  const results = [];

  for (let d = 0; d < days; d++) {
    const dateISO = addDaysISO(todayISO, d);
    let disrupted = false;
    let dayDisruption = null;

    if (disruption) {
      if (disruption.type === "away") {
        disrupted = dateISO >= disruption.startDate && dateISO <= disruption.endDate;
      } else if (disruption.type === "sick") {
        disrupted = d === 0 && dateISO >= disruption.startDate;
      }
      if (disrupted) dayDisruption = disruption;
    }

    // Only today's real homework is known; future days can't speculate on
    // homework that hasn't been assigned yet.
    const homeworkForDay = d === 0 ? homework.filter((h) => !h.done) : [];
    const dayDaysUntil = (examDateStr) => (examDateStr ? daysBetween(dateISO, examDateStr) : null);

    const blocks = generatePlan({
      fixedBlocks,
      homework: homeworkForDay,
      subjects: simSubjects,
      disruption: dayDisruption,
      isDisruptedToday: disrupted,
      daysUntil: dayDaysUntil,
      dayStart,
      dayEnd,
      todayISO: dateISO,
      examEntries: simExams,
    });

    results.push({ dateISO, disrupted, blocks, isProjected: d > 0 });

    // Simulate completion of whatever syllabus/exam-prep work this day
    // covered, so the next iteration's "next topic" pointer has actually moved.
    for (const b of blocks) {
      if (CARRY_KINDS.includes(b.kind) && b.refId) {
        simSubjects = simSubjects.map((s) =>
          s.id !== b.subjectId ? s : { ...s, topics: s.topics.map((t) => (t.id === b.refId ? { ...t, done: true } : t)) }
        );
      }
      if (b.kind === "exam-prep" && b.refId) {
        simExams = simExams.map((e) =>
          e.id !== b.examEntryId ? e : { ...e, topics: e.topics.map((t) => (t.id === b.refId ? { ...t, done: true } : t)) }
        );
      }
    }
  }

  return results;
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

function Input({ value, onChange, placeholder, type = "text", style, min }) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      type={type}
      min={min}
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
function Timeline({ plan, dayStart, dayEnd, busy = [], onSkipTopic }) {
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
        {/* Fixed commitments + breaks, drawn as background bands so the
            exclusion the scheduler applied is actually visible, not just
            assumed. Buffer padding (if any) shows as a lighter band around
            the solid busy period. */}
        {busy.map((b) => {
          let s = toMin(b.start);
          let e = toMin(b.end);
          if (e <= s) [s, e] = [e, s];
          const bufTop = b.buffer ? (Math.max(s - 40, dayStart) - dayStart) * PX_PER_MIN : (s - dayStart) * PX_PER_MIN;
          const bufHeight = b.buffer
            ? (Math.min(e + 40, dayEnd) - Math.max(s - 40, dayStart)) * PX_PER_MIN
            : (e - s) * PX_PER_MIN;
          const coreTop = (s - dayStart) * PX_PER_MIN;
          const coreHeight = (e - s) * PX_PER_MIN;
          return (
            <React.Fragment key={b.id || b.label}>
              {b.buffer && (
                <div
                  style={{
                    position: "absolute",
                    top: bufTop,
                    left: 18,
                    right: 4,
                    height: Math.max(bufHeight, 0),
                    background: `${C.muted}14`,
                    borderRadius: 8,
                  }}
                />
              )}
              <div
                style={{
                  position: "absolute",
                  top: coreTop,
                  left: 18,
                  right: 4,
                  height: Math.max(coreHeight, 0),
                  background: `${C.muted}26`,
                  border: `1px dashed ${C.muted}80`,
                  borderRadius: 8,
                  display: "flex",
                  alignItems: "center",
                  padding: "0 12px",
                  boxSizing: "border-box",
                }}
              >
                <span style={{ fontSize: 11.5, color: C.muted, fontFamily: FONT_MONO }}>
                  {b.label} · busy · {toHHMM(s)}–{toHHMM(e)}
                </span>
              </div>
            </React.Fragment>
          );
        })}
        {plan.map((b) => {
          const top = (b.start - dayStart) * PX_PER_MIN;
          const height = Math.max((b.end - b.start) * PX_PER_MIN, 26);
          const canSkip = onSkipTopic && b.refId && b.subjectId;
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
              {canSkip && height > 55 && (
                <button
                  onClick={() => onSkipTopic(b.subjectId, b.refId)}
                  title="Not clicking today — move to the next topic and pick this back up tomorrow"
                  style={{
                    marginTop: 6,
                    fontFamily: FONT_MONO,
                    fontSize: 10.5,
                    padding: "3px 8px",
                    borderRadius: 5,
                    border: `1px solid ${C.line}`,
                    background: "transparent",
                    color: C.muted,
                    cursor: "pointer",
                  }}
                >
                  Not clicking today → skip to tomorrow
                </button>
              )}
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

// One-line explanation of why today's plan is shaped the way it is — the
// same signals the scheduler already used to build it, read back in plain
// language instead of leaving the person to infer it from the timeline.
function describeDay(plan) {
  if (!plan || plan.length === 0) return null;
  const studyBlocks = plan.filter((b) => b.kind !== "break");
  if (studyBlocks.length === 0) return null;
  const total = studyBlocks.reduce((s, b) => s + (b.end - b.start), 0);
  const byKind = {};
  for (const b of studyBlocks) byKind[b.kind] = (byKind[b.kind] || 0) + (b.end - b.start);
  const hwShare = (byKind.homework || 0) / total;
  const hasWeak = studyBlocks.some((b) => (b.reason || "").toLowerCase().includes("weak"));
  const hasExamPriority = (byKind["revision-priority"] || 0) > 0;
  const hasExtra = (byKind["syllabus-extra"] || 0) > 0;
  const compressedCount = studyBlocks.filter((b) => b.partial).length;

  if (hwShare >= 0.4) return `Homework-heavy today (${Math.round(byKind.homework)}m) — syllabus time got compressed to fit it in.`;
  if (hasExamPriority) return `An exam is close, so revision for it jumped ahead of the normal syllabus order.`;
  if (hasWeak) return `Extra time went to a topic you flagged as weak, ahead of its normal turn.`;
  if (compressedCount > 0) return `Today was tight — ${compressedCount} block${compressedCount > 1 ? "s" : ""} got compressed to still fit something in.`;
  if (hasExtra) return `A lighter day — the extra room went into getting ahead rather than sitting empty.`;
  return `A fairly even day — no single thing crowded out the rest.`;
}

// Plain-text export of the day, for pasting into notes/WhatsApp or for the demo.
function planToText(plan, dateLabel) {
  const lines = plan
    .filter((b) => b.kind !== "break")
    .map((b) => `${toHHMM(b.start)}–${toHHMM(b.end)}  ${b.label}${b.reason ? `  (${b.reason})` : ""}`);
  return `Today's plan — ${dateLabel}\n${"-".repeat(28)}\n${lines.join("\n")}`;
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
  { key: "Syllabus", icon: ListOrdered },
  { key: "Exams", icon: GraduationCap },
  { key: "Today", icon: CalendarClock },
  { key: "Week Ahead", icon: TrendingUp },
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

  // Sick has no end date — you don't know in advance how long you'll be out,
  // so it's open-ended: {type:'sick', startDate}, cleared manually by saying
  // "I'm back." Away has a known window in advance, so it keeps a real
  // date range: {type:'away', startDate, endDate}, and clears itself once
  // the date passes.
  const [disruption, setDisruption] = useState(null);
  const [disType, setDisType] = useState("sick");
  const [disStart, setDisStart] = useState("");
  const [disEnd, setDisEnd] = useState("");
  const [recoveryPending, setRecoveryPending] = useState(false);

  const [plan, setPlan] = useState(null);
  const [checked, setChecked] = useState({});
  const [history, setHistory] = useState([]); // [{date, done, partial, skipped, total, blocks:[{label,color,status}]}]
  const [copied, setCopied] = useState(false);
  const [openSubjectId, setOpenSubjectId] = useState(null); // which subject folder is open, if any

  // Exam Timetable — deliberately separate from `subjects`. Each entry is
  // one exam: a date, a subject name (free text — doesn't need to match an
  // existing subject folder), and the specific chapters coming up for that
  // exam, which may be a narrower slice than the subject's full syllabus.
  const [examEntries, setExamEntries] = useState([]);
  const [openExamId, setOpenExamId] = useState(null);
  const [newTopicText, setNewTopicText] = useState("");

  function daysUntil(dateStr) {
    if (!dateStr) return null;
    const d = new Date(dateStr + "T00:00:00");
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return Math.round((d - now) / 86400000);
  }

  const SUBJECT_PALETTE = [C.teal, C.amber, C.violet, "#7C9DD6", "#D68C6A", "#8CC9A1"];

  function addSubject() {
    const id = uid();
    setSubjects((s) => [
      ...s,
      { id, name: "New subject", examDate: "", topicsRaw: "", topics: [], color: SUBJECT_PALETTE[s.length % SUBJECT_PALETTE.length] },
    ]);
    setOpenSubjectId(id);
    setTab("Syllabus");
  }
  function updateSubject(id, patch) {
    setSubjects((s) => s.map((sub) => (sub.id === id ? { ...sub, ...patch } : sub)));
  }
  function removeSubject(id) {
    setSubjects((s) => s.filter((sub) => sub.id !== id));
  }
  function parseTopics(sub) {
    const lines = sub.topicsRaw.split("\n").map((l) => l.trim()).filter(Boolean);
    const rawTopics = lines.map((name) => ({ id: uid(), name, estMinutes: 40, done: false, weak: false, skippedForDate: null }));
    const ordered = heuristicOrder(rawTopics);
    updateSubject(sub.id, { topics: ordered });
  }
  function toggleWeak(subId, topicId) {
    setSubjects((subs) =>
      subs.map((s) =>
        s.id !== subId ? s : { ...s, topics: s.topics.map((t) => (t.id === topicId ? { ...t, weak: !t.weak } : t)) }
      )
    );
  }
  // Marking done here is the same action as "done" at check-in — it's just
  // reachable directly from the subject's own syllabus, for topics studied
  // outside whatever got auto-scheduled that day.
  function toggleTopicDone(subId, topicId) {
    setSubjects((subs) =>
      subs.map((s) =>
        s.id !== subId ? s : { ...s, topics: s.topics.map((t) => (t.id === topicId ? { ...t, done: !t.done } : t)) }
      )
    );
  }
  // Skips a topic for exactly today — not marked done, so it's simply next
  // in line again once the date changes. Regenerates today's plan right
  // away using the updated data directly (not the stale `subjects` closure),
  // so the swap to the next topic is immediate.
  function skipTopicNow(subjectId, topicId) {
    const updated = subjects.map((s) =>
      s.id !== subjectId
        ? s
        : { ...s, topics: s.topics.map((t) => (t.id === topicId ? { ...t, skippedForDate: todayISO } : t)) }
    );
    setSubjects(updated);
    handleGenerate(updated, { silent: true });
  }
  function unskipTopic(subjectId, topicId) {
    setSubjects((subs) =>
      subs.map((s) =>
        s.id !== subjectId ? s : { ...s, topics: s.topics.map((t) => (t.id === topicId ? { ...t, skippedForDate: null } : t)) }
      )
    );
  }
  function addTopicManual(subId, name) {
    if (!name.trim()) return;
    setSubjects((subs) =>
      subs.map((s) =>
        s.id !== subId ? s : { ...s, topics: [...s.topics, { id: uid(), name: name.trim(), estMinutes: 40, done: false, weak: false, skippedForDate: null }] }
      )
    );
  }
  function updateTopicName(subId, topicId, name) {
    setSubjects((subs) =>
      subs.map((s) =>
        s.id !== subId ? s : { ...s, topics: s.topics.map((t) => (t.id === topicId ? { ...t, name } : t)) }
      )
    );
  }
  function deleteTopic(subId, topicId) {
    setSubjects((subs) =>
      subs.map((s) => (s.id !== subId ? s : { ...s, topics: s.topics.filter((t) => t.id !== topicId) }))
    );
  }

  // ---- Exam Timetable handlers (mirror the subject handlers above, but for
  // the separate examEntries list — adding, editing, or deleting an exam
  // never touches the regular syllabus in `subjects`) ----
  function addExam() {
    const id = uid();
    setExamEntries((ex) => [...ex, { id, subjectName: "New exam", examDate: "", topicsRaw: "", topics: [] }]);
    setOpenExamId(id);
    setTab("Exams");
  }
  function updateExam(id, patch) {
    setExamEntries((ex) => ex.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  }
  function removeExam(id) {
    setExamEntries((ex) => ex.filter((e) => e.id !== id));
  }
  function parseExamTopics(exam) {
    const lines = exam.topicsRaw.split("\n").map((l) => l.trim()).filter(Boolean);
    const rawTopics = lines.map((name) => ({ id: uid(), name, estMinutes: 40, done: false }));
    const ordered = heuristicOrder(rawTopics);
    updateExam(exam.id, { topics: ordered });
  }
  function moveExamTopic(examId, fromIdx, toIdx) {
    setExamEntries((ex) =>
      ex.map((e) => {
        if (e.id !== examId) return e;
        const t = [...e.topics];
        const [item] = t.splice(fromIdx, 1);
        t.splice(toIdx, 0, item);
        return { ...e, topics: t };
      })
    );
  }
  function toggleExamTopicDone(examId, topicId) {
    setExamEntries((ex) =>
      ex.map((e) =>
        e.id !== examId ? e : { ...e, topics: e.topics.map((t) => (t.id === topicId ? { ...t, done: !t.done } : t)) }
      )
    );
  }
  function deleteExamTopic(examId, topicId) {
    setExamEntries((ex) =>
      ex.map((e) => (e.id !== examId ? e : { ...e, topics: e.topics.filter((t) => t.id !== topicId) }))
    );
  }
  function addExamTopicManual(examId, name) {
    if (!name.trim()) return;
    setExamEntries((ex) =>
      ex.map((e) =>
        e.id !== examId ? e : { ...e, topics: [...e.topics, { id: uid(), name: name.trim(), estMinutes: 40, done: false }] }
      )
    );
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

  function setSick() {
    const start = disStart && disStart > todayISO ? disStart : todayISO;
    setDisruption({ type: "sick", startDate: start });
  }
  function setAwayRange() {
    if (!disStart || !disEnd) return;
    const start = disStart < todayISO ? todayISO : disStart;
    const end = disEnd < start ? start : disEnd;
    setDisruption({ type: "away", startDate: start, endDate: end });
  }
  function clearAway() {
    setDisruption(null);
  }
  // "I'm back" for sick — there's no end date to wait out, so this is the
  // only way a sick period ends. It clears immediately and queues one
  // welcome-back revision pass on the next generated plan.
  function markRecovered() {
    setDisruption(null);
    setRecoveryPending(true);
  }

  const todayISO = todayLocalISO();
  const isDisruptedToday = useMemo(() => {
    if (!disruption) return false;
    if (disruption.type === "sick") return todayISO >= disruption.startDate;
    return todayISO >= disruption.startDate && todayISO <= disruption.endDate;
  }, [disruption, todayISO]);

  function handleGenerate(subjectsOverride, opts = {}) {
    // Away has a known end date, so a passed date auto-ends it. Sick has no
    // end date — it only ends when markRecovered() was just clicked, tracked
    // via recoveryPending. Either way, the next generated plan gets one
    // welcome-back revision pass.
    const awayJustEnded = !!disruption && disruption.type === "away" && todayISO > disruption.endDate;
    const justEnded = awayJustEnded || recoveryPending;
    const breaksAsBlocks = breaks.map((b) => ({ ...b, buffer: false }));
    const subjectsToUse = subjectsOverride || subjects;
    const p = generatePlan({
      fixedBlocks: [...fixed, ...breaksAsBlocks],
      homework,
      subjects: subjectsToUse,
      disruption: justEnded ? { ...disruption, justEnded: true } : disruption,
      isDisruptedToday,
      daysUntil,
      dayStart: toMin(wakeTime),
      dayEnd: toMin(sleepTime),
      todayISO,
      examEntries,
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
    if (awayJustEnded) setDisruption(null);
    if (recoveryPending) setRecoveryPending(false);
    if (!opts.silent) setTab("Today");
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

  function handleCopyPlan() {
    if (!plan) return;
    const text = planToText(plan, todayISO);
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      })
      .catch(() => {});
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
    setExamEntries((exs) =>
      exs.map((e) => ({
        ...e,
        topics: e.topics.map((t) => {
          const b = plan.find((b) => b.refId === t.id && b.examEntryId === e.id);
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

  const weekPlan = useMemo(() => {
    if (!hasAnySetup) return [];
    const breaksAsBlocks = breaks.map((b) => ({ ...b, buffer: false }));
    return simulateWeek({
      days: 7,
      todayISO,
      fixedBlocks: [...fixed, ...breaksAsBlocks],
      homework,
      subjects,
      disruption,
      dayStart: toMin(wakeTime),
      dayEnd: toMin(sleepTime),
      examEntries,
    });
  }, [hasAnySetup, fixed, breaks, homework, subjects, disruption, wakeTime, sleepTime, todayISO, examEntries]);

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
                      {disruption.type === "sick" ? (
                        <>Marked <b style={{ color: C.rose }}>sick</b> since {disruption.startDate} — new topics are paused until you say you're back.</>
                      ) : (
                        <>Marked <b style={{ color: C.rose }}>away</b> until {disruption.endDate}. New topics are paused — only light revision until you're back.</>
                      )}
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
                            <ProgressBar pct={pct} color={d !== null && d <= 7 ? C.amber : s.color || C.teal} />
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
                  <div key={b.id}>
                    <div style={{ display: "flex", gap: 10, alignItems: "center", background: C.panel, padding: 12, borderRadius: 10, border: `1px solid ${C.line}`, flexWrap: "wrap" }}>
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
                    {b.start && b.end && toMin(b.end) <= toMin(b.start) && (
                      <p style={{ color: C.rose, fontSize: 12, fontFamily: FONT_MONO, margin: "4px 2px 0" }}>
                        End time is before start — this is auto-corrected when building the schedule, but double-check it's what you meant.
                      </p>
                    )}
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

            <Section eyebrow="Step 4" icon={NotebookPen} title="Subjects" right={<Btn variant="ghost" onClick={addSubject}><Plus size={14} /> Add subject</Btn>}>
              {subjects.length === 0 ? (
                <p style={{ color: C.muted, fontSize: 13, fontFamily: FONT_MONO, marginTop: -6, marginBottom: 12 }}>
                  Add whatever you're studying — Physics, Chemistry, Math, an olympiad, anything. Each one becomes its own folder where you write and manage that subject's syllabus.
                </p>
              ) : (
                <p style={{ color: C.muted, fontSize: 13, marginTop: -6, marginBottom: 14 }}>
                  Tap a subject to open its syllabus — write topics, reorder them, mark weak ones, or delete the whole thing.
                </p>
              )}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 12 }}>
                {subjects.map((s) => {
                  const total = s.topics.length;
                  const done = s.topics.filter((t) => t.done).length;
                  return (
                    <button
                      key={s.id}
                      onClick={() => {
                        setOpenSubjectId(s.id);
                        setTab("Syllabus");
                      }}
                      style={{
                        textAlign: "left",
                        background: C.panel,
                        border: `1px solid ${C.line}`,
                        borderTop: `3px solid ${s.color || C.teal}`,
                        borderRadius: 10,
                        padding: 14,
                        cursor: "pointer",
                        display: "flex",
                        flexDirection: "column",
                        gap: 8,
                      }}
                    >
                      <span style={{ fontWeight: 600, fontSize: 14.5, color: C.paper }}>{s.name}</span>
                      <span style={{ fontFamily: FONT_MONO, fontSize: 11.5, color: C.muted }}>
                        {total ? `${done}/${total} topics` : "no syllabus yet"}
                      </span>
                    </button>
                  );
                })}
                <button
                  onClick={addSubject}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 6,
                    background: "transparent",
                    border: `1px dashed ${C.line}`,
                    borderRadius: 10,
                    padding: 14,
                    color: C.muted,
                    cursor: "pointer",
                    fontSize: 13,
                    minHeight: 68,
                  }}
                >
                  <Plus size={15} /> New subject
                </button>
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

        {/* ---------------- SYLLABUS (per-subject folder) ---------------- */}
        {tab === "Syllabus" && (() => {
          const openSubject = subjects.find((s) => s.id === openSubjectId);

          if (!openSubject) {
            // No folder open — show the picker grid (same idea as Setup's grid)
            return (
              <Section eyebrow="Syllabus" icon={ListOrdered} title="Pick a subject">
                {subjects.length === 0 ? (
                  <p style={{ color: C.muted, fontFamily: FONT_MONO, fontSize: 13 }}>
                    No subjects yet — add one in Setup first.
                  </p>
                ) : (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 12 }}>
                    {subjects.map((s) => {
                      const total = s.topics.length;
                      const done = s.topics.filter((t) => t.done).length;
                      return (
                        <button
                          key={s.id}
                          onClick={() => setOpenSubjectId(s.id)}
                          style={{
                            textAlign: "left",
                            background: C.panel,
                            border: `1px solid ${C.line}`,
                            borderTop: `3px solid ${s.color || C.teal}`,
                            borderRadius: 10,
                            padding: 14,
                            cursor: "pointer",
                            display: "flex",
                            flexDirection: "column",
                            gap: 8,
                          }}
                        >
                          <span style={{ fontWeight: 600, fontSize: 14.5 }}>{s.name}</span>
                          <span style={{ fontFamily: FONT_MONO, fontSize: 11.5, color: C.muted }}>
                            {total ? `${done}/${total} topics` : "no syllabus yet"}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </Section>
            );
          }

          const s = openSubject;
          return (
            <Section
              eyebrow="Syllabus"
              icon={ListOrdered}
              title={s.name}
              right={
                <Btn variant="ghost" onClick={() => setOpenSubjectId(null)}>
                  ← All subjects
                </Btn>
              }
            >
              {/* Name / color / exam date / delete */}
              <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
                <div style={{ display: "flex", gap: 5 }}>
                  {SUBJECT_PALETTE.map((c) => (
                    <button
                      key={c}
                      onClick={() => updateSubject(s.id, { color: c })}
                      title="Subject color"
                      style={{
                        width: 20,
                        height: 20,
                        borderRadius: "50%",
                        background: c,
                        border: (s.color || SUBJECT_PALETTE[0]) === c ? `2px solid ${C.paper}` : "2px solid transparent",
                        cursor: "pointer",
                        padding: 0,
                      }}
                    />
                  ))}
                </div>
                <Input value={s.name} onChange={(v) => updateSubject(s.id, { name: v })} style={{ flex: 2, minWidth: 140 }} placeholder="Subject name" />
                <Input type="date" value={s.examDate} onChange={(v) => updateSubject(s.id, { examDate: v })} min={todayISO} style={{ flex: 1, minWidth: 140 }} />
              </div>

              {/* Syllabus paste + order */}
              <textarea
                value={s.topicsRaw}
                onChange={(e) => updateSubject(s.id, { topicsRaw: e.target.value })}
                placeholder={"Paste or type topics, one per line\ne.g.\nIntro to Kinematics\nNewton's Laws\nWork Energy Power"}
                rows={4}
                style={{ width: "100%", background: C.panel2, border: `1px solid ${C.line}`, borderRadius: 8, padding: 10, color: C.paper, fontFamily: FONT_MONO, fontSize: 13, resize: "vertical", boxSizing: "border-box" }}
              />
              <div style={{ marginTop: 8, marginBottom: 20, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <Btn variant="teal" onClick={() => parseTopics(s)}><ListOrdered size={14} /> Order topics from text above</Btn>
                <span style={{ color: C.muted, fontSize: 12, fontFamily: FONT_MONO }}>
                  Re-running this re-orders everything below from the text above.
                </span>
              </div>

              {/* Ordered topic list */}
              {s.topics.length === 0 ? (
                <p style={{ color: C.muted, fontFamily: FONT_MONO, fontSize: 13 }}>
                  No topics yet — paste your syllabus above and click "Order topics", or add one below.
                </p>
              ) : (
                <>
                  <p style={{ color: C.muted, fontSize: 12.5, marginBottom: 10 }}>
                    Drag to reorder. Mark a topic <b>weak</b> to bump it ahead of its normal turn, or check it <b>done</b> directly if you already covered it.
                  </p>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 }}>
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
                          gap: 10,
                          background: C.panel,
                          border: `1px solid ${C.line}`,
                          borderRadius: 8,
                          padding: "8px 12px",
                          cursor: "grab",
                          flexWrap: "wrap",
                        }}
                      >
                        <span style={{ fontFamily: FONT_MONO, color: C.muted, fontSize: 12, width: 22 }}>{String(idx + 1).padStart(2, "0")}</span>
                        <input
                          value={t.name}
                          onChange={(e) => updateTopicName(s.id, t.id, e.target.value)}
                          style={{ flex: 1, minWidth: 120, background: "transparent", border: "none", color: t.done ? C.muted : C.paper, textDecoration: t.done ? "line-through" : "none", fontSize: 13.5, outline: "none" }}
                        />
                        <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: C.muted, fontFamily: FONT_MONO, cursor: "pointer" }}>
                          <input type="checkbox" checked={!!t.done} onChange={() => toggleTopicDone(s.id, t.id)} />
                          done
                        </label>
                        {t.skippedForDate === todayISO && (
                          <button
                            onClick={() => unskipTopic(s.id, t.id)}
                            title="Undo — bring this back into today's picks"
                            style={{
                              background: "none",
                              border: `1px solid ${C.amber}55`,
                              color: C.amber,
                              borderRadius: 6,
                              padding: "3px 8px",
                              fontSize: 11,
                              fontFamily: FONT_MONO,
                              cursor: "pointer",
                            }}
                          >
                            skipped today ✕
                          </button>
                        )}
                        <button
                          onClick={() => toggleWeak(s.id, t.id)}
                          title="Mark as weak — gets bumped ahead in the queue"
                          style={{
                            background: "none",
                            border: `1px solid ${t.weak ? C.rose : C.line}`,
                            color: t.weak ? C.rose : C.muted,
                            borderRadius: 6,
                            padding: "3px 8px",
                            fontSize: 11,
                            fontFamily: FONT_MONO,
                            cursor: "pointer",
                          }}
                        >
                          {t.weak ? "★ weak" : "☆ weak"}
                        </button>
                        <button onClick={() => deleteTopic(s.id, t.id)} style={{ background: "none", border: "none", color: C.rose, cursor: "pointer" }}>
                          <X size={15} />
                        </button>
                        <GripVertical size={15} color={C.muted} />
                      </div>
                    ))}
                  </div>
                </>
              )}

              <AddTopicRow onAdd={(name) => addTopicManual(s.id, name)} />

              <div style={{ marginTop: 28, paddingTop: 18, borderTop: `1px solid ${C.line}` }}>
                <DeleteSubjectButton
                  onConfirm={() => {
                    removeSubject(s.id);
                    setOpenSubjectId(null);
                    setTab("Setup");
                  }}
                />
              </div>
            </Section>
          );
        })()}

        {/* ---------------- EXAMS ---------------- */}
        {tab === "Exams" && (() => {
          const openExam = examEntries.find((e) => e.id === openExamId);

          if (!openExam) {
            const sorted = [...examEntries].sort((a, b) => (a.examDate || "9999").localeCompare(b.examDate || "9999"));
            return (
              <>
                <Section
                  eyebrow="Exam timetable"
                  icon={GraduationCap}
                  title="Upcoming exams"
                  right={<Btn variant="ghost" onClick={addExam}><Plus size={14} /> Add exam</Btn>}
                >
                  <p style={{ color: C.muted, fontSize: 13, marginTop: -6, marginBottom: 16 }}>
                    Add a date, a subject, and the specific chapters coming up — separate from that subject's regular syllabus. While any exam here is still ahead, your daily plan studies <b>this list</b> for that subject instead of the regular one. Nothing in your regular Syllabus folders gets touched, and it resumes automatically once every exam here has passed, with one rest day right after the last one.
                  </p>
                  {sorted.length === 0 ? (
                    <p style={{ color: C.muted, fontFamily: FONT_MONO, fontSize: 13 }}>No exams added yet.</p>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      {sorted.map((e) => {
                        const days = daysUntil(e.examDate);
                        const isPast = days !== null && days < 0;
                        const total = e.topics.length;
                        const done = e.topics.filter((t) => t.done).length;
                        return (
                          <button
                            key={e.id}
                            onClick={() => setOpenExamId(e.id)}
                            style={{
                              textAlign: "left",
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "center",
                              gap: 10,
                              background: C.panel,
                              border: `1px solid ${isPast ? C.line : `${C.rose}55`}`,
                              borderRadius: 10,
                              padding: 14,
                              cursor: "pointer",
                              opacity: isPast ? 0.6 : 1,
                              flexWrap: "wrap",
                            }}
                          >
                            <div>
                              <div style={{ fontWeight: 600, fontSize: 14.5, marginBottom: 3 }}>
                                {e.subjectName || "Untitled exam"}
                              </div>
                              <div style={{ fontFamily: FONT_MONO, fontSize: 12, color: C.muted }}>
                                {e.examDate || "no date set"} {total ? `· ${done}/${total} chapters` : "· no chapters yet"}
                              </div>
                            </div>
                            <span style={{ fontFamily: FONT_MONO, fontSize: 12, color: isPast ? C.muted : C.rose, whiteSpace: "nowrap" }}>
                              {isPast ? "done" : days === 0 ? "today" : `in ${days}d`}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </Section>
              </>
            );
          }

          const e = openExam;
          const daysLeft = daysUntil(e.examDate);
          return (
            <Section
              eyebrow="Exam"
              icon={GraduationCap}
              title={e.subjectName || "Untitled exam"}
              right={<Btn variant="ghost" onClick={() => setOpenExamId(null)}>← All exams</Btn>}
            >
              <div style={{ display: "flex", gap: 10, marginBottom: 10, flexWrap: "wrap", alignItems: "center" }}>
                <Input value={e.subjectName} onChange={(v) => updateExam(e.id, { subjectName: v })} style={{ flex: 2, minWidth: 140 }} placeholder="Subject (type exactly as in Syllabus)" />
                <Input type="date" value={e.examDate} onChange={(v) => updateExam(e.id, { examDate: v })} min={todayISO} style={{ flex: 1, minWidth: 140 }} />
              </div>
              {subjects.length > 0 && (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
                  <span style={{ fontSize: 11.5, color: C.muted, fontFamily: FONT_MONO, alignSelf: "center" }}>quick-fill:</span>
                  {subjects.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => updateExam(e.id, { subjectName: s.name })}
                      style={{ fontSize: 11.5, fontFamily: FONT_MONO, padding: "3px 9px", borderRadius: 6, border: `1px solid ${C.line}`, background: "transparent", color: C.muted, cursor: "pointer" }}
                    >
                      {s.name}
                    </button>
                  ))}
                </div>
              )}
              {daysLeft !== null && (
                <p style={{ color: daysLeft < 0 ? C.muted : C.rose, fontSize: 12.5, fontFamily: FONT_MONO, marginBottom: 14 }}>
                  {daysLeft < 0 ? "This exam has passed — the regular syllabus has already resumed for this subject." : daysLeft === 0 ? "Today's the exam." : `${daysLeft} day${daysLeft === 1 ? "" : "s"} to go.`}
                </p>
              )}

              <textarea
                value={e.topicsRaw}
                onChange={(ev) => updateExam(e.id, { topicsRaw: ev.target.value })}
                placeholder={"Paste or type the chapters/topics for THIS exam, one per line\ne.g.\nElectrostatics\nCurrent Electricity\nMagnetism"}
                rows={4}
                style={{ width: "100%", background: C.panel2, border: `1px solid ${C.line}`, borderRadius: 8, padding: 10, color: C.paper, fontFamily: FONT_MONO, fontSize: 13, resize: "vertical", boxSizing: "border-box" }}
              />
              <div style={{ marginTop: 8, marginBottom: 20, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <Btn variant="teal" onClick={() => parseExamTopics(e)}><ListOrdered size={14} /> Order chapters from text above</Btn>
              </div>

              {e.topics.length === 0 ? (
                <p style={{ color: C.muted, fontFamily: FONT_MONO, fontSize: 13 }}>
                  No chapters yet — paste them above, or add one below.
                </p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 }}>
                  {e.topics.map((t, idx) => (
                    <div
                      key={t.id}
                      draggable
                      onDragStart={(ev) => ev.dataTransfer.setData("idx", idx)}
                      onDragOver={(ev) => ev.preventDefault()}
                      onDrop={(ev) => {
                        const from = Number(ev.dataTransfer.getData("idx"));
                        moveExamTopic(e.id, from, idx);
                      }}
                      style={{ display: "flex", alignItems: "center", gap: 10, background: C.panel, border: `1px solid ${C.line}`, borderRadius: 8, padding: "8px 12px", cursor: "grab", flexWrap: "wrap" }}
                    >
                      <span style={{ fontFamily: FONT_MONO, color: C.muted, fontSize: 12, width: 22 }}>{String(idx + 1).padStart(2, "0")}</span>
                      <span style={{ flex: 1, minWidth: 120, color: t.done ? C.muted : C.paper, textDecoration: t.done ? "line-through" : "none", fontSize: 13.5 }}>{t.name}</span>
                      <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: C.muted, fontFamily: FONT_MONO, cursor: "pointer" }}>
                        <input type="checkbox" checked={!!t.done} onChange={() => toggleExamTopicDone(e.id, t.id)} />
                        done
                      </label>
                      <button onClick={() => deleteExamTopic(e.id, t.id)} style={{ background: "none", border: "none", color: C.rose, cursor: "pointer" }}>
                        <X size={15} />
                      </button>
                      <GripVertical size={15} color={C.muted} />
                    </div>
                  ))}
                </div>
              )}

              <AddTopicRow onAdd={(name) => addExamTopicManual(e.id, name)} />

              <div style={{ marginTop: 28, paddingTop: 18, borderTop: `1px solid ${C.line}` }}>
                <DeleteSubjectButton
                  label="exam"
                  onConfirm={() => {
                    removeExam(e.id);
                    setOpenExamId(null);
                    setTab("Exams");
                  }}
                />
              </div>
            </Section>
          );
        })()}

        {/* ---------------- TODAY ---------------- */}
        {tab === "Today" && (
          <Section
            eyebrow="Timetable"
            icon={CalendarClock}
            title={isDisruptedToday ? `Light day — ${disruption.type === "sick" ? "recovering" : "away"}` : "Today's plan"}
            right={
              plan && plan.length > 0 ? (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <Btn variant="ghost" onClick={handleCopyPlan}>
                    {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? "Copied" : "Copy plan"}
                  </Btn>
                  <Btn variant="ghost" onClick={() => takeBreakNow(30)}>
                    <Coffee size={14} /> Take a break now (+30m)
                  </Btn>
                </div>
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
                {describeDay(plan) && (
                  <div style={{ background: C.panel2, border: `1px solid ${C.line}`, borderRadius: 10, padding: "12px 16px", marginBottom: 18, fontSize: 13.5, display: "flex", gap: 10, alignItems: "flex-start" }}>
                    <span style={{ color: C.amber, fontFamily: FONT_MONO, fontSize: 11, textTransform: "uppercase", letterSpacing: 1, flexShrink: 0, marginTop: 2 }}>Today</span>
                    <span>{describeDay(plan)}</span>
                  </div>
                )}
                <AllocationBar plan={plan} />
                <Timeline plan={plan} dayStart={toMin(wakeTime)} dayEnd={toMin(sleepTime)} busy={[...fixed, ...breaks]} onSkipTopic={skipTopicNow} />
                <p style={{ color: C.muted, fontSize: 12, marginTop: 12, fontFamily: FONT_MONO }}>
                  "Take a break now" pushes everything not yet started back by 30 min — anything that no longer fits before {sleepTime} is flagged and carries to tomorrow.
                </p>
              </>
            )}
          </Section>
        )}

        {/* ---------------- WEEK AHEAD ---------------- */}
        {tab === "Week Ahead" && (
          <Section eyebrow="Pacing check" icon={TrendingUp} title="Are you on track?">
            <p style={{ color: C.muted, fontSize: 13, marginTop: -6, marginBottom: 18 }}>
              For each subject with an exam date: topics left, days left, and the pace you'd need to finish in time — a normal day covers roughly 1–2 topics per subject.
            </p>
            {subjects.length === 0 && (
              <p style={{ color: C.muted, fontFamily: FONT_MONO, fontSize: 13 }}>No subjects yet — add some in Setup.</p>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {subjects.map((s) => {
                const total = s.topics.length;
                const done = s.topics.filter((t) => t.done).length;
                const remaining = total - done;
                const d = daysUntil(s.examDate);
                const color = s.color || C.teal;
                let statusLabel = null;
                let statusColor = C.muted;
                let neededPace = null;
                if (!s.examDate) {
                  statusLabel = "No exam date set";
                } else if (d === null) {
                  statusLabel = "—";
                } else if (d < 0) {
                  statusLabel = remaining > 0 ? "Exam date has passed with topics left" : "Done before the exam";
                  statusColor = remaining > 0 ? C.rose : C.teal;
                } else if (remaining === 0) {
                  statusLabel = "All topics done";
                  statusColor = C.teal;
                } else if (d === 0) {
                  statusLabel = `${remaining} topic${remaining > 1 ? "s" : ""} left, exam is today`;
                  statusColor = C.rose;
                } else {
                  neededPace = remaining / d;
                  if (neededPace <= 1) {
                    statusLabel = `On track — about 1 topic every ${Math.round(1 / neededPace)} day${Math.round(1 / neededPace) > 1 ? "s" : ""} needed`;
                    statusColor = C.teal;
                  } else if (neededPace <= 2) {
                    statusLabel = `Slightly behind — need ~${neededPace.toFixed(1)} topics/day to finish in time`;
                    statusColor = C.amber;
                  } else {
                    statusLabel = `Cramming territory — need ~${neededPace.toFixed(1)} topics/day`;
                    statusColor = C.rose;
                  }
                }
                return (
                  <div key={s.id} style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 10, padding: 14 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, flexWrap: "wrap", gap: 8 }}>
                      <span style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600 }}>
                        <span style={{ width: 10, height: 10, borderRadius: "50%", background: color, display: "inline-block" }} />
                        {s.name}
                      </span>
                      <span style={{ fontFamily: FONT_MONO, fontSize: 12, color: C.muted }}>
                        {total ? `${done}/${total} topics` : "no topics yet"}
                        {d !== null ? ` · exam in ${d}d` : ""}
                      </span>
                    </div>
                    {total > 0 && <ProgressBar pct={total ? (done / total) * 100 : 0} color={color} />}
                    <div style={{ marginTop: 8, fontSize: 13, color: statusColor, fontWeight: 500 }}>{statusLabel}</div>
                  </div>
                );
              })}
            </div>
          </Section>
        )}

        {tab === "Week Ahead" && hasAnySetup && (
          <Section eyebrow="Multi-day" icon={CalendarClock} title="Next 7 days">
            <p style={{ color: C.muted, fontSize: 13, marginTop: -6, marginBottom: 10 }}>
              Simulated forward, day by day — each day assumes the one before it got done, so the syllabus pointer actually moves instead of repeating.
            </p>
            {disruption?.type === "away" && (
              <p style={{ color: C.muted, fontSize: 12, fontFamily: FONT_MONO, marginBottom: 10 }}>
                Away is dated, so days within {disruption.startDate}–{disruption.endDate} correctly show frozen below.
              </p>
            )}
            {disruption?.type === "sick" && (
              <p style={{ color: C.rose, fontSize: 12, fontFamily: FONT_MONO, marginBottom: 10 }}>
                Sick has no end date — only today is shown frozen. The rest of the week assumes you're back, since there's no way to know. Re-check this after you extend or clear the sick status.
              </p>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {weekPlan.map((day) => {
                const studyBlocks = day.blocks.filter((b) => b.kind !== "break");
                return (
                  <div key={day.dateISO} style={{ background: C.panel, border: `1px solid ${day.disrupted ? `${C.rose}55` : C.line}`, borderRadius: 10, padding: 14 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, flexWrap: "wrap", gap: 8 }}>
                      <span style={{ fontWeight: 600, fontFamily: FONT_MONO, fontSize: 13 }}>{weekdayLabel(day.dateISO)}</span>
                      {day.disrupted && (
                        <span style={{ fontSize: 11, fontFamily: FONT_MONO, color: C.rose, border: `1px solid ${C.rose}55`, borderRadius: 5, padding: "2px 8px" }}>
                          light day
                        </span>
                      )}
                      {day.isProjected && !day.disrupted && (
                        <span style={{ fontSize: 11, fontFamily: FONT_MONO, color: C.muted }}>projected · homework not included</span>
                      )}
                    </div>
                    {studyBlocks.length === 0 ? (
                      <p style={{ color: C.muted, fontSize: 12.5, fontFamily: FONT_MONO, margin: 0 }}>Nothing scheduled.</p>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        {studyBlocks.map((b, i) => (
                          <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5 }}>
                            <span>{b.label}</span>
                            <span style={{ fontFamily: FONT_MONO, color: C.muted }}>{toHHMM(b.start)}–{toHHMM(b.end)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
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
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  <div style={{ display: "flex", gap: 4 }}>
                    {["sick", "away"].map((t) => (
                      <button
                        key={t}
                        onClick={() => setDisType(t)}
                        style={{
                          fontFamily: FONT_MONO,
                          fontSize: 12,
                          padding: "6px 12px",
                          borderRadius: 6,
                          border: `1px solid ${disType === t ? C.rose : C.line}`,
                          background: disType === t ? `${C.rose}22` : "transparent",
                          color: disType === t ? C.rose : C.muted,
                          cursor: "pointer",
                        }}
                      >
                        {t === "sick" ? "Sick" : "Away / traveling"}
                      </button>
                    ))}
                  </div>

                  {disType === "sick" ? (
                    <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                      <span style={{ fontSize: 13, color: C.muted }}>Starting</span>
                      <Input type="date" value={disStart} onChange={setDisStart} min={todayISO} style={{ width: 160 }} />
                      <Btn onClick={setSick}>Mark as sick</Btn>
                      <span style={{ fontFamily: FONT_MONO, fontSize: 12, color: C.muted, width: "100%" }}>
                        No end date — you rarely know in advance. It stays active until you tell it you're back.
                      </span>
                    </div>
                  ) : (
                    <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                      <Input type="date" value={disStart} onChange={setDisStart} min={todayISO} style={{ width: 160 }} />
                      <span style={{ color: C.muted, fontFamily: FONT_MONO, fontSize: 12 }}>to</span>
                      <Input type="date" value={disEnd} onChange={setDisEnd} min={disStart || todayISO} style={{ width: 160 }} />
                      <Btn onClick={setAwayRange}>Set</Btn>
                    </div>
                  )}
                </div>
              ) : disruption.type === "sick" ? (
                <div style={{ background: C.panel, border: `1px solid ${C.rose}55`, borderRadius: 10, padding: 14, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
                  <span>
                    Marked <b style={{ color: C.rose }}>sick</b> since {disruption.startDate}. New topics are frozen — only light revision until you say you're back.
                  </span>
                  <Btn onClick={markRecovered}><CheckCircle2 size={14} /> I'm back — feeling better</Btn>
                </div>
              ) : (
                <div style={{ background: C.panel, border: `1px solid ${C.rose}55`, borderRadius: 10, padding: 14, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
                  <span>
                    Marked <b style={{ color: C.rose }}>away</b> from {disruption.startDate} to {disruption.endDate}. New topics are frozen — only light revision until you're back.
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

function AddTopicRow({ onAdd }) {
  const [value, setValue] = useState("");
  return (
    <div style={{ display: "flex", gap: 8 }}>
      <Input
        value={value}
        onChange={setValue}
        placeholder="Add one more topic…"
        style={{ flex: 1 }}
      />
      <Btn
        variant="ghost"
        onClick={() => {
          if (!value.trim()) return;
          onAdd(value);
          setValue("");
        }}
      >
        <Plus size={14} /> Add
      </Btn>
    </div>
  );
}

// Requires a second, explicit click before actually deleting — a subject's
// whole syllabus is a lot to lose to a misclick.
function DeleteSubjectButton({ onConfirm, label = "subject" }) {
  const [confirming, setConfirming] = useState(false);
  if (!confirming) {
    return (
      <Btn variant="ghost" onClick={() => setConfirming(true)} style={{ color: C.rose, borderColor: `${C.rose}55` }}>
        <X size={14} /> Delete this {label}
      </Btn>
    );
  }
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      <span style={{ fontSize: 13, color: C.rose }}>Delete this {label} and everything in it? This can't be undone.</span>
      <Btn onClick={onConfirm} style={{ background: C.rose, color: "#2A0E08" }}>Yes, delete it</Btn>
      <Btn variant="ghost" onClick={() => setConfirming(false)}>Cancel</Btn>
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
