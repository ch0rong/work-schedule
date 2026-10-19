import { useState, type FormEvent } from 'react'
import { ChevronLeft, ChevronRight, Info } from 'lucide-react'
import { useNotify } from '../../app/noticeContext'
import { useAppState, useAppStore } from '../../app/storeContext'
import { useHolidays } from '../../app/useHolidays'
import { estimateMonthlyPay, formatWon, PAY_DISCLAIMER, setPayrollRecord, type PayLine } from '../../features/pay/payService'
import { addMonthsToMonthString, toDateString } from '../../lib/date'
import { payrollRecordSchema, type PayrollRecord } from '../../lib/schema'
import { formatMinutes } from '../../lib/time'
import { MoneyInput } from '../common/MoneyInput'

const weekday = new Intl.DateTimeFormat('ko-KR', { weekday: 'short' })

function LineRows({ lines, negative = false }: { lines: PayLine[]; negative?: boolean }) {
  return (
    <>
      {lines.map((line) => (
        <tr key={line.key}>
          <th scope="row">{line.label}</th>
          <td className="small">{line.detail}</td>
          <td className={`num ${negative ? 'text-danger' : ''}`}>
            {negative && line.amount > 0 ? '−' : ''}
            {formatWon(line.amount)}
          </td>
        </tr>
      ))}
    </>
  )
}

