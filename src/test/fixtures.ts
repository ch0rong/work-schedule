import { createDefaultData } from '../lib/defaults'
import type { AppData, LeaveEntry, TripEntry, WorkEntry } from '../lib/schema'

export const FIXED_NOW = new Date('2026-10-18T12:00:00.000Z')

export function workEntry(overrides: Partial<WorkEntry> = {}): WorkEntry {
  return {
    id: 'w1',
    kind: 'work',
    date: '2026-10-19',
    endDate: '2026-10-19',
    workTypeId: 'work',
    startTime: '09:00',
    endTime: '18:00',
    endsNextDay: false,
    breakMinutes: 60,
    note: '',
    overtime: [],
    holidayCompensation: null,
    compExpiresOn: null,
    ...overrides,
  }
}

export function leaveEntry(overrides: Partial<LeaveEntry> = {}): LeaveEntry {
  return {
    id: 'l1',
    kind: 'leave',
    leaveType: 'annual',
    date: '2026-10-23',
    endDate: '2026-10-23',
    startTime: null,
    endTime: null,
    minutes: 480,
    specialTypeId: null,
    compSourceId: null,
    note: '',
    ...overrides,
  }
}

export function tripEntry(overrides: Partial<TripEntry> = {}): TripEntry {
  return {
    id: 't1',
    kind: 'trip',
    date: '2026-10-20',
    endDate: '2026-10-20',
    tripType: 'inside',
    startTime: '13:00',
    endTime: '18:00',
    note: '',
    ...overrides,
  }
}

/** 정규 근무 09:00~18:00 + 연장 구간 */
export function overtimeEntry(id: string, date: string, start: string, end: string, overrides: Partial<WorkEntry> = {}): WorkEntry {
  return workEntry({ id, date, endDate: date, overtime: [{ startTime: start, endTime: end, endsNextDay: end < start }], ...overrides })
}

export function sampleData(overrides: Partial<AppData> = {}): AppData {
  const base = createDefaultData(FIXED_NOW)
  return {
    ...base,
    settings: {
      ...base.settings,
      leave: { ...base.settings.leave, grants: { '2026': { days: 15, extraDays: 0, note: '' } } },
    },
    entries: [workEntry(), leaveEntry()],
    ...overrides,
  }
}

/** 테스트용 메모리 저장소. failWith를 지정하면 setItem이 예외를 던진다. */
export function memoryStorage(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial))
  const storage = {
    failWith: null as Error | null,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (storage.failWith) throw storage.failWith
      items.set(key, value)
    },
    items,
  }
  return storage
}
