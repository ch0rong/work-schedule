import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAppStore } from '../lib/store'
import { STORAGE_KEY } from '../lib/storage'
import type { AppData } from '../lib/schema'
import { FIXED_NOW, leaveEntry, memoryStorage, overtimeEntry, sampleData, workEntry } from '../test/fixtures'
import App from './App'

// "오늘"을 2026-10-19(월)로 고정
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 19, 10, 0))
})
afterEach(() => {
  vi.useRealTimers()
})

function setup(data?: AppData) {
  const storage = memoryStorage(data ? { [STORAGE_KEY]: JSON.stringify(data) } : {})
  const store = createAppStore(storage, () => FIXED_NOW)
  const user = userEvent.setup()
  render(<App store={store} />)
  return { storage, store, user }
}

type User = ReturnType<typeof userEvent.setup>

/** 입력칸은 지우고 입력, 선택 상자(시각 등)는 값 선택 */
async function fill(user: User, input: HTMLElement, value: string) {
  if (input instanceof HTMLSelectElement) {
    await user.selectOptions(input, value)
    return
  }
  await user.clear(input)
  if (value) await user.type(input, value)
}

/** 시각 묶음(오전/오후 · 시 · 분)의 선택 상자 3개 */
function timeSelects(scope: HTMLElement, label: string): HTMLSelectElement[] {
  return within(within(scope).getByRole('group', { name: label })).getAllByRole('combobox') as HTMLSelectElement[]
}

/** 선택된 시각 `HH:mm` (비어 있으면 '') */
function timeValue(scope: HTMLElement, label: string): string {
  const [meridiem, hour, minute] = timeSelects(scope, label).map((select) => select.value)
  if (!meridiem || !hour || !minute) return ''
  const hours = (Number(hour) % 12) + (meridiem === 'pm' ? 12 : 0)
  return `${String(hours).padStart(2, '0')}:${minute.padStart(2, '0')}`
}

async function pickTime(user: User, scope: HTMLElement, label: string, value: string) {
  const [hours, minutes] = value.split(':').map(Number)
  const [meridiem, hour, minute] = timeSelects(scope, label)
  await user.selectOptions(meridiem, hours < 12 ? 'am' : 'pm')
  await user.selectOptions(hour, String(hours % 12 === 0 ? 12 : hours % 12))
  await user.selectOptions(minute, String(minutes))
}

const dayPanel = () => screen.getByRole('region', { name: /10월 19일/ })

async function openAdd(user: User, kind: '근무' | '휴가·근태' | '출장') {
  await user.click(within(dayPanel()).getByRole('button', { name: kind }))
  return screen.getByRole('dialog', { name: '일정 추가' })
}

