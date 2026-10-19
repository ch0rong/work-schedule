import { useState, type FormEvent } from 'react'
import { addYears } from 'date-fns'
import { ChevronLeft, ChevronRight, Plus, Trash2 } from 'lucide-react'
import { useNotify } from '../../app/noticeContext'
import { useAppState, useAppStore } from '../../app/storeContext'
import { COMP_STATUS_LABELS, dismissCompGrant, summarizeCompLeave, type CompLeaveSummary } from '../../features/leave/compLeaveService'
import { deductsAnnualLeave, formatLeaveAmount, leavePeriodFor, summarizeAnnualLeave, type LeavePeriod } from '../../features/leave/leaveService'
import { entryTitle } from '../../features/schedules/scheduleService'
import { parseDateString, toDateString } from '../../lib/date'
import { leaveGrantSchema, type LeaveGrant } from '../../lib/schema'
import { Dialog } from '../common/Dialog'
import { EntryDialog, type EntryDialogTarget } from '../schedule/EntryDialog'

export function LeavePage() {
  const { data } = useAppState()
  const today = toDateString(new Date())
  const [anchor, setAnchor] = useState(today)
  const [dialog, setDialog] = useState<EntryDialogTarget | null>(null)
  const settings = data.settings
  const minutesPerDay = settings.leave.minutesPerDay
  const period = leavePeriodFor(anchor, settings)
  const fmt = (minutes: number) => formatLeaveAmount(minutes, minutesPerDay)
  const shift = (years: number) => setAnchor(toDateString(addYears(parseDateString(anchor)!, years)))

  return (
    <div className="stack">
      <section className="card" aria-labelledby="annual-title">
        <div className="card-header">
          <h3 id="annual-title" className="section-title">
            연차
          </h3>
          <div className="year-nav">
            <button type="button" className="button icon-button" aria-label="이전 기간" onClick={() => shift(-1)}>
              <ChevronLeft aria-hidden="true" size={18} />
            </button>
            <span aria-live="polite">{period ? `${period.start} ~ ${period.end}` : '입사 전'}</span>
            <button type="button" className="button icon-button" aria-label="다음 기간" onClick={() => shift(1)}>
              <ChevronRight aria-hidden="true" size={18} />
            </button>
          </div>
        </div>
        <p className="muted small">
          {settings.regulation === 'public-servant' ? '공무원·공공기관 복무규정' : '근로기준법'} ·{' '}
          {settings.leave.basis === 'fiscal-year' ? '회계연도 기준' : `입사일(${settings.leave.hireDate ?? '미입력'}) 기준`} — 마이페이지에서 변경
        </p>

        {!period ? (
          <p className="muted">입사일 기준을 쓰려면 마이페이지에서 입사일을 입력하세요.</p>
        ) : (
          <AnnualLeave key={period.key} period={period} fmt={fmt} onOpen={(entryId) => setDialog({ mode: 'view', entryId })} />
        )}
        <div>
          <button
            type="button"
            className="button button-primary"
            onClick={() => setDialog({ mode: 'create', kind: 'leave', date: period && today >= period.start && today <= period.end ? today : (period?.start ?? today) })}
          >
            <Plus aria-hidden="true" size={18} />
            휴가·근태 등록
          </button>
        </div>
      </section>

      <CompLeaveSection today={today} fmt={fmt} onUse={() => setDialog({ mode: 'create', kind: 'leave', leaveType: 'comp', date: today })} onOpen={(entryId) => setDialog({ mode: 'view', entryId })} />

      <EntryDialog target={dialog} onClose={() => setDialog(null)} />
    </div>
  )
}

