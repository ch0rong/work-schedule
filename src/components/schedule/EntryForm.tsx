import { useId, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { useNotify } from '../../app/noticeContext'
import { useAppState, useAppStore } from '../../app/storeContext'
import { useHolidays } from '../../app/useHolidays'
import { holidayWorkResult } from '../../features/holidayWork/holidayWorkService'
import { holidayWorkEarnsMeal } from '../../features/meal/mealService'
import { getCompUseWarnings, summarizeCompLeave, type CompLeaveSummary } from '../../features/leave/compLeaveService'
import {
  deductsAnnualLeave,
  defaultLeaveMinutes,
  formatLeaveAmount,
  getLeaveWarnings,
  isHalfDay,
  isHourlyType,
  isSingleDayType,
  LEAVE_LABELS,
} from '../../features/leave/leaveService'
import { afterWorkOvertimeMinutes, capUsage, getOvertimeLimitErrors, overtimeAmount, overtimeMinutes, suggestNextSegment } from '../../features/overtime/overtimeService'
import { formatWon } from '../../features/pay/payService'
import { createId, defaultShift, flexShift, getEntryWarnings, holidayWorkShift, isWeekendOrHoliday, upsertEntry } from '../../features/schedules/scheduleService'
import { dailyTravel, isMultiDayTrip, tripAmount, tripMinutes } from '../../features/travel/travelService'
import { addDaysToDateString, countCalendarDays, isValidDateString, isValidTimeString, timeToMinutes } from '../../lib/date'
import { entrySchema, LEAVE_TYPES, type AppData, type Entry, type HolidayCompensation, type LeaveType, type OvertimeSegment, type WorkEntry } from '../../lib/schema'
import { calculateElapsedMinutes, formatMinutes } from '../../lib/time'
import { endTimeBounds, fitEndTime } from '../../lib/timeOptions'
import { ErrorMessage } from '../common/ErrorMessage'
import { TimeSelect } from '../common/TimeSelect'

type Kind = Entry['kind']

interface FormValues {
  kind: Kind
  date: string
  // 근무
  workTypeId: string
  startTime: string
  endTime: string
  endsNextDay: boolean
  breakMinutes: string
  holidayCompensation: HolidayCompensation
  overtime: OvertimeSegment[]
  // 휴가·근태
  leaveType: LeaveType
  endDate: string
  leaveStart: string
  leaveEnd: string
  amount: string
  amountUnit: 'day' | 'hour'
  specialTypeId: string
  /** 대체휴무 사용 발생 건 (빈 값 = 자동) */
  compSourceId: string
  // 출장
  tripType: 'inside' | 'outside'
  tripStart: string
  tripEnd: string
  /** 복귀일 (당일 출장이면 출발일과 같음) */
  tripEndDate: string
  note: string
}

type FieldErrors = Partial<Record<string, string>>

export interface EntryFormProps {
  /** 수정할 일정. 없으면 새로 만든다. */
  entry?: Entry
  defaultDate: string
  defaultKind?: Kind
  /** 주간 보기에서 시간 칸을 눌렀을 때의 시작 시각 */
  defaultStartTime?: string
  defaultLeaveType?: LeaveType
  onDone: () => void
  onCancel: () => void
}

const KIND_LABELS: Record<Kind, string> = { work: '근무', leave: '휴가·근태', trip: '출장' }

const toNumber = (value: string) => (value.trim() === '' ? Number.NaN : Number(value))

export function EntryForm(props: EntryFormProps) {
  const { entry, onDone, onCancel } = props
  const store = useAppStore()
  const { data } = useAppState()
  const { isHoliday } = useHolidays()
  const notify = useNotify()
  const formId = useId()
  const settings = data.settings
  const minutesPerDay = settings.leave.minutesPerDay
  const currentTypeId = entry?.kind === 'work' ? entry.workTypeId : ''
  const selectableTypes = data.workTypes.filter((type) => !type.archived || type.id === currentTypeId)
  const typeById = new Map(data.workTypes.map((type) => [type.id, type]))
  const specialTypes = settings.specialLeaveTypes.filter((type) => !type.archived || (entry?.kind === 'leave' && entry.specialTypeId === type.id))

  function defaultCompSource(date: string): string {
    // 기한 안의 발생분을 먼저 고르고, 없을 때만 기한 지난 발생분
    const options = compSourceOptions(data, date, entry?.id ?? '').filter((option) => option.selectable)
    return (options.find((option) => option.reason === '') ?? options[0])?.grant.entryId ?? ''
  }

  function initialValues(): FormValues {
    const date = props.defaultDate
    const firstType = selectableTypes.find((type) => type.category === 'regular') ?? selectableTypes[0]
    const shift = defaultShift(firstType?.category ?? 'regular', settings, props.defaultStartTime)
    const base: FormValues = {
      kind: props.defaultKind ?? 'work',
      date,
      workTypeId: firstType?.id ?? '',
      startTime: props.defaultStartTime ?? shift.startTime,
      endTime: shift.endTime,
      endsNextDay: shift.endsNextDay,
      breakMinutes: String(shift.breakMinutes),
      holidayCompensation: 'comp-leave',
      overtime: [],
      leaveType: props.defaultLeaveType ?? 'annual',
      endDate: date,
      leaveStart: '',
      leaveEnd: '',
      amount: String(defaultLeaveMinutes(props.defaultLeaveType ?? 'annual', date, date, minutesPerDay, isHoliday) / minutesPerDay),
      amountUnit: 'day',
      specialTypeId: specialTypes[0]?.id ?? '',
      compSourceId: props.defaultLeaveType === 'comp' ? defaultCompSource(date) : '',
      tripType: 'inside',
      tripStart: '09:00',
      tripEnd: '13:00',
      tripEndDate: date,
      note: '',
    }
    if (!entry) return base
    if (entry.kind === 'work') {
      return {
        ...base,
        kind: 'work',
        date: entry.date,
        workTypeId: entry.workTypeId,
        startTime: entry.startTime,
        endTime: entry.endTime,
        endsNextDay: entry.endsNextDay,
        breakMinutes: String(entry.breakMinutes),
        holidayCompensation: entry.holidayCompensation ?? 'comp-leave',
        overtime: entry.overtime,
        note: entry.note,
      }
    }
    if (entry.kind === 'trip') {
      return { ...base, kind: 'trip', date: entry.date, tripType: entry.tripType, tripStart: entry.startTime, tripEnd: entry.endTime, tripEndDate: entry.endDate, note: entry.note }
    }
    const byDay = !isHourlyType(entry.leaveType) && entry.minutes % (minutesPerDay / 2) === 0
    return {
      ...base,
      kind: 'leave',
      date: entry.date,
      endDate: entry.endDate,
      leaveType: entry.leaveType,
      leaveStart: entry.startTime ?? '',
      leaveEnd: entry.endTime ?? '',
      amountUnit: byDay ? 'day' : 'hour',
      amount: String(byDay ? entry.minutes / minutesPerDay : entry.minutes / 60),
      specialTypeId: entry.specialTypeId ?? base.specialTypeId,
      compSourceId: entry.compSourceId ?? '',
      note: entry.note,
    }
  }

  const [values, setValues] = useState<FormValues>(() => initialValues())
  const [endTouched, setEndTouched] = useState(Boolean(entry))
  const [amountTouched, setAmountTouched] = useState(Boolean(entry))
  const [errors, setErrors] = useState<FieldErrors>({})
  const [acknowledged, setAcknowledged] = useState(false)

  /** 폼 값 → 일정. 숫자가 아니면 NaN이 되어 스키마 검증에서 걸러진다. */
  function toEntry(v: FormValues, id: string): Entry {
    const note = v.note.trim()
    if (v.kind === 'work') {
      const category = typeById.get(v.workTypeId)?.category
      const isHolidayWork = category === 'holiday-work'
      const times = { startTime: v.startTime, endTime: v.endTime, endsNextDay: v.endsNextDay, breakMinutes: toNumber(v.breakMinutes) }
      const holiday = isHolidayWork && isValidTimeString(v.startTime) && isValidTimeString(v.endTime) && Number.isFinite(times.breakMinutes)
        ? holidayWorkResult({ ...times, holidayCompensation: v.holidayCompensation }, settings)
        : null
      return {
        id,
        kind: 'work',
        date: v.date,
        endDate: v.endsNextDay && isValidDateString(v.date) ? addDaysToDateString(v.date, 1) : v.date,
        workTypeId: v.workTypeId,
        startTime: v.startTime,
        endTime: v.endTime,
        endsNextDay: v.endsNextDay,
        breakMinutes: toNumber(v.breakMinutes),
        note,
        // 휴일근무는 최대 8시간만 인정 — 연장근무 구간을 두지 않는다
        overtime: isHolidayWork ? [] : v.overtime,
        holidayCompensation: isHolidayWork ? (holiday?.compensation ?? v.holidayCompensation) : null,
        // 대체휴무 기한은 저장할 때(upsertEntry) 기록한다
        compExpiresOn: null,
      }
    }
    if (v.kind === 'trip') {
      return { id, kind: 'trip', date: v.date, endDate: v.tripEndDate, tripType: v.tripType, startTime: v.tripStart, endTime: v.tripEnd, note }
    }
    const hasTimes = v.leaveStart !== '' && v.leaveEnd !== ''
    let minutes: number
    if (isHalfDay(v.leaveType)) minutes = minutesPerDay / 2
    else if (isHourlyType(v.leaveType) && hasTimes && v.leaveEnd > v.leaveStart) minutes = timeToMinutes(v.leaveEnd) - timeToMinutes(v.leaveStart)
    else minutes = Math.round(toNumber(v.amount) * (v.amountUnit === 'day' ? minutesPerDay : 60))
    return {
      id,
      kind: 'leave',
      leaveType: v.leaveType,
      date: v.date,
      endDate: isSingleDayType(v.leaveType) ? v.date : v.endDate,
      startTime: hasTimes ? v.leaveStart : null,
      endTime: hasTimes ? v.leaveEnd : null,
      minutes,
      specialTypeId: v.leaveType === 'special' ? v.specialTypeId || null : null,
      compSourceId: v.leaveType === 'comp' ? v.compSourceId || null : null,
      note,
    }
  }

  const id = entry?.id ?? ''
  const candidate = useMemo(() => {
    const parsed = entrySchema.safeParse(toEntry(values, id || 'new'))
    return parsed.success ? parsed.data : null
    // eslint-disable-next-line react-hooks/exhaustive-deps -- toEntry는 values·설정에만 의존
  }, [values, id, settings])

  const warnings = useMemo(() => {
    if (!candidate) return []
    const list = getEntryWarnings(data, candidate)
    if (candidate.kind === 'leave') list.push(...getLeaveWarnings(data, candidate), ...getCompUseWarnings(data, candidate))
    return list
  }, [candidate, data])

  /** 월(산정 기간)·주(월~일) 연장근무 한도를 넘으면 저장하지 않는다 */
  const limitErrors = useMemo(() => (candidate?.kind === 'work' ? getOvertimeLimitErrors(data, candidate) : []), [candidate, data])

  function update(patch: Partial<FormValues>) {
    setValues((current) => {
      const next = { ...current, ...patch }
      const category = typeById.get(next.workTypeId)?.category ?? 'regular'

      let typeChanged = 'workTypeId' in patch
      if ('workTypeId' in patch || 'date' in patch) {
        // 당직은 날짜에 맞는 유형으로 자동 선택 (주말·휴일 → 주말 당직)
        if ((category === 'weekday-duty' || category === 'weekend-duty') && isValidDateString(next.date)) {
          const wanted = isWeekendOrHoliday(next.date, isHoliday) ? 'weekend-duty' : 'weekday-duty'
          const match = selectableTypes.find((type) => type.category === wanted)
          if (match && match.id !== next.workTypeId) {
            next.workTypeId = match.id
            typeChanged = true // 유형이 바뀌면 그 유형의 기본 시간으로
          }
        }
      }
      if (typeChanged) {
        const nextCategory = typeById.get(next.workTypeId)?.category ?? 'regular'
        const shift = defaultShift(nextCategory, settings, nextCategory === 'flex' ? next.startTime : undefined)
        Object.assign(next, { startTime: shift.startTime, endTime: shift.endTime, endsNextDay: shift.endsNextDay, breakMinutes: String(shift.breakMinutes) })
        setEndTouched(false)
      } else if ('startTime' in patch && category === 'flex' && !endTouched && isValidTimeString(next.startTime)) {
        const shift = flexShift(next.startTime, settings)
        Object.assign(next, { endTime: shift.endTime, endsNextDay: shift.endsNextDay })
      }
      // 휴일근무: 종료 시각을 직접 고치기 전까지는 시작·휴게에 맞춰 실근무 8시간을 유지한다
      const holidayWork = (typeById.get(next.workTypeId)?.category ?? 'regular') === 'holiday-work'
      if (holidayWork && !typeChanged && !endTouched && ('startTime' in patch || 'breakMinutes' in patch)) {
        const breakMinutes = toNumber(next.breakMinutes)
        if (isValidTimeString(next.startTime) && Number.isFinite(breakMinutes) && breakMinutes >= 0) {
          const shift = holidayWorkShift(next.startTime, breakMinutes)
          Object.assign(next, { endTime: shift.endTime, endsNextDay: shift.endsNextDay })
        }
      }
      // 종료 시각은 같은 날이면 시작 + 30분부터, 다음 날 종료면 00:00~시작 시각. 벗어나면 맞춘다
      if ('startTime' in patch || 'endTime' in patch || 'endsNextDay' in patch) {
        Object.assign(next, fitEndTime(next.startTime, next.endTime, next.endsNextDay))
      }
      if ('leaveStart' in patch && next.leaveStart && next.leaveEnd && next.leaveEnd <= next.leaveStart) {
        next.leaveEnd = fitEndTime(next.leaveStart, next.leaveEnd, false).endTime
      }
      if (('tripStart' in patch || 'date' in patch || 'tripEndDate' in patch) && next.tripEndDate === next.date) {
        next.tripEnd = fitEndTime(next.tripStart, next.tripEnd, false).endTime
      }

      if ('date' in patch && isValidDateString(next.date) && isValidDateString(current.date) && isValidDateString(current.tripEndDate)) {
        // 출장: 출발일을 바꾸면 박 수를 유지한 채 복귀일도 옮긴다
        const nights = Math.max(0, countCalendarDays(current.date, current.tripEndDate) - 1)
        next.tripEndDate = addDaysToDateString(next.date, nights)
      }
      if (isSingleDayType(next.leaveType) || ('date' in patch && next.endDate < next.date)) next.endDate = next.date
      if ('leaveType' in patch) {
        next.amountUnit = isHourlyType(next.leaveType) ? 'hour' : 'day'
        setAmountTouched(false)
      }
      // 대체휴무: 사용일 기준 기한이 가장 빠른 발생 건을 미리 선택 (직접 고르면 유지)
      if (next.kind === 'leave' && next.leaveType === 'comp' && ('leaveType' in patch || 'date' in patch) && isValidDateString(next.date)) {
        const options = compSourceOptions(data, next.date, id)
        if (!options.some((option) => option.grant.entryId === next.compSourceId && option.selectable)) next.compSourceId = defaultCompSource(next.date)
      }
      if ((!amountTouched || 'leaveType' in patch) && next.kind === 'leave' && isValidDateString(next.date) && isValidDateString(next.endDate)) {
        const minutes = defaultLeaveMinutes(next.leaveType, next.date, next.endDate, minutesPerDay, isHoliday)
        next.amount = String(next.amountUnit === 'day' ? minutes / minutesPerDay : minutes / 60)
      }
      return next
    })
    setErrors({})
    setAcknowledged(false)
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const next = toEntry(values, id || createId())
    const parsed = entrySchema.safeParse(next)
    if (!parsed.success) {
      const fieldErrors: FieldErrors = {}
      for (const issue of parsed.error.issues) {
        const [first] = issue.path
        const field = first === 'overtime' ? 'overtime' : first === 'minutes' ? 'amount' : String(first ?? 'form')
        fieldErrors[field] ??= issue.message.replace(/expected number, received NaN/i, '숫자를 입력하세요.')
      }
      setErrors(fieldErrors)
      return
    }
    const blocking = parsed.data.kind === 'work' ? getOvertimeLimitErrors(data, parsed.data) : []
    if (blocking.length > 0) {
      setErrors({ form: '연장근무 한도를 넘어 저장할 수 없습니다. 연장근무 시간을 줄이세요.' })
      return
    }
    if (warnings.length > 0 && !acknowledged) {
      setErrors({ form: '경고 내용을 확인하고 체크한 뒤 저장하세요.' })
      return
    }
    const result = store.update((current) => upsertEntry(current, parsed.data))
    if (!result.ok) {
      setErrors({ form: result.errors.join(' ') })
      return
    }
    notify(entry ? '일정을 수정했습니다.' : '일정을 추가했습니다.')
    onDone()
  }

  const fid = (name: string) => `${formId}-${name}`
  const errorProps = (name: string) => (errors[name] ? { 'aria-invalid': true as const, 'aria-describedby': fid(`${name}-error`) } : {})
  const fieldError = (name: string) =>
    errors[name] && (
      <p id={fid(`${name}-error`)} className="field-error">
        {errors[name]}
      </p>
    )
  const dateField = (label = '날짜') => (
    <div className="field">
      <label htmlFor={fid('date')}>{label}</label>
      <input id={fid('date')} type="date" value={values.date} onChange={(e) => update({ date: e.target.value })} required {...errorProps('date')} />
      {fieldError('date')}
    </div>
  )

  return (
    <form className="form" onSubmit={handleSubmit} noValidate>
      {!entry && (
        <fieldset className="segmented">
          <legend className="visually-hidden">일정 종류</legend>
          {(Object.keys(KIND_LABELS) as Kind[]).map((kind) => (
            <label key={kind} className="segmented-option">
              <input type="radio" name={fid('kind')} checked={values.kind === kind} onChange={() => update({ kind })} />
              <span>{KIND_LABELS[kind]}</span>
            </label>
          ))}
        </fieldset>
      )}

      {values.kind === 'work' && (
        <WorkFields
          values={values}
          update={update}
          setEndTouched={setEndTouched}
          candidate={candidate?.kind === 'work' ? candidate : null}
          fid={fid}
          errorProps={errorProps}
          fieldError={fieldError}
          dateField={dateField}
        />
      )}

      {values.kind === 'leave' && (
        <>
          <div className="field">
            <label htmlFor={fid('leaveType')}>종류</label>
            <select id={fid('leaveType')} value={values.leaveType} onChange={(e) => update({ leaveType: e.target.value as LeaveType })}>
              {LEAVE_TYPES.map((type) => (
                <option key={type} value={type}>
                  {LEAVE_LABELS[type]}
                  {type === 'half-am' || type === 'half-pm' ? ` (${minutesPerDay / 120}시간)` : ''}
                </option>
              ))}
            </select>
            <p className="hint">
              {deductsAnnualLeave(values.leaveType, settings) ? '연차에서 차감합니다.' : '연차에서 차감하지 않습니다.'}
              {(values.leaveType === 'outing' || values.leaveType === 'early-leave') &&
                settings.leave.outingDeducts &&
                ` (누계 ${minutesPerDay / 60}시간 = 연차 1일)`}
            </p>
          </div>

          {values.leaveType === 'special' && (
            <div className="field">
              <label htmlFor={fid('specialTypeId')}>특별휴가 유형</label>
              <select id={fid('specialTypeId')} value={values.specialTypeId} onChange={(e) => update({ specialTypeId: e.target.value })} {...errorProps('specialTypeId')}>
                {specialTypes.map((type) => (
                  <option key={type.id} value={type.id}>
                    {type.name}
                  </option>
                ))}
              </select>
              {fieldError('specialTypeId')}
            </div>
          )}

          {values.leaveType === 'comp' && (
            <CompSourcePicker date={values.date} excludeId={id} value={values.compSourceId} onChange={(compSourceId) => update({ compSourceId })} />
          )}

          <div className="field-row">
            {dateField(isSingleDayType(values.leaveType) ? '날짜' : '시작일')}
            {!isSingleDayType(values.leaveType) && (
              <div className="field">
                <label htmlFor={fid('endDate')}>종료일</label>
                <input id={fid('endDate')} type="date" value={values.endDate} min={values.date} onChange={(e) => update({ endDate: e.target.value })} {...errorProps('endDate')} />
                {fieldError('endDate')}
              </div>
            )}
          </div>

          <div className="field-row">
            <div className="field">
              <label htmlFor={fid('leaveStart')}>시작 시각 (선택)</label>
              <TimeSelect id={fid('leaveStart')} label="시작 시각 (선택)" emptyLabel="선택 안 함" value={values.leaveStart} onChange={(leaveStart) => update({ leaveStart })} />
            </div>
            <div className="field">
              <label htmlFor={fid('leaveEnd')}>종료 시각 (선택)</label>
              <TimeSelect id={fid('leaveEnd')} label="종료 시각 (선택)" emptyLabel="선택 안 함" value={values.leaveEnd} bounds={values.leaveStart ? endTimeBounds(values.leaveStart, false) : undefined} onChange={(leaveEnd) => update({ leaveEnd })} {...errorProps('endTime')} />
              {fieldError('endTime')}
            </div>
          </div>

          {isHalfDay(values.leaveType) ? (
            <p className="hint">사용량: {formatLeaveAmount(minutesPerDay / 2, minutesPerDay)} (반차 고정)</p>
          ) : isHourlyType(values.leaveType) && values.leaveStart && values.leaveEnd ? (
            <p className="hint">사용량: 시작·종료 시각으로 계산 ({values.leaveEnd > values.leaveStart ? formatMinutes(timeToMinutes(values.leaveEnd) - timeToMinutes(values.leaveStart)) : '—'})</p>
          ) : (
            <div className="field-row">
              <div className="field">
                <label htmlFor={fid('amount')}>사용량</label>
                <input
                  id={fid('amount')}
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step={0.5}
                  value={values.amount}
                  onChange={(e) => {
                    setAmountTouched(true)
                    update({ amount: e.target.value })
                  }}
                  {...errorProps('amount')}
                />
                {fieldError('amount')}
              </div>
              <div className="field">
                <label htmlFor={fid('amountUnit')}>단위</label>
                <select
                  id={fid('amountUnit')}
                  value={values.amountUnit}
                  onChange={(e) => {
                    setAmountTouched(true)
                    update({ amountUnit: e.target.value as 'day' | 'hour' })
                  }}
                >
                  <option value="day">일 ({minutesPerDay / 60}시간)</option>
                  <option value="hour">시간</option>
                </select>
              </div>
              <p className="hint">여러 날 연차는 주말·공휴일을 뺀 일수로 자동 계산합니다. 필요하면 직접 고치세요.</p>
            </div>
          )}
        </>
      )}

      {values.kind === 'trip' && <TripFields values={values} update={update} fid={fid} errorProps={errorProps} fieldError={fieldError} dateField={dateField} />}

      <div className="field">
        <label htmlFor={fid('note')}>비고 (선택)</label>
        <textarea id={fid('note')} rows={2} value={values.note} onChange={(e) => update({ note: e.target.value })} maxLength={1000} />
      </div>

      {limitErrors.length > 0 && <ErrorMessage title="연장근무 한도 초과 — 저장할 수 없습니다" messages={limitErrors} />}

      {warnings.length > 0 && (
        <div className="alert alert-warning" role="alert">
          <div>
            <p className="alert-title">확인이 필요합니다</p>
            <ul className="alert-list">
              {warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
            <label className="checkbox">
              <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} />
              확인했으며 그대로 저장합니다
            </label>
          </div>
        </div>
      )}

      {errors.form && <ErrorMessage title={errors.form} />}

      <div className="dialog-actions">
        <button type="button" className="button" onClick={onCancel}>
          취소
        </button>
        <button type="submit" className="button button-primary">
          저장
        </button>
      </div>
    </form>
  )
}

// ---------- 근무 ----------

interface FieldHelpers {
  fid: (name: string) => string
  errorProps: (name: string) => object
  fieldError: (name: string) => ReactNode
  dateField: (label?: string) => ReactNode
}

function WorkFields({
  values,
  update,
  setEndTouched,
  candidate,
  fid,
  errorProps,
  fieldError,
  dateField,
}: FieldHelpers & {
  values: FormValues
  update: (patch: Partial<FormValues>) => void
  setEndTouched: (touched: boolean) => void
  candidate: WorkEntry | null
}) {
  const { data } = useAppState()
  const settings = data.settings
  const type = data.workTypes.find((item) => item.id === values.workTypeId)
  const category = type?.category ?? 'regular'
  const selectable = data.workTypes.filter((item) => !item.archived || item.id === values.workTypeId)
  const elapsed = isValidTimeString(values.startTime) && isValidTimeString(values.endTime) ? calculateElapsedMinutes(values) : null
  const breakNumber = Number(values.breakMinutes)
  const unit = settings.overtime.unitMinutes

  const holiday =
    category === 'holiday-work' && elapsed !== null && Number.isFinite(breakNumber)
      ? holidayWorkResult({ startTime: values.startTime, endTime: values.endTime, endsNextDay: values.endsNextDay, breakMinutes: breakNumber, holidayCompensation: values.holidayCompensation }, settings)
      : null
  const rate = settings.overtime.hourlyRate
  const overtimeTotal = candidate ? overtimeMinutes(candidate) : null
  const limits = useMemo(() => {
    if (!candidate || candidate.overtime.length === 0) return null
    const next = { ...data, entries: [...data.entries.filter((entry) => entry.id !== candidate.id), candidate] }
    return capUsage(next, candidate.date)
  }, [candidate, data])
  const mealEarned = candidate ? afterWorkOvertimeMinutes(candidate) >= settings.meal.minOvertimeMinutes && afterWorkOvertimeMinutes(candidate) > 0 : false

  const setSegment = (index: number, patch: Partial<OvertimeSegment>) =>
    update({
      overtime: values.overtime.map((segment, i) => {
        if (i !== index) return segment
        const next = { ...segment, ...patch }
        return { ...next, ...fitEndTime(next.startTime, next.endTime, next.endsNextDay) }
      }),
    })

  return (
    <>
      <div className="field-row">
        {dateField()}
        <div className="field">
          <label htmlFor={fid('workTypeId')}>근무 유형</label>
          <select id={fid('workTypeId')} value={values.workTypeId} onChange={(e) => update({ workTypeId: e.target.value })} {...errorProps('workTypeId')}>
            {selectable.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
                {item.countsAsWork ? '' : ' (근무시간 제외)'}
              </option>
            ))}
          </select>
          {fieldError('workTypeId')}
        </div>
      </div>

      {category === 'flex' && <p className="hint">유연근무: 시작 시각을 바꾸면 종료 시각이 실근무 {formatMinutes(settings.schedule.flex.netMinutes)} + 점심 {settings.schedule.flex.breakMinutes}분으로 자동 계산됩니다.</p>}
      {(category === 'weekday-duty' || category === 'weekend-duty') && <p className="hint">당직은 날짜에 맞게 평일/주말 당직이 자동 선택되고 기본 시간이 입력됩니다.</p>}

      <div className="field-row">
        <div className="field">
          <label htmlFor={fid('startTime')}>시작 시각</label>
          <TimeSelect id={fid('startTime')} label="시작 시각" value={values.startTime} onChange={(startTime) => update({ startTime })} {...errorProps('startTime')} />
          {fieldError('startTime')}
        </div>
        <div className="field">
          <label htmlFor={fid('endTime')}>종료 시각</label>
          <TimeSelect
            id={fid('endTime')}
            label="종료 시각"
            value={values.endTime}
            bounds={endTimeBounds(values.startTime, values.endsNextDay)}
            onChange={(endTime) => {
              setEndTouched(true)
              update({ endTime })
            }}
            {...errorProps('endTime')}
          />
          {fieldError('endTime')}
        </div>
        <div className="field">
          <label htmlFor={fid('breakMinutes')}>휴게시간 (분)</label>
          <input id={fid('breakMinutes')} type="number" inputMode="numeric" min={0} step={30} value={values.breakMinutes} onChange={(e) => update({ breakMinutes: e.target.value })} {...errorProps('breakMinutes')} />
          {category === 'holiday-work' && <p className="hint">쉬지 않고 일했으면 0</p>}
          {fieldError('breakMinutes')}
        </div>
      </div>
      <label className="checkbox">
        <input type="checkbox" checked={values.endsNextDay} onChange={(e) => update({ endsNextDay: e.target.checked })} />
        다음 날 종료 (자정을 넘기는 근무)
      </label>
      {fieldError('endDate')}
      {elapsed !== null && elapsed > 0 && Number.isFinite(breakNumber) && (
        <p className="hint" aria-live="polite">
          경과 {formatMinutes(elapsed)} − 휴게 {formatMinutes(breakNumber)} = 실근무 <strong>{formatMinutes(elapsed - breakNumber)}</strong>
        </p>
      )}

      {category === 'holiday-work' && (
        <fieldset className="field">
          <legend>휴일근무 보상</legend>
          {holiday && !holiday.fullDay ? (
            <p className="hint">8시간 미만이라 대체휴무는 발생하지 않고 실근무만큼 수당으로 지급합니다. (월·주 연장근무 한도에 포함)</p>
          ) : (
            <>
              <label className="checkbox">
                <input type="radio" name={fid('comp')} checked={values.holidayCompensation === 'comp-leave'} onChange={() => update({ holidayCompensation: 'comp-leave' })} />
                대체휴무 1일 발생
              </label>
              <label className="checkbox">
                <input type="radio" name={fid('comp')} checked={values.holidayCompensation === 'allowance'} onChange={() => update({ holidayCompensation: 'allowance' })} />
                수당 지급 — 인정 {formatMinutes(settings.holidayWork.allowanceMinutes)} × {formatWon(rate)} ={' '}
                {formatWon(overtimeAmount(settings.holidayWork.allowanceMinutes, rate))}
              </label>
              <label className="checkbox">
                <input type="radio" name={fid('comp')} checked={values.holidayCompensation === 'trip-comp'} onChange={() => update({ holidayCompensation: 'trip-comp' })} />
                출장(대체휴무) — 수당 없이 대체휴무 1일 발생
              </label>
              {values.holidayCompensation === 'allowance' && (
                <p className="hint">8시간 근무해도 수당은 {formatMinutes(settings.holidayWork.allowanceMinutes)} 기준으로 지급합니다.</p>
              )}
              {values.holidayCompensation === 'trip-comp' && (
                <p className="hint">주 12시간 한도로 수당을 받을 수 없을 때 쓰는 예외입니다. 주·월 연장근무 한도에서 제외되고 수당·출장비 없이 대체휴무로 보상합니다.</p>
              )}
              {holiday && holiday.droppedMinutes > 0 && (
                <p className="hint">휴일근무는 최대 8시간까지만 인정합니다. 넘는 {formatMinutes(holiday.droppedMinutes)}은 인정하지 않습니다(연장근무 수당 없음).</p>
              )}
            </>
          )}
          {holiday && holiday.netMinutes > 0 && (
            <div className="overtime-summary" aria-live="polite">
              <p>
                실근무 <strong>{formatMinutes(holiday.netMinutes)}</strong> ·{' '}
                {holiday.compensation === 'allowance' ? (
                  <>
                    예상 수당 <strong>{formatWon(holiday.amount)}</strong>
                    <span className="muted small">
                      {' '}
                      ({formatMinutes(holiday.allowanceMinutes)} × {formatWon(rate)})
                    </span>
                  </>
                ) : (
                  <>
                    대체휴무 <strong>1일</strong> (수당 없음)
                  </>
                )}
                {candidate && holidayWorkEarnsMeal(candidate, settings) && <span className="badge badge-meal">매식비</span>}
              </p>
            </div>
          )}
        </fieldset>
      )}
      {category === 'weekend-duty' && <p className="hint">주말 당직은 대체휴무 1일이 발생하며 수당은 지급하지 않습니다.</p>}

      {category === 'holiday-work' ? (
        <p className="hint">
          휴일근무는 최대 8시간까지만 인정되어 연장근무를 따로 입력하지 않습니다.
          {values.overtime.length > 0 && ' 저장하면 이 일정의 기존 연장근무 구간은 지워집니다.'}
        </p>
      ) : (
        <fieldset className="field overtime-box">
          <legend>연장근무 ({unit}분 단위, 근무 시작 전·종료 후)</legend>
          {values.overtime.map((segment, index) => (
            <div key={index} className="inline-row">
              <TimeSelect label={`연장 ${index + 1} 시작`} value={segment.startTime} onChange={(startTime) => setSegment(index, { startTime })} />
              <span aria-hidden="true">~</span>
              <TimeSelect label={`연장 ${index + 1} 종료`} value={segment.endTime} bounds={endTimeBounds(segment.startTime, segment.endsNextDay)} onChange={(endTime) => setSegment(index, { endTime })} />
              <label className="checkbox nowrap small">
                <input type="checkbox" checked={segment.endsNextDay} onChange={(e) => setSegment(index, { endsNextDay: e.target.checked })} />
                다음 날
              </label>
              <button
                type="button"
                className="button button-small button-danger"
                aria-label={`연장 ${index + 1} 삭제`}
                onClick={() => update({ overtime: values.overtime.filter((_, i) => i !== index) })}
              >
                <Trash2 aria-hidden="true" size={16} />
              </button>
            </div>
          ))}
          <div>
            <button
              type="button"
              className="button button-small"
              disabled={values.overtime.length >= 6 || !isValidTimeString(values.endTime)}
              onClick={() => update({ overtime: [...values.overtime, suggestNextSegment(values, unit)] })}
            >
              <Plus aria-hidden="true" size={16} />
              연장근무 추가
            </button>
          </div>
          {fieldError('overtime')}
          {overtimeTotal !== null && overtimeTotal > 0 && (
            <div className="overtime-summary" aria-live="polite">
              <p>
                총 연장 <strong>{formatMinutes(overtimeTotal)}</strong> · 예상 수당 <strong>{formatWon(overtimeAmount(overtimeTotal, settings.overtime.hourlyRate))}</strong>
                {mealEarned && <span className="badge badge-meal">매식비</span>}
              </p>
              {limits && (
                <p className="muted small">
                  월 한도({limits.month.range.start.slice(5)} ~ {limits.month.range.end.slice(5)}) {formatMinutes(limits.month.countedMinutes)} / {formatMinutes(limits.month.capMinutes)} · 주
                  한도({limits.week.range.start.slice(5)} ~ {limits.week.range.end.slice(5)}) {formatMinutes(limits.week.countedMinutes)} / {formatMinutes(limits.week.capMinutes)}
                </p>
              )}
            </div>
          )}
        </fieldset>
      )}
    </>
  )
}