export function PayPage() {
  const { data } = useAppState()
  const { isHoliday } = useHolidays()
  const [month, setMonth] = useState(toDateString(new Date()).slice(0, 7))
  const valid = /^\d{4}-\d{2}$/.test(month)
  const pay = valid ? estimateMonthlyPay(data, month, isHoliday) : null
  const history = valid ? Array.from({ length: 6 }, (_, index) => estimateMonthlyPay(data, addMonthsToMonthString(month, index - 5), isHoliday)) : []

  return (
    <div className="stack">
      <p className="alert alert-info" role="note">
        <Info aria-hidden="true" size={18} className="alert-icon" />
        <span>{PAY_DISCLAIMER}</span>
      </p>

      <div className="year-nav">
        <button type="button" className="button icon-button" aria-label="이전 달" onClick={() => setMonth(addMonthsToMonthString(month, -1))} disabled={!valid}>
          <ChevronLeft aria-hidden="true" size={18} />
        </button>
        <div className="field inline-field">
          <label htmlFor="pay-month">급여 월</label>
          <input id="pay-month" type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
        </div>
        <button type="button" className="button icon-button" aria-label="다음 달" onClick={() => setMonth(addMonthsToMonthString(month, 1))} disabled={!valid}>
          <ChevronRight aria-hidden="true" size={18} />
        </button>
      </div>

      {pay && (
        <>
          <section className="summary-grid" aria-label={`${month} 급여 요약`}>
            <div className="stat-card">
              <p className="stat-label">예상 실수령액</p>
              <p className="stat-value">{formatWon(pay.net)}</p>
              <p className="stat-sub">
                지급 {formatWon(pay.gross)} − 공제 {formatWon(pay.totalDeductions)}
              </p>
            </div>
            <div className="stat-card">
              <p className="stat-label">실제 입금액</p>
              <p className="stat-value">{pay.record?.actualDeposit != null ? formatWon(pay.record.actualDeposit) : '미입력'}</p>
              <p className="stat-sub">{pay.difference !== null ? `차액 ${pay.difference > 0 ? '+' : ''}${formatWon(pay.difference)}` : '입금 후 기록'}</p>
            </div>
            <div className="stat-card">
              <p className="stat-label">급여 지급일</p>
              <p className="stat-value">{pay.payday.slice(5).replace('-', '/')} ({weekday.format(new Date(`${pay.payday}T00:00`))})</p>
              <p className="stat-sub">
                매월 {data.settings.pay.payday}일{pay.payday.slice(8) !== String(data.settings.pay.payday).padStart(2, '0') ? ' → 주말·공휴일로 앞당김' : ''}
              </p>
            </div>
            <div className="stat-card">
              <p className="stat-label">출장비 (별도 지급)</p>
              <p className="stat-value">{formatWon(pay.travel.total)}</p>
              <p className="stat-sub">실수령액에 포함 안 함{pay.travel.needsSetting ? ' · 설정 필요 건 있음' : ''}</p>
            </div>
          </section>

          <section className="card" aria-labelledby="pay-detail-title">
            <h3 id="pay-detail-title" className="section-title">
              {Number(month.slice(5))}월 급여 내역 <span className="muted small">({pay.profile.effectiveFrom}부터 적용 설정)</span>
            </h3>
            <div className="table-wrap">
              <table className="table">
                <caption className="visually-hidden">급여 계산 내역</caption>
                <thead>
                  <tr>
                    <th scope="col">항목</th>
                    <th scope="col">계산 근거</th>
                    <th scope="col" className="num">
                      금액
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <LineRows lines={pay.earnings} />
                  <tr className="subtotal-row">
                    <th scope="row">지급 합계</th>
                    <td />
                    <td className="num">{formatWon(pay.gross)}</td>
                  </tr>
                  <LineRows lines={pay.deductions} negative />
                  <tr className="subtotal-row">
                    <th scope="row">공제 합계</th>
                    <td />
                    <td className="num text-danger">−{formatWon(pay.totalDeductions)}</td>
                  </tr>
                </tbody>
                <tfoot>
                  <tr className="total-row">
                    <th scope="row">예상 실수령액</th>
                    <td />
                    <td className="num">{formatWon(pay.net)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <ul className="note-list small muted">
              {pay.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </section>

          <DepositForm key={month} month={month} record={pay.record} />

          <section className="card" aria-labelledby="overtime-detail-title">
            <h3 id="overtime-detail-title" className="section-title">
              연장근무 산정 기간 {pay.overtime.period.start} ~ {pay.overtime.period.end}
            </h3>
            <p>
              입력 {formatMinutes(pay.overtime.overtimeMinutes)} · 인정 {formatMinutes(pay.overtime.recognizedMinutes)}
              {pay.overtime.unrecognizedMinutes > 0 && <strong className="text-danger"> · 미인정 {formatMinutes(pay.overtime.unrecognizedMinutes)}</strong>}
            </p>
            <p className="muted small">
              한도는 월(1일~말일) {formatMinutes(data.settings.overtime.capMinutes)} · 주(월~일) {formatMinutes(data.settings.overtime.weeklyCapMinutes)} 기준입니다. 누적은 해당 날짜가
              속한 달·주의 값입니다.
            </p>
            {pay.overtime.records.length === 0 ? (
              <p className="muted">이 산정 기간에 연장근무 기록이 없습니다.</p>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">날짜</th>
                      <th scope="col">구분</th>
                      <th scope="col">시간</th>
                      <th scope="col">누적</th>
                      <th scope="col" className="num">
                        수당
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {pay.overtime.records.map((record, index) => (
                      <tr key={`${record.entryId}-${index}`}>
                        <td>{record.date}</td>
                        <td>{record.source === 'overtime' ? '연장근무' : '휴일근무 수당'}</td>
                        <td>
                          {formatMinutes(record.minutes)}
                          {record.recognizedMinutes < record.minutes && <span className="badge badge-warning">미인정 {formatMinutes(record.minutes - record.recognizedMinutes)}</span>}
                        </td>
                        <td>
                          월 {formatMinutes(record.monthCumulativeMinutes)} · 주 {formatMinutes(record.weekCumulativeMinutes)}
                        </td>
                        <td className="num">{formatWon(record.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="card" aria-labelledby="history-title">
            <h3 id="history-title" className="section-title">
              최근 6개월 비교
            </h3>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">월</th>
                    <th scope="col" className="num">
                      지급 합계
                    </th>
                    <th scope="col" className="num">
                      연장·휴일 수당
                    </th>
                    <th scope="col" className="num">
                      예상 실수령
                    </th>
                    <th scope="col" className="num">
                      실제 입금
                    </th>
                    <th scope="col" className="num">
                      차액
                    </th>
                    <th scope="col" className="num">
                      출장비(별도)
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((item) => (
                    <tr key={item.month} className={item.month === month ? 'is-current-row' : undefined}>
                      <th scope="row">
                        <button type="button" className="link-button" onClick={() => setMonth(item.month)}>
                          {item.month}
                        </button>
                      </th>
                      <td className="num">{formatWon(item.gross)}</td>
                      <td className="num">{formatWon(item.overtime.overtimeAmount + item.overtime.holidayAllowance.amount)}</td>
                      <td className="num">{formatWon(item.net)}</td>
                      <td className="num">{item.record?.actualDeposit != null ? formatWon(item.record.actualDeposit) : '—'}</td>
                      <td className="num">{item.difference !== null ? formatWon(item.difference) : '—'}</td>
                      <td className="num">{formatWon(item.travel.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  )
}

function DepositForm({ month, record }: { month: string; record: PayrollRecord | null }) {
  const store = useAppStore()
  const notify = useNotify()
  const [deposit, setDeposit] = useState<number | null>(record?.actualDeposit ?? null)
  const [note, setNote] = useState(record?.note ?? '')
  const [error, setError] = useState('')

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const parsed = payrollRecordSchema.safeParse({ actualDeposit: deposit, note: note.trim() })
    if (!parsed.success) {
      setError('실제 입금액은 0 이상의 원 단위 숫자로 입력하세요.')
      return
    }
    const result = store.update((data) => setPayrollRecord(data, month, parsed.data))
    if (!result.ok) {
      setError(result.errors.join(' '))
      return
    }
    setError('')
    notify(`${month} 실제 입금액을 저장했습니다.`)
  }

  return (
    <form className="card" onSubmit={handleSubmit} noValidate aria-labelledby="deposit-title">
      <h3 id="deposit-title" className="section-title">
        실제 입금액 기록
      </h3>
      <div className="field-row">
        <div className="field">
          <label htmlFor="actual-deposit">실제 입금액 (원)</label>
          <MoneyInput id="actual-deposit" value={deposit} onChange={setDeposit} />
        </div>
        <div className="field">
          <label htmlFor="deposit-note">메모</label>
          <input id="deposit-note" value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} />
        </div>
      </div>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      <div>
        <button type="submit" className="button button-primary">
          저장
        </button>
      </div>
    </form>
  )
}
