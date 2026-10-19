import { useAppState } from '../../app/storeContext'
import { formatWon } from '../../features/pay/payService'
import { monthlyTravel, TRIP_LABELS, tripMinutes } from '../../features/travel/travelService'
import type { Entry } from '../../lib/schema'
import { formatMinutes } from '../../lib/time'
import { Dialog } from '../common/Dialog'

interface TravelPanelProps {
  month: string | null
  onClose: () => void
  onSelectEntry: (entry: Entry) => void
}

/** 메인 달력 화면의 출장비 패널: 월별 출장 내역과 일자별 합계 (급여와 별도 지급) */
export function TravelPanel({ month, onClose, onSelectEntry }: TravelPanelProps) {
  const { data } = useAppState()
  if (!month) return <Dialog open={false} title="" onClose={onClose}>{null}</Dialog>
  const travel = monthlyTravel(data, month)

  return (
    <Dialog open title={`${Number(month.slice(5))}월 출장비`} onClose={onClose}>
      <p>
        이 달 총 출장비 <strong>{formatWon(travel.total)}</strong>
        <span className="muted small"> · 급여와 별도 지급 (예상 실수령액에 포함하지 않음)</span>
      </p>
      {travel.needsSetting && <p className="badge badge-warning">금액 기준이 정해지지 않은 출장이 있습니다 (마이페이지 → 출장비)</p>}
      {travel.days.length === 0 ? (
        <p className="muted">이 달에 등록된 출장이 없습니다.</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">날짜</th>
                <th scope="col">출장</th>
                <th scope="col" className="num">
                  금액
                </th>
              </tr>
            </thead>
            <tbody>
              {travel.days.map((day) => (
                <tr key={day.date}>
                  <th scope="row">{day.date}</th>
                  <td>
                    <ul className="plain-list compact-list">
                      {day.trips.map(({ trip, amount, label }) => (
                        <li key={trip.id}>
                          <button type="button" className="link-button" onClick={() => onSelectEntry(trip)}>
                            {TRIP_LABELS[trip.tripType]} {trip.startTime}~{trip.endTime} ({formatMinutes(tripMinutes(trip))})
                          </button>{' '}
                          <span className="muted small">
                            {label} · {amount === null ? '설정 필요' : formatWon(amount)}
                          </span>
                        </li>
                      ))}
                    </ul>
                    {day.rawTotal > day.total && <span className="muted small">일일 한도 {formatWon(day.cap)} 적용</span>}
                  </td>
                  <td className="num">{formatWon(day.total)}</td>
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
