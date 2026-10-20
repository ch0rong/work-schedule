import { useId, useState, type FormEvent } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useNotify } from '../../app/noticeContext'
import { useAppState, useAppStore } from '../../app/storeContext'
import { useHolidays } from '../../app/useHolidays'
import { BULK_WORK_CATEGORIES, bulkAddWork, describeWorkBulkResult, hasWorkOn } from '../../features/schedules/dutyBulkService'
import { createId, defaultShift, isWeekendOrHoliday } from '../../features/schedules/scheduleService'
import { addDaysToDateString, addMonthsToMonthString, isValidTimeString } from '../../lib/date'
import { calculateNetMinutes, formatMinutes, monthRange, weekRange } from '../../lib/time'
import { endTimeBounds, fitEndTime } from '../../lib/timeOptions'
import { Dialog } from '../common/Dialog'
import { ErrorMessage } from '../common/ErrorMessage'
import { TimeSelect } from '../common/TimeSelect'

interface WorkBulkDialogProps {
  open: boolean
  /** 처음 보여줄 월 `YYYY-MM` */
  initialMonth: string
  onClose: () => void
}

/** 일괄 등록: 정규 근무·평일 당직·주말 당직 중 하나를 고르고, 달력에서 여러 날짜를 선택, 시간은 한 번만 입력한다. */
export function WorkBulkDialog({ open, initialMonth, onClose }: WorkBulkDialogProps) {
  return (
    <Dialog open={open} title="일괄 등록" onClose={onClose}>
      {open && <WorkBulkForm key={initialMonth} initialMonth={initialMonth} onClose={onClose} />}
    </Dialog>
  )
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']

function WorkBulkForm({ initialMonth, onClose }: { initialMonth: string; onClose: () => void }) {
  const store = useAppStore()
  const { data } = useAppState()
  const { isHoliday } = useHolidays()
  const notify = useNotify()
  const formId = useId()
  const fid = (name: string) => `${formId}-${name}`
  const settings = data.settings

  // 정규 근무 → 평일 당직 → 주말 당직 순
  const bulkTypes = BULK_WORK_CATEGORIES.flatMap((category) => data.workTypes.filter((type) => !type.archived && type.category === category))
  const initialType = bulkTypes[0]
  const initialShift = defaultShift(initialType?.category ?? 'regular', settings)

  const [month, setMonth] = useState(initialMonth)
  const [typeId, setTypeId] = useState(initialType?.id ?? '')
  const [selected, setSelected] = useState<string[]>([])
  const [startTime, setStartTime] = useState(initialShift.startTime)
  const [endTime, setEndTime] = useState(initialShift.endTime)
  const [endsNextDay, setEndsNextDay] = useState(initialShift.endsNextDay)

  /** 시작·종료·다음 날 종료를 함께 바꾸고 종료 시각을 범위에 맞춘다 */
  function setTimes(next: { start?: string; end?: string; nextDay?: boolean }) {
    const start = next.start ?? startTime
    const fitted = fitEndTime(start, next.end ?? endTime, next.nextDay ?? endsNextDay)
    setStartTime(start)
    setEndTime(fitted.endTime)
    setEndsNextDay(fitted.endsNextDay)
  }
  const [breakMinutes, setBreakMinutes] = useState(String(initialShift.breakMinutes))
  const [errors, setErrors] = useState<string[]>([])

  const category = bulkTypes.find((type) => type.id === typeId)?.category
  const weekend = category === 'weekend-duty'
  /** 주말 당직은 주말·공휴일, 정규 근무·평일 당직은 평일만 고를 수 있다 */
  const matchesType = (date: string) => isWeekendOrHoliday(date, isHoliday) === weekend

  const range = monthRange(month)
  const gridStart = weekRange(range.start, settings.weekStartsOn).start
  const gridEnd = weekRange(range.end, settings.weekStartsOn).end
  const days: string[] = []
  for (let day = gridStart; day <= gridEnd; day = addDaysToDateString(day, 1)) days.push(day)
  const weekdayLabels = Array.from({ length: 7 }, (_, index) => WEEKDAYS[(settings.weekStartsOn + index) % 7])

  const breakNumber = breakMinutes.trim() === '' ? Number.NaN : Number(breakMinutes)
  const timesValid = isValidTimeString(startTime) && isValidTimeString(endTime) && startTime !== endTime
  const net = timesValid && Number.isFinite(breakNumber) ? calculateNetMinutes({ startTime, endTime, endsNextDay, breakMinutes: breakNumber }) : null

  function changeType(id: string) {
    const nextCategory = bulkTypes.find((type) => type.id === id)?.category ?? 'regular'
    const shift = defaultShift(nextCategory, settings)
    setTypeId(id)
    setStartTime(shift.startTime)
    setEndTime(shift.endTime)
    setEndsNextDay(shift.endsNextDay)
    setBreakMinutes(String(shift.breakMinutes))
    setSelected((current) => current.filter((date) => isWeekendOrHoliday(date, isHoliday) === (nextCategory === 'weekend-duty')))
    setErrors([])
  }

  function changeMonth(delta: number) {
    setMonth((current) => addMonthsToMonthString(current, delta))
    setSelected([]) // 대상 월 안에서만 고른다
  }

  function toggle(date: string) {
    setSelected((current) => (current.includes(date) ? current.filter((item) => item !== date) : [...current, date].sort()))
    setErrors([])
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const result = bulkAddWork(store.getState().data, { workTypeId: typeId, dates: selected, startTime, endTime, breakMinutes: breakNumber, note: '' }, createId)
    if (result.errors.length > 0) {
      setErrors(result.errors)
      return
    }
    if (result.added.length > 0) {
      const saved = store.update(() => result.data)
      if (!saved.ok) {
        setErrors(saved.errors)
        return
      }
    }
    notify(describeWorkBulkResult(result))
    onClose()
  }

  if (bulkTypes.length === 0) {
    return <p className="muted">숨기지 않은 정규 근무·당직 유형이 없습니다. 마이페이지의 근무 유형에서 다시 표시하세요.</p>
  }

  const [year, monthNumber] = month.split('-').map(Number)
  return (
    <form className="form" onSubmit={handleSubmit} noValidate>
      <div className="field">
        <label htmlFor={fid('type')}>근무 종류</label>
        <select id={fid('type')} value={typeId} onChange={(e) => changeType(e.target.value)}>
          {bulkTypes.map((type) => (
            <option key={type.id} value={type.id}>
              {type.name}
            </option>
          ))}
        </select>
        <p className="hint">
          {weekend ? '주말·공휴일만 고를 수 있습니다. 1회당 대체휴무 1일이 발생합니다.' : '평일만 고를 수 있습니다. 주말·공휴일은 주말 당직을 고르세요.'}
        </p>
      </div>

      <fieldset className="field">
        <legend>날짜 선택 (여러 날 선택 가능)</legend>
        <div className="year-nav">
          <button type="button" className="button icon-button" aria-label="이전 달" onClick={() => changeMonth(-1)}>
            <ChevronLeft aria-hidden="true" size={18} />
          </button>
          <span aria-live="polite">
            {year}년 {monthNumber}월
          </span>
          <button type="button" className="button icon-button" aria-label="다음 달" onClick={() => changeMonth(1)}>
            <ChevronRight aria-hidden="true" size={18} />
          </button>
        </div>
        <div className="duty-grid" role="group" aria-label={`${year}년 ${monthNumber}월 날짜`}>
          {weekdayLabels.map((label) => (
            <span key={label} className="duty-grid-head" aria-hidden="true">
              {label}
            </span>
          ))}
          {days.map((date) => {
            const inMonth = date.startsWith(month)
            if (!inMonth) return <span key={date} aria-hidden="true" />
            const taken = hasWorkOn(data, date)
            const usable = matchesType(date) && !taken
            const pressed = selected.includes(date)
            const day = Number(date.slice(8, 10))
            const holidayLike = isWeekendOrHoliday(date, isHoliday)
            return (
              <button
                key={date}
                type="button"
                className={`duty-day ${pressed ? 'is-selected' : ''} ${holidayLike ? 'is-holiday' : ''}`}
                aria-pressed={pressed}
                aria-label={`${monthNumber}월 ${day}일${taken ? ' (근무 있음)' : ''}`}
                disabled={!usable}
                onClick={() => toggle(date)}
              >
                {day}
                {taken && <span className="duty-day-mark" aria-hidden="true">•</span>}
              </button>
            )
          })}
        </div>
        <p className="hint" aria-live="polite">
          {selected.length === 0 ? '선택한 날짜가 없습니다.' : `${selected.length}일 선택: ${selected.map((date) => `${Number(date.slice(8, 10))}일`).join(', ')}`} · •
          표시는 이미 근무가 있어 건너뜁니다.
        </p>
      </fieldset>

      <div className="field-row">
        <div className="field">
          <label htmlFor={fid('start')}>시작 시각</label>
          <TimeSelect id={fid('start')} label="시작 시각" value={startTime} onChange={(start) => setTimes({ start })} />
        </div>
        <div className="field">
          <label htmlFor={fid('end')}>종료 시각</label>
          <TimeSelect id={fid('end')} label="종료 시각" value={endTime} bounds={endTimeBounds(startTime, endsNextDay)} onChange={(end) => setTimes({ end })} />
        </div>
        <div className="field">
          <label htmlFor={fid('break')}>휴게시간 (분)</label>
          <input id={fid('break')} type="number" inputMode="numeric" min={0} step={30} value={breakMinutes} onChange={(e) => setBreakMinutes(e.target.value)} />
        </div>
      </div>
      <label className="checkbox">
        <input type="checkbox" checked={endsNextDay} onChange={(e) => setTimes({ nextDay: e.target.checked })} />
        다음 날 종료 (자정을 넘기는 근무)
      </label>
      {net !== null && (
        <p className="hint">
          선택한 모든 날짜에 {startTime} ~ {endsNextDay ? `다음 날 ${endTime}` : endTime}, 휴게 {breakNumber}분 · 실근무 {formatMinutes(net)}을 적용합니다. 월·주
          연장근무 한도를 넘는 날은 등록하지 않습니다.
        </p>
      )}

      {errors.length > 0 && <ErrorMessage title="등록할 수 없습니다" messages={errors} />}

      <div className="dialog-actions">
        <button type="button" className="button" onClick={onClose}>
          취소
        </button>
        <button type="submit" className="button button-primary" disabled={selected.length === 0}>
          {selected.length}일 등록
        </button>
      </div>
    </form>
  )
}