describe('근무 일정', () => {
  it('추가 → 수정 → 삭제가 저장 데이터와 동기화된다', async () => {
    const { user, store, storage } = setup()
    const dialog = await openAdd(user, '근무')
    expect(within(dialog).getByText('8시간')).toBeInTheDocument() // 09:00~18:00, 휴게 60분
    await user.click(within(dialog).getByRole('button', { name: '저장' }))

    expect(store.getState().data.entries).toHaveLength(1)
    expect(JSON.parse(storage.items.get(STORAGE_KEY)!).entries).toHaveLength(1)

    await user.click(within(dayPanel()).getByRole('button', { name: /정규 근무/ }))
    await user.click(screen.getByRole('button', { name: '수정' }))
    await fill(user, screen.getByLabelText('휴게시간 (분)'), '30')
    await user.click(screen.getByRole('button', { name: '저장' }))
    expect(store.getState().data.entries[0]).toMatchObject({ breakMinutes: 30 })

    await user.click(within(dayPanel()).getByRole('button', { name: /정규 근무/ }))
    await user.click(screen.getByRole('button', { name: '삭제' }))
    await user.click(within(screen.getByRole('dialog', { name: '일정을 삭제할까요?' })).getByRole('button', { name: '삭제' }))
    expect(store.getState().data.entries).toHaveLength(0)
  })

  it('평일 당직은 12:30~21:30, 주말 날짜로 바꾸면 주말 당직 09:00~18:00으로 자동 변경', async () => {
    const { user, store } = setup()
    const dialog = await openAdd(user, '근무')
    await user.selectOptions(within(dialog).getByLabelText('근무 유형'), 'weekday-duty')
    expect(timeValue(dialog, '시작 시각')).toBe('12:30')
    expect(timeValue(dialog, '종료 시각')).toBe('21:30')

    await fill(user, within(dialog).getByLabelText('날짜'), '2026-10-24') // 토
    expect(within(dialog).getByLabelText('근무 유형')).toHaveValue('weekend-duty')
    expect(within(dialog).getByText(/대체휴무 1일이 발생하며 수당은 지급하지 않습니다/)).toBeInTheDocument()
    await user.selectOptions(within(dialog).getByLabelText('근무 유형'), 'weekend-duty')
    expect(timeValue(dialog, '시작 시각')).toBe('09:00')
    await user.click(within(dialog).getByRole('button', { name: '저장' }))
    expect(store.getState().data.entries[0]).toMatchObject({ workTypeId: 'weekend-duty', date: '2026-10-24', holidayCompensation: null })
  })

  it('평일 날짜에서 주말 당직을 고르고 주말로 날짜를 바꿔도 주말 당직 기본 시간이 들어간다', async () => {
    const { user } = setup()
    const dialog = await openAdd(user, '근무')
    await user.selectOptions(within(dialog).getByLabelText('근무 유형'), 'weekend-duty') // 10/19 월 → 평일 당직으로 자동 전환
    expect(within(dialog).getByLabelText('근무 유형')).toHaveValue('weekday-duty')
    await fill(user, within(dialog).getByLabelText('날짜'), '2026-09-12')
    expect(within(dialog).getByLabelText('근무 유형')).toHaveValue('weekend-duty')
    expect(timeValue(dialog, '시작 시각')).toBe('09:00')
    expect(timeValue(dialog, '종료 시각')).toBe('18:00')
  })

  it('주말 당직 상세에서 대체휴무 발생·기한을 보여주고, 기한이 지나도 소멸 대신 기한 지남으로 표시한다', async () => {
    const duty = workEntry({ id: 'd', workTypeId: 'weekend-duty', date: '2026-09-12', endDate: '2026-09-12' })
    const { user } = setup(sampleData({ entries: [duty] }))
    expect(screen.getByText('잔여 대체휴무').closest('.stat-card')).toHaveTextContent('기한 지남 1일')
    await user.click(screen.getByRole('button', { name: '연차·대체휴무' }))
    await user.click(screen.getByRole('button', { name: '2026-09-12' }))
    const dialog = screen.getByRole('dialog', { name: '주말 당직' })
    expect(within(dialog).getByText(/사용 기한 ~2026-10-12/)).toHaveTextContent('기한 지남')
  })

  it('휴일근무는 휴게 0·8시간으로 시작하고, 실근무가 8시간 미만이면 대체휴무 없이 수당만 지급한다', async () => {
    const { user, store } = setup(sampleData({ entries: [] }))
    const dialog = await openAdd(user, '근무')
    await user.selectOptions(within(dialog).getByLabelText('근무 유형'), 'holiday-work')
    expect(within(dialog).getByLabelText('휴게시간 (분)')).toHaveValue(0)
    await pickTime(user, dialog, '시작 시각', '10:00')
    expect(timeValue(dialog, '종료 시각')).toBe('18:00') // 시작 + 8시간 + 휴게 0
    expect(within(dialog).getByRole('radio', { name: /^대체휴무 1일 발생/ })).toBeChecked()

    await pickTime(user, dialog, '종료 시각', '14:00') // 4시간
    expect(within(dialog).queryByRole('radio', { name: /^대체휴무 1일 발생/ })).not.toBeInTheDocument()
    expect(within(dialog).getByText(/8시간 미만이라 대체휴무는 발생하지 않고/)).toBeInTheDocument()
    const summary = within(dialog).getByText(/예상 수당/).closest('p')!
    expect(summary).toHaveTextContent('실근무 4시간 · 예상 수당 72,200원 (4시간 × 18,050원)')
    expect(within(summary).getByText('매식비')).toBeInTheDocument() // 휴일 4시간 이상
    await user.click(within(dialog).getByRole('button', { name: '저장' }))
    expect(store.getState().data.entries[0]).toMatchObject({ holidayCompensation: 'allowance', startTime: '10:00', endTime: '14:00', breakMinutes: 0, compExpiresOn: null })
    // 날짜 패널에 연장근무처럼 예상 수당을 보여준다
    expect(within(dayPanel()).getByText('휴일근무 보상').closest('div')).toHaveTextContent('예상 72,200원 (4시간 × 18,050원 · 8시간 미만 실근무)')
  })

  it('휴일근무 8시간에 출장(대체휴무)을 고르면 수당 없이 대체휴무 만료일을 기록한다', async () => {
    const { user, store } = setup(sampleData({ entries: [] }))
    const dialog = await openAdd(user, '근무')
    await user.selectOptions(within(dialog).getByLabelText('근무 유형'), 'holiday-work')
    await user.click(within(dialog).getByRole('radio', { name: /수당 지급/ }))
    expect(within(dialog).getByText(/8시간 근무해도 수당은 7시간 30분 기준/)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('radio', { name: /출장\(대체휴무\)/ }))
    expect(within(dialog).getByText(/한도에서 제외/)).toBeInTheDocument()
    expect(within(dialog).getByText(/대체휴무/, { selector: '.overtime-summary p' })).toHaveTextContent('실근무 8시간 · 대체휴무 1일 (수당 없음)매식비')
    await user.click(within(dialog).getByRole('button', { name: '저장' }))
    expect(store.getState().data.entries[0]).toMatchObject({ holidayCompensation: 'trip-comp', startTime: '09:00', endTime: '17:00', compExpiresOn: '2026-11-19', overtime: [] })
    expect(within(dayPanel()).getByText('휴일근무 보상').closest('div')).toHaveTextContent('출장 · 대체휴무 1일')
  })

  it('유연근무는 시작 시각을 바꾸면 종료 시각이 8시간 + 점심 1시간으로 계산된다', async () => {
    const { user } = setup()
    const dialog = await openAdd(user, '근무')
    await user.selectOptions(within(dialog).getByLabelText('근무 유형'), 'flex')
    await pickTime(user, dialog, '시작 시각', '10:00')
    expect(timeValue(dialog, '종료 시각')).toBe('19:00')
    await pickTime(user, dialog, '시작 시각', '08:00')
    expect(timeValue(dialog, '종료 시각')).toBe('17:00')
  })

  it('자정을 넘기는 근무는 다음 날 종료를 체크해야 다음 날 00:00~시작 시각을 고를 수 있다', async () => {
    const { user, store } = setup()
    const dialog = await openAdd(user, '근무')
    await pickTime(user, dialog, '시작 시각', '22:00')
    expect(timeValue(dialog, '종료 시각')).toBe('22:30') // 18:00이 시작보다 빨라져 시작 + 30분으로 맞춤
    const [meridiem] = timeSelects(dialog, '종료 시각')
    expect(within(meridiem).getByRole('option', { name: '오전' })).toBeDisabled()

    await user.click(within(dialog).getByLabelText('다음 날 종료 (자정을 넘기는 근무)'))
    expect(timeValue(dialog, '종료 시각')).toBe('00:00')
    await pickTime(user, dialog, '종료 시각', '06:00')
    await user.click(within(dialog).getByRole('button', { name: '저장' }))
    expect(store.getState().data.entries[0]).toMatchObject({ startTime: '22:00', endTime: '06:00', endsNextDay: true, endDate: '2026-10-20' })
  })
})

