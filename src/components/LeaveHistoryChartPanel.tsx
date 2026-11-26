import { useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { BarChart3, CalendarRange, RotateCcw } from 'lucide-react';
import {
  buildMonthlyLeaveHistoryChartData,
  type MonthlyLeaveHistoryBucket,
} from '../shared/logic';
import type { LeaveRequest, LeaveType, User } from '../types/client';
import { Avatar } from './Avatar';

interface LeaveHistoryChartPanelProps {
  currentUser: User;
  usersById: Record<string, User>;
  leaves: LeaveRequest[];
  todayDate: string;
}

type HistoryScope = 'mine' | 'all';
type ChartMode = 'total' | 'stacked';

const LEAVE_TYPE_COLORS: Record<LeaveType, string> = {
  연차: '#008069',
  오전반차: '#0EA5E9',
  오후반차: '#6366F1',
  병가: '#D97706',
  공가: '#64748B',
};

const LEAVE_TYPE_SWATCH_CLASSES: Record<LeaveType, string> = {
  연차: 'bg-[#008069]',
  오전반차: 'bg-[#0EA5E9]',
  오후반차: 'bg-[#6366F1]',
  병가: 'bg-[#D97706]',
  공가: 'bg-[#64748B]',
};

const STACKED_SERIES: LeaveType[] = ['연차', '오전반차', '오후반차', '병가', '공가'];

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{ payload?: MonthlyLeaveHistoryBucket }>;
  chartMode: ChartMode;
}

