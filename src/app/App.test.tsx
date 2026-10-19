import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { createBackup, serializeBackup } from '../lib/backup'
import { createAppStore } from '../lib/store'
import { STORAGE_KEY } from '../lib/storage'
import { FIXED_NOW, memoryStorage, sampleData } from '../test/fixtures'
import App from './App'

function setup(initial: Record<string, string> = {}) {
  const storage = memoryStorage(initial)
  const store = createAppStore(storage, () => FIXED_NOW)
  const user = userEvent.setup()
  render(<App store={store} />)
  return { storage, store, user }
}

function backupFile(content: string, name = 'backup.json') {
  return new File([content], name, { type: 'application/json' })
}

/** 마이페이지를 열고 탭을 고른다 (백업·복원 테스트는 '백업' 탭) */
async function openSettings(user: ReturnType<typeof userEvent.setup>, tab = '백업') {
  await user.click(screen.getByRole('button', { name: '마이페이지' }))
  await user.click(screen.getByRole('tab', { name: tab }))
}

describe('App', () => {
  it('주요 메뉴로 화면을 전환한다', async () => {
    const { user } = setup()
    expect(screen.getByRole('heading', { level: 2, name: '달력' })).toBeInTheDocument()

    await openSettings(user)

    expect(screen.getByRole('heading', { level: 2, name: '마이페이지' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '마이페이지' })).toHaveAttribute('aria-current', 'page')
  })
})

describe('데이터 백업·복원', () => {
  it('확인 후 백업 파일을 가져와 저장한다', async () => {
    const { user, store, storage } = setup()
    await openSettings(user)

    await user.upload(screen.getByLabelText('백업 파일 가져오기'), backupFile(serializeBackup(createBackup(sampleData(), FIXED_NOW))))

    const dialog = screen.getByRole('dialog', { name: '백업을 가져올까요?' })
    expect(within(dialog).getByText('일정 2건')).toBeInTheDocument()
    expect(store.getState().data.entries).toHaveLength(0)

    await user.click(within(dialog).getByRole('button', { name: '백업 없이 덮어쓰기' }))

    expect(store.getState().data.entries).toHaveLength(2)
    expect(JSON.parse(storage.items.get(STORAGE_KEY)!).entries).toHaveLength(2)
    expect(await screen.findByText('백업을 가져왔습니다.')).toBeInTheDocument()
  })

  it('가져오기를 취소하면 데이터가 바뀌지 않는다', async () => {
    const { user, store } = setup()
    await openSettings(user)

    await user.upload(screen.getByLabelText('백업 파일 가져오기'), backupFile(serializeBackup(createBackup(sampleData(), FIXED_NOW))))
    await user.click(screen.getByRole('button', { name: '취소' }))

    expect(store.getState().data.entries).toHaveLength(0)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('현재 데이터를 백업한 뒤 가져올 수 있다', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const { user, store } = setup()
    await openSettings(user)

    await user.upload(screen.getByLabelText('백업 파일 가져오기'), backupFile(serializeBackup(createBackup(sampleData(), FIXED_NOW))))
    await user.click(screen.getByRole('button', { name: '현재 데이터 백업 후 가져오기' }))

    expect(click).toHaveBeenCalledTimes(1)
    expect(store.getState().data.entries).toHaveLength(2)
    click.mockRestore()
  })

  it('잘못된 파일은 검증 오류를 보여주고 저장하지 않는다', async () => {
    const { user, storage } = setup()
    await openSettings(user)

    await user.upload(screen.getByLabelText('백업 파일 가져오기'), backupFile('{"format":"work-schedule-backup","data":{}}'))

    expect(await screen.findByRole('alert')).toHaveTextContent('백업 파일을 가져올 수 없습니다.')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(storage.items.has(STORAGE_KEY)).toBe(false)
  })

  it('확인 후 모든 데이터를 초기화한다', async () => {
    const { user, store } = setup({ [STORAGE_KEY]: JSON.stringify(sampleData()) })
    await openSettings(user)
    expect(store.getState().data.entries).toHaveLength(2)

    await user.click(screen.getByRole('button', { name: '모든 데이터 초기화' }))
    await user.click(screen.getByRole('button', { name: '백업 없이 초기화' }))

    expect(store.getState().data.entries).toHaveLength(0)
  })

  it('저장 데이터가 손상되면 복구 화면을 보여주고 원본을 보존한다', async () => {
    const { user, storage } = setup({ [STORAGE_KEY]: '{broken' })

    expect(screen.getByRole('heading', { name: '데이터 복구' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '손상된 원본 내려받기' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '달력' })).toBeDisabled()
    expect(storage.items.get(STORAGE_KEY)).toBe('{broken')

    await user.upload(screen.getByLabelText('백업 파일 가져오기'), backupFile(serializeBackup(createBackup(sampleData(), FIXED_NOW))))
    await user.click(screen.getByRole('button', { name: '백업 없이 덮어쓰기' }))

    expect(screen.getByRole('heading', { level: 2, name: '달력' })).toBeInTheDocument()
    expect(JSON.parse(storage.items.get(STORAGE_KEY)!).entries).toHaveLength(2)
  })
})