describe('달력', () => {
  const dateCell = (date: string) => document.querySelector<HTMLElement>(`.calendar [data-date="${date}"]`)!

  it('하루에 일정이 여러 개여도 더보기 없이 모두 보여준다', async () => {
    const entries = [
      workEntry({ id: 'a', date: '2026-10-15', endDate: '2026-10-15' }),
      overtimeEntry('b', '2026-10-15', '18:00', '19:00', { workTypeId: 'flex', startTime: '09:00', endTime: '18:00' }),
      leaveEntry({ id: 'c', leaveType: 'outing', date: '2026-10-15', endDate: '2026-10-15', minutes: 60, startTime: '14:00', endTime: '15:00' }),
    ]
    setup(sampleData({ entries }))
    const cell = dateCell('2026-10-15')
    expect(within(cell).getByTitle('정규 근무')).toHaveClass('day-regular-dot') // 정규 근무는 날짜 옆 점
    expect(within(cell).getByText('유연근무 +1:00')).toBeInTheDocument()
    expect(within(cell).getByText('외출')).toBeInTheDocument()
    expect(within(cell).queryByText(/^\+\d+/)).not.toBeInTheDocument() // "+1개" 더보기 링크 없음
  })

  it('월간 보기: 정규 근무는 날짜 옆 점, 연장이 있으면 "연장 +1:30"만 아래에 적는다', () => {
    setup(sampleData({ entries: [workEntry({ id: 'a', date: '2026-10-14', endDate: '2026-10-14' }), overtimeEntry('b', '2026-10-15', '18:00', '19:30')] }))
    expect(within(dateCell('2026-10-14')).getByTitle('정규 근무')).toBeInTheDocument()
    expect(within(dateCell('2026-10-14')).queryByRole('button')).not.toBeInTheDocument()
    expect(within(dateCell('2026-10-15')).getByTitle('정규 근무')).toBeInTheDocument()
    expect(within(dateCell('2026-10-15')).getByText('연장 +1:30')).toBeInTheDocument()
  })

  it('날짜 메모를 저장하면 달력 칸에 표시되고, 비우면 지운다', async () => {
    const { user, store } = setup()
    fireEvent.change(screen.getByLabelText('날짜 선택'), { target: { value: '2026-10-15' } }) // 날짜 선택기는 값을 한 번에 넘긴다
    await user.type(screen.getByLabelText('이 날짜 메모'), '교육 참석')
    await user.click(screen.getByRole('button', { name: '메모 저장' }))
    expect(store.getState().data.dayNotes).toEqual({ '2026-10-15': '교육 참석' })
    expect(within(dateCell('2026-10-15')).getByText('교육 참석')).toBeInTheDocument()

    await user.clear(screen.getByLabelText('이 날짜 메모'))
    await user.click(screen.getByRole('button', { name: '메모 저장' }))
    expect(store.getState().data.dayNotes).toEqual({})
  })
})

describe('연장근무·매식비', () => {
  it('18:00~19:30 연장 → 1시간 30분, 27,075원, 매식비 발생 후 사용 처리', async () => {
    const { user, store } = setup()
    const dialog = await openAdd(user, '근무')
    await user.click(within(dialog).getByRole('button', { name: '연장근무 추가' }))
    expect(timeValue(dialog, '연장 1 시작')).toBe('18:00')
    await pickTime(user, dialog, '연장 1 종료', '19:30')
    const summary = within(dialog).getByText(/총 연장/).closest('p')!
    expect(summary).toHaveTextContent('1시간 30분')
    expect(summary).toHaveTextContent('27,075원')
    expect(within(summary).getByText('매식비')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: '저장' }))

    expect(store.getState().data.entries[0]).toMatchObject({ overtime: [{ startTime: '18:00', endTime: '19:30', endsNextDay: false }] })
    // 10/19 → 11월 급여 산정 기간(10/21~)이 아니라 10월 급여(9/21~10/20)
    const card = screen.getByText(/10월 연장근무 한도/).closest('.stat-card')!
    expect(card).toHaveTextContent('1시간 30분')
    expect(card).toHaveTextContent('이번 주 1시간 30분 / 12시간')
    expect(screen.getByText(/10월 급여 연장·휴일수당/).closest('.stat-card')).toHaveTextContent('27,075원')

    await user.click(within(dayPanel()).getByRole('button', { name: '사용 처리' }))
    const meal = screen.getByRole('dialog', { name: '10월 매식비' })
    await user.type(within(meal).getByLabelText('사용처'), '구내식당')
    await user.click(within(meal).getByRole('button', { name: '사용 완료' }))
    expect(store.getState().data.mealUsages[0]).toMatchObject({ sourceDate: '2026-10-19', usedDate: '2026-10-19', place: '구내식당', used: true })
    expect(within(meal).getByText('사용 완료', { selector: '.badge' })).toBeInTheDocument()
  })

  it('시각은 오전/오후 · 시(1~12) · 분(00, 30)으로 나눠 고른다', async () => {
    const { user } = setup()
    const dialog = await openAdd(user, '근무')
    const texts = (select: HTMLSelectElement) => within(select).getAllByRole('option').map((option) => option.textContent)
    const [meridiem, hour, minute] = timeSelects(dialog, '시작 시각')
    expect(texts(meridiem)).toEqual(['오전', '오후'])
    expect(texts(hour)).toEqual(Array.from({ length: 12 }, (_, index) => `${index + 1}시`))
    expect(texts(minute)).toEqual(['00분', '30분'])
    // 바깥 라벨을 누르면 오전/오후 선택으로 간다
    expect(within(dialog).getByLabelText('시작 시각', { selector: 'select' })).toBe(meridiem)
  })

  it('종료 시각은 시작 + 30분부터만 보인다 — 오전 시작', async () => {
    const { user } = setup()
    const dialog = await openAdd(user, '근무')
    await pickTime(user, dialog, '시작 시각', '09:30')
    const texts = (select: HTMLSelectElement) => within(select).getAllByRole('option').map((option) => option.textContent)
    // 종료가 오후(18:00)일 때는 오후 1~12시 전체
    expect(texts(timeSelects(dialog, '종료 시각')[1])).toEqual(Array.from({ length: 12 }, (_, index) => `${index + 1}시`))
    // 오전으로 바꾸면 10:00부터
    await user.selectOptions(timeSelects(dialog, '종료 시각')[0], 'am')
    expect(timeValue(dialog, '종료 시각')).toBe('10:00')
    expect(texts(timeSelects(dialog, '종료 시각')[1])).toEqual(['10시', '11시'])
  })

  it('종료 시각은 시작 + 30분부터만 보인다 — 오후 시작이면 오전 선택 불가', async () => {
    const { user } = setup()
    const dialog = await openAdd(user, '근무')
    await pickTime(user, dialog, '시작 시각', '14:00')
    const [meridiem, hour] = timeSelects(dialog, '종료 시각')
    expect(within(meridiem).getByRole('option', { name: '오전' })).toBeDisabled()
    expect(within(hour).getAllByRole('option').map((option) => option.textContent)).toEqual(['2시', '3시', '4시', '5시', '6시', '7시', '8시', '9시', '10시', '11시'])
    await user.selectOptions(hour, '2')
    expect(timeValue(dialog, '종료 시각')).toBe('14:30') // 2시 00분은 없으므로 2시 30분
    expect(within(timeSelects(dialog, '종료 시각')[2]).getAllByRole('option').map((option) => option.textContent)).toEqual(['30분'])
  })

  it('연장근무 구간 종료도 구간 시작 + 30분부터', async () => {
    const { user } = setup()
    const dialog = await openAdd(user, '근무')
    await user.click(within(dialog).getByRole('button', { name: '연장근무 추가' }))
    expect(within(timeSelects(dialog, '연장 1 종료')[1]).getAllByRole('option').map((option) => option.textContent)).toEqual(['6시', '7시', '8시', '9시', '10시', '11시'])
  })
  it('오후 12시는 정오, 다음 날 오전 12시는 자정으로 저장된다', async () => {
    const { user, store } = setup()
    const dialog = await openAdd(user, '근무')
    await user.selectOptions(timeSelects(dialog, '종료 시각')[1], '12') // 오후 6시 → 오후 12시
    expect(timeValue(dialog, '종료 시각')).toBe('12:00')
    await user.click(within(dialog).getByLabelText('다음 날 종료 (자정을 넘기는 근무)'))
    expect(timeValue(dialog, '종료 시각')).toBe('00:00') // 다음 날 오전 12시
    await user.click(within(dialog).getByLabelText('확인했으며 그대로 저장합니다')) // 15시간 근무 확인
    await user.click(within(dialog).getByRole('button', { name: '저장' }))
    expect(store.getState().data.entries[0]).toMatchObject({ endTime: '00:00', endsNextDay: true })
  })
  it('월(1일~말일) 20시간을 넘기면 오류를 보여주고 저장하지 않는다', async () => {
    // 10월 평일 2시간 × 10일 = 20시간 (주별 4·8·8시간)
    const days = ['01', '02', '05', '06', '07', '08', '12', '13', '14', '15']
    const entries = days.map((day) => overtimeEntry(`o${day}`, `2026-10-${day}`, '18:00', '20:00'))
    const { user, store } = setup(sampleData({ entries }))
    const dialog = await openAdd(user, '근무')
    await user.click(within(dialog).getByRole('button', { name: '연장근무 추가' }))
    expect(within(dialog).getByText(/월 한도\(2026-10-01 ~ 2026-10-31\)/)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: '저장' }))
    expect(store.getState().data.entries).toHaveLength(10)
    expect(within(dialog).getByText(/저장할 수 없습니다. 연장근무 시간을 줄이세요/)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: '연장 1 삭제' }))
    await user.click(within(dialog).getByRole('button', { name: '저장' }))
    expect(store.getState().data.entries).toHaveLength(11)
  })
})