// ---------- 출장 ----------

const TRIP_LENGTHS = [0, 1, 2, 3, 4] as const

function TripFields({
  values,
  update,
  fid,
  errorProps,
  fieldError,
  dateField,
}: FieldHelpers & { values: FormValues; update: (patch: Partial<FormValues>) => void }) {
  const { data } = useAppState()
  const datesValid = isValidDateString(values.date) && isValidDateString(values.tripEndDate) && values.tripEndDate >= values.date
  const nights = datesValid ? countCalendarDays(values.date, values.tripEndDate) - 1 : 0
  const times = { date: values.date, endDate: values.tripEndDate, startTime: values.tripStart, endTime: values.tripEnd }
  const valid = datesValid && isValidTimeString(values.tripStart) && isValidTimeString(values.tripEnd) && (nights > 0 || values.tripEnd > values.tripStart)
  const amount = valid ? tripAmount({ tripType: values.tripType, ...times }, data.settings) : null
  const day = isValidDateString(values.date) ? dailyTravel(data, values.date) : null
  const days = nights + 1

  return (
    <>
      <div className="field-row">
        <div className="field">
          <label htmlFor={fid('tripType')}>구분</label>
          <select id={fid('tripType')} value={values.tripType} onChange={(e) => update({ tripType: e.target.value as 'inside' | 'outside' })}>
            <option value="inside">관내</option>
            <option value="outside">관외</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor={fid('tripLength')}>기간</label>
          <select
            id={fid('tripLength')}
            value={TRIP_LENGTHS.includes(nights as (typeof TRIP_LENGTHS)[number]) ? String(nights) : 'custom'}
            onChange={(e) => e.target.value !== 'custom' && isValidDateString(values.date) && update({ tripEndDate: addDaysToDateString(values.date, Number(e.target.value)) })}
          >
            {TRIP_LENGTHS.map((n) => (
              <option key={n} value={n}>
                {n === 0 ? '당일' : `${n}박 ${n + 1}일`}
              </option>
            ))}
            {!TRIP_LENGTHS.includes(nights as (typeof TRIP_LENGTHS)[number]) && <option value="custom">{nights}박 {nights + 1}일</option>}
          </select>
        </div>
      </div>
      <div className="field-row">
        {dateField('출발일')}
        <div className="field">
          <label htmlFor={fid('tripStart')}>출발 시각</label>
          <TimeSelect id={fid('tripStart')} label="출발 시각" value={values.tripStart} onChange={(tripStart) => update({ tripStart })} />
        </div>
      </div>
      <div className="field-row">
        <div className="field">
          <label htmlFor={fid('tripEndDate')}>복귀일</label>
          <input id={fid('tripEndDate')} type="date" value={values.tripEndDate} min={values.date} onChange={(e) => update({ tripEndDate: e.target.value })} {...errorProps('endDate')} />
          {fieldError('endDate')}
        </div>
        <div className="field">
          <label htmlFor={fid('tripEnd')}>복귀 시각</label>
          <TimeSelect id={fid('tripEnd')} label="복귀 시각" value={values.tripEnd} bounds={values.tripEndDate === values.date ? endTimeBounds(values.tripStart, false) : undefined} onChange={(tripEnd) => update({ tripEnd })} {...errorProps('endTime')} />
          {fieldError('endTime')}
        </div>
      </div>
      {amount && (
        <p className="hint" aria-live="polite">
          {amount.label} · {isMultiDayTrip(times) ? `${days}일` : `출장 ${formatMinutes(tripMinutes(times))}`} · 예상 출장비{' '}
          <strong>
            {amount.amount === null
              ? '설정 필요'
              : isMultiDayTrip(times)
                ? `하루 ${formatWon(amount.amount)} × ${days}일 = ${formatWon(amount.amount * days)}`
                : formatWon(amount.amount)}
          </strong>
          {amount.amount === null && ' (마이페이지 출장비에서 금액을 정하면 계산합니다)'}
        </p>
      )}
      {day && day.trips.length > 0 && (
        <p className="muted small">
          출발일에 다른 출장 {day.trips.length}건 · 일일 한도 {formatWon(day.cap)} (관외 출장이 있는 날은 관외 한도)
        </p>
      )}
    </>
  )
}

