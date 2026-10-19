import { useNotify } from '../../app/noticeContext'
import { useAppState, useAppStore } from '../../app/storeContext'
import type { Settings } from '../../lib/schema'

const WEEKDAYS = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일']

export function CalendarPreferences() {
  const store = useAppStore()
  const { data } = useAppState()
  const notify = useNotify()

  function save(patch: Partial<Pick<Settings, 'weekStartsOn' | 'defaultView'>>) {
    const result = store.update((current) => ({ ...current, settings: { ...current.settings, ...patch } }))
    if (result.ok) notify('달력 설정을 저장했습니다.')
  }

  return (
    <section className="card" aria-labelledby="calendar-pref-title">
      <h3 id="calendar-pref-title" className="section-title">
        달력
      </h3>
      <div className="field-row">
        <div className="field">
          <label htmlFor="week-starts-on">주 시작 요일</label>
          <select id="week-starts-on" value={data.settings.weekStartsOn} onChange={(e) => save({ weekStartsOn: Number(e.target.value) })}>
            {WEEKDAYS.map((label, index) => (
              <option key={label} value={index}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="default-view">기본 달력 보기</label>
          <select
            id="default-view"
            value={data.settings.defaultView}
            onChange={(e) => save({ defaultView: e.target.value as Settings['defaultView'] })}
          >
            <option value="dayGridMonth">월간</option>
            <option value="timeGridWeek">주간</option>
          </select>
        </div>
      </div>
      <p className="muted small">급여 설정은 급여 탭, 연차 부여량은 휴가·연차 탭에서 관리합니다.</p>
    </section>
  )
}