describe('휴가·근태·출장', () => {
  it('반차는 4시간으로 저장되고 연차 화면에 반영된다', async () => {
    const { user, store } = setup(sampleData({ entries: [] }))
    const dialog = await openAdd(user, '휴가·근태')
    await user.selectOptions(within(dialog).getByLabelText('종류'), 'half-am')
    await user.click(within(dialog).getByRole('button', { name: '저장' }))
    expect(store.getState().data.entries[0]).toMatchObject({ kind: 'leave', leaveType: 'half-am', minutes: 240 })

    await user.click(screen.getByRole('button', { name: '연차·대체휴무' }))
    const remaining = screen.getByText('잔여', { selector: '.stat-label' }).closest('.stat-card')!
    expect(remaining).toHaveTextContent('14일 4시간')
  })

  it('관외 4시간 미만 출장은 설정 필요로 표시한다', async () => {
    const { user, store } = setup()
    const dialog = await openAdd(user, '출장')
    await user.selectOptions(within(dialog).getByLabelText('구분'), 'outside')
    expect(within(dialog).getByText('25,000원')).toBeInTheDocument() // 기본 09:00~13:00 = 4시간 이상
    await pickTime(user, dialog, '복귀 시각', '11:00')
    expect(within(dialog).getByText('설정 필요')).toBeInTheDocument()
    await pickTime(user, dialog, '복귀 시각', '14:00')
    expect(within(dialog).getByText('25,000원')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: '저장' }))
    expect(store.getState().data.entries[0]).toMatchObject({ kind: 'trip', tripType: 'outside' })
    expect(within(dayPanel()).getByText('25,000원')).toBeInTheDocument()
  })

  it('대체휴무를 쓸 때 어느 날 발생한 것을 쓸지 고른다', async () => {
    const dutyA = workEntry({ id: 'a', workTypeId: 'weekend-duty', date: '2026-10-10', endDate: '2026-10-10' })
    const dutyB = workEntry({ id: 'b', workTypeId: 'weekend-duty', date: '2026-10-17', endDate: '2026-10-17' })
    const expired = workEntry({ id: 'x', workTypeId: 'weekend-duty', date: '2026-09-12', endDate: '2026-09-12' })
    const { user, store } = setup(sampleData({ entries: [dutyA, dutyB, expired] }))
    await user.click(screen.getByRole('button', { name: '연차·대체휴무' }))
    await user.click(screen.getByRole('button', { name: '대체휴무 사용 등록' }))
    const dialog = screen.getByRole('dialog', { name: '일정 추가' })
    const picker = within(dialog).getByRole('group', { name: '사용할 대체휴무 (발생일 선택)' })

    const radios = within(picker).getAllByRole('radio')
    expect(radios[0]).toBeEnabled() // 9/12분: 기한 지남이지만 협의해 쓸 수 있다
    expect(within(picker).getByText('기한 지남')).toBeInTheDocument()
    expect(radios[1]).toBeChecked() // 기한 안에서 가장 빠른 10/10분이 기본 선택

    await user.click(radios[2]) // 10/17분 선택
    await user.click(within(dialog).getByRole('button', { name: '저장' }))
    const use = store.getState().data.entries.find((entry) => entry.kind === 'leave')
    expect(use).toMatchObject({ leaveType: 'comp', compSourceId: 'b', minutes: 480 })
    expect(screen.getByText(/2026-10-17 발생분 1일/)).toBeInTheDocument()
  })

  it('1박 2일 출장을 한 번에 입력한다', async () => {
    const { user, store } = setup()
    const dialog = await openAdd(user, '출장')
    await user.selectOptions(within(dialog).getByLabelText('구분'), 'outside')
    await user.selectOptions(within(dialog).getByLabelText('기간'), '1')
    expect(within(dialog).getByLabelText('복귀일')).toHaveValue('2026-10-20')
    await pickTime(user, dialog, '복귀 시각', '12:00')
    expect(within(dialog).getByText('하루 25,000원 × 2일 = 50,000원')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: '저장' }))
    expect(store.getState().data.entries[0]).toMatchObject({ kind: 'trip', date: '2026-10-19', endDate: '2026-10-20', startTime: '09:00', endTime: '12:00' })
  })

  it('주말 당직으로 발생한 대체휴무를 시간 단위로 사용한다', async () => {
    const duty = workEntry({ id: 'd', workTypeId: 'weekend-duty', date: '2026-10-17', endDate: '2026-10-17' })
    const { user, store } = setup(sampleData({ entries: [duty] }))
    await user.click(screen.getByRole('button', { name: '연차·대체휴무' }))
    expect(screen.getByText('오늘 사용 가능').closest('.stat-card')).toHaveTextContent('1일')

    await user.click(screen.getByRole('button', { name: '대체휴무 사용 등록' }))
    const dialog = screen.getByRole('dialog', { name: '일정 추가' })
    expect(within(dialog).getByLabelText('종류')).toHaveValue('comp')
    await user.selectOptions(within(dialog).getByLabelText('단위'), 'hour')
    await fill(user, within(dialog).getByLabelText('사용량'), '2')
    await user.click(within(dialog).getByRole('button', { name: '저장' }))
    expect(store.getState().data.entries.find((entry) => entry.id !== 'd')).toMatchObject({ leaveType: 'comp', minutes: 120 })
    expect(screen.getByText('오늘 사용 가능').closest('.stat-card')).toHaveTextContent('6시간')
  })

  it('기한 지난 대체휴무를 확인 후 직접 삭제하면 잔여에서 빠지고 근무 일정은 남는다', async () => {
    const duty = workEntry({ id: 'd', workTypeId: 'weekend-duty', date: '2026-09-12', endDate: '2026-09-12' })
    const { user, store } = setup(sampleData({ entries: [duty] }))
    await user.click(screen.getByRole('button', { name: '연차·대체휴무' }))
    expect(screen.getByText('기한 지남', { selector: '.badge' })).toBeInTheDocument()
    expect(screen.getByText('오늘 사용 가능').closest('.stat-card')).toHaveTextContent('1일')

    await user.click(screen.getByRole('button', { name: '2026-09-12 대체휴무 삭제' }))
    const confirm = screen.getByRole('dialog', { name: '대체휴무를 삭제할까요?' })
    await user.click(within(confirm).getByRole('button', { name: '취소' }))
    expect(store.getState().data.compDismissals).toEqual([])

    await user.click(screen.getByRole('button', { name: '2026-09-12 대체휴무 삭제' }))
    await user.click(within(screen.getByRole('dialog', { name: '대체휴무를 삭제할까요?' })).getByRole('button', { name: '삭제' }))
    expect(store.getState().data.compDismissals).toEqual([{ entryId: 'd', date: '2026-10-19' }])
    expect(store.getState().data.entries).toHaveLength(1)
    expect(screen.getByText('오늘 사용 가능').closest('.stat-card')).toHaveTextContent('0일')
    expect(screen.getByText(/삭제함/, { selector: '.badge' })).toBeInTheDocument()
  })
})

