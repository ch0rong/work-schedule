import { describe, expect, it } from 'vitest'
import { overtimeEntry, sampleData, tripEntry, workEntry } from '../../test/fixtures'
import {
  afterWorkOvertimeMinutes,
  capMonth,
  capUsage,
  capWeek,
  getOvertimeLimitErrors,
  getTripOverlapErrors,
  overtimeAmount,
  overtimeMinutes,
  overtimePeriod,
  payMonthForDate,
  suggestNextSegment,
  summarizeOvertime,
} from './overtimeService'

describe('산정 기간 (21일 ~ 다음 달 20일)', () => {
  it('9월 급여 = 8/21 ~ 9/20', () => {
    expect(overtimePeriod('2026-09', 21)).toEqual({ start: '2026-08-21', end: '2026-09-20' })
  })

  it('1월 급여는 전년 12/21부터', () => {
    expect(overtimePeriod('2027-01', 21)).toEqual({ start: '2026-12-21', end: '2027-01-20' })
  })

  it('3월 급여 — 윤년 2월을 지난다', () => {
    expect(overtimePeriod('2028-03', 21)).toEqual({ start: '2028-02-21', end: '2028-03-20' })
  })

  it('날짜 → 급여 월', () => {
    expect(payMonthForDate('2026-09-20', 21)).toBe('2026-09')
    expect(payMonthForDate('2026-09-21', 21)).toBe('2026-10')
    expect(payMonthForDate('2026-12-25', 21)).toBe('2027-01')
    expect(payMonthForDate('2026-12-25', 1)).toBe('2026-12')
  })

  it('시작일이 1이면 달력 월과 같다', () => {
    expect(overtimePeriod('2026-02', 1)).toEqual({ start: '2026-02-01', end: '2026-02-28' })
  })
})

describe('연장근무 시간·수당', () => {
  it('09:00~18:00 근무 + 18:00~19:30 연장 → 1시간 30분, 27,075원', () => {
    const entry = overtimeEntry('a', '2026-09-01', '18:00', '19:30')
    expect(overtimeMinutes(entry)).toBe(90)
    expect(overtimeAmount(90, 18050)).toBe(27075)
  })

  it('30분 = 9,025원', () => {
    expect(overtimeAmount(30, 18050)).toBe(9025)
  })

  it('근무 시작 전과 종료 후를 모두 합산하고, 매식비 기준은 종료 후만 본다', () => {
    const entry = workEntry({
      overtime: [
        { startTime: '07:30', endTime: '09:00', endsNextDay: false },
        { startTime: '18:00', endTime: '18:30', endsNextDay: false },
      ],
    })
    expect(overtimeMinutes(entry)).toBe(120)
    expect(afterWorkOvertimeMinutes(entry)).toBe(30)
  })

  it('유연근무 10:00~19:00 이후 19:00~20:00 연장', () => {
    const entry = workEntry({
      workTypeId: 'flex',
      startTime: '10:00',
      endTime: '19:00',
      overtime: [{ startTime: '19:00', endTime: '20:00', endsNextDay: false }],
    })
    expect(afterWorkOvertimeMinutes(entry)).toBe(60)
  })

  it('자정을 넘기는 연장 21:30~00:30', () => {
    const entry = workEntry({
      workTypeId: 'weekday-duty',
      startTime: '12:30',
      endTime: '21:30',
      overtime: [{ startTime: '21:30', endTime: '00:30', endsNextDay: true }],
    })
    expect(overtimeMinutes(entry)).toBe(180)
  })

  it('다음 구간 제안은 근무 종료 직후 30분', () => {
    expect(suggestNextSegment(workEntry(), 30)).toEqual({ startTime: '18:00', endTime: '18:30', endsNextDay: false })
  })
})

// 2026-09: 9/1(화). 주(월~일) = 8/31~9/6, 9/7~9/13, 9/14~9/20, 9/21~9/27, 9/28~10/4
const twoHours = (id: string, date: string) => overtimeEntry(id, date, '18:00', '20:00')
/** 9월 평일 2시간씩 10일 = 20시간 (주별 8h·8h·4h) */
const september20h = ['01', '02', '03', '04', '08', '09', '10', '11', '15', '16'].map((day) => twoHours(`s${day}`, `2026-09-${day}`))
const holidayTrip = (id: string, date: string) =>
  workEntry({ id, workTypeId: 'holiday-work', date, endDate: date, holidayCompensation: 'trip-comp' })

