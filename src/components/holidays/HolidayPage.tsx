import { useState, type FormEvent } from 'react'
import { ChevronLeft, ChevronRight, Pencil, Plus, Trash2 } from 'lucide-react'
import { useNotify } from '../../app/noticeContext'
import { useAppState, useAppStore } from '../../app/storeContext'
import { createId } from '../../features/schedules/scheduleService'
import { HOLIDAY_SOURCES, OFFICIAL_HOLIDAYS, type OfficialHoliday } from '../../lib/holidayData'
import { officialHolidayName, officialHolidayYears, renameOfficialHoliday } from '../../lib/holidays'
import { parseDateString, toDateString } from '../../lib/date'
import { customHolidaySchema, type CustomHoliday } from '../../lib/schema'
import { Dialog } from '../common/Dialog'

const weekday = new Intl.DateTimeFormat('ko-KR', { weekday: 'short' })
const withWeekday = (date: string) => `${date} (${weekday.format(parseDateString(date) ?? new Date())})`

export function HolidayPage() {
  const { data } = useAppState()
  const store = useAppStore()
  const notify = useNotify()
  const [year, setYear] = useState(Number(toDateString(new Date()).slice(0, 4)))
  const [editing, setEditing] = useState<{ holiday: CustomHoliday | null } | null>(null)
  const [deleting, setDeleting] = useState<CustomHoliday | null>(null)
  const [renaming, setRenaming] = useState<OfficialHoliday | null>(null)
  const official = OFFICIAL_HOLIDAYS[String(year)] ?? []
  const custom = data.holidays.custom.filter((holiday) => holiday.date.startsWith(`${year}-`)).sort((a, b) => (a.date < b.date ? -1 : 1))

  return (
    <div className="stack holiday-page">
      <div className="year-nav">
        <button type="button" className="button icon-button" aria-label="이전 연도" onClick={() => setYear(year - 1)}>
          <ChevronLeft aria-hidden="true" size={18} />
        </button>
        <h3 className="section-title" aria-live="polite">
          {year}년
        </h3>
        <button type="button" className="button icon-button" aria-label="다음 연도" onClick={() => setYear(year + 1)}>
          <ChevronRight aria-hidden="true" size={18} />
        </button>
      </div>

      <section className="card" aria-labelledby="official-title">
        <h3 id="official-title" className="section-title">
          법정공휴일·대체공휴일
        </h3>
        {official.length === 0 ? (
          <p className="muted">
            {year}년 공휴일 데이터가 아직 포함되어 있지 않습니다. (포함된 연도: {officialHolidayYears().join(', ') || '없음'}) 임시공휴일·추가 휴일은 아래에서 직접
            추가할 수 있습니다.
          </p>
        ) : (
          <ul className="holiday-list">
            {official.map((holiday) => {
              const shown = officialHolidayName(holiday.date, holiday.name, data.holidays.overrides)
              return (
                <li key={`${holiday.date}-${holiday.name}`} className="rule-item">
                  <span>
                    <span className="holiday-date">{withWeekday(holiday.date)}</span> {shown.name}
                    {holiday.substitute && <span className="badge">대체공휴일</span>}
                    {shown.originalName && <span className="badge" title={`원래 이름: ${shown.originalName}`}>이름 수정됨</span>}
                  </span>
                  <button type="button" className="button button-small" aria-label={`${shown.name} 이름 수정`} onClick={() => setRenaming(holiday)}>
                    <Pencil aria-hidden="true" size={16} />
                  </button>
                </li>
              )
            })}
          </ul>
        )}
        {HOLIDAY_SOURCES.length > 0 && (
          <p className="muted small">
            출처:{' '}
            {HOLIDAY_SOURCES.map((source, index) => (
              <span key={source.url}>
                {index > 0 && ', '}
                <a href={source.url} target="_blank" rel="noreferrer">
                  {source.label}
                </a>
              </span>
            ))}
          </p>
        )}
      </section>

      <section className="card" aria-labelledby="custom-holiday-title">
        <div className="card-header">
          <h3 id="custom-holiday-title" className="section-title">
            추가 휴일 (임시공휴일 등)
          </h3>
          <button type="button" className="button button-primary" onClick={() => setEditing({ holiday: null })}>
            <Plus aria-hidden="true" size={18} />
            휴일 추가
          </button>
        </div>
        <p className="muted small">추가 휴일은 달력에 빨간 날짜 + 점선 밑줄로 표시되며, 연차 일수와 급여 지급일 계산에 반영됩니다.</p>
        {custom.length === 0 ? (
          <p className="muted">{year}년에 추가한 휴일이 없습니다.</p>
        ) : (
          <ul className="rule-list">
            {custom.map((holiday) => (
              <li key={holiday.id} className="rule-item">
                <span>
                  <span className="holiday-date">{withWeekday(holiday.date)}</span> {holiday.name} <span className="badge">추가 휴일</span>
                </span>
                <span className="button-row">
                  <button type="button" className="button button-small" aria-label={`${holiday.name} 수정`} onClick={() => setEditing({ holiday })}>
                    <Pencil aria-hidden="true" size={16} />
                  </button>
                  <button type="button" className="button button-small button-danger" aria-label={`${holiday.name} 삭제`} onClick={() => setDeleting(holiday)}>
                    <Trash2 aria-hidden="true" size={16} />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Dialog open={renaming !== null} title="공휴일 이름 수정" onClose={() => setRenaming(null)}>
        {renaming && <OfficialHolidayForm key={`${renaming.date}-${renaming.name}`} holiday={renaming} onDone={() => setRenaming(null)} />}
      </Dialog>

      <Dialog open={editing !== null} title={editing?.holiday ? '추가 휴일 수정' : '추가 휴일'} onClose={() => setEditing(null)}>
        {editing && <HolidayForm key={editing.holiday?.id ?? 'new'} holiday={editing.holiday} defaultYear={year} onDone={() => setEditing(null)} />}
      </Dialog>

      <Dialog
        open={deleting !== null}
        title="추가 휴일을 삭제할까요?"
        onClose={() => setDeleting(null)}
        actions={
          <>
            <button type="button" className="button" onClick={() => setDeleting(null)}>
              취소
            </button>
            <button
              type="button"
              className="button button-danger"
              onClick={() => {
                if (deleting) {
                  const result = store.update((current) => ({ ...current, holidays: { ...current.holidays, custom: current.holidays.custom.filter((item) => item.id !== deleting.id) } }))
                  if (result.ok) notify('추가 휴일을 삭제했습니다.')
                }
                setDeleting(null)
              }}
            >
              삭제
            </button>
          </>
        }
      >
        <p>
          {deleting?.date} {deleting?.name}을(를) 삭제합니다.
        </p>
      </Dialog>
    </div>
  )
}

/** 앱에 포함된 법정공휴일의 이름만 바꾼다 (날짜·휴일 여부는 그대로). 원래 이름으로 되돌릴 수 있다 */
function OfficialHolidayForm({ holiday, onDone }: { holiday: OfficialHoliday; onDone: () => void }) {
  const store = useAppStore()
  const { data } = useAppState()
  const notify = useNotify()
  const current = officialHolidayName(holiday.date, holiday.name, data.holidays.overrides)
  const [name, setName] = useState(current.name)
  const [error, setError] = useState('')

  function save(nextName: string, message: string) {
    if (nextName.trim().length > 30) {
      setError('휴일 이름은 30자 이하로 입력하세요.')
      return
    }
    const result = store.update((state) => ({
      ...state,
      holidays: { ...state.holidays, overrides: renameOfficialHoliday(state.holidays.overrides, holiday.date, holiday.name, nextName) },
    }))
    if (!result.ok) {
      setError(result.errors.join(' '))
      return
    }
    notify(message)
    onDone()
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (name.trim() === '') {
      setError('휴일 이름을 입력하세요.')
      return
    }
    save(name, '공휴일 이름을 수정했습니다.')
  }

  return (
    <form className="form" onSubmit={handleSubmit} noValidate>
      <p className="muted small">
        {withWeekday(holiday.date)} · 원래 이름: {holiday.name}. 이름만 바뀌고 날짜와 휴일 여부(연차·급여일 계산)는 그대로입니다.
      </p>
      <div className="field">
        <label htmlFor="official-holiday-name">이름</label>
        <input id="official-holiday-name" value={name} maxLength={30} onChange={(e) => setName(e.target.value)} />
      </div>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      <div className="dialog-actions">
        {current.originalName && (
          <button type="button" className="button" onClick={() => save(holiday.name, '공휴일 이름을 원래대로 되돌렸습니다.')}>
            원래 이름으로
          </button>
        )}
        <button type="button" className="button" onClick={onDone}>
          취소
        </button>
        <button type="submit" className="button button-primary">
          저장
        </button>
      </div>
    </form>
  )
}

function HolidayForm({ holiday, defaultYear, onDone }: { holiday: CustomHoliday | null; defaultYear: number; onDone: () => void }) {
  const store = useAppStore()
  const notify = useNotify()
  const [date, setDate] = useState(holiday?.date ?? `${defaultYear}-01-01`)
  const [name, setName] = useState(holiday?.name ?? '임시공휴일')
  const [error, setError] = useState('')

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const parsed = customHolidaySchema.safeParse({ id: holiday?.id ?? createId(), date, name })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? '입력값을 확인하세요.')
      return
    }
    const result = store.update((current) => {
      const exists = current.holidays.custom.some((item) => item.id === parsed.data.id)
      const list = exists ? current.holidays.custom.map((item) => (item.id === parsed.data.id ? parsed.data : item)) : [...current.holidays.custom, parsed.data]
      return { ...current, holidays: { ...current.holidays, custom: list } }
    })
    if (!result.ok) {
      setError(result.errors.join(' '))
      return
    }
    notify(holiday ? '추가 휴일을 수정했습니다.' : '추가 휴일을 등록했습니다.')
    onDone()
  }

  return (
    <form className="form" onSubmit={handleSubmit} noValidate>
      <div className="field">
        <label htmlFor="holiday-date">날짜</label>
        <input id="holiday-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="holiday-name">이름</label>
        <input id="holiday-name" value={name} maxLength={30} onChange={(e) => setName(e.target.value)} />
      </div>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      <div className="dialog-actions">
        <button type="button" className="button" onClick={onDone}>
          취소
        </button>
        <button type="submit" className="button button-primary">
          저장
        </button>
      </div>
    </form>
  )
}
