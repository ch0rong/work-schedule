import { createDefaultData } from './defaults'
import { appDataSchema, formatSchemaIssues, type AppData } from './schema'
import { loadData, saveData, type KeyValueStorage, type LoadResult, type SaveResult } from './storage'

/** idle: 변경 없음, saving: 저장 중, saved: 저장됨, error: 실패, conflict: 다른 기기에서 먼저 저장됨, auth: 로그인 만료 */
export type SyncStatus = 'idle' | 'saving' | 'saved' | 'error' | 'conflict' | 'auth'

export interface AppState {
  data: AppData
  /** 저장된 데이터가 손상된 경우. 해결 전까지 일반 변경을 막아 원본을 보존한다. */
  invalid: { raw: string; errors: string[] } | null
  /** 마지막 저장 실패 메시지 */
  saveError: string | null
  /** 저장소를 쓸 수 없는 환경 안내 */
  storageWarning: string | null
  syncStatus: SyncStatus
}

export type UpdateResult = { ok: true } | { ok: false; errors: string[] }

/** 데이터를 저장하는 함수. localStorage는 동기, Google Drive는 비동기 */
export type Persist = (data: AppData) => SaveResult | Promise<SaveResult>

export interface AppStore {
  getState(): AppState
  subscribe(listener: () => void): () => void
  /** 현재 데이터를 바꾼다. 검증에 실패하면 반영하지 않는다. */
  update(updater: (data: AppData) => AppData): UpdateResult
  /** 백업 복원·초기화처럼 전체를 바꾼다. 손상 상태에서도 사용할 수 있다. */
  replaceAll(data: AppData): UpdateResult
  /** 다른 기기에서 다시 불러온 데이터로 바꾼다 (저장하지 않음) */
  applyRemote(data: AppData): void
  /** 마지막 저장을 다시 시도한다 (로그인 갱신 후 등) */
  retrySave(): Promise<void>
  /** 진행 중인 저장이 끝날 때까지 기다린다 */
  flush(): Promise<void>
}

export function createStore(loaded: LoadResult, persist: Persist, now: () => Date = () => new Date()): AppStore {
  let state: AppState =
    loaded.status === 'invalid'
      ? { data: createDefaultData(now()), invalid: { raw: loaded.raw, errors: loaded.errors }, saveError: null, storageWarning: null, syncStatus: 'idle' }
      : {
          data: loaded.data,
          invalid: null,
          saveError: null,
          storageWarning: loaded.status === 'unavailable' ? loaded.message : null,
          syncStatus: 'idle',
        }
  const listeners = new Set<() => void>()
  const set = (patch: Partial<AppState>) => {
    state = { ...state, ...patch }
    listeners.forEach((listener) => listener())
  }

  // 비동기 저장: 저장 중에 또 바뀌면 끝난 뒤 최신 데이터로 한 번 더 저장한다
  let running: Promise<void> | null = null
  let dirty = false

  const applyResult = (result: SaveResult) => {
    if (result.ok) set({ saveError: null, syncStatus: 'saved' })
    else set({ saveError: result.message, syncStatus: result.reason ?? 'error' })
  }

  function persistLatest(): Promise<void> | void {
    const first = persist(state.data)
    if (!(first instanceof Promise)) {
      applyResult(first)
      return
    }
    dirty = false
    set({ syncStatus: 'saving' })
    running = (async () => {
      let result = await first
      while (result.ok && dirty) {
        dirty = false
        result = await persist(state.data)
      }
      dirty = false
      running = null
      applyResult(result)
    })()
    return running
  }

  function schedule() {
    if (running) {
      dirty = true
      return
    }
    void persistLatest()
  }

  function commit(next: AppData): UpdateResult {
    const parsed = appDataSchema.safeParse({ ...next, updatedAt: now().toISOString() })
    if (!parsed.success) return { ok: false, errors: formatSchemaIssues(parsed.error) }
    set({ data: parsed.data, invalid: null })
    schedule()
    return { ok: true }
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    update(updater) {
      if (state.invalid) {
        return { ok: false, errors: ['저장된 데이터에 문제가 있어 변경할 수 없습니다. 먼저 복원하거나 초기화하세요.'] }
      }
      if (state.syncStatus === 'conflict') {
        return { ok: false, errors: ['다른 기기에서 데이터가 바뀌었습니다. 먼저 다시 불러오거나 덮어쓰기를 선택하세요.'] }
      }
      return commit(updater(state.data))
    },
    replaceAll: commit,
    applyRemote(data) {
      set({ data, invalid: null, saveError: null, syncStatus: 'saved' })
    },
    async retrySave() {
      if (running) await running
      await persistLatest()
    },
    async flush() {
      while (running) await running
    },
  }
}

/** localStorage(개발·로컬 모드) 저장소 */
export function createAppStore(storage: KeyValueStorage | null, now: () => Date = () => new Date()): AppStore {
  return createStore(loadData(storage), (data) => saveData(data, storage), now)
}