describe('한도 기간 — 월(산정 기간 21일~20일)·주(월~일)', () => {
  it('주는 월요일 시작, 월은 산정 기간', () => {
    expect(capWeek('2026-09-13')).toEqual({ start: '2026-09-07', end: '2026-09-13' }) // 일요일
    expect(capWeek('2026-09-14')).toEqual({ start: '2026-09-14', end: '2026-09-20' }) // 월요일
    expect(capWeek('2027-01-01')).toEqual({ start: '2026-12-28', end: '2027-01-03' }) // 연도 경계
    expect(capMonth('2026-09-20', 21)).toEqual({ start: '2026-08-21', end: '2026-09-20' })
    expect(capMonth('2026-09-21', 21)).toEqual({ start: '2026-09-21', end: '2026-10-20' }) // 21일부터 새 기간
    expect(capMonth('2026-12-25', 21)).toEqual({ start: '2026-12-21', end: '2027-01-20' }) // 연도 경계
    expect(capMonth('2028-02-29', 21)).toEqual({ start: '2028-02-21', end: '2028-03-20' }) // 윤년
    expect(capMonth('2028-02-10', 1)).toEqual({ start: '2028-02-01', end: '2028-02-29' }) // 시작일 1이면 달력 월
  })

  it('월 한도는 산정 기간(21일~20일)으로 센다', () => {
    const data = sampleData({ entries: [...september20h, twoHours('o1', '2026-09-21'), twoHours('o2', '2026-10-01')] })
    expect(capUsage(data, '2026-09-20').month).toMatchObject({ range: { start: '2026-08-21', end: '2026-09-20' }, countedMinutes: 20 * 60, remainingMinutes: 0 })
    // 9/21과 10/1은 같은 산정 기간(9/21~10/20)
    expect(capUsage(data, '2026-10-01').month).toMatchObject({ range: { start: '2026-09-21', end: '2026-10-20' }, countedMinutes: 240, remainingMinutes: 16 * 60 })
    // 주 9/28~10/4에는 10/1분만
    expect(capUsage(data, '2026-09-30').week).toMatchObject({ range: { start: '2026-09-28', end: '2026-10-04' }, countedMinutes: 120 })
  })
})

describe('한도 초과 저장 차단', () => {
  it('산정 기간 20시간을 넘기면 오류, 21일부터는 새 기간이라 저장 가능', () => {
    const data = sampleData({ entries: september20h })
    const errors = getOvertimeLimitErrors(data, overtimeEntry('new', '2026-09-18', '18:00', '18:30'))
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('월 한도(2026-08-21 ~ 2026-09-20)')
    expect(errors[0]).toContain('저장할 수 없습니다')
    expect(getOvertimeLimitErrors(data, overtimeEntry('new', '2026-09-21', '18:00', '20:00'))).toEqual([])
  })

  it('달이 바뀌어도 같은 산정 기간이면 한도를 이어서 센다', () => {
    const sept = ['21', '22', '23', '24', '25', '28', '29', '30'].map((day) => twoHours(`a${day}`, `2026-09-${day}`)) // 16h
    const oct = ['01', '02'].map((day) => twoHours(`b${day}`, `2026-10-${day}`)) // +4h = 20h
    const data = sampleData({ entries: [...sept, ...oct] })
    expect(getOvertimeLimitErrors(data, overtimeEntry('new', '2026-10-05', '18:00', '18:30'))).toEqual([expect.stringContaining('월 한도(2026-09-21 ~ 2026-10-20)')])
  })

  it('주 12시간을 넘기면 오류 (월 한도 안이어도)', () => {
    const week = ['07', '08', '09', '10', '11', '12'].map((day) => twoHours(`w${day}`, `2026-09-${day}`)) // 9/7~9/12 = 12시간
    const data = sampleData({ entries: week })
    const errors = getOvertimeLimitErrors(data, overtimeEntry('new', '2026-09-13', '18:00', '18:30'))
    expect(errors).toEqual([expect.stringContaining('주 한도(2026-09-07 ~ 2026-09-13)')])
    // 다음 주 월요일은 새 주
    expect(getOvertimeLimitErrors(data, overtimeEntry('new', '2026-09-14', '18:00', '20:00'))).toEqual([])
  })

  it('월·주 한도를 동시에 넘기면 오류 2개', () => {
    const data = sampleData({ entries: september20h.slice(0, 8) }) // 9월 16시간, 주(9/14~9/20) 0시간
    const long = workEntry({
      id: 'new',
      date: '2026-09-16',
      endDate: '2026-09-16',
      overtime: [
        { startTime: '05:00', endTime: '09:00', endsNextDay: false },
        { startTime: '18:00', endTime: '03:00', endsNextDay: true },
      ],
    }) // 13시간 → 월 29시간, 주 13시간
    expect(getOvertimeLimitErrors(data, long)).toHaveLength(2)
  })

  it('한도 안이면 통과하고, 이미 넘은 기존 기록을 늘리지 않는 수정은 막지 않는다', () => {
    const data = sampleData({ entries: [...september20h, twoHours('old', '2026-09-17')] }) // 차단 전 입력된 22시간
    expect(getOvertimeLimitErrors(data, { ...twoHours('old', '2026-09-17'), note: '메모만 수정' })).toEqual([])
    expect(getOvertimeLimitErrors(data, overtimeEntry('old', '2026-09-17', '18:00', '19:00'))).toEqual([]) // 줄이는 수정
    expect(getOvertimeLimitErrors(data, overtimeEntry('old', '2026-09-17', '18:00', '21:00'))).toHaveLength(1)
  })

  it('자정을 넘는 연장도 근무일 기준으로 센다', () => {
    const data = sampleData({ entries: september20h.slice(0, 9) }) // 18h
    // 9/18 21:30 ~ 9/19 00:30 — 근무일 기준
    const night = workEntry({ id: 'n', workTypeId: 'weekday-duty', date: '2026-09-18', endDate: '2026-09-18', startTime: '12:30', endTime: '21:30', overtime: [{ startTime: '21:30', endTime: '00:30', endsNextDay: true }] })
    expect(getOvertimeLimitErrors(data, night)).toEqual([expect.stringContaining('월 한도(2026-08-21 ~ 2026-09-20)')])
    // 9/20 밤 연장은 자정을 넘겨도 9/20이 속한 기간(8/21~9/20)에 남는다
    const boundary = { ...night, date: '2026-09-20', endDate: '2026-09-20' }
    expect(getOvertimeLimitErrors(data, boundary)).toEqual([expect.stringContaining('월 한도(2026-08-21 ~ 2026-09-20)')])
  })
})