describe('연장근무 요약 카드', () => {
  it('한도(1일~말일)와 정산(21일~20일)을 따로 보여주고, 정산 금액에 휴일근무 수당도 넣는다', () => {
    const holiday = workEntry({ id: 'h', workTypeId: 'holiday-work', date: '2026-10-11', endDate: '2026-10-11', startTime: '09:00', endTime: '13:00', breakMinutes: 0, holidayCompensation: 'allowance' })
    setup(
      sampleData({
        entries: [
          overtimeEntry('sep', '2026-09-22', '18:00', '21:00'), // 9월 한도 · 10월 급여
          overtimeEntry('oct', '2026-10-13', '18:00', '20:00'), // 10월 한도 · 10월 급여
          overtimeEntry('late', '2026-10-26', '18:00', '22:00'), // 10월 한도 · 11월 급여
          holiday, // 휴일 4시간: 10월 한도 · 10월 급여
        ],
      }),
    )
    const limit = screen.getByText(/10월 연장근무 한도 \(10\/1~10\/31\)/).closest('.stat-card')!
    expect(limit).toHaveTextContent('10시간 / 20시간') // 2 + 4 + 휴일 4
    const pay = screen.getByText(/10월 급여 연장·휴일수당 \(9\/21~10\/20\)/).closest('.stat-card')!
    expect(pay).toHaveTextContent('162,450원') // 연장 5시간 90,250원 + 휴일 4시간 72,200원
    expect(pay).toHaveTextContent('연장 5시간 · 휴일수당 4시간')
  })
})