interface CompSourceOption {
  grant: CompLeaveSummary['grants'][number]
  selectable: boolean
  reason: string
}

/** 사용일 기준 고를 수 있는 대체휴무 발생 건 (기한이 빠른 순). 지금 편집 중인 일정의 차감은 빼고 계산한다. */
function compSourceOptions(data: AppData, date: string, excludeId: string): CompSourceOption[] {
  const others = { ...data, entries: data.entries.filter((item) => item.id !== excludeId) }
  return summarizeCompLeave(others, date)
    .grants.filter((grant) => grant.status === 'active' || grant.status === 'overdue' || grant.lastUsableDate >= addDaysToDateString(date, -31))
    .sort((a, b) => (a.lastUsableDate < b.lastUsableDate ? -1 : 1))
    .map((grant) => {
      const blocked =
        grant.date > date ? '사용일 이후 발생' : grant.status === 'dismissed' ? '삭제함' : grant.remainingMinutes <= 0 ? '모두 사용' : ''
      // 기한이 지난 발생분도 협의해 쓸 수 있으므로 고를 수 있게 두고 경고만 표시한다
      return { grant, selectable: blocked === '', reason: blocked || (grant.status === 'overdue' ? '기한 지남' : '') }
    })
}

const shortDate = new Intl.DateTimeFormat('ko-KR', { month: 'numeric', day: 'numeric', weekday: 'short' })

