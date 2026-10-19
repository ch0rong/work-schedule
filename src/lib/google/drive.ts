import type { FetchFn } from './auth'

/**
 * Google Drive appDataFolder 클라이언트.
 * appDataFolder는 이 앱(OAuth 클라이언트)과 로그인 계정 전용 숨김 폴더로, 사용자의 다른 Drive 파일에는 접근하지 않는다.
 */
export const DRIVE_FILE_NAME = 'work-schedule-data.json'
const API = 'https://www.googleapis.com/drive/v3/files'
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files'

/** 로그인이 만료되었거나 권한이 없음 */
export class DriveAuthError extends Error {}

export interface DriveFile {
  id: string
  /** 파일이 바뀔 때마다 증가하는 버전 (충돌 확인용) */
  version: string
}

export interface DriveClient {
  findFile(): Promise<DriveFile | null>
  download(fileId: string): Promise<string>
  getVersion(fileId: string): Promise<string>
  create(content: string): Promise<DriveFile>
  update(fileId: string, content: string): Promise<DriveFile>
}

export function createDriveClient(getToken: () => string, fetchFn: FetchFn = fetch): DriveClient {
  async function call(url: string, init: RequestInit = {}): Promise<Response> {
    const response = await fetchFn(url, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${getToken()}` } })
    if (response.status === 401 || response.status === 403) throw new DriveAuthError('로그인이 만료되었거나 권한이 없습니다.')
    if (!response.ok) throw new Error(`Google Drive 요청이 실패했습니다. (${response.status})`)
    return response
  }

  const fileFrom = (body: { id?: unknown; version?: unknown }): DriveFile => {
    if (typeof body.id !== 'string') throw new Error('Google Drive 응답이 올바르지 않습니다.')
    return { id: body.id, version: String(body.version ?? '') }
  }

  return {
    async findFile() {
      const query = new URLSearchParams({
        spaces: 'appDataFolder',
        q: `name = '${DRIVE_FILE_NAME}' and trashed = false`,
        fields: 'files(id, version)',
        pageSize: '10',
      })
      const body = (await (await call(`${API}?${query}`)).json()) as { files?: { id: string; version: string }[] }
      const file = body.files?.[0]
      return file ? fileFrom(file) : null
    },
    async download(fileId) {
      return (await call(`${API}/${encodeURIComponent(fileId)}?alt=media`)).text()
    },
    async getVersion(fileId) {
      const body = (await (await call(`${API}/${encodeURIComponent(fileId)}?fields=version`)).json()) as { version?: unknown }
      return String(body.version ?? '')
    },
    async create(content) {
      const boundary = `ws-${crypto.randomUUID()}`
      const metadata = JSON.stringify({ name: DRIVE_FILE_NAME, parents: ['appDataFolder'], mimeType: 'application/json' })
      const body = [
        `--${boundary}`,
        'Content-Type: application/json; charset=UTF-8',
        '',
        metadata,
        `--${boundary}`,
        'Content-Type: application/json; charset=UTF-8',
        '',
        content,
        `--${boundary}--`,
        '',
      ].join('\r\n')
      const response = await call(`${UPLOAD}?uploadType=multipart&fields=id,version`, {
        method: 'POST',
        headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
        body,
      })
      return fileFrom(await response.json())
    },
    async update(fileId, content) {
      const response = await call(`${UPLOAD}/${encodeURIComponent(fileId)}?uploadType=media&fields=id,version`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json; charset=UTF-8' },
        body: content,
      })
      return fileFrom(await response.json())
    },
  }
}
