import { describe, expect, it } from 'vitest'
import {
  addDaysToDateString,
  compareDateStrings,
  isValidDateString,
  isValidTimeString,
  timeToMinutes,
} from './date'

describe('isValidDateString', () => {
  it('YYYY-MM-DD 형식의 실제 날짜만 허용한다', () => {
    expect(isValidDateString('2026-10-19')).toBe(true)
    expect(isValidDateString('2026-1-9')).toBe(false)
    expect(isValidDateString('2026/10/19')).toBe(false)
    expect(isValidDateString('2026-13-01')).toBe(false)
    expect(isValidDateString('2026-04-31')).toBe(false)
    expect(isValidDateString('')).toBe(false)
  })

  it('윤년의 2월 29일을 구분한다', () => {
    expect(isValidDateString('2028-02-29')).toBe(true)
    expect(isValidDateString('2026-02-29')).toBe(false)
    expect(isValidDateString('2100-02-29')).toBe(false)
    expect(isValidDateString('2000-02-29')).toBe(true)
  })
})

describe('isValidTimeString / timeToMinutes', () => {
  it('HH:mm 형식만 허용한다', () => {
    expect(isValidTimeString('00:00')).toBe(true)
    expect(isValidTimeString('23:59')).toBe(true)
    expect(isValidTimeString('24:00')).toBe(false)
    expect(isValidTimeString('9:00')).toBe(false)
    expect(isValidTimeString('09:60')).toBe(false)
  })

  it('자정 기준 분으로 변환한다', () => {
    expect(timeToMinutes('00:00')).toBe(0)
    expect(timeToMinutes('09:30')).toBe(570)
    expect(timeToMinutes('23:59')).toBe(1439)
    expect(() => timeToMinutes('25:00')).toThrow()
  })
})

describe('addDaysToDateString', () => {
  it('월·연도·윤년 경계를 넘긴다', () => {
    expect(addDaysToDateString('2026-10-31', 1)).toBe('2026-11-01')
    expect(addDaysToDateString('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDaysToDateString('2028-02-28', 1)).toBe('2028-02-29')
    expect(addDaysToDateString('2026-02-28', 1)).toBe('2026-03-01')
    expect(addDaysToDateString('2026-03-01', -1)).toBe('2026-02-28')
  })
})

describe('compareDateStrings', () => {
  it('날짜순으로 비교한다', () => {
    expect(compareDateStrings('2026-01-02', '2026-01-10')).toBe(-1)
    expect(compareDateStrings('2026-01-02', '2026-01-02')).toBe(0)
    expect(compareDateStrings('2027-01-01', '2026-12-31')).toBe(1)
  })
})