function CompSourcePicker({ date, excludeId, value, onChange }: { date: string; excludeId: string; value: string; onChange: (value: string) => void }) {
  const { data } = useAppState()
  const minutesPerDay = data.settings.leave.minutesPerDay
  if (!isValidDateString(date)) return null
  const options = compSourceOptions(data, date, excludeId)
  const label = (day: string) => shortDate.format(new Date(`${day}T00:00`))

  return (
    <fieldset className="field comp-picker">
      <legend>사용할 대체휴무 (발생일 선택)</legend>
      {options.length === 0 ? (
        <p className="hint">사용일 기준으로 쓸 수 있는 대체휴무 발생 내역이 없습니다. 주말 당직이나 휴일근무(대체휴무 선택)를 먼저 등록하세요.</p>
      ) : (
        <ul className="comp-options">
          {options.map(({ grant, selectable, reason }) => (
            <li key={grant.entryId}>
              <label className={`comp-option ${selectable ? '' : 'is-disabled'}`}>
                <input type="radio" name="comp-source" value={grant.entryId} checked={value === grant.entryId} disabled={!selectable && value !== grant.entryId} onChange={() => onChange(grant.entryId)} />
                <span>
                  <strong>{label(grant.date)}</strong> {grant.reason} · 잔여 {formatLeaveAmount(grant.remainingMinutes, minutesPerDay)} · {label(grant.lastUsableDate)}까지
                  {reason && <span className="badge badge-warning">{reason}</span>}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
      <label className="checkbox small">
        <input type="radio" name="comp-source" value="" checked={value === ''} onChange={() => onChange('')} />
        자동 (기한이 빠른 발생분부터 차감)
      </label>
    </fieldset>
  )
}
