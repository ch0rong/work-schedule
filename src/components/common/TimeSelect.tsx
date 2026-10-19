import { DAY_TIMES, pickTime, splitTime, timeChoices, timesWithin, type Meridiem, type TimeBounds, type TimeParts } from '../../lib/timeOptions'

interface TimeSelectProps {
  /** 오전/오후 선택 상자의 id (바깥 <label htmlFor>가 가리킨다) */
  id?: string
  /** 묶음 이름 (화면 낭독기용) */
  label: string
  value: string
  onChange: (value: string) => void
  /** 고를 수 있는 범위. 종료 시각은 endTimeBounds(시작, 다음 날 종료)로 시작 + 30분부터만 보여준다 */
  bounds?: TimeBounds
  /** 비워 둘 수 있으면 빈 선택지의 문구 */
  emptyLabel?: string
  'aria-invalid'?: boolean
  'aria-describedby'?: string
}

/** 비어 있을 때 일부만 고르면 나머지를 채우는 기본값 */
const DEFAULT_PARTS: TimeParts = { meridiem: 'am', hour: 9, minute: 0 }

const MERIDIEM_LABELS: Record<Meridiem, string> = { am: '오전', pm: '오후' }

/**
 * 시각 선택: 오전/오후 · 시(1~12) · 분(00, 30). 값은 `HH:mm`(24시간).
 * 범위(bounds) 밖의 시각은 목록에 보이지 않고, 고를 수 없는 오전/오후는 비활성화한다.
 * 범위 밖인 기존 값(30분 단위가 아닌 값 포함)은 그대로 보이도록 목록에 덧붙인다.
 */
export function TimeSelect({ id, label, value, onChange, bounds = {}, emptyLabel, ...aria }: TimeSelectProps) {
  const allowed = bounds.min === undefined && bounds.max === undefined ? DAY_TIMES : timesWithin(bounds)
  const parts = value ? splitTime(value) : null
  const choices = timeChoices(allowed, value)
  const empty = emptyLabel !== undefined

  function change(patch: Partial<TimeParts>, raw: string) {
    if (raw === '') {
      onChange('')
      return
    }
    onChange(parts ? pickTime(allowed, parts, patch) : pickTime(allowed, DEFAULT_PARTS, patch))
  }

  return (
    <div className="time-select" role="group" aria-label={label} aria-describedby={aria['aria-describedby']}>
      <select id={id} aria-label="오전/오후" value={parts?.meridiem ?? ''} onChange={(e) => change({ meridiem: e.target.value as Meridiem }, e.target.value)} {...aria}>
        {empty && <option value="">{emptyLabel}</option>}
        {(['am', 'pm'] as const).map((meridiem) => (
          <option key={meridiem} value={meridiem} disabled={!choices.meridiems.includes(meridiem)}>
            {MERIDIEM_LABELS[meridiem]}
          </option>
        ))}
      </select>
      <select aria-label="시" value={parts?.hour ?? ''} onChange={(e) => change({ hour: Number(e.target.value) }, e.target.value)} {...aria}>
        {empty && <option value="">--</option>}
        {choices.hours.map((hour) => (
          <option key={hour} value={hour}>
            {hour}시
          </option>
        ))}
      </select>
      <select aria-label="분" value={parts?.minute ?? ''} onChange={(e) => change({ minute: Number(e.target.value) }, e.target.value)} {...aria}>
        {empty && <option value="">--</option>}
        {choices.minutes.map((minute) => (
          <option key={minute} value={minute}>
            {String(minute).padStart(2, '0')}분
          </option>
        ))}
      </select>
    </div>
  )
}
