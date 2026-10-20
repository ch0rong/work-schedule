import { useState } from 'react'
import { Eraser } from 'lucide-react'
import { useNotify } from '../../app/noticeContext'
import { useAppState, useAppStore } from '../../app/storeContext'
import { cleanupYears, recordYears, summarizeCleanup } from '../../features/cleanup/cleanupService'
import { backupFileName, createBackup, downloadTextFile, serializeBackup } from '../../lib/backup'
import { Dialog } from '../common/Dialog'

/** 기간별 정리: 시작~끝 연도의 기록(일정·할 일·메모·급여 기록 등)을 지운다. 설정은 남긴다. */
export function YearCleanup() {
  const store = useAppStore()
  const { data } = useAppState()
  const notify = useNotify()
  // 기록이 있는 첫 해부터 마지막 해(또는 올해)까지 이어서 고를 수 있다
  const recorded = recordYears(data)
  const first = recorded[0]
  const last = Math.max(recorded.at(-1) ?? 0, new Date().getFullYear())
  const years = first === undefined ? [] : Array.from({ length: last - first + 1 }, (_, index) => first + index)
  const [from, setFrom] = useState(years[0] ?? new Date().getFullYear())
  const [to, setTo] = useState(years[0] ?? new Date().getFullYear())
  const [confirm, setConfirm] = useState(false)
  const [error, setError] = useState('')
  const summary = summarizeCleanup(data, from, to)
  const range = from === to ? `${from}년` : `${Math.min(from, to)}~${Math.max(from, to)}년`

  function apply(backupFirst: boolean) {
    if (backupFirst) downloadTextFile(backupFileName(), serializeBackup(createBackup(data)))
    const result = store.update((current) => cleanupYears(current, from, to))
    setConfirm(false)
    if (!result.ok) {
      setError(result.errors.join(' '))
      return
    }
    setError('')
    notify(`${range} 기록 ${summary.total}건을 정리했습니다.`)
  }

  const counts = [
    ['일정', summary.entries],
    ['할 일', summary.todos],
    ['날짜 메모', summary.dayNotes],
    ['매식비 사용 기록', summary.mealUsages],
    ['급여 기록(실제 입금액)', summary.payrollRecords],
    ['추가 휴일', summary.customHolidays],
  ] as const

  return (
    <section className="card" aria-labelledby="year-cleanup-title">
      <h3 id="year-cleanup-title" className="section-title">
        기간별 정리
      </h3>
      <p className="muted">오래된 기록을 연도 단위로 지웁니다. 급여·연차·근무 유형 같은 설정은 그대로 남습니다.</p>

      {years.length === 0 ? (
        <p className="muted small">정리할 기록이 없습니다.</p>
      ) : (
        <>
          <div className="field-row">
            <div className="field">
              <label htmlFor="cleanup-from">시작 연도</label>
              <select id="cleanup-from" value={from} onChange={(event) => setFrom(Number(event.target.value))}>
                {years.map((year) => (
                  <option key={year} value={year}>
                    {year}년
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="cleanup-to">끝 연도</label>
              <select id="cleanup-to" value={to} onChange={(event) => setTo(Number(event.target.value))}>
                {years.map((year) => (
                  <option key={year} value={year}>
                    {year}년
                  </option>
                ))}
              </select>
            </div>
          </div>
          <p className="small" aria-live="polite">
            {range}: {summary.total > 0 ? counts.filter(([, count]) => count > 0).map(([name, count]) => `${name} ${count}건`).join(' · ') : '지울 기록이 없습니다.'}
          </p>
          <div>
            <button type="button" className="button button-danger" disabled={summary.total === 0} onClick={() => setConfirm(true)}>
              <Eraser aria-hidden="true" size={18} />
              정리하기
            </button>
          </div>
        </>
      )}

      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}

      <Dialog
        open={confirm}
        title={`${range} 기록을 정리할까요?`}
        onClose={() => setConfirm(false)}
        actions={
          <>
            <button type="button" className="button" onClick={() => setConfirm(false)}>
              취소
            </button>
            <button type="button" className="button button-danger" onClick={() => apply(false)}>
              백업 없이 정리
            </button>
            <button type="button" className="button button-primary" onClick={() => apply(true)}>
              백업 후 정리
            </button>
          </>
        }
      >
        <ul className="plain-list">
          {counts
            .filter(([, count]) => count > 0)
            .map(([name, count]) => (
              <li key={name}>
                {name} {count}건
              </li>
            ))}
        </ul>
        {summary.openTodos > 0 && <p className="text-danger">완료하지 않은 할 일 {summary.openTodos}건도 지워집니다 (지금 날짜에도 보이던 항목).</p>}
        <p>삭제한 기록은 되돌릴 수 없습니다. 연차·연장근무·급여 통계도 해당 기간은 비게 됩니다.</p>
      </Dialog>
    </section>
  )
}