describe('잔여 대체휴무 카드', () => {
  it('아직 발생일이 안 된 대체휴무는 회색 글씨로 발생 예정을 보여준다', () => {
    setup(sampleData({ entries: [workEntry({ id: 'd', workTypeId: 'weekend-duty', date: '2026-10-24', endDate: '2026-10-24' })] }))
    const card = screen.getByText('잔여 대체휴무').closest('.stat-card')!
    expect(card.querySelector('.stat-value')).toHaveTextContent('0일')
    const upcoming = within(card as HTMLElement).getByText(/발생 예정/)
    expect(upcoming).toHaveTextContent('발생 예정 1일 (10/24)')
    expect(upcoming).toHaveClass('muted')
  })
})

describe('공휴일', () => {
  it('앱에 포함된 공휴일 이름을 바꾸고 원래대로 되돌린다', async () => {
    const { user, store } = setup(sampleData({ entries: [] }))
    await user.click(screen.getByRole('button', { name: '공휴일' }))
    await user.click(screen.getByRole('button', { name: '기독탄신일 이름 수정' }))
    const dialog = screen.getByRole('dialog', { name: '공휴일 이름 수정' })
    expect(within(dialog).getByText(/원래 이름: 기독탄신일/)).toBeInTheDocument()
    await fill(user, within(dialog).getByLabelText('이름'), '성탄절')
    await user.click(within(dialog).getByRole('button', { name: '저장' }))
    expect(store.getState().data.holidays.overrides).toEqual([{ date: '2026-12-25', originalName: '기독탄신일', name: '성탄절' }])
    expect(screen.getByText('성탄절').closest('li')).toHaveTextContent('이름 수정됨')

    await user.click(screen.getByRole('button', { name: '성탄절 이름 수정' }))
    await user.click(within(screen.getByRole('dialog', { name: '공휴일 이름 수정' })).getByRole('button', { name: '원래 이름으로' }))
    expect(store.getState().data.holidays.overrides).toEqual([])
    expect(screen.getByRole('button', { name: '기독탄신일 이름 수정' })).toBeInTheDocument()
  })
})

describe('일괄 등록', () => {
  it('달력에서 여러 날을 골라 같은 시간으로 등록하고, 근무가 있는 날은 고를 수 없다', async () => {
    const existing = workEntry({ id: 'w', date: '2026-10-08', endDate: '2026-10-08' })
    const { user, store } = setup(sampleData({ entries: [existing] }))
    await user.click(screen.getByRole('button', { name: '일괄 등록' }))
    const dialog = screen.getByRole('dialog', { name: '일괄 등록' })
    expect(within(dialog).getByText('2026년 10월')).toBeInTheDocument()
    expect(within(dialog).getByLabelText('근무 종류')).toHaveValue('work') // 정규 근무가 먼저
    expect(timeValue(dialog, '시작 시각')).toBe('09:00')
    await user.selectOptions(within(dialog).getByLabelText('근무 종류'), 'weekday-duty')
    expect(timeValue(dialog, '시작 시각')).toBe('12:30') // 평일 당직 기본 시간
    expect(within(dialog).getByRole('button', { name: '10월 8일 (근무 있음)' })).toBeDisabled()
    expect(within(dialog).getByRole('button', { name: '10월 10일' })).toBeDisabled() // 토요일: 평일 당직 아님
    expect(within(dialog).getByRole('button', { name: '10월 5일' })).toBeDisabled() // 개천절 대체공휴일

    await user.click(within(dialog).getByRole('button', { name: '10월 6일' }))
    await user.click(within(dialog).getByRole('button', { name: '10월 7일' }))
    expect(within(dialog).getByRole('button', { name: '10월 6일' })).toHaveAttribute('aria-pressed', 'true')
    await pickTime(user, dialog, '종료 시각', '22:00')
    await fill(user, within(dialog).getByLabelText('휴게시간 (분)'), '30')
    await user.click(within(dialog).getByRole('button', { name: '2일 등록' }))

    const added = store.getState().data.entries.filter((entry) => entry.id !== 'w')
    expect(added).toHaveLength(2)
    expect(added.map((entry) => entry.date).sort()).toEqual(['2026-10-06', '2026-10-07'])
    expect(added[0]).toMatchObject({ workTypeId: 'weekday-duty', startTime: '12:30', endTime: '22:00', breakMinutes: 30 })
    expect(screen.getByRole('status')).toHaveTextContent('평일 당직 2일을 등록했습니다.')
  })

  it('정규 근무를 평일에 일괄 등록한다', async () => {
    const { user, store } = setup(sampleData({ entries: [] }))
    await user.click(screen.getByRole('button', { name: '일괄 등록' }))
    const dialog = screen.getByRole('dialog', { name: '일괄 등록' })
    expect(within(dialog).getByRole('button', { name: '10월 10일' })).toBeDisabled() // 토요일
    for (const day of [12, 13, 14]) await user.click(within(dialog).getByRole('button', { name: `10월 ${day}일` }))
    await user.click(within(dialog).getByRole('button', { name: '3일 등록' }))
    expect(store.getState().data.entries).toHaveLength(3)
    expect(store.getState().data.entries[0]).toMatchObject({ workTypeId: 'work', startTime: '09:00', endTime: '18:00', breakMinutes: 60 })
    expect(screen.getByRole('status')).toHaveTextContent('정규 근무 3일을 등록했습니다.')
  })

  it('주말 당직으로 바꾸면 주말·공휴일만 고를 수 있고 기본 시간이 바뀐다', async () => {
    const { user } = setup(sampleData({ entries: [] }))
    await user.click(screen.getByRole('button', { name: '일괄 등록' }))
    const dialog = screen.getByRole('dialog', { name: '일괄 등록' })
    await user.selectOptions(within(dialog).getByLabelText('근무 종류'), 'weekend-duty')
    expect(timeValue(dialog, '시작 시각')).toBe('09:00')
    expect(within(dialog).getByRole('button', { name: '10월 6일' })).toBeDisabled()
    expect(within(dialog).getByRole('button', { name: '10월 10일' })).toBeEnabled()
    expect(within(dialog).getByRole('button', { name: '10월 5일' })).toBeEnabled() // 대체공휴일
    expect(within(dialog).getByRole('button', { name: '10월 9일' })).toBeEnabled() // 한글날(금)
  })
})