describe('휴일근무 출장(대체휴무)', () => {
  it('출장 근무 8시간은 주·월 한도에서 제외되어 한도가 찬 주에도 저장된다', () => {
    const week = ['07', '08', '09', '10', '11', '12'].map((day) => twoHours(`w${day}`, `2026-09-${day}`)) // 주 12시간
    const data = sampleData({ entries: week })
    const trip = holidayTrip('t', '2026-09-13')
    expect(getOvertimeLimitErrors(data, trip)).toEqual([])
    const next = sampleData({ entries: [...week, trip] })
    expect(capUsage(next, '2026-09-13').week.countedMinutes).toBe(12 * 60)
  })

  it('수당은 0원 (휴일근무 수당·연장 수당 없음)', () => {
    const summary = summarizeOvertime(sampleData({ entries: [holidayTrip('t', '2026-09-13')] }), '2026-09')
    expect(summary).toMatchObject({ overtimeAmount: 0, recognizedMinutes: 0, holidayAllowance: { count: 0, minutes: 0, amount: 0 } })
  })

  it('비교: 수당 지급은 한도에 포함되므로 같은 주에 저장할 수 없다', () => {
    const week = ['07', '08', '09', '10', '11', '12'].map((day) => twoHours(`w${day}`, `2026-09-${day}`))
    const data = sampleData({ entries: week })
    const allowance = workEntry({ id: 'h', workTypeId: 'holiday-work', date: '2026-09-13', endDate: '2026-09-13', holidayCompensation: 'allowance' })
    expect(getOvertimeLimitErrors(data, allowance)).toHaveLength(1)
    expect(getOvertimeLimitErrors(data, holidayTrip('t', '2026-09-13'))).toEqual([])
  })

  it('출장일에 남아 있는 연장근무 구간도 인정하지 않는다 (휴일근무는 최대 8시간)', () => {
    const trip = { ...holidayTrip('t', '2026-09-13'), overtime: [{ startTime: '18:00', endTime: '19:00', endsNextDay: false }] }
    expect(capUsage(sampleData({ entries: [trip] }), '2026-09-13').week.countedMinutes).toBe(0)
  })
})

