import { createDefaultData } from '../defaults'
import type { AppData } from '../schema'
import { validateAppData, type LoadResult, type PullResult, type SaveResult } from '../storage'
import { DriveAuthError, type DriveClient } from './drive'

/**
 * Drive에 저장된 문서 1개를 읽고 쓴다.
 * 다른 기기에서 먼저 저장했으면 덮어쓰지 않고 그 데이터를 돌려준다(store가 병합한 뒤 다시 저장).
 */
export interface DriveRepository {
  load(): Promise<LoadResult>
  save(data: AppData): Promise<SaveResult>
  /** 다른 기기에서 저장한 새 버전이 있으면 가져온다 */
  pull(): Promise<PullResult>
}

const AUTH_MESSAGE = '로그인이 만료되어 저장하지 못했습니다. 다시 로그인하면 이어서 저장합니다.'

const errorMessage = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback)

export function createDriveRepository(client: DriveClient, now: () => Date = () => new Date()): DriveRepository {
  let fileId: string | null = null
  /** 마지막으로 읽거나 쓴 버전 */
  let knownVersion: string | null = null

  /** 최신 파일을 내려받아 검증한다. 읽은 버전을 기억한다. */
  async function download(id: string, version: string): Promise<{ ok: true; data: AppData } | { ok: false; message: string }> {
    const raw = await client.download(id)
    let json: unknown
    try {
      json = JSON.parse(raw)
    } catch {
      return { ok: false, message: 'Drive에 저장된 데이터가 올바른 JSON이 아니어서 동기화하지 못했습니다.' }
    }
    const result = validateAppData(json)
    if (!result.ok) return { ok: false, message: `Drive의 데이터를 확인하지 못해 동기화하지 못했습니다. ${result.errors.join(' ')}` }
    knownVersion = version
    return result
  }

  async function remoteChanged(id: string, version: string): Promise<SaveResult> {
    const remote = await download(id, version)
    if (!remote.ok) return remote
    return { ok: false, reason: 'remote-changed', remote: remote.data, message: '다른 기기에서 데이터가 바뀌어 합치는 중입니다.' }
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

    async save(data) {
      try {
        const content = JSON.stringify(data)
        if (fileId === null) {
          // 처음 저장: 다른 기기가 그사이 파일을 만들었는지 확인
          const existing = await client.findFile()
          if (existing) {
            fileId = existing.id
            return await remoteChanged(existing.id, existing.version)
          }
          const created = await client.create(content)
          fileId = created.id
          knownVersion = created.version
          return { ok: true }
        }
        const remote = await client.getVersion(fileId)
        if (knownVersion !== null && remote !== knownVersion) return await remoteChanged(fileId, remote)
        knownVersion = (await client.update(fileId, content)).version
        return { ok: true }
      } catch (error) {
        if (error instanceof DriveAuthError) return { ok: false, reason: 'auth', message: AUTH_MESSAGE }
        return { ok: false, message: errorMessage(error, 'Google Drive에 저장하지 못했습니다.') }
      }
    },

    async pull() {
      try {
        if (fileId === null) {
          const existing = await client.findFile()
          if (!existing) return { status: 'unchanged' }
          fileId = existing.id
          const remote = await download(existing.id, existing.version)
          return remote.ok ? { status: 'changed', data: remote.data } : { status: 'error', message: remote.message }
        }
        const version = await client.getVersion(fileId)
        if (version === knownVersion) return { status: 'unchanged' }
        const remote = await download(fileId, version)
        return remote.ok ? { status: 'changed', data: remote.data } : { status: 'error', message: remote.message }
      } catch (error) {
        if (error instanceof DriveAuthError) return { status: 'error', reason: 'auth', message: AUTH_MESSAGE }
        return { status: 'error', message: errorMessage(error, 'Google Drive에서 불러오지 못했습니다.') }
      }
    },
  }
}
