import { Fragment } from "react";
import type { AdminModel } from "./model.ts";
import type { Totals } from "./types.ts";
const meta = [
  ["approved", "Approved"],
  ["pending", "Pending"],
  ["denied", "Denied"],
  ["cancelled", "Cancelled"],
] as const;
const dayLabel = (day: string) =>
  new Intl.DateTimeFormat("en-IN", {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
  }).format(new Date(day + "T12:00:00Z"));
export const rangeLabel = (from: string, to: string) =>
  !from || !to
    ? ""
    : from === to
      ? dayLabel(from) + " " + from.slice(0, 4)
      : dayLabel(from) + " – " + dayLabel(to) + " " + to.slice(0, 4);
export function Stat({
  label,
  value,
  tone = "",
}: {
  label: string;
  value: string | number;
  tone?: string;
}) {
  return (
    <article className="admin-stat" data-tone={tone}>
      <strong>{value}</strong>
      <span>{label}</span>
    </article>
  );
}
export function SummaryCards({ model }: { model: AdminModel }) {
  const totals = model.summary?.visits;
  return (
    totals && (
      <>
        <Stat label="Registered" value={totals.total} tone="total" />
        {(
          [
            ["pending", "Pending"],
            ["approved", "Approved"],
            ["denied", "Denied"],
          ] as const
        ).map(([key, label]) => (
          <Stat key={key} label={label} value={totals[key]} tone={key} />
        ))}
      </>
    )
  );
}
function percentages(totals: Totals) {
  const sum = meta.reduce((n, [key]) => n + Number(totals[key]), 0),
    out: Record<string, number> = {};
  if (!sum) return out;
  let left = 100;
  const rows = meta
    .map(([key]) => {
      const exact = (Number(totals[key]) * 100) / sum,
        whole = Math.floor(exact);
      out[key] = whole;
      left -= whole;
      return { key, fraction: exact - whole };
    })
    .sort((a, b) => b.fraction - a.fraction);
  for (const { key } of rows)
    if (left > 0 && Number(totals[key]) > 0) {
      out[key]++;
      left--;
    }
  return out;
}
function Legend({ totals }: { totals?: Totals }) {
  const pct = totals ? percentages(totals) : {};
  return (
    <ul className="chart-legend">
      {meta.map(([key, label]) => (
        <li key={key}>
          <span className={"legend-dot tone-" + key} aria-hidden="true" />
          <span className="legend-label">{label}</span>
          {totals && (
            <>
              <strong>{totals[key]}</strong>
              <span className="legend-share">
                {key in pct ? pct[key] + "%" : "—"}
              </span>
            </>
          )}
        </li>
      ))}
    </ul>
  );
}
export function StatusChart({ model }: { model: AdminModel }) {
  const t = model.summary?.visits;
  if (!t) return null;
  const total = meta.reduce((sum, [key]) => sum + Number(t[key]), 0),
    circumference = 2 * Math.PI * 46;
  let used = 0;
  return (
    <>
      <svg
        viewBox="0 0 140 140"
        className="chart-donut"
        role="img"
        aria-label={
          "Approval status: " +
          meta
            .map(([key, label]) => t[key] + " " + label.toLowerCase())
            .join(", ")
        }
      >
        <circle
          cx="70"
          cy="70"
          r="46"
          fill="none"
          strokeWidth="18"
          className="donut-track"
        />
        {total > 0 &&
          meta.map(([key]) => {
            if (!Number(t[key])) return null;
            const length = (circumference * Number(t[key])) / total,
              offset = used;
            used += length;
            return (
              <circle
                key={key}
                cx="70"
                cy="70"
                r="46"
                fill="none"
                strokeWidth="18"
                className={"donut-segment tone-" + key}
                strokeDasharray={
                  length.toFixed(2) + " " + (circumference - length).toFixed(2)
                }
                strokeDashoffset={(-offset).toFixed(2)}
                transform="rotate(-90 70 70)"
              />
            );
          })}
        <text x="70" y="74" className="donut-total" textAnchor="middle">
          {total}
        </text>
        <text x="70" y="91" className="donut-caption" textAnchor="middle">
          registered
        </text>
      </svg>
      <Legend totals={t} />
    </>
  );
}
export function TrendChart({ model }: { model: AdminModel }) {
  if (!model.summary) return null;
  const totals = model.summary.visits,
    days = model.summary.days;
  if (days.length <= 1) {
    const max = Math.max(1, ...meta.map(([key]) => Number(totals[key])));
    return (
      <svg
        viewBox="0 0 420 184"
        className="chart-bars"
        role="img"
        aria-label={
          "Status comparison: " +
          meta
            .map(([key, label]) => totals[key] + " " + label.toLowerCase())
            .join(", ")
        }
      >
        {meta.map(([key, label], i) => (
          <Fragment key={key}>
            <text x="0" y={i * 46 + 14} className="bar-label">
              {label}
            </text>
            <text
              x="420"
              y={i * 46 + 14}
              className="bar-value"
              textAnchor="end"
            >
              {totals[key]}
            </text>
            <rect
              x="0"
              y={i * 46 + 22}
              width="420"
              height="12"
              rx="6"
              className="bar-track"
            />
            {Number(totals[key]) > 0 && (
              <rect
                x="0"
                y={i * 46 + 22}
                width={Math.max(12, (420 * Number(totals[key])) / max).toFixed(
                  2,
                )}
                height="12"
                rx="6"
                className={"bar-fill tone-" + key}
              />
            )}
          </Fragment>
        ))}
      </svg>
    );
  }
  const band = 606 / days.length,
    width = Math.min(36, band * 0.64),
    max = Math.max(1, ...days.map((d) => Number(d.visits.total))),
    y = (n: number) => 194 - (184 * n) / max,
    step = Math.ceil(days.length / 8);
  return (
    <>
      <svg
        viewBox="0 0 640 220"
        className="chart-columns"
        role="img"
        aria-label={
          "Daily registrations from " +
          dayLabel(days[0].localVisitDate) +
          " to " +
          dayLabel(days.at(-1)!.localVisitDate) +
          ", highest day " +
          max
        }
      >
        {[...new Set([0, Math.ceil(max / 2), max])].map((tick) => (
          <Fragment key={tick}>
            <line
              x1="34"
              x2="640"
              y1={y(tick).toFixed(2)}
              y2={y(tick).toFixed(2)}
              className="chart-grid"
            />
            <text
              x="28"
              y={(y(tick) + 3).toFixed(2)}
              className="chart-axis"
              textAnchor="end"
            >
              {tick}
            </text>
          </Fragment>
        ))}
        {days.map((day, i) => {
          const cx = 34 + band * i + band / 2;
          let base = 194;
          return (
            <Fragment key={day.localVisitDate}>
              <g>
                <title>
                  {dayLabel(day.localVisitDate) +
                    ": " +
                    meta
                      .map(
                        ([key, label]) =>
                          day.visits[key] + " " + label.toLowerCase(),
                      )
                      .join(", ")}
                </title>
                {meta.map(([key]) => {
                  const value = Number(day.visits[key]);
                  if (!value) return null;
                  const height = (184 * value) / max;
                  base -= height;
                  return (
                    <rect
                      key={key}
                      x={(cx - width / 2).toFixed(2)}
                      y={base.toFixed(2)}
                      width={width.toFixed(2)}
                      height={height.toFixed(2)}
                      className={"column tone-" + key}
                    />
                  );
                })}
              </g>
              {i % step === 0 && (
                <text
                  x={cx.toFixed(2)}
                  y="212"
                  className="chart-axis"
                  textAnchor="middle"
                >
                  {dayLabel(day.localVisitDate)}
                </text>
              )}
            </Fragment>
          );
        })}
      </svg>
      <Legend />
    </>
  );
}
export function PresenceCards({ model }: { model: AdminModel }) {
  const value = model.summary?.recordedPresence;
  return (
    value && (
      <>
        <Stat label="Account visits inside" value={value.projectVisitsInside} />
        <Stat
          label="Employee account presence"
          value={value.digitalIdsInside}
        />
      </>
    )
  );
}