describe('급여', () => {
  it('마이페이지에서 기본급을 저장하면 월별 급여에 반영되고 휴일근무 수당이 계산된다', async () => {
    const holiday = workEntry({ id: 'h', workTypeId: 'holiday-work', date: '2026-10-03', endDate: '2026-10-03', holidayCompensation: 'allowance' })
    const { user, store } = setup(sampleData({ entries: [holiday] }))
    await user.click(screen.getByRole('button', { name: '마이페이지' }))
    await user.click(screen.getByRole('tab', { name: '급여·공제' }))
    const paySection = screen.getByRole('form', { name: '급여·공제' })
    await fill(user, within(paySection).getByLabelText('기본급(원)'), '2500000')
    expect(within(paySection).getByLabelText('기본급(원)')).toHaveValue('2,500,000') // 입력 중 천 단위 쉼표
    await user.click(within(paySection).getByRole('button', { name: '저장' }))
    // 세금: 공제대상 가족 2명으로 저장
    await user.click(screen.getByRole('tab', { name: '세금' }))
    const taxSection = screen.getByRole('form', { name: '세금 (소득세·지방소득세)' })
    expect(within(taxSection).getByLabelText('공제대상 부양가족 수 (본인 포함)')).toHaveValue(1)
    await fill(user, within(taxSection).getByLabelText('공제대상 부양가족 수 (본인 포함)'), '2')
    await user.click(within(taxSection).getByRole('button', { name: '저장' }))
    expect(store.getState().data.settings.tax).toEqual({ familyCount: 2, childCount: 0 })
    expect(store.getState().data.settings.pay.profiles[0].baseSalary).toBe(2_500_000)

    await user.click(screen.getByRole('button', { name: '월별 급여' }))
    const table = screen.getByRole('table', { name: '급여 계산 내역' })
    expect(within(table).getByText('휴일근무 수당').closest('tr')).toHaveTextContent('135,375원')
    // 과세급여 2,635,375원, 가족 2명 → 간이세액표 33,050원, 지방소득세 3,300원
    expect(within(table).getByText('소득세').closest('tr')).toHaveTextContent('33,050원')
    expect(within(table).getByText('지방소득세').closest('tr')).toHaveTextContent('3,300원')
    expect(screen.getByRole('note')).toHaveTextContent('추정치')
    expect(screen.getByText('급여 지급일').closest('.stat-card')).toHaveTextContent('10/23') // 10/25 일요일 → 금요일

    await fill(user, screen.getByLabelText('실제 입금액 (원)'), '2300000')
    expect(screen.getByLabelText('실제 입금액 (원)')).toHaveValue('2,300,000')
    await user.click(within(screen.getByRole('form', { name: '실제 입금액 기록' })).getByRole('button', { name: '저장' }))
    expect(store.getState().data.payrollRecords['2026-10']).toMatchObject({ actualDeposit: 2_300_000 })
  })

  it('마이페이지는 탭으로 한 섹션만 보여주고, 처음에는 적용 규정 탭이 열린다', async () => {
    const { user } = setup()
    await user.click(screen.getByRole('button', { name: '마이페이지' }))
    const regulation = screen.getByRole('tab', { name: '적용 규정' })
    expect(regulation).toHaveAttribute('aria-selected', 'true')
    expect(regulation).toHaveClass('is-active')
    expect(screen.getByRole('tabpanel')).toHaveAccessibleName('적용 규정')
    expect(screen.getByRole('form', { name: '적용 규정' })).toBeInTheDocument()
    expect(screen.queryByRole('form', { name: '급여·공제' })).not.toBeInTheDocument() // 렌더링하지 않음
    expect(screen.getAllByRole('form')).toHaveLength(1)

    await user.click(screen.getByRole('tab', { name: '연장근무' }))
    expect(screen.getByRole('tab', { name: '연장근무' })).toHaveAttribute('aria-selected', 'true')
    expect(regulation).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByRole('form', { name: '연장근무·휴일근무' })).toBeInTheDocument()
    expect(screen.queryByRole('form', { name: '적용 규정' })).not.toBeInTheDocument()

    // 방향키로 옆 탭으로 이동
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: '매식비' })).toHaveFocus()
    expect(screen.getByRole('form', { name: '매식비' })).toBeInTheDocument()
  })

  it('저장하지 않은 변경이 있으면 탭을 바꾸기 전에 확인한다', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    const { user } = setup()
    await user.click(screen.getByRole('button', { name: '마이페이지' }))
    await user.click(within(screen.getByRole('form', { name: '적용 규정' })).getByLabelText(/근로기준법/))
    await user.click(screen.getByRole('tab', { name: '세금' }))
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('tab', { name: '적용 규정' })).toHaveAttribute('aria-selected', 'true') // 취소 → 그대로
    await user.click(screen.getByRole('tab', { name: '세금' }))
    expect(screen.getByRole('tab', { name: '세금' })).toHaveAttribute('aria-selected', 'true')
    confirm.mockRestore()
  })

  it('적용 규정을 근로기준법으로 바꾸면 외출이 연차에서 차감되지 않는다', async () => {
    const { user, store } = setup()
    await user.click(screen.getByRole('button', { name: '마이페이지' }))
    const section = screen.getByRole('form', { name: '적용 규정' })
    await user.click(within(section).getByLabelText(/근로기준법/))
    await user.click(within(section).getByRole('button', { name: '저장' }))
    expect(store.getState().data.settings.regulation).toBe('labor-standards')
  })
})

