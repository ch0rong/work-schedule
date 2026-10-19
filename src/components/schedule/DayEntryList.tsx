import { CalendarPlus, Plane, Utensils } from 'lucide-react'
import { useAppState } from '../../app/storeContext'
import { useHolidays } from '../../app/useHolidays'
import { LEAVE_COLORS } from '../../features/leave/leaveService'
import { mealOccurrenceDates } from '../../features/meal/mealService'
import { overtimeAmount, overtimeMinutes } from '../../features/overtime/overtimeService'
import { formatWon } from '../../features/pay/payService'
import { describeEntryTime, entriesOnDate, entryTitle, holidayWorkCompensationText, netWorkMinutesOnDate } from '../../features/schedules/scheduleService'
import { dailyTravel } from '../../features/travel/travelService'
import { parseDateString } from '../../lib/date'
import type { Entry } from '../../lib/schema'
import { DayNote } from './DayNote'
import { formatMinutes } from '../../lib/time'

interface DayEntryListProps {
  date: string
  onSelectEntry: (entry: Entry) => void
  onAdd: (kind: Entry['kind']) => void
  onOpenMeal: (date: string) => void
}

const dateLabel = new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' })

/** 선택한 날짜 패널: 일정 목록, 실제 근무시간, 연장근무, 휴일근무 보상, 매식비, 출장비 */
export function DayEntryList({ date, onSelectEntry, onAdd, onOpenMeal }: DayEntryListProps) {
  const { data } = useAppState()
  const { map: holidays } = useHolidays()
  const entries = entriesOnDate(data.entries, date)
  const parsed = parseDateString(date)
  const dayHolidays = holidays.get(date) ?? []
  const work = netWorkMinutesOnDate(data, date)
  const overtime = entries.reduce((sum, entry) => sum + (entry.kind === 'work' && entry.date === date ? overtimeMinutes(entry) : 0), 0)
  const meal = mealOccurrenceDates(data).has(date)
  const usage = data.mealUsages.find((item) => item.sourceDate === date)
  const travel = dailyTravel(data, date)
  const holidayWork = entries.flatMap((entry) => {
    const text = entry.date === date ? holidayWorkCompensationText(entry, data) : null
    return text ? [{ id: entry.id, ...text }] : []
  })

  const colorOf = (entry: Entry) =>
    entry.kind === 'leave'
      ? LEAVE_COLORS[entry.leaveType]
      : entry.kind === 'trip'
        ? '#8D6E4A'
        : (data.workTypes.find((type) => type.id === entry.workTypeId)?.color ?? '#8A8F98')

  return (
    <section className="card day-panel" aria-labelledby="day-panel-title">
      <div className="card-header">
        <h3 id="day-panel-title" className="section-title">
          {parsed ? dateLabel.format(parsed) : date}
        </h3>
      </div>
      {dayHolidays.length > 0 && (
        <p className="holiday-label">
          {dayHolidays.map((holiday) => `${holiday.name}${holiday.kind === 'custom' ? ' (추가 휴일)' : ''}`).join(', ')}
        </p>
      )}

      <div className="button-row">
        <button type="button" className="button button-primary button-small" onClick={() => onAdd('work')}>
          <CalendarPlus aria-hidden="true" size={16} />
          근무
        </button>
        <button type="button" className="button button-small" onClick={() => onAdd('leave')}>
          휴가·근태
        </button>
        <button type="button" className="button button-small" onClick={() => onAdd('trip')}>
          <Plane aria-hidden="true" size={16} />
          출장
        </button>
      </div>

      <DayNote key={date} date={date} />

      {entries.length === 0 ? (
        <p className="muted">등록된 일정이 없습니다.</p>
      ) : (
        <ul className="entry-list">
          {entries.map((entry) => {
            const continued = entry.kind === 'work' && entry.date !== date
            return (
              <li key={entry.id}>
                <button type="button" className="entry-item" onClick={() => onSelectEntry(entry)}>
                  <span className="type-dot" style={{ background: colorOf(entry) }} aria-hidden="true" />
                  <span className="entry-item-text">
                    <span className="entry-item-title">
                      {entryTitle(entry, data)}
                      {continued && <span className="badge">전날부터</span>}
                    </span>
                    <span className="muted small">{describeEntryTime(entry, data.settings)}</span>
                    {entry.note && <span className="muted small entry-note">{entry.note}</span>}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {(work.work > 0 || overtime > 0 || holidayWork.length > 0 || meal || travel.trips.length > 0) && (
        <dl className="day-facts">
          {work.work > 0 && (
            <div>
              <dt>실제 근무</dt>
              <dd>
                {formatMinutes(work.net)}
                {work.leave > 0 && <span className="muted small"> (근무 {formatMinutes(work.work)} − 반차·외출 등 {formatMinutes(work.leave)})</span>}
              </dd>
            </div>
          )}
          {overtime > 0 && (
            <div>
              <dt>연장근무</dt>
              <dd>
                {formatMinutes(overtime)} · 예상 {formatWon(overtimeAmount(overtime, data.settings.overtime.hourlyRate))}
                <span className="muted small"> (한도 적용 전)</span>
              </dd>
            </div>
          )}
          {holidayWork.map((item) => (
            <div key={item.id}>
              <dt>휴일근무 보상</dt>
              <dd>
                {item.short.startsWith('수당') ? `예상 ${item.short.slice(3)}` : item.short}
                <span className="muted small"> ({item.detail})</span>
              </dd>
            </div>
          ))}
          {meal && (
            <div>
              <dt>매식비</dt>
              <dd>
                {usage?.used ? `사용 완료 (${usage.usedDate}${usage.place ? `, ${usage.place}` : ''})` : '미사용'}{' '}
                <button type="button" className="button button-small" onClick={() => onOpenMeal(date)}>
                  <Utensils aria-hidden="true" size={14} />
                  {usage?.used ? '사용 내역' : '사용 처리'}
                </button>
              </dd>
            </div>
          )}
          {travel.trips.length > 0 && (
            <div>
              <dt>출장비</dt>
              <dd>
                {formatWon(travel.total)}
                {travel.rawTotal > travel.total && <span className="muted small"> (건별 {formatWon(travel.rawTotal)} → 일일 한도 적용)</span>}
                {travel.needsSetting && <span className="badge badge-warning">설정 필요 건 있음</span>}
              </dd>
            </div>
          )}
        </dl>
      )}
    </section>
  )
}