function AnnualLeave({ period, fmt, onOpen }: { period: LeavePeriod; fmt: (minutes: number) => string; onOpen: (entryId: string) => void }) {
  const { data } = useAppState()
  const summary = summarizeAnnualLeave(data, period)
  const deducted = summary.entries.filter((entry) => deductsAnnualLeave(entry.leaveType, data.settings))
  const special = summary.entries.filter((entry) => entry.leaveType === 'special')
  const specialByMonth = new Map<string, number>()
  for (const entry of special) specialByMonth.set(entry.date.slice(0, 7), (specialByMonth.get(entry.date.slice(0, 7)) ?? 0) + entry.minutes)

  return (
    <>
      <div className="summary-grid">
        <div className="stat-card">
          <p className="stat-label">부여</p>
          <p className="stat-value">{fmt(summary.grantedMinutes)}</p>
          <p className="stat-sub">{summary.manualDays !== null ? '직접 입력값' : '자동 참고값'}{summary.extraDays > 0 ? ` + 추가 ${summary.extraDays}일` : ''}</p>
        </div>
        <div className="stat-card">
          <p className="stat-label">사용</p>
          <p className="stat-value">{fmt(summary.usedMinutes)}</p>
          <p className="stat-sub">차감 대상 {deducted.length}건</p>
        </div>
        <div className={`stat-card ${summary.remainingMinutes < 0 ? 'stat-warning' : ''}`}>
          <p className="stat-label">잔여</p>
          <p className="stat-value">{fmt(summary.remainingMinutes)}</p>
        </div>
      </div>

      <GrantForm periodKey={period.key} grant={data.settings.leave.grants[period.key] ?? null} reference={summary.reference} />

      <h4 className="subsection-title">사용 내역</h4>
      {summary.entries.length === 0 ? (
        <p className="muted">이 기간에 등록된 휴가·근태가 없습니다.</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">날짜</th>
                <th scope="col">종류</th>
                <th scope="col">사용량</th>
                <th scope="col">연차</th>
              </tr>
            </thead>
            <tbody>
              {summary.entries.map((entry) => (
                <tr key={entry.id}>
                  <td>
                    <button type="button" className="link-button" onClick={() => onOpen(entry.id)}>
                      {entry.date === entry.endDate ? entry.date : `${entry.date} ~ ${entry.endDate}`}
                    </button>
                  </td>
                  <td>{entryTitle(entry, data)}</td>
                  <td>{fmt(entry.minutes)}</td>
                  <td>{deductsAnnualLeave(entry.leaveType, data.settings) ? '차감' : '미차감'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {specialByMonth.size > 0 && (
        <>
          <h4 className="subsection-title">특별휴가 월별 사용 (연차 미차감)</h4>
          <ul className="plain-list">
            {[...specialByMonth.entries()].map(([month, minutes]) => (
              <li key={month}>
                {month}: {fmt(minutes)}
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  )
}

function GrantForm({ periodKey, grant, reference }: { periodKey: string; grant: LeaveGrant | null; reference: { days: number | null; explanation: string } }) {
  const store = useAppStore()
  const notify = useNotify()
  const [days, setDays] = useState(grant?.days != null ? String(grant.days) : '')
  const [extra, setExtra] = useState(String(grant?.extraDays ?? 0))
  const [note, setNote] = useState(grant?.note ?? '')
  const [error, setError] = useState('')

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const parsed = leaveGrantSchema.safeParse({
      days: days.trim() === '' ? null : Number(days),
      extraDays: extra.trim() === '' ? 0 : Number(extra),
      note: note.trim(),
    })
    if (!parsed.success) {
      setError('부여 일수를 0 이상의 숫자로 입력하세요.')
      return
    }
    const result = store.update((data) => ({
      ...data,
      settings: { ...data.settings, leave: { ...data.settings.leave, grants: { ...data.settings.leave.grants, [periodKey]: parsed.data } } },
    }))
    if (!result.ok) {
      setError(result.errors.join(' '))
      return
    }
    setError('')
    notify('연차 부여를 저장했습니다.')
  }

  return (
    <form className="subcard" onSubmit={handleSubmit} noValidate aria-label="연차 부여 입력">
      <p className="small">
        <strong>자동 참고값:</strong> {reference.days !== null ? `${reference.days}일` : '계산 불가'} — {reference.explanation}
      </p>
      <div className="field-row">
        <div className="field">
          <label htmlFor="grant-days">회사 부여 일수 (비우면 참고값)</label>
          <input id="grant-days" type="number" min={0} step={0.5} value={days} placeholder={reference.days !== null ? String(reference.days) : ''} onChange={(e) => setDays(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="grant-extra">추가 부여 (일)</label>
          <input id="grant-extra" type="number" min={0} step={0.5} value={extra} onChange={(e) => setExtra(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="grant-note">메모</label>
          <input id="grant-note" value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} />
        </div>
      </div>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      <div>
        <button type="submit" className="button button-small button-primary">
          부여 저장
        </button>
      </div>
    </form>
  )
}

const STATUS_BADGES = { active: '', overdue: 'badge-warning', used: 'badge-done', dismissed: 'badge-done' } as const

type CompGrantRow = CompLeaveSummary['grants'][number]

function CompLeaveSection({ today, fmt, onUse, onOpen }: { today: string; fmt: (minutes: number) => string; onUse: () => void; onOpen: (entryId: string) => void }) {
  const { data } = useAppState()
  const store = useAppStore()
  const notify = useNotify()
  const summary = summarizeCompLeave(data, today)
  const [dismissing, setDismissing] = useState<CompGrantRow | null>(null)

  function handleDismiss() {
    if (!dismissing) return
    const result = store.update((current) => dismissCompGrant(current, dismissing.entryId, today))
    if (result.ok) notify('대체휴무 발생 건을 삭제했습니다.')
    setDismissing(null)
  }

  return (
    <section className="card" aria-labelledby="comp-title">
      <div className="card-header">
        <h3 id="comp-title" className="section-title">
          대체휴무
        </h3>
        <button type="button" className="button button-primary" onClick={onUse}>
          <Plus aria-hidden="true" size={18} />
          대체휴무 사용 등록
        </button>
      </div>
      <p className="muted small">
        주말 당직·휴일근무(대체휴무·출장 선택) 1회당 발생, 원칙상 발생일로부터 {data.settings.compLeave.validityMonths}개월 안에 사용. 기한이 지나도 자동으로
        소멸하지 않고 '기한 지남'으로 표시하며 계속 쓸 수 있습니다. 못 쓰게 된 건은 직접 삭제하세요. 연차에서 차감하지 않으며 일·반일·시간 단위로 나눠 쓸 수
        있습니다.
      </p>
      <div className="summary-grid">
        <div className="stat-card">
          <p className="stat-label">오늘 사용 가능</p>
          <p className="stat-value">{fmt(summary.availableMinutes)}</p>
        </div>
        <div className={`stat-card ${summary.expiringSoonMinutes > 0 ? 'stat-warning' : ''}`}>
          <p className="stat-label">7일 안 기한 도래</p>
          <p className="stat-value">{fmt(summary.expiringSoonMinutes)}</p>
        </div>
        <div className="stat-card">
          <p className="stat-label">발생 / 사용 / 삭제</p>
          <p className="stat-value small-value">
            {fmt(summary.earnedMinutes)} / {fmt(summary.usedMinutes)} / {fmt(summary.dismissedMinutes)}
          </p>
        </div>
        <div className={`stat-card ${summary.overdueMinutes > 0 ? 'stat-warning' : ''}`}>
          <p className="stat-label">기한 지남 (사용 가능)</p>
          <p className="stat-value">{fmt(summary.overdueMinutes)}</p>
        </div>
      </div>

      {summary.grants.length === 0 ? (
        <p className="muted">발생한 대체휴무가 없습니다.</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">발생일</th>
                <th scope="col">사유</th>
                <th scope="col">발생</th>
                <th scope="col">사용 기한</th>
                <th scope="col">잔여</th>
                <th scope="col">상태</th>
                <th scope="col">
                  <span className="visually-hidden">관리</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {summary.grants.map((grant) => (
                <tr key={grant.entryId}>
                  <td>
                    <button type="button" className="link-button" onClick={() => onOpen(grant.entryId)}>
                      {grant.date}
                    </button>
                  </td>
                  <td>{grant.reason}</td>
                  <td>{fmt(grant.minutes)}</td>
                  <td>~ {grant.lastUsableDate}</td>
                  <td>{fmt(grant.remainingMinutes)}</td>
                  <td>
                    <span className={`badge ${STATUS_BADGES[grant.status]}`}>
                      {COMP_STATUS_LABELS[grant.status]}
                      {grant.status === 'dismissed' && grant.dismissedOn && ` (${grant.dismissedOn})`}
                    </span>
                  </td>
                  <td>
                    {(grant.status === 'active' || grant.status === 'overdue') && (
                      <button type="button" className="button button-small button-danger" aria-label={`${grant.date} 대체휴무 삭제`} onClick={() => setDismissing(grant)}>
                        <Trash2 aria-hidden="true" size={16} />
                        삭제
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {summary.uses.length > 0 && (
        <>
          <h4 className="subsection-title">사용 내역</h4>
          <ul className="plain-list">
            {summary.uses.map((use) => (
              <li key={use.entry.id}>
                <button type="button" className="link-button" onClick={() => onOpen(use.entry.id)}>
                  {use.entry.date}
                </button>{' '}
                {fmt(use.entry.minutes)} 사용
                {use.allocations.length > 0 && <span className="muted small"> ← {use.allocations.map((item) => `${item.grantDate} 발생분 ${fmt(item.minutes)}`).join(', ')}</span>}
                {use.unallocatedMinutes > 0 && <span className="badge badge-warning">부족 {fmt(use.unallocatedMinutes)}</span>}
              </li>
            ))}
          </ul>
        </>
      )}

      <Dialog open={dismissing !== null} title="대체휴무를 삭제할까요?" onClose={() => setDismissing(null)}>
        {dismissing && (
          <>
            <p>
              {dismissing.date} {dismissing.reason}로 발생한 대체휴무 잔여 {fmt(dismissing.remainingMinutes)}을 더 이상 쓸 수 없는 것으로 처리합니다. 근무 일정은 지우지
              않으며, 오늘({today}) 이후의 대체휴무 사용에는 차감하지 않습니다.
            </p>
            <div className="dialog-actions">
              <button type="button" className="button" onClick={() => setDismissing(null)}>
                취소
              </button>
              <button type="button" className="button button-danger" onClick={handleDismiss}>
                삭제
              </button>
            </div>
          </>
        )}
      </Dialog>
    </section>
  )
}
