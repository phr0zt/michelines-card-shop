import clsx from 'clsx';
import { BarChart3, Table2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

/**
 * Chart conventions (see the dataviz notes in README): one axis only, thin
 * marks (bars ≤ 24px with a rounded data end, 2px lines), recessive hairline
 * grid, text in ink colours never series colours, a legend for 2+ series, a
 * hover tooltip, and a table view for every chart.
 */

export const SERIES = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)'];

export interface Series {
  key: string;
  label: string;
}

interface TooltipEntry {
  dataKey?: string | number;
  name?: string;
  value?: number | string;
  color?: string;
  payload?: Record<string, unknown>;
}

function ChartTooltip({
  active,
  payload,
  label,
  format,
  labelFormat,
  series,
}: {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string | number;
  format: (v: number) => string;
  labelFormat?: (l: string) => string;
  series: Series[];
}) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="min-w-40 rounded-lg border border-line bg-surface px-3 py-2 text-sm shadow-pop">
      <div className="mb-1 text-xs text-muted">{labelFormat ? labelFormat(String(label)) : String(label)}</div>
      {series.map((s, i) => {
        const entry = payload.find((p) => p.dataKey === s.key);
        if (!entry) return null;
        return (
          <div key={s.key} className="flex items-center gap-2 py-0.5">
            <span className="inline-block h-0.5 w-3 rounded-full" style={{ background: SERIES[i] }} />
            <span className="tabular font-semibold text-ink">{format(Number(entry.value ?? 0))}</span>
            <span className="text-xs text-ink-2">{s.label}</span>
          </div>
        );
      })}
    </div>
  );
}

export function Legend({ series, kind = 'rect' }: { series: Series[]; kind?: 'rect' | 'line' }) {
  if (series.length < 2) return null;
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
      {series.map((s, i) => (
        <span key={s.key} className="inline-flex items-center gap-1.5">
          <span
            className={clsx('inline-block', kind === 'rect' ? 'size-2.5 rounded-[3px]' : 'h-0.5 w-3.5 rounded-full')}
            style={{ background: SERIES[i] }}
          />
          {s.label}
        </span>
      ))}
    </div>
  );
}

/** A panel that can flip between the chart and the same numbers as a table. */
export function ChartCard({
  title,
  subtitle,
  legend,
  chart,
  table,
  className,
  dim,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  legend?: ReactNode;
  chart: ReactNode;
  table: ReactNode;
  className?: string;
  dim?: boolean;
}) {
  const [view, setView] = useState<'chart' | 'table'>('chart');
  return (
    <section className={clsx('rounded-xl border border-line bg-surface p-4 shadow-card sm:p-5', className)}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">{title}</h2>
          {subtitle && <p className="text-sm text-muted">{subtitle}</p>}
          {view === 'chart' && legend && <div className="mt-2">{legend}</div>}
        </div>
        <div className="shrink-0">
          <div className="inline-flex rounded-lg bg-surface-3 p-0.5">
            <button
              type="button"
              aria-pressed={view === 'chart'}
              onClick={() => setView('chart')}
              className={clsx('rounded-md p-1.5', view === 'chart' ? 'bg-surface text-ink shadow-card' : 'text-muted hover:text-ink')}
              aria-label="Show chart"
              title="Chart"
            >
              <BarChart3 className="size-4" />
            </button>
            <button
              type="button"
              aria-pressed={view === 'table'}
              onClick={() => setView('table')}
              className={clsx('rounded-md p-1.5', view === 'table' ? 'bg-surface text-ink shadow-card' : 'text-muted hover:text-ink')}
              aria-label="Show table"
              title="Table"
            >
              <Table2 className="size-4" />
            </button>
          </div>
        </div>
      </div>
      <div className={clsx('transition-opacity', dim && 'opacity-50')}>{view === 'chart' ? chart : table}</div>
    </section>
  );
}

interface BarShapeProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  fill?: string;
  value?: number | [number, number];
}

/** Bar with a 4px rounded data end and a square baseline end — for negative values too. */
function RoundedBar(props: BarShapeProps) {
  const { x = 0, y = 0, width = 0, fill } = props;
  const rawHeight = props.height ?? 0;
  const value = Array.isArray(props.value) ? props.value[1] - props.value[0] : (props.value ?? 0);
  if (!width || !rawHeight) return null;
  const top = Math.min(y, y + rawHeight);
  const h = Math.abs(rawHeight);
  const r = Math.min(4, h, width / 2);
  const negative = value < 0;
  const d = negative
    ? `M${x},${top} h${width} v${h - r} a${r},${r} 0 0 1 ${-r},${r} h${-(width - 2 * r)} a${r},${r} 0 0 1 ${-r},${-r} z`
    : `M${x},${top + h} v${-(h - r)} a${r},${r} 0 0 1 ${r},${-r} h${width - 2 * r} a${r},${r} 0 0 1 ${r},${r} v${h - r} z`;
  return <path d={d} fill={fill} />;
}

const axisTick = { fill: 'var(--chart-muted)', fontSize: 12 };

