import { createDefaultData } from '../defaults'
import type { AppData } from '../schema'
import { validateAppData, type LoadResult, type SaveResult } from '../storage'
import { DriveAuthError, type DriveClient } from './drive'

/** Drive에 저장된 문서 1개를 읽고 쓴다. 다른 기기에서 먼저 저장했으면 덮어쓰지 않는다. */
export interface DriveRepository {
  load(): Promise<LoadResult>
  save(data: AppData): Promise<SaveResult>
  /** 충돌 시 사용자가 선택: 내 데이터로 덮어쓰기 */
  forceSave(data: AppData): Promise<SaveResult>
}

const AUTH_MESSAGE = '로그인이 만료되어 저장하지 못했습니다. 다시 로그인하면 이어서 저장합니다.'

export function createDriveRepository(client: DriveClient, now: () => Date = () => new Date()): DriveRepository {
  let fileId: string | null = null
  /** 마지막으로 읽거나 쓴 버전 */
  let knownVersion: string | null = null

  async function write(data: AppData, force: boolean): Promise<SaveResult> {
    try {
      const content = JSON.stringify(data)
      if (fileId === null) {
        // 처음 저장: 다른 기기가 그사이 파일을 만들었는지 확인
        const existing = await client.findFile()
        if (existing && !force) {
          fileId = existing.id
          return { ok: false, reason: 'conflict', message: '다른 기기에서 먼저 저장한 데이터가 있습니다.' }
        }
        const created = existing ? await client.update(existing.id, content) : await client.create(content)
        fileId = created.id
        knownVersion = created.version
        return { ok: true }
      }
      if (!force) {
        const remote = await client.getVersion(fileId)
        if (knownVersion !== null && remote !== knownVersion) {
          return { ok: false, reason: 'conflict', message: '다른 기기에서 데이터가 바뀌었습니다. 다시 불러오거나 내 데이터로 덮어쓰세요.' }
        }
      }
      knownVersion = (await client.update(fileId, content)).version
      return { ok: true }
    } catch (error) {
      if (error instanceof DriveAuthError) return { ok: false, reason: 'auth', message: AUTH_MESSAGE }
      return { ok: false, message: error instanceof Error ? error.message : 'Google Drive에 저장하지 못했습니다.' }
    }
  }

  return {
    async load() {
      const file = await client.findFile()
      if (!file) {
        fileId = null
        knownVersion = null
        return { status: 'empty', data: createDefaultData(now()) }
      }
      fileId = file.id
      knownVersion = file.version
      const raw = await client.download(file.id)
      let json: unknown
      try {
        json = JSON.parse(raw)
      } catch {
        return { status: 'invalid', raw, errors: ['Drive에 저장된 데이터가 올바른 JSON이 아닙니다.'] }
      }
      const result = validateAppData(json)
      return result.ok ? { status: 'loaded', data: result.data } : { status: 'invalid', raw, errors: result.errors }
    },
    save: (data) => write(data, false),
    forceSave: (data) => write(data, true),
  }
}