describe('할 일', () => {
  const saved = (storage: ReturnType<typeof memoryStorage>) => (JSON.parse(storage.items.get(STORAGE_KEY)!) as AppData).todos
  const todoRegion = () => screen.getByRole('region', { name: '할 일' })
  const texts = () => within(todoRegion()).queryAllByRole('textbox', { name: '할 일 내용' }) as HTMLTextAreaElement[]
  const todo = (id: string, text: string, overrides: Partial<AppData['todos'][number]> = {}) => ({ id, text, done: false, date: '2026-10-19', doneOn: null, ...overrides })
  const pickDate = (value: string) => fireEvent.change(screen.getByLabelText('날짜 선택'), { target: { value } })

  it('Enter로 다음 할 일을 추가하고(선택한 날짜로 저장), 빈 칸에서 Backspace로 지운다', async () => {
    const { storage, user } = setup(sampleData())
    await user.click(within(todoRegion()).getByRole('button', { name: '할 일 추가' }))
    await user.keyboard('보고서 제출{Enter}회의 준비')
    expect(saved(storage).map((item) => [item.text, item.date])).toEqual([
      ['보고서 제출', '2026-10-19'],
      ['회의 준비', '2026-10-19'],
    ])
    expect(texts()[1]).toHaveFocus()

    await user.keyboard('{Enter}')
    expect(texts()).toHaveLength(3)
    await user.keyboard('{Backspace}')
    expect(saved(storage).map((item) => item.text)).toEqual(['보고서 제출', '회의 준비'])
    expect(texts()[1]).toHaveFocus()
  })

  it('× 버튼으로 삭제한다', async () => {
    const { storage, user } = setup(sampleData({ todos: [todo('a', '장보기'), todo('b', '운동')] }))
    await user.click(within(todoRegion()).getByRole('button', { name: '"장보기" 삭제' }))
    expect(saved(storage).map((item) => item.id)).toEqual(['b'])
  })

  it('글자를 눌러 바로 고치고, 체크하면 완료(취소선)로 표시한다', async () => {
    const { storage, user } = setup(sampleData({ todos: [todo('a', '장보기')] }))
    await user.click(texts()[0])
    await user.keyboard('{End} 우유')
    expect(saved(storage)[0].text).toBe('장보기 우유')
    await user.click(within(todoRegion()).getByRole('checkbox', { name: '"장보기 우유" 완료' }))
    expect(saved(storage)[0]).toMatchObject({ done: true, doneOn: '2026-10-19' })
    expect(texts()[0].closest('li')).toHaveClass('is-done')
  })

  it('완료하지 않은 할 일은 체크할 때까지 이후 날짜에도 보이고, 완료한 다음 날부터는 안 보인다', async () => {
    const { user } = setup(sampleData({ todos: [todo('a', '서류 제출', { date: '2026-10-17' }), todo('b', '다음 주 일', { date: '2026-10-26' })] }))
    expect(texts().map((input) => input.value)).toEqual(['서류 제출'])
    expect(within(todoRegion()).getByText('10/17부터')).toBeInTheDocument()

    pickDate('2026-10-16')
    expect(texts()).toHaveLength(0)

    pickDate('2026-10-21')
    await user.click(within(todoRegion()).getByRole('checkbox', { name: '"서류 제출" 완료' }))
    expect(texts()[0].closest('li')).toHaveClass('is-done')
    pickDate('2026-10-22')
    expect(texts()).toHaveLength(0)
    pickDate('2026-10-20')
    expect(texts()[0].closest('li')).not.toHaveClass('is-done')
  })

  it('손잡이에서 ↑/↓, 글 칸에서 Alt+↑/↓로 순서를 바꾼다', async () => {
    const { storage, user } = setup(sampleData({ todos: [todo('a', 'A'), todo('b', 'B')] }))
    await user.click(texts()[1])
    await user.keyboard('{Alt>}{ArrowUp}{/Alt}')
    expect(saved(storage).map((item) => item.id)).toEqual(['b', 'a'])
    within(todoRegion()).getByRole('button', { name: /"B" 순서 변경/ }).focus()
    await user.keyboard('{ArrowDown}')
    expect(saved(storage).map((item) => item.id)).toEqual(['a', 'b'])
  })
})

describe('급여 초기화', () => {
  it('확인 후 해당 월의 저장된 급여 데이터를 지운다', async () => {
    const { storage, user } = setup(sampleData({ payrollRecords: { '2026-10': { actualDeposit: 2_500_000, note: '입금' }, '2026-09': { actualDeposit: 1, note: '' } } }))
    await user.click(screen.getByRole('button', { name: /월별 급여/ }))
    expect(screen.getByLabelText('실제 입금액 (원)')).toHaveValue('2,500,000')
    await user.click(screen.getByRole('button', { name: '급여 초기화' }))
    await user.click(within(screen.getByRole('dialog', { name: /급여를 초기화할까요/ })).getByRole('button', { name: '초기화' }))
    const records = (JSON.parse(storage.items.get(STORAGE_KEY)!) as AppData).payrollRecords
    expect(records).toEqual({ '2026-09': { actualDeposit: 1, note: '' } })
    expect(screen.getByLabelText('실제 입금액 (원)')).toHaveValue('')
    expect(screen.getByRole('button', { name: '급여 초기화' })).toBeDisabled()
  })
})

describe('기간별 정리', () => {
  it('연도 범위를 골라 건수를 확인하고 정리한다 (설정은 남김)', async () => {
    const { storage, user } = setup(
      sampleData({
        entries: [workEntry({ id: 'old', date: '2024-03-04', endDate: '2024-03-04' }), workEntry({ id: 'new', date: '2026-10-19', endDate: '2026-10-19' })],
        todos: [{ id: 't', text: '옛 할 일', done: false, date: '2024-05-01', doneOn: null }],
      }),
    )
    await user.click(screen.getByRole('button', { name: '마이페이지' }))
    await user.click(screen.getByRole('tab', { name: '백업·정리' }))
    await user.selectOptions(screen.getByLabelText('시작 연도'), '2024')
    await user.selectOptions(screen.getByLabelText('끝 연도'), '2025')
    expect(screen.getByText('2024~2025년: 일정 1건 · 할 일 1건')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '정리하기' }))
    const dialog = screen.getByRole('dialog', { name: '2024~2025년 기록을 정리할까요?' })
    expect(within(dialog).getByText(/완료하지 않은 할 일 1건도 지워집니다/)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: '백업 없이 정리' }))
    const saved = JSON.parse(storage.items.get(STORAGE_KEY)!) as AppData
    expect(saved.entries.map((entry) => entry.id)).toEqual(['new'])
    expect(saved.todos).toEqual([])
    expect(saved.settings.leave.grants).toEqual(sampleData().settings.leave.grants)
  })
})
