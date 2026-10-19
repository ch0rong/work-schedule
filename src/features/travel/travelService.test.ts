import { describe, expect, it } from 'vitest'
import { sampleData, tripEntry } from '../../test/fixtures'
import { dailyTravel, monthlyTravel, tripAmount } from './travelService'

const settings = sampleData().settings

describe('출장비 건별', () => {
  it('관내 4시간 미만 10,000 / 이상 20,000, 관외 4시간 이상 25,000', () => {
    expect(tripAmount(tripEntry({ startTime: '13:00', endTime: '16:59' }), settings).amount).toBe(10000)
    expect(tripAmount(tripEntry({ startTime: '13:00', endTime: '17:00' }), settings).amount).toBe(20000)
    expect(tripAmount(tripEntry({ tripType: 'outside', startTime: '09:00', endTime: '18:00' }), settings).amount).toBe(25000)
  })

  it('관외 4시간 미만은 금액을 계산하지 않는다(설정 필요)', () => {
    expect(tripAmount(tripEntry({ tripType: 'outside', startTime: '13:00', endTime: '15:00' }), settings).amount).toBeNull()
  })
})

describe('일일 한도', () => {
  it('관내 2건(10,000 + 20,000)은 20,000원으로 제한', () => {
    const data = sampleData({
      entries: [tripEntry({ id: 'a', startTime: '09:00', endTime: '11:00' }), tripEntry({ id: 'b', startTime: '13:00', endTime: '17:30' })],
    })
    expect(dailyTravel(data, '2026-10-20')).toMatchObject({ rawTotal: 30000, cap: 20000, total: 20000 })
  })

  it('관외가 섞이면 관외 한도 25,000원', () => {
    const data = sampleData({
      entries: [
        tripEntry({ id: 'a', startTime: '08:00', endTime: '09:00' }),
        tripEntry({ id: 'b', tripType: 'outside', startTime: '10:00', endTime: '15:00' }),
      ],
    })
    expect(dailyTravel(data, '2026-10-20')).toMatchObject({ rawTotal: 35000, cap: 25000, total: 25000 })
  })

  it('설정 필요 건은 합계에서 빼고 표시한다', () => {
    const data = sampleData({ entries: [tripEntry({ tripType: 'outside', startTime: '13:00', endTime: '14:00' })] })
    expect(dailyTravel(data, '2026-10-20')).toMatchObject({ total: 0, needsSetting: true })
  })

  it('월 합계는 일자별 한도 적용 후 합산', () => {
    const data = sampleData({
      entries: [
        tripEntry({ id: 'a', date: '2026-10-20', endDate: '2026-10-20', startTime: '09:00', endTime: '11:00' }),
        tripEntry({ id: 'b', date: '2026-10-20', endDate: '2026-10-20', startTime: '13:00', endTime: '18:00' }),
        tripEntry({ id: 'c', date: '2026-10-21', endDate: '2026-10-21', startTime: '09:00', endTime: '11:00' }),
        tripEntry({ id: 'd', date: '2026-11-02', endDate: '2026-11-02', startTime: '09:00', endTime: '11:00' }),
      ],
    })
    expect(monthlyTravel(data, '2026-10').total).toBe(30000)
  })
})

describe('여러 날 출장', () => {
  const trip = tripEntry({ id: 'm', tripType: 'outside', date: '2026-10-30', endDate: '2026-11-01', startTime: '15:00', endTime: '11:00' })

  it('날마다 4시간 이상 금액으로 계산하고, 월 합계는 그 달에 속한 날만 센다', () => {
    expect(tripAmount(trip, settings)).toMatchObject({ amount: 25000 })
    const data = sampleData({ entries: [trip] })
    expect(dailyTravel(data, '2026-10-31').total).toBe(25000)
    expect(monthlyTravel(data, '2026-10').total).toBe(50000) // 10/30, 10/31
    expect(monthlyTravel(data, '2026-11').total).toBe(25000) // 11/1
  })

  it('같은 날 다른 출장과 합쳐도 일일 한도를 넘지 않는다', () => {
    const data = sampleData({ entries: [trip, tripEntry({ id: 's', date: '2026-10-31', endDate: '2026-10-31', startTime: '09:00', endTime: '10:00' })] })
    expect(dailyTravel(data, '2026-10-31')).toMatchObject({ rawTotal: 35000, total: 25000 })
  })

  it('관외 하루 기준 금액이 비어 있으면 설정 필요', () => {
    const data = sampleData({ entries: [trip] })
    data.settings.travel.outside.over = null
    expect(dailyTravel(data, '2026-10-30').needsSetting).toBe(true)
  })
})
