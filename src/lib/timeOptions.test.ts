import { describe, expect, it } from 'vitest'
import { DAY_TIMES, endTimeBounds, fitEndTime, HOUR12_OPTIONS, joinTime, MINUTE_OPTIONS, pickTime, splitTime, timeChoices, timesWithin } from './timeOptions'

describe('오전/오후 · 시 · 분', () => {
  it('선택지는 1~12시, 00·30분', () => {
    expect(HOUR12_OPTIONS).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
    expect(MINUTE_OPTIONS).toEqual([0, 30])
  })

  it('자정·정오 경계', () => {
    expect(splitTime('00:00')).toEqual({ meridiem: 'am', hour: 12, minute: 0 })
    expect(splitTime('00:30')).toEqual({ meridiem: 'am', hour: 12, minute: 30 })
    expect(splitTime('11:30')).toEqual({ meridiem: 'am', hour: 11, minute: 30 })
    expect(splitTime('12:00')).toEqual({ meridiem: 'pm', hour: 12, minute: 0 })
    expect(splitTime('18:30')).toEqual({ meridiem: 'pm', hour: 6, minute: 30 })
    expect(joinTime({ meridiem: 'am', hour: 12, minute: 0 })).toBe('00:00')
    expect(joinTime({ meridiem: 'pm', hour: 12, minute: 30 })).toBe('12:30')
    expect(joinTime({ meridiem: 'pm', hour: 9, minute: 30 })).toBe('21:30')
  })

  it('00:00 ~ 23:30 모든 30분 단위 시각이 나눴다 합쳐도 같다', () => {
    for (let total = 0; total < 24 * 60; total += 30) {
      const value = `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
      expect(joinTime(splitTime(value))).toBe(value)
    }
  })
})

describe('종료 시각 범위', () => {
  it('같은 날 종료는 시작 + 30분부터, 다음 날 종료는 00:00 ~ 시작', () => {
    expect(timesWithin(endTimeBounds('09:30', false))[0]).toBe('10:00')
    expect(timesWithin(endTimeBounds('09:30', false)).at(-1)).toBe('23:30')
    expect(timesWithin(endTimeBounds('22:00', true))).toEqual(DAY_TIMES.slice(0, 45)) // 00:00 ~ 22:00
    expect(timesWithin(endTimeBounds('23:30', false))).toEqual([]) // 같은 날 종료 불가
  })

  it('Case 1 오전 09:30 시작: 오전 10시부터, 오후는 1~12시 전체', () => {
    const allowed = timesWithin(endTimeBounds('09:30', false))
    expect(timeChoices(allowed, '10:00')).toEqual({ meridiems: ['am', 'pm'], hours: [10, 11], minutes: [0, 30] })
    expect(timeChoices(allowed, '18:00').hours).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
  })

  it('Case 2 오후 14:00 시작: 오전 불가, 오후 2시 30분부터', () => {
    const allowed = timesWithin(endTimeBounds('14:00', false))
    expect(timeChoices(allowed, '14:30')).toEqual({ meridiems: ['pm'], hours: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11], minutes: [30] })
  })

  it('범위 밖 조합을 고르면 바꾼 칸을 유지하는 가장 이른 시각으로 맞춘다', () => {
    const allowed = timesWithin(endTimeBounds('09:30', false))
    expect(pickTime(allowed, splitTime('18:00'), { meridiem: 'am' })).toBe('10:00')
    expect(pickTime(allowed, splitTime('18:00'), { hour: 9 })).toBe('21:00')
    expect(pickTime(timesWithin(endTimeBounds('14:00', false)), splitTime('15:00'), { hour: 2 })).toBe('14:30')
  })

  it('fitEndTime: 범위를 벗어난 종료 시각만 고친다', () => {
    expect(fitEndTime('09:00', '18:00', false)).toEqual({ endTime: '18:00', endsNextDay: false })
    expect(fitEndTime('19:00', '18:00', false)).toEqual({ endTime: '19:30', endsNextDay: false })
    expect(fitEndTime('23:30', '18:00', false)).toEqual({ endTime: '00:00', endsNextDay: true })
    expect(fitEndTime('22:00', '23:00', true)).toEqual({ endTime: '00:00', endsNextDay: true })
    expect(fitEndTime('22:00', '06:00', true)).toEqual({ endTime: '06:00', endsNextDay: true })
    expect(fitEndTime('09:00', '18:15', false)).toEqual({ endTime: '18:15', endsNextDay: false }) // 기존 비정형 값 유지
  })
})