export function ColumnChart({
  data,
  xKey,
  series,
  format,
  compactFormat,
  labelFormat,
  height = 260,
}: {
  data: Record<string, unknown>[];
  xKey: string;
  series: Series[];
  format: (v: number) => string;
  compactFormat: (v: number) => string;
  labelFormat?: (l: string) => string;
  height?: number;
}) {
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} barGap={2} barCategoryGap="20%" margin={{ top: 8, right: 4, bottom: 0, left: 4 }}>
          <CartesianGrid vertical={false} stroke="var(--grid)" strokeWidth={1} />
          <XAxis
            dataKey={xKey}
            tickFormatter={labelFormat}
            tick={axisTick}
            axisLine={{ stroke: 'var(--axis)' }}
            tickLine={false}
            interval="preserveStartEnd"
            minTickGap={12}
          />
          <YAxis tickFormatter={compactFormat} tick={axisTick} axisLine={false} tickLine={false} width={56} />
          <Tooltip
            cursor={{ fill: 'var(--surface-3)', opacity: 0.6 }}
            content={(props) => (
              <ChartTooltip {...(props as object)} format={format} labelFormat={labelFormat} series={series} />
            )}
          />
          {series.map((s, i) => (
            <Bar key={s.key} dataKey={s.key} name={s.label} fill={SERIES[i]} maxBarSize={24} shape={RoundedBar} isAnimationActive={false} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function TrendChart({
  data,
  xKey,
  series,
  format,
  compactFormat,
  labelFormat,
  height = 220,
  area = false,
}: {
  data: Record<string, unknown>[];
  xKey: string;
  series: Series[];
  format: (v: number) => string;
  compactFormat: (v: number) => string;
  labelFormat?: (l: string) => string;
  height?: number;
  area?: boolean;
}) {
  const common = {
    data,
    margin: { top: 8, right: 8, bottom: 0, left: 4 },
  };
  const axes = (
    <>
      <CartesianGrid vertical={false} stroke="var(--grid)" strokeWidth={1} />
      <XAxis
        dataKey={xKey}
        tickFormatter={labelFormat}
        tick={axisTick}
        axisLine={{ stroke: 'var(--axis)' }}
        tickLine={false}
        interval="preserveStartEnd"
        minTickGap={16}
      />
      <YAxis tickFormatter={compactFormat} tick={axisTick} axisLine={false} tickLine={false} width={56} domain={['auto', 'auto']} />
      <Tooltip
        cursor={{ stroke: 'var(--axis)', strokeWidth: 1 }}
        content={(props) => <ChartTooltip {...(props as object)} format={format} labelFormat={labelFormat} series={series} />}
      />
    </>
  );
  const dot = data.length <= 2 ? { r: 4, strokeWidth: 2, stroke: 'var(--surface)' } : false;
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        {area ? (
          <AreaChart {...common}>
            {axes}
            {series.map((s, i) => (
              <Area
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.label}
                stroke={SERIES[i]}
                strokeWidth={2}
                fill={SERIES[i]}
                fillOpacity={0.1}
                dot={dot}
                activeDot={{ r: 5, strokeWidth: 2, stroke: 'var(--surface)' }}
                isAnimationActive={false}
              />
            ))}
          </AreaChart>
        ) : (
          <LineChart {...common}>
            {axes}
            {series.map((s, i) => (
              <Line
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.label}
                stroke={SERIES[i]}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                dot={dot || { r: 4, strokeWidth: 2, stroke: 'var(--surface)', fill: SERIES[i] }}
                activeDot={{ r: 5, strokeWidth: 2, stroke: 'var(--surface)' }}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}

/**
 * Horizontal bars in plain HTML — every bar one colour (one series), value at
 * the bar tip in ink, full-width rows as the hover/focus target.
 */
export function BarList({
  rows,
  format,
  empty = 'Nothing to show yet',
}: {
  rows: { key: string | number; label: ReactNode; value: number; detail?: ReactNode; href?: string }[];
  format: (v: number) => string;
  empty?: string;
}) {
  const max = Math.max(0, ...rows.map((r) => r.value));
  if (rows.length === 0 || max === 0) return <p className="py-6 text-center text-sm text-muted">{empty}</p>;
  return (
    <ul className="flex flex-col gap-2.5">
      {rows.map((r) => (
        <li key={r.key} className="group" title={r.detail ? undefined : `${format(r.value)}`}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate text-ink">{r.label}</span>
            <span className="tabular shrink-0 font-medium text-ink">{format(r.value)}</span>
          </div>
          <div className="h-2.5 w-full rounded-r-[4px] bg-transparent">
            <div
              className="h-full rounded-r-[4px] bg-series-1 transition-opacity group-hover:opacity-80"
              style={{ width: `${Math.max(1.5, (r.value / max) * 100)}%` }}
            />
          </div>
          {r.detail && <div className="mt-0.5 text-xs text-muted">{r.detail}</div>}
        </li>
      ))}
    </ul>
  );
}

export function DataTable({
  columns,
  rows,
}: {
  columns: { key: string; label: string; align?: 'left' | 'right'; render?: (row: Record<string, unknown>) => ReactNode }[];
  rows: Record<string, unknown>[];
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs text-muted">
            {columns.map((c) => (
              <th key={c.key} className={clsx('px-2 py-2 font-medium', c.align === 'right' && 'text-right')}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-line last:border-0">
              {columns.map((c) => (
                <td key={c.key} className={clsx('tabular px-2 py-1.5', c.align === 'right' && 'text-right')}>
                  {c.render ? c.render(row) : String(row[c.key] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
