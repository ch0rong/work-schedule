import { createDefaultData } from './defaults'
import { MigrationError, migrateV1ToV2 } from './migrations'
import { appDataSchema, formatSchemaIssues, SCHEMA_VERSION, type AppData } from './schema'

export const STORAGE_KEY = 'work-schedule-app:v1'

/** 저장소 의존성을 주입할 수 있도록 Storage의 필요한 부분만 사용한다. */
export type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem'>

export type ValidationResult = { ok: true; data: AppData } | { ok: false; errors: string[] }

export type LoadResult =
  /** 저장된 데이터가 없어 기본 데이터로 시작 */
  | { status: 'empty'; data: AppData }
  | { status: 'loaded'; data: AppData }
  /** 저장된 데이터가 손상되었거나 검증에 실패. 원본은 덮어쓰지 않는다. */
  | { status: 'invalid'; raw: string; errors: string[] }
  /** localStorage를 사용할 수 없음 (브라우저 설정 등) */
  | { status: 'unavailable'; data: AppData; message: string }

/** reason — auth: 로그인 만료, remote-changed: 다른 기기에서 먼저 저장됨 (remote와 병합한 뒤 다시 저장) */
export type SaveResult =
  | { ok: true }
  | { ok: false; message: string; reason?: 'auth' }
  | { ok: false; message: string; reason: 'remote-changed'; remote: AppData }

/** 다른 기기의 변경 확인 결과 */
export type PullResult =
  | { status: 'unchanged' }
  | { status: 'changed'; data: AppData }
  | { status: 'error'; message: string; reason?: 'auth' }

/**
 * 버전별 마이그레이션. key 버전의 데이터를 key+1 버전으로 바꾼다.
 * 스키마가 바뀌면 SCHEMA_VERSION을 올리고 여기에 함수를 추가한다.
 */
export const MIGRATIONS: Record<number, (data: Record<string, unknown>) => Record<string, unknown>> = {
  1: (data) => migrateV1ToV2(data),
}

export function migrateData(
  raw: unknown,
  migrations = MIGRATIONS,
  targetVersion = SCHEMA_VERSION,
): { ok: true; data: unknown } | { ok: false; errors: string[] } {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, errors: ['데이터가 객체 형식이 아닙니다.'] }
  }
  let data = raw as Record<string, unknown>
  let version = data.schemaVersion
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return { ok: false, errors: ['schemaVersion이 없거나 올바르지 않습니다.'] }
  }
  if (version > targetVersion) {
    return {
      ok: false,
      errors: [`이 앱보다 새로운 버전(${version})의 데이터입니다. 지원 버전: ${targetVersion}`],
    }
  }
  while (version < targetVersion) {
    const migrate = migrations[version]
    if (!migrate) {
      return { ok: false, errors: [`버전 ${version} 데이터를 변환하는 방법이 없습니다.`] }
    }
    try {
      data = migrate(data)
    } catch (error) {
      return { ok: false, errors: error instanceof MigrationError ? error.errors : [`버전 ${version} 데이터 변환 중 오류가 발생했습니다.`] }
    }
    version += 1
    data = { ...data, schemaVersion: version }
  }
  return { ok: true, data }
}

/** 기본 근무 유형의 옛 이름. 사용자가 바꾸지 않았으면 새 이름으로 바꾼다 (2026-10-20 '기본근무' → '정규 근무') */
const RENAMED_WORK_TYPES: Record<string, { from: string; to: string }> = { work: { from: '기본근무', to: '정규 근무' } }

function renameDefaultWorkTypes(data: AppData): AppData {
  if (!data.workTypes.some((type) => RENAMED_WORK_TYPES[type.id]?.from === type.name)) return data
  return { ...data, workTypes: data.workTypes.map((type) => (RENAMED_WORK_TYPES[type.id]?.from === type.name ? { ...type, name: RENAMED_WORK_TYPES[type.id].to } : type)) }
}

/** 마이그레이션 후 스키마를 검증한다. */
export function validateAppData(raw: unknown): ValidationResult {
  const migrated = migrateData(raw)
  if (!migrated.ok) return migrated
  const parsed = appDataSchema.safeParse(migrated.data)
  if (!parsed.success) return { ok: false, errors: formatSchemaIssues(parsed.error) }
  return { ok: true, data: renameDefaultWorkTypes(parsed.data) }
}

/** localStorage 접근 자체가 예외를 던지는 환경(차단 설정 등)이 있어 안전하게 가져온다. */
export function getBrowserStorage(): KeyValueStorage | null {
  try {
    const storage = window.localStorage
    const probe = `${STORAGE_KEY}:probe`
    storage.setItem(probe, '1')
    storage.removeItem(probe)
    return storage
  } catch {
    return null
  }
}

export function loadData(storage: KeyValueStorage | null): LoadResult {
  if (!storage) {
    return {
      status: 'unavailable',
      data: createDefaultData(),
      message: '이 브라우저에서 localStorage를 사용할 수 없어 데이터가 저장되지 않습니다.',
    }
  }

  let raw: string | null
  try {
    raw = storage.getItem(STORAGE_KEY)
  } catch {
    return {
      status: 'unavailable',
      data: createDefaultData(),
      message: '저장된 데이터를 읽을 수 없습니다. 브라우저의 사이트 데이터 설정을 확인하세요.',
    }
  }
  if (raw === null) return { status: 'empty', data: createDefaultData() }

  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    return { status: 'invalid', raw, errors: ['저장된 데이터가 올바른 JSON이 아닙니다.'] }
  }

  const result = validateAppData(json)
  if (!result.ok) return { status: 'invalid', raw, errors: result.errors }

  // 이전 버전에서 변환된 경우, 첫 저장으로 덮어쓰기 전에 원본을 별도 키에 한 번 보관한다
  const version = (json as { schemaVersion?: unknown }).schemaVersion
  if (typeof version === 'number' && version < SCHEMA_VERSION) {
    const backupKey = `${STORAGE_KEY}:backup-v${version}`
    try {
      if (storage.getItem(backupKey) === null) storage.setItem(backupKey, raw)
    } catch {
      // 보관에 실패해도 불러오기는 계속한다 (저장 시 다시 오류가 표시됨)
    }
  }
  return { status: 'loaded', data: result.data }
}

function isQuotaError(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED')
  )
}

export function saveData(data: AppData, storage: KeyValueStorage | null): SaveResult {
  if (!storage) {
    return { ok: false, message: 'localStorage를 사용할 수 없어 저장하지 못했습니다.' }
  }
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(data))
    return { ok: true }
  } catch (error) {
    return {
      ok: false,
      message: isQuotaError(error)
        ? '브라우저 저장공간이 부족해 저장하지 못했습니다. JSON 백업을 내려받은 뒤 공간을 확보하세요.'
        : '데이터를 저장하지 못했습니다. 브라우저의 사이트 데이터 설정을 확인하세요.',
    }
  }
}
