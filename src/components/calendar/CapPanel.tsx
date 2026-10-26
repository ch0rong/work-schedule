import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useAppState } from '../../app/storeContext'
import { capBreakdown } from '../../features/overtime/overtimeService'
import { addDaysToDateString } from '../../lib/date'
import type { Entry } from '../../lib/schema'
import { formatMinutes } from '../../lib/time'
import { Dialog } from '../common/Dialog'

interface CapPanelProps {
  /** 이 날짜가 속한 산정 기간을 보여준다. null이면 닫힘 */
  date: string | null
  onChangeDate: (date: string) => void
  onClose: () => void
  onSelectEntry: (entry: Entry) => void
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']
const dayLabel = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))} (${WEEKDAYS[new Date(`${date}T00:00:00`).getDay()]})`

/** 메인 달력의 연장근무 누적 패널: 산정 기간(21일~20일) 날짜별 한도 대상 시간 */
export function CapPanel({ date, onChangeDate, onClose, onSelectEntry }: CapPanelProps) {
  const { data } = useAppState()
  if (!date) return <Dialog open={false} title="" onClose={onClose}>{null}</Dialog>
  const { usage, days } = capBreakdown(data, date)
  const { start, end } = usage.range
  const entryById = new Map(data.entries.map((entry) => [entry.id, entry]))

  return (
    <Dialog open title={`연장근무 누적 (${dayLabel(start)} ~ ${dayLabel(end)})`} onClose={onClose}>
      <div className="dialog-nav">
        <button type="button" className="button" onClick={() => onChangeDate(addDaysToDateString(start, -1))}>
          <ChevronLeft aria-hidden="true" size={16} />
          이전 기간
        </button>
        <button type="button" className="button" onClick={() => onChangeDate(addDaysToDateString(end, 1))}>
          다음 기간
          <ChevronRight aria-hidden="true" size={16} />
        </button>
      </div>
      <p>
        누적 <strong>{formatMinutes(usage.countedMinutes)}</strong> / {formatMinutes(usage.capMinutes)}
        {usage.exceededMinutes > 0 ? (
          <strong className="text-danger"> · 한도 초과 {formatMinutes(usage.exceededMinutes)}</strong>
        ) : (
          <span> · 잔여 {formatMinutes(usage.remainingMinutes)}</span>
        )}
      </p>
      <p className="muted small">연장근무와 시간 단위로 보상받는 휴일근무(수당)를 합산합니다. 대체휴무·출장(대체휴무)로 받은 휴일근무는 제외됩니다.</p>
      {days.length === 0 ? (
        <p className="muted">이 기간에 한도에 들어가는 근무가 없습니다.</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">날짜</th>
                <th scope="col">내역</th>
                <th scope="col" className="num">
                  시간
                </th>
                <th scope="col" className="num">
                  누적
                </th>
              </tr>
            </thead>
            <tbody>
              {days.map((day) => (
                <tr key={day.date}>
                  <th scope="row">{dayLabel(day.date)}</th>
                  <td>
                    <ul className="plain-list compact-list">
                      {day.items.map((item, index) => {
                        const entry = entryById.get(item.entryId)
                        const text = `${item.source === 'holiday-allowance' ? '휴일근무(수당)' : '연장'} ${item.startTime}~${item.endTime}`
                        return (
                          <li key={`${item.entryId}-${index}`}>
                            {entry ? (
                              <button type="button" className="link-button" onClick={() => onSelectEntry(entry)}>
                                {text}
                              </button>
                            ) : (
                              text
                            )}
                            {day.items.length > 1 && <span className="muted small"> {formatMinutes(item.minutes)}</span>}
                          </li>
                        )
                      })}
                    </ul>
                  </td>
                  <td className="num">{formatMinutes(day.minutes)}</td>
                  <td className={`num ${day.cumulativeMinutes > usage.capMinutes ? 'text-danger' : ''}`}>{formatMinutes(day.cumulativeMinutes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="dialog-actions">
        <button type="button" className="button" onClick={onClose}>
          닫기
        </button>
      </div>
    </Dialog>
  )
}