function LeaveHistoryTooltip({ active, payload, chartMode }: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const bucket = payload[0]?.payload;
  if (!bucket) return null;

  return (
    <div className="min-w-[164px] rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-2.5 shadow-lg text-xs">
      <div className="font-bold text-neutral-900 dark:text-white mb-1.5 flex items-center justify-between gap-3">
        <span>{bucket.fullLabel}</span>
        <span className="tabular-nums text-[#008069] dark:text-[#07C160]">
          {bucket.totalDays}일 ({bucket.recordCount}건)
        </span>
      </div>
      {bucket.totalDays === 0 ? (
        <div className="text-[11px] text-neutral-400">과거 사용 기록 없음</div>
      ) : chartMode === 'stacked' || bucket.recordCount > 0 ? (
        <div className="space-y-1 border-t border-neutral-100 dark:border-neutral-800 pt-1.5">
          {STACKED_SERIES.filter((type) => bucket[type] > 0).map((type) => (
            <div key={type} className="flex items-center justify-between gap-3 text-[11px]">
              <span className="flex items-center gap-1.5 text-neutral-600 dark:text-neutral-300">
                <span
                  className={`inline-block h-2 w-2 rounded-xs shrink-0 ${LEAVE_TYPE_SWATCH_CLASSES[type]}`}
                />
                {type}
              </span>
              <span className="font-semibold tabular-nums text-neutral-900 dark:text-white">
                {bucket[type]}일
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function LeaveHistoryChartPanel({
  currentUser,
  usersById,
  leaves,
  todayDate,
}: LeaveHistoryChartPanelProps) {
  const [scope, setScope] = useState<HistoryScope>('all');
  const [monthsBack, setMonthsBack] = useState<6 | 12>(6);
  const [chartMode, setChartMode] = useState<ChartMode>('total');
  const [selectedYearMonth, setSelectedYearMonth] = useState<string | null>(null);

  const chartData = useMemo(
    () =>
      buildMonthlyLeaveHistoryChartData(leaves, todayDate, {
        userId: scope === 'mine' ? currentUser.id : null,
        monthsBack,
      }),
    [leaves, todayDate, scope, currentUser.id, monthsBack],
  );

  const selectedBucket = useMemo(
    () => chartData.buckets.find((b) => b.yearMonth === selectedYearMonth) ?? null,
    [chartData.buckets, selectedYearMonth],
  );

  const filteredRecords = useMemo(() => {
    if (!selectedYearMonth) return chartData.matchedLeaves;
    return chartData.matchedLeaves.filter(
      (l) =>
        l.startDate.slice(0, 7) <= selectedYearMonth &&
        l.endDate.slice(0, 7) >= selectedYearMonth,
    );
  }, [chartData.matchedLeaves, selectedYearMonth]);

  const handleBarSelect = (index: number) => {
    const bucket = chartData.buckets[index];
    if (!bucket) return;
    setSelectedYearMonth((cur) => (cur === bucket.yearMonth ? null : bucket.yearMonth));
  };

  return (
    <div className="space-y-4">
      {/* Header + Filter Toolbar */}
      <div className="space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold text-neutral-900 dark:text-white flex items-center gap-1.5">
              <BarChart3 className="h-4 w-4 text-[#008069] dark:text-[#07C160]" />
              <span>Leave History · 월별 과거 연차 사용량</span>
            </h3>
            <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
              완료된 과거 휴가의 월별 사용 일수입니다. 막대를 클릭하면 해당 월 기록만 아래에서 필터링합니다.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-neutral-100 dark:bg-neutral-800">
              <button
                type="button"
                onClick={() => {
                  setScope('mine');
                  setSelectedYearMonth(null);
                }}
                className={`px-2.5 py-1 rounded-md text-[11px] font-semibold whitespace-nowrap cursor-pointer transition-colors ${
                  scope === 'mine'
                    ? 'bg-white dark:bg-neutral-900 text-neutral-900 dark:text-white shadow-2xs'
                    : 'text-neutral-600 dark:text-neutral-400'
                }`}
              >
                내 연차
              </button>
              <button
                type="button"
                onClick={() => {
                  setScope('all');
                  setSelectedYearMonth(null);
                }}
                className={`px-2.5 py-1 rounded-md text-[11px] font-semibold whitespace-nowrap cursor-pointer transition-colors ${
                  scope === 'all'
                    ? 'bg-white dark:bg-neutral-900 text-neutral-900 dark:text-white shadow-2xs'
                    : 'text-neutral-600 dark:text-neutral-400'
                }`}
              >
                전사 전체
              </button>
            </div>

            <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-neutral-100 dark:bg-neutral-800">
              <button
                type="button"
                onClick={() => {
                  setMonthsBack(6);
                  setSelectedYearMonth(null);
                }}
                className={`px-2.5 py-1 rounded-md text-[11px] font-semibold whitespace-nowrap cursor-pointer transition-colors ${
                  monthsBack === 6
                    ? 'bg-white dark:bg-neutral-900 text-[#008069] dark:text-[#07C160] shadow-2xs'
                    : 'text-neutral-600 dark:text-neutral-400'
                }`}
              >
                최근 6개월
              </button>
              <button
                type="button"
                onClick={() => {
                  setMonthsBack(12);
                  setSelectedYearMonth(null);
                }}
                className={`px-2.5 py-1 rounded-md text-[11px] font-semibold whitespace-nowrap cursor-pointer transition-colors ${
                  monthsBack === 12
                    ? 'bg-white dark:bg-neutral-900 text-[#008069] dark:text-[#07C160] shadow-2xs'
                    : 'text-neutral-600 dark:text-neutral-400'
                }`}
              >
                최근 12개월
              </button>
            </div>
          </div>

          <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-neutral-100 dark:bg-neutral-800">
            <button
              type="button"
              onClick={() => setChartMode('total')}
              className={`px-2.5 py-1 rounded-md text-[11px] font-semibold whitespace-nowrap cursor-pointer transition-colors ${
                chartMode === 'total'
                  ? 'bg-white dark:bg-neutral-900 text-neutral-900 dark:text-white shadow-2xs'
                  : 'text-neutral-600 dark:text-neutral-400'
              }`}
            >
              합계 일수
            </button>
            <button
              type="button"
              onClick={() => setChartMode('stacked')}
              className={`px-2.5 py-1 rounded-md text-[11px] font-semibold whitespace-nowrap cursor-pointer transition-colors ${
                chartMode === 'stacked'
                  ? 'bg-white dark:bg-neutral-900 text-neutral-900 dark:text-white shadow-2xs'
                  : 'text-neutral-600 dark:text-neutral-400'
              }`}
            >
              유형별 누적
            </button>
          </div>
        </div>
      </div>

      {/* KPI Metric Strip */}
      <div className="grid grid-cols-3 gap-2.5">
        <div className="p-3 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50/70 dark:bg-neutral-950/40">
          <div className="text-[11px] font-medium text-neutral-500 dark:text-neutral-400">
            기간 누적 사용
          </div>
          <div className="mt-1 text-lg font-extrabold text-neutral-900 dark:text-white tabular-nums">
            {chartData.totalPastDays}일
          </div>
          <div className="text-[11px] text-neutral-400 tabular-nums">
            총 {chartData.totalPastRecords}건 완료
          </div>
        </div>

        <div className="p-3 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50/70 dark:bg-neutral-950/40">
          <div className="text-[11px] font-medium text-neutral-500 dark:text-neutral-400">
            월 평균 사용
          </div>
          <div className="mt-1 text-lg font-extrabold text-[#008069] dark:text-[#07C160] tabular-nums">
            {chartData.averageDaysPerMonth}일
          </div>
          <div className="text-[11px] text-neutral-400 tabular-nums">
            {chartData.activeMonthsCount}개 사용월
          </div>
        </div>

        <div className="p-3 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50/70 dark:bg-neutral-950/40">
          <div className="text-[11px] font-medium text-neutral-500 dark:text-neutral-400">
            최다 사용월
          </div>
          <div className="mt-1 text-lg font-extrabold text-neutral-900 dark:text-white tabular-nums truncate">
            {chartData.peakMonth ? chartData.peakMonth.fullLabel.replace('2026년 ', '') : '-'}
          </div>
          <div className="text-[11px] text-neutral-400 tabular-nums">
            {chartData.peakMonth ? `${chartData.peakMonth.totalDays}일 사용` : '기록 없음'}
          </div>
        </div>
      </div>

      {/* Recharts BarChart Surface */}
      <div className="p-3.5 rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50/50 dark:bg-neutral-950/40">
        {chartData.totalPastRecords === 0 ? (
          <div className="h-56 flex flex-col items-center justify-center text-center gap-2.5">
            <CalendarRange className="h-8 w-8 text-neutral-300 dark:text-neutral-600" />
            <div className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">
              최근 {monthsBack}개월간 완료된 {scope === 'mine' ? '내 ' : ''}과거 연차 기록이 없습니다.
            </div>
            <div className="flex items-center gap-2">
              {scope === 'mine' && (
                <button
                  type="button"
                  onClick={() => setScope('all')}
                  className="px-3 py-1.5 rounded-lg bg-[#008069] text-white text-xs font-semibold cursor-pointer"
                >
                  전사 전체 기록 보기
                </button>
              )}
              {monthsBack === 6 && (
                <button
                  type="button"
                  onClick={() => setMonthsBack(12)}
                  className="px-3 py-1.5 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-xs font-semibold text-neutral-700 dark:text-neutral-200 cursor-pointer"
                >
                  최근 12개월로 확장
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="h-56 w-full min-w-0" data-testid="leave-history-chart">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={chartData.buckets}
                margin={{ top: 10, right: 8, left: -12, bottom: 2 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  vertical={false}
                  stroke="rgba(115, 115, 115, 0.22)"
                />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11, fill: '#737373' }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  allowDecimals
                  tick={{ fontSize: 11, fill: '#737373' }}
                  axisLine={false}
                  tickLine={false}
                  unit="일"
                  width={42}
                />
                <Tooltip
                  content={<LeaveHistoryTooltip chartMode={chartMode} />}
                  cursor={{ fill: 'rgba(0, 128, 105, 0.08)' }}
                />
                {chartMode === 'stacked' && (
                  <Legend
                    wrapperStyle={{ fontSize: '11px', paddingTop: '6px' }}
                    iconSize={10}
                  />
                )}

                {chartMode === 'total' ? (
                  <Bar
                    dataKey="totalDays"
                    name="사용 일수"
                    radius={[6, 6, 0, 0]}
                    maxBarSize={44}
                    className="cursor-pointer"
                    onClick={(_data, index) => handleBarSelect(index)}
                  >
                    {chartData.buckets.map((bucket) => {
                      const isSelected = selectedYearMonth === bucket.yearMonth;
                      const isDimmed = Boolean(selectedYearMonth && !isSelected);
                      return (
                        <Cell
                          key={bucket.yearMonth}
                          fill={isSelected ? '#075E54' : isDimmed ? '#94A3B8' : '#008069'}
                          fillOpacity={isDimmed ? 0.45 : 1}
                        />
                      );
                    })}
                  </Bar>
                ) : (
                  STACKED_SERIES.map((type, idx) => (
                    <Bar
                      key={type}
                      dataKey={type}
                      name={type}
                      stackId="leaveType"
                      fill={LEAVE_TYPE_COLORS[type]}
                      radius={idx === STACKED_SERIES.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
                      maxBarSize={44}
                      className="cursor-pointer"
                      onClick={(_data, index) => handleBarSelect(index)}
                    />
                  ))
                )}
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Matching Historical Records Below Chart */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="font-semibold text-neutral-800 dark:text-neutral-200">
            {selectedBucket
              ? `${selectedBucket.fullLabel} 과거 연차 내역 (${filteredRecords.length}건 · ${selectedBucket.totalDays}일)`
              : `최근 ${monthsBack}개월 ${scope === 'mine' ? '내' : '전사'} 과거 연차 내역 (${filteredRecords.length}건)`}
          </span>
          {selectedYearMonth && (
            <button
              type="button"
              onClick={() => setSelectedYearMonth(null)}
              className="text-xs font-semibold text-[#008069] dark:text-[#07C160] hover:underline flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <RotateCcw className="h-3 w-3" />
              <span>월 선택 해제</span>
            </button>
          )}
        </div>

        {filteredRecords.length === 0 ? (
          <p className="py-8 text-center text-xs text-neutral-400">
            선택한 월에 해당하는 과거 연차 기록이 없습니다.
          </p>
        ) : (
          <div className="space-y-2">
            {filteredRecords.map((l) => {
              const applicant = usersById[l.userId];
              const sub = l.substituteId ? usersById[l.substituteId] : null;
              return (
                <div
                  key={l.id}
                  className="p-3 rounded-xl border border-neutral-200 dark:border-neutral-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
                >
                  <div className="flex items-start gap-3 min-w-0">
                    <Avatar user={applicant} size="md" />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-sm font-bold text-neutral-900 dark:text-white">
                          {applicant?.name ?? '사원'} {applicant?.position ?? ''}
                        </span>
                        <span className="text-xs text-neutral-500">
                          {applicant?.department} · {l.type} ({l.daysCount}일)
                        </span>
                        <span className="text-[11px] font-medium text-neutral-500 dark:text-neutral-400">
                          · 사용 완료
                        </span>
                      </div>
                      <div className="mt-0.5 text-xs text-neutral-600 dark:text-neutral-300 tabular-nums">
                        {l.startDate === l.endDate
                          ? l.startDate
                          : `${l.startDate} ~ ${l.endDate}`}{' '}
                        · 대행: {sub ? `${sub.name} ${sub.position}` : '지정 안 함'}
                      </div>
                      {l.reason && (
                        <p className="mt-0.5 text-xs text-neutral-400 truncate">{l.reason}</p>
                      )}
                    </div>
                  </div>

                  <div className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 shrink-0 tabular-nums">
                    {l.daysCount}일 · {l.status}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
