import { format } from 'date-fns'
import type { AppData } from './schema'
import { validateAppData, type ValidationResult } from './storage'

export const BACKUP_FORMAT = 'work-schedule-backup'
/** localStorage 한도(보통 5MB)를 넘는 파일은 저장할 수 없으므로 미리 거부한다. */
export const MAX_BACKUP_BYTES = 5 * 1024 * 1024

export interface BackupFile {
  format: typeof BACKUP_FORMAT
  exportedAt: string
  data: AppData
}

export function createBackup(data: AppData, now: Date = new Date()): BackupFile {
  return { format: BACKUP_FORMAT, exportedAt: now.toISOString(), data }
}

export function serializeBackup(backup: BackupFile): string {
  return JSON.stringify(backup, null, 2)
}

export function backupFileName(now: Date = new Date(), prefix = 'work-schedule-backup'): string {
  return `${prefix}-${format(now, 'yyyy-MM-dd-HHmm')}.json`
}

/**
 * 백업 파일 내용을 검증한다. 검증을 통과하기 전에는 아무것도 저장하지 않는다.
 * 반환값의 data는 현재 스키마 버전으로 마이그레이션된 데이터다.
 */
export function parseBackup(text: string): ValidationResult & { exportedAt?: string } {
  if (new Blob([text]).size > MAX_BACKUP_BYTES) {
    return { ok: false, errors: ['파일이 너무 큽니다. (최대 5MB)'] }
  }

  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return { ok: false, errors: ['JSON 파일 형식이 아닙니다.'] }
  }

  if (typeof json !== 'object' || json === null || (json as { format?: unknown }).format !== BACKUP_FORMAT) {
    return { ok: false, errors: ['이 앱에서 내보낸 백업 파일이 아닙니다.'] }
  }

  const { exportedAt, data } = json as { exportedAt?: unknown; data?: unknown }
  const result = validateAppData(data)
  if (!result.ok) return result
  return { ...result, exportedAt: typeof exportedAt === 'string' ? exportedAt : undefined }
}

/** 브라우저에서 텍스트 파일을 내려받게 한다. */
export function downloadTextFile(fileName: string, content: string, mimeType = 'application/json'): void {
  const url = URL.createObjectURL(new Blob([content], { type: `${mimeType};charset=utf-8` }))
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.append(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
