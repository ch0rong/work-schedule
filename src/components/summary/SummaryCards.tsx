import { Plane, Utensils } from 'lucide-react'
import { useAppState } from '../../app/storeContext'
import { summarizeCompLeave } from '../../features/leave/compLeaveService'
import { formatLeaveAmount, leavePeriodFor, summarizeAnnualLeave } from '../../features/leave/leaveService'
import { summarizeMeals } from '../../features/meal/mealService'
import { capUsage, summarizeOvertime } from '../../features/overtime/overtimeService'
import { formatWon } from '../../features/pay/payService'
import { monthlyTravel } from '../../features/travel/travelService'
import { formatMinutes } from '../../lib/time'

interface SummaryCardsProps {
  /** 달력에서 보고 있는 월 `YYYY-MM` — 수당은 이 월 급여의 산정 기간. 한도는 오늘(이번 달이면) 또는 이 월 급여의 산정 기간 */
  month: string
  today: string
  onOpenMeal: () => void
  onOpenTravel: () => void
  /** 한도 카드가 보여주는 산정 기간 안의 날짜로 누적 내역을 연다 */
  onOpenCap: (date: string) => void
}

/** 메인 달력 요약: 산정 기간(21일~20일) 연장근무 한도(휴일근무 수당 시간 포함)·연장·휴일수당, 매식비, 출장비, 잔여 연차·대체휴무 */
export function SummaryCards({ month, today, onOpenMeal, onOpenTravel, onOpenCap }: SummaryCardsProps) {
  const { data } = useAppState()
  const minutesPerDay = data.settings.leave.minutesPerDay
  const overtime = summarizeOvertime(data, month)
  // 이번 달을 보고 있으면 오늘이 속한 산정 기간(21일 이후면 다음 급여 월), 아니면 이 월 급여의 산정 기간
  const capDate = today.startsWith(month) ? today : `${month}-01`
  const limits = capUsage(data, capDate)
  const meals = summarizeMeals(data, month)
  const travel = monthlyTravel(data, month)
  const period = leavePeriodFor(today, data.settings)
  const leave = period ? summarizeAnnualLeave(data, period) : null
  const comp = summarizeCompLeave(data, today)
  const monthLabel = `${Number(month.slice(5))}월`
  const slash = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`
  const periodLabel = `${slash(overtime.period.start)}~${slash(overtime.period.end)}`
  const capLabel = `${slash(limits.month.range.start)}~${slash(limits.month.range.end)}`
  // 정산 금액 = 연장근무 수당 + 휴일근무 수당 (모두 산정 기간 기준, 한도 적용 후)
  const settledAmount = overtime.overtimeAmount + overtime.holidayAllowance.amount
  const settledOvertimeMinutes = overtime.recognizedMinutes - overtime.holidayAllowance.minutes

  return (
    <section aria-label="요약" className="summary-grid">
      <button type="button" className={`stat-card stat-button ${limits.month.exceededMinutes > 0 ? 'stat-warning' : ''}`} onClick={() => onOpenCap(capDate)}>
        <span className="stat-label">연장근무 누적·한도 ({capLabel})</span>
        <span className="stat-value">
          {formatMinutes(limits.month.countedMinutes)} <span className="stat-unit">/ {formatMinutes(limits.month.capMinutes)}</span>
        </span>
        <span className="stat-sub">
          {limits.month.exceededMinutes > 0 ? `한도 초과 ${formatMinutes(limits.month.exceededMinutes)}` : `잔여 ${formatMinutes(limits.month.remainingMinutes)}`}
          {today.startsWith(month) && ` · 이번 주 ${formatMinutes(limits.week.countedMinutes)} / ${formatMinutes(limits.week.capMinutes)}`} — 눌러서 날짜별 보기
        </span>
      </button>
      <div className={`stat-card ${overtime.unrecognizedMinutes > 0 ? 'stat-warning' : ''}`}>
        <p className="stat-label">
          {monthLabel} 급여 연장·휴일수당 ({periodLabel})
        </p>
        <p className="stat-value">{formatWon(settledAmount)}</p>
        <p className="stat-sub">
          연장 {formatMinutes(settledOvertimeMinutes)}
          {overtime.holidayAllowance.count > 0 && ` · 휴일수당 ${formatMinutes(overtime.holidayAllowance.minutes)}`}
          {overtime.unrecognizedMinutes > 0 && ` · 미인정 ${formatMinutes(overtime.unrecognizedMinutes)}`}
        </p>
      </div>
      <button type="button" className="stat-card stat-button" onClick={onOpenMeal}>
        <span className="stat-label">
          <Utensils aria-hidden="true" size={14} /> {monthLabel} 매식비
        </span>
        <span className="stat-value">잔여 {meals.remaining}건</span>
        <span className="stat-sub">
          발생 {meals.occurred} · 사용 {meals.used} — 눌러서 관리
        </span>
      </button>
      <button type="button" className="stat-card stat-button" onClick={onOpenTravel}>
        <span className="stat-label">
          <Plane aria-hidden="true" size={14} /> {monthLabel} 출장비
        </span>
        <span className="stat-value">{formatWon(travel.total)}</span>
        <span className="stat-sub">급여와 별도{travel.needsSetting ? ' · 설정 필요 건 있음' : ''} — 눌러서 보기</span>
      </button>
      <div className="stat-card">
        <p className="stat-label">잔여 연차</p>
        <p className="stat-value">{leave ? formatLeaveAmount(leave.remainingMinutes, minutesPerDay) : '—'}</p>
        <p className="stat-sub">{leave ? `사용 ${formatLeaveAmount(leave.usedMinutes, minutesPerDay)}` : '입사일을 입력하세요'}</p>
      </div>
      <div className={`stat-card ${comp.expiringSoonMinutes > 0 || comp.overdueMinutes > 0 ? 'stat-warning' : ''}`}>
        <p className="stat-label">잔여 대체휴무</p>
        <p className="stat-value">{formatLeaveAmount(comp.availableMinutes, minutesPerDay)}</p>
        <p className="stat-sub">
          {[
            comp.expiringSoonMinutes > 0 ? `7일 안 기한 ${formatLeaveAmount(comp.expiringSoonMinutes, minutesPerDay)}` : `기한 ${data.settings.compLeave.validityMonths}개월`,
            comp.overdueMinutes > 0 ? `기한 지남 ${formatLeaveAmount(comp.overdueMinutes, minutesPerDay)}` : '',
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
        {comp.upcoming.length > 0 && (
          <p className="stat-sub muted">
            발생 예정 {formatLeaveAmount(comp.upcoming.reduce((sum, item) => sum + item.minutes, 0), minutesPerDay)} (
            {comp.upcoming.map((item) => `${Number(item.date.slice(5, 7))}/${Number(item.date.slice(8, 10))}`).join(', ')})
          </p>
        )}
      </div>
    </section>
  )
}