describe('summarizeOvertime — 수당 정산(산정 기간)과 미인정', () => {
  it('산정 기간 8/21~9/20 수당 = 인정 분 × 단가', () => {
    const summary = summarizeOvertime(sampleData({ entries: september20h }), '2026-09')
    expect(summary).toMatchObject({ period: { start: '2026-08-21', end: '2026-09-20' }, overtimeMinutes: 20 * 60, recognizedMinutes: 20 * 60, unrecognizedMinutes: 0 })
    expect(summary.overtimeAmount).toBe(20 * 18050)
  })

  it('차단 전 입력된 월 한도 초과분은 미인정 0원', () => {
    const summary = summarizeOvertime(sampleData({ entries: [...september20h, twoHours('x', '2026-09-17')] }), '2026-09')
    expect(summary.unrecognizedMinutes).toBe(120)
    expect(summary.records.at(-1)).toMatchObject({ recognizedMinutes: 0, amount: 0, monthCumulativeMinutes: 22 * 60 })
  })

  it('주 한도 초과분도 미인정', () => {
    const week = ['07', '08', '09', '10', '11', '12'].map((day) => twoHours(`w${day}`, `2026-09-${day}`))
    const summary = summarizeOvertime(sampleData({ entries: [...week, overtimeEntry('sun', '2026-09-13', '18:00', '21:00')] }), '2026-09')
    expect(summary.records.at(-1)).toMatchObject({ minutes: 180, recognizedMinutes: 0, weekCumulativeMinutes: 15 * 60 })
    expect(summary.unrecognizedMinutes).toBe(180)
  })

  it('산정 기간이 두 달에 걸쳐도 한 기간으로 월 한도를 적용한다', () => {
    // 9/21~9/30 평일 2시간 × 8일 = 16h, 10/1~10/20 평일 2시간 × 10일 = 20h → 10월 급여 36시간 중 20시간만 인정
    const sept = ['21', '22', '23', '24', '25', '28', '29', '30'].map((day) => twoHours(`a${day}`, `2026-09-${day}`))
    const oct = ['01', '02', '05', '06', '07', '08', '12', '13', '14', '15'].map((day) => twoHours(`b${day}`, `2026-10-${day}`))
    const summary = summarizeOvertime(sampleData({ entries: [...sept, ...oct] }), '2026-10')
    expect(summary).toMatchObject({ overtimeMinutes: 36 * 60, recognizedMinutes: 20 * 60, unrecognizedMinutes: 16 * 60 })
  })

  it('산정 기간 밖 기록은 다른 급여 월로 간다', () => {
    const data = sampleData({ entries: [overtimeEntry('x', '2026-09-21', '18:00', '19:00'), overtimeEntry('y', '2026-08-20', '18:00', '19:00')] })
    expect(summarizeOvertime(data, '2026-09').overtimeMinutes).toBe(0)
    expect(summarizeOvertime(data, '2026-10').overtimeMinutes).toBe(60)
    expect(summarizeOvertime(data, '2026-08').overtimeMinutes).toBe(60)
  })
})

describe('주말 당직·휴일근무', () => {
  it('주말 당직의 연장근무도 같은 단가로 계산된다', () => {
    const entry = workEntry({ workTypeId: 'weekend-duty', date: '2026-09-05', endDate: '2026-09-05', overtime: [{ startTime: '18:00', endTime: '19:00', endsNextDay: false }] })
    expect(summarizeOvertime(sampleData({ entries: [entry] }), '2026-09').overtimeAmount).toBe(18050)
  })

  it('휴일근무 수당 지급 = 7.5시간 × 18,050원 = 135,375원, 대체휴무 선택 시 0원', () => {
    const allowance = workEntry({ id: 'h1', workTypeId: 'holiday-work', date: '2026-09-06', endDate: '2026-09-06', holidayCompensation: 'allowance' })
    const comp = workEntry({ id: 'h2', workTypeId: 'holiday-work', date: '2026-09-13', endDate: '2026-09-13', holidayCompensation: 'comp-leave' })
    const data = sampleData({ entries: [allowance, comp] })
    expect(summarizeOvertime(data, '2026-09').holidayAllowance).toEqual({ count: 1, minutes: 450, amount: 135375 })
    // 수당 지급 7.5시간은 월·주 한도에 포함, 대체휴무 1일은 제외
    expect(capUsage(data, '2026-09-06')).toMatchObject({ month: { countedMinutes: 450 }, week: { countedMinutes: 450 } })
    expect(capUsage(data, '2026-09-13').week.countedMinutes).toBe(0)
  })

  it('휴일근무 수당 시간과 연장근무를 합쳐 월 한도(산정 기간)를 넘기면 저장할 수 없다', () => {
    // 8/21~9/20 연장 14시간(주별 8h·6h) + 9/20(일, 주 0시간) 휴일 수당 7.5시간 = 21.5시간 → 월 한도만 초과
    const overtime = september20h.slice(0, 7)
    const allowance = workEntry({ id: 'h', workTypeId: 'holiday-work', date: '2026-09-20', endDate: '2026-09-20', holidayCompensation: 'allowance' })
    expect(getOvertimeLimitErrors(sampleData({ entries: overtime }), allowance)).toEqual([expect.stringContaining('월 한도(2026-08-21 ~ 2026-09-20)')])
    // 대체휴무 1일로 받으면 한도와 무관
    expect(getOvertimeLimitErrors(sampleData({ entries: overtime }), { ...allowance, holidayCompensation: 'comp-leave' })).toEqual([])
  })
})

