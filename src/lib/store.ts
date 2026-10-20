import { createDefaultData } from './defaults'
import { mergeAppData } from './merge'
import { appDataSchema, formatSchemaIssues, type AppData } from './schema'
import { loadData, saveData, type KeyValueStorage, type LoadResult, type PullResult, type SaveResult } from './storage'

/** idle: 변경 없음, saving: 저장 중, saved: 저장됨, error: 실패, auth: 로그인 만료 */
export type SyncStatus = 'idle' | 'saving' | 'saved' | 'error' | 'auth'

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

/** 다른 기기에서 바뀐 데이터를 가져오는 함수 (Google Drive) */
export type Pull = () => Promise<PullResult>

export interface AppStore {
  getState(): AppState
  subscribe(listener: () => void): () => void
  /** 현재 데이터를 바꾼다. 검증에 실패하면 반영하지 않는다. */
  update(updater: (data: AppData) => AppData): UpdateResult
  /** 백업 복원·초기화처럼 전체를 바꾼다. 손상 상태에서도 사용할 수 있다. */
  replaceAll(data: AppData): UpdateResult
  /** 다른 기기의 변경을 확인해 자동으로 병합한다. 이 기기의 저장 안 된 변경은 유지하고 병합 결과를 저장한다. */
  refresh(): Promise<void>
  /** 마지막 저장을 다시 시도한다 (로그인 갱신 후 등) */
  retrySave(): Promise<void>
  /** 진행 중인 저장·동기화가 끝날 때까지 기다린다 */
  flush(): Promise<void>
}

/** 저장 중 다른 기기와 계속 엇갈릴 때 병합·재시도 횟수 */
const MAX_MERGE_ATTEMPTS = 5

export function createStore(loaded: LoadResult, persist: Persist, now: () => Date = () => new Date(), pull?: Pull): AppStore {
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

  /** 마지막으로 저장소와 같다고 확인된 데이터 (병합 기준) */
  let synced = state.data

  // 저장·불러오기는 한 번에 하나씩 순서대로 실행한다 (서로 엇갈려 다른 기기 변경을 덮어쓰지 않도록)
  let tail: Promise<void> = Promise.resolve()
  let busy = 0
  let saveQueued = false
  const enqueue = (task: () => Promise<void>): Promise<void> => {
    busy += 1
    const run = tail.then(task).finally(() => (busy -= 1))
    tail = run.catch(() => {})
    return run
  }

  const applyResult = (result: SaveResult) => {
    if (result.ok) set({ saveError: null, syncStatus: 'saved' })
    else set({ saveError: result.message, syncStatus: result.reason === 'auth' ? 'auth' : 'error' })
  }

  /** 다른 기기의 데이터와 이 기기의 변경을 합친다 */
  function rebase(remote: AppData) {
    const merged = mergeAppData(synced, state.data, remote)
    synced = remote
    if (merged !== state.data) set({ data: merged })
  }

  /** 최신 데이터를 저장한다. 저장 중에 또 바뀌거나 다른 기기에서 먼저 저장했으면 병합해 다시 저장한다. */
  async function saveLoop(sending: AppData, first: SaveResult | Promise<SaveResult>) {
    set({ syncStatus: 'saving' })
    let result = await first
    let attempts = 0
    for (;;) {
      if (result.ok) {
        synced = sending
        if (state.data === sending) break
      } else if (result.reason === 'remote-changed' && attempts < MAX_MERGE_ATTEMPTS) {
        attempts += 1
        rebase(result.remote)
        if (state.data === synced) {
          result = { ok: true }
          break
        }
      } else break
      sending = state.data
      result = await persist(sending)
    }
    applyResult(result)
  }

  function schedule() {
    if (saveQueued) return
    if (busy === 0) {
      const sending = state.data
      const first = persist(sending)
      if (!(first instanceof Promise)) {
        if (first.ok) synced = sending
        applyResult(first)
        return
      }
      set({ syncStatus: 'saving' })
      void enqueue(() => saveLoop(sending, first))
      return
    }
    saveQueued = true
    set({ syncStatus: 'saving' })
    void enqueue(async () => {
      saveQueued = false
      if (state.data === synced) {
        if (state.syncStatus === 'saving') set({ syncStatus: 'saved' })
        return
      }
      await saveLoop(state.data, persist(state.data))
    })
  }

  async function flush() {
    while (busy > 0) await tail
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
      return commit(updater(state.data))
    },
    replaceAll: commit,
    async refresh() {
      // 저장이 대기 중이면 그 저장이 다른 기기 변경을 확인·병합한다
      if (!pull || state.invalid || saveQueued || state.syncStatus === 'auth') return
      await enqueue(async () => {
        const result = await pull()
        if (result.status === 'error') {
          if (result.reason === 'auth') set({ saveError: result.message, syncStatus: 'auth' })
          return
        }
        if (result.status === 'unchanged') return
        rebase(result.data)
        if (state.data !== synced) schedule()
      })
    },
    async retrySave() {
      await flush()
      if (state.data === synced && state.syncStatus !== 'auth' && state.syncStatus !== 'error') return
      await enqueue(() => saveLoop(state.data, persist(state.data)))
    },
    flush,
  }
}

/** localStorage(개발·로컬 모드) 저장소 */
export function createAppStore(storage: KeyValueStorage | null, now: () => Date = () => new Date()): AppStore {
  return createStore(loadData(storage), (data) => saveData(data, storage), now)
}
