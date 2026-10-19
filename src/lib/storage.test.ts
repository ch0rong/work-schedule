import { describe, expect, it } from 'vitest'
import { FIXED_NOW, memoryStorage, sampleData } from '../test/fixtures'
import { backupFileName, createBackup, parseBackup, serializeBackup } from './backup'
import { createAppStore } from './store'
import { loadData, migrateData, saveData, STORAGE_KEY } from './storage'

describe('loadData', () => {
  it('저장된 데이터가 없으면 기본 데이터로 시작한다', () => {
    const result = loadData(memoryStorage())
    expect(result.status).toBe('empty')
  })

  it('저장 후 다시 읽으면 같은 데이터가 나온다 (새로고침)', () => {
    const storage = memoryStorage()
    const data = sampleData()
    expect(saveData(data, storage)).toEqual({ ok: true })

    const result = loadData(storage)
    expect(result).toEqual({ status: 'loaded', data })
  })

  it('JSON이 깨졌으면 invalid로 표시하고 원본을 보존한다', () => {
    const storage = memoryStorage({ [STORAGE_KEY]: '{broken' })
    const result = loadData(storage)
    expect(result.status).toBe('invalid')
    expect(storage.items.get(STORAGE_KEY)).toBe('{broken')
  })

  it('스키마 검증에 실패하면 오류 목록을 돌려준다', () => {
    const storage = memoryStorage({ [STORAGE_KEY]: JSON.stringify({ ...sampleData(), entries: 'nope' }) })
    const result = loadData(storage)
    expect(result.status).toBe('invalid')
    if (result.status === 'invalid') expect(result.errors.length).toBeGreaterThan(0)
  })

  it('localStorage를 쓸 수 없으면 unavailable', () => {
    expect(loadData(null).status).toBe('unavailable')
  })
})

describe('migrateData', () => {
  it('더 새로운 버전은 거부한다', () => {
    const result = migrateData({ schemaVersion: 99 })
    expect(result.ok).toBe(false)
  })

  it('schemaVersion이 없으면 거부한다', () => {
    expect(migrateData({}).ok).toBe(false)
    expect(migrateData(null).ok).toBe(false)
  })

  it('등록된 마이그레이션을 차례로 적용한다', () => {
    const migrations = {
      1: (d: Record<string, unknown>) => ({ ...d, a: 1 }),
      2: (d: Record<string, unknown>) => ({ ...d, b: 2 }),
    }
    const result = migrateData({ schemaVersion: 1 }, migrations, 3)
    expect(result).toEqual({ ok: true, data: { schemaVersion: 3, a: 1, b: 2 } })
  })

  it('중간 마이그레이션이 없으면 거부한다', () => {
    expect(migrateData({ schemaVersion: 1 }, {}, 2).ok).toBe(false)
  })
})

describe('saveData', () => {
  it('저장공간 초과를 알린다', () => {
    const storage = memoryStorage()
    storage.failWith = new DOMException('full', 'QuotaExceededError')
    const result = saveData(sampleData(), storage)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('저장공간')
  })
})

describe('backup', () => {
  it('내보낸 백업을 다시 가져오면 같은 데이터가 나온다', () => {
    const data = sampleData()
    const text = serializeBackup(createBackup(data, FIXED_NOW))
    const result = parseBackup(text)
    expect(result).toEqual({ ok: true, data, exportedAt: FIXED_NOW.toISOString() })
  })

  it('JSON이 아니거나 다른 형식의 파일은 거부한다', () => {
    expect(parseBackup('not json').ok).toBe(false)
    expect(parseBackup(JSON.stringify({ hello: 'world' })).ok).toBe(false)
    expect(parseBackup(JSON.stringify(sampleData())).ok).toBe(false)
  })

  it('데이터가 스키마에 맞지 않으면 거부한다', () => {
    const backup = { ...createBackup(sampleData(), FIXED_NOW), data: { ...sampleData(), schemaVersion: 3 } }
    expect(parseBackup(JSON.stringify(backup)).ok).toBe(false)
  })

  it('파일 이름에 날짜와 시각을 넣는다', () => {
    expect(backupFileName(new Date(2026, 9, 18, 9, 5))).toBe('work-schedule-backup-2026-10-18-0905.json')
  })
})

describe('createAppStore', () => {
  const now = () => FIXED_NOW

  it('변경을 즉시 저장하고 구독자에게 알린다', () => {
    const storage = memoryStorage()
    const store = createAppStore(storage, now)
    let notified = 0
    store.subscribe(() => notified++)

    const result = store.update((data) => ({ ...data, entries: sampleData().entries }))

    expect(result).toEqual({ ok: true })
    expect(notified).toBeGreaterThan(0)
    expect(createAppStore(storage, now).getState().data.entries).toHaveLength(2)
  })

  it('검증에 실패한 변경은 반영하지도 저장하지도 않는다', () => {
    const storage = memoryStorage()
    const store = createAppStore(storage, now)
    const before = store.getState()

    const result = store.update((data) => ({ ...data, entries: [{ ...sampleData().entries[0], breakMinutes: -1 }] }))

    expect(result.ok).toBe(false)
    expect(store.getState()).toBe(before)
    expect(storage.items.has(STORAGE_KEY)).toBe(false)
  })

  it('저장 실패 시 메모리에는 반영하고 오류를 알린다', () => {
    const storage = memoryStorage()
    const store = createAppStore(storage, now)
    storage.failWith = new DOMException('full', 'QuotaExceededError')

    store.update((data) => ({ ...data, entries: sampleData().entries }))

    expect(store.getState().data.entries).toHaveLength(2)
    expect(store.getState().saveError).toContain('저장공간')
  })

  it('손상된 데이터는 덮어쓰지 않고, 복원(replaceAll) 후에만 저장한다', () => {
    const storage = memoryStorage({ [STORAGE_KEY]: '{broken' })
    const store = createAppStore(storage, now)
    expect(store.getState().invalid).not.toBeNull()

    expect(store.update((data) => data).ok).toBe(false)
    expect(storage.items.get(STORAGE_KEY)).toBe('{broken')

    expect(store.replaceAll(sampleData()).ok).toBe(true)
    expect(store.getState().invalid).toBeNull()
    expect(loadData(storage).status).toBe('loaded')
  })
})