describe('출장·연장근무 시간 중복', () => {
  const trip = (overrides = {}) => tripEntry({ id: 't', date: '2026-10-19', endDate: '2026-10-19', startTime: '13:00', endTime: '19:00', ...overrides })

  it('같은 날 출장과 연장근무 구간이 겹치면 오류 (근무·출장 어느 쪽을 저장해도)', () => {
    const work = overtimeEntry('w', '2026-10-19', '18:00', '20:00')
    expect(getTripOverlapErrors(sampleData({ entries: [trip()] }), work)).toEqual([expect.stringContaining('겹칩니다')])
    expect(getTripOverlapErrors(sampleData({ entries: [work] }), trip())).toEqual([
      expect.stringContaining('관내 출장 2026-10-19 13:00~19:00과 연장근무 2026-10-19 18:00~20:00'),
    ])
  })

  it('맞닿기만 하면 겹침이 아니다', () => {
    expect(getTripOverlapErrors(sampleData({ entries: [trip()] }), overtimeEntry('w', '2026-10-19', '19:00', '21:00'))).toEqual([])
  })

  it('자정을 넘는 연장과 여러 날 출장도 실제 시각으로 비교한다', () => {
    const night = overtimeEntry('w', '2026-10-19', '22:00', '01:00') // 10/19 22:00 ~ 10/20 01:00
    const nextMorning = trip({ date: '2026-10-20', endDate: '2026-10-20', startTime: '00:30', endTime: '09:00' })
    expect(getTripOverlapErrors(sampleData({ entries: [nextMorning] }), night)).toHaveLength(1)
    const multiDay = trip({ date: '2026-10-18', endDate: '2026-10-20', startTime: '09:00', endTime: '12:00' })
    expect(getTripOverlapErrors(sampleData({ entries: [multiDay] }), overtimeEntry('w2', '2026-10-19', '18:00', '19:00'))).toHaveLength(1)
  })

  it('휴일근무는 근무 시간 전체를 연장근무로 보고, 출장(대체휴무) 보상은 검사하지 않는다', () => {
    const holiday = workEntry({ id: 'h', workTypeId: 'holiday-work', date: '2026-10-18', endDate: '2026-10-18', startTime: '09:00', endTime: '17:00', breakMinutes: 0, holidayCompensation: 'allowance' })
    const sundayTrip = trip({ date: '2026-10-18', endDate: '2026-10-18', startTime: '15:00', endTime: '18:00' })
    expect(getTripOverlapErrors(sampleData({ entries: [sundayTrip] }), holiday)).toEqual([expect.stringContaining('휴일근무 2026-10-18 09:00~17:00')])
    expect(getTripOverlapErrors(sampleData({ entries: [sundayTrip] }), { ...holiday, holidayCompensation: 'comp-leave' })).toHaveLength(1)
    expect(getTripOverlapErrors(sampleData({ entries: [sundayTrip] }), { ...holiday, holidayCompensation: 'trip-comp' })).toEqual([])
  })

  it('연장근무가 없는 근무, 다른 날 출장, 휴가는 검사하지 않는다', () => {
    expect(getTripOverlapErrors(sampleData({ entries: [trip()] }), workEntry({ id: 'w', date: '2026-10-19', endDate: '2026-10-19' }))).toEqual([])
    expect(getTripOverlapErrors(sampleData({ entries: [trip({ date: '2026-10-20', endDate: '2026-10-20' })] }), overtimeEntry('w', '2026-10-19', '18:00', '20:00'))).toEqual([])
    expect(getTripOverlapErrors(sampleData({ entries: [trip()] }), sampleData().entries[1])).toEqual([])
  })
})
