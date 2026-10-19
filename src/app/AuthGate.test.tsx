import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { sha256Hex, type GoogleAuth } from '../lib/google/auth'
import type { DriveRepository } from '../lib/google/driveRepository'
import type { AppData } from '../lib/schema'
import { sampleData } from '../test/fixtures'
import { AuthGate } from './AuthGate'

const ALLOWED = 'me@example.com'

function fakeAuth() {
  return {
    requestToken: vi.fn(async () => ({ value: 'token-1', expiresAt: Date.now() + 3600_000 })),
    revoke: vi.fn(async () => {}),
  } satisfies GoogleAuth
}

function fakeRepository(initial: AppData | null) {
  let stored = initial
  const repository: DriveRepository = {
    load: vi.fn(async () => (stored ? { status: 'loaded' as const, data: stored } : { status: 'empty' as const, data: sampleData({ entries: [] }) })),
    save: vi.fn(async (data: AppData) => {
      stored = data
      return { ok: true as const }
    }),
    forceSave: vi.fn(async () => ({ ok: true as const })),
  }
  return repository
}

async function setup({ email = ALLOWED, data = sampleData() as AppData | null } = {}) {
  const auth = fakeAuth()
  const repository = fakeRepository(data)
  const createRepository = vi.fn(() => repository)
  render(
    <AuthGate
      auth={auth}
      allowedEmailHash={await sha256Hex(ALLOWED)}
      fetchEmail={async () => ({ email, verified: true })}
      createRepository={createRepository}
    />,
  )
  return { auth, repository, createRepository, user: userEvent.setup() }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('로그인 게이트', () => {
  it('로그인 전에는 앱 화면도, 데이터 불러오기도 없다', async () => {
    const { createRepository } = await setup()
    expect(screen.getByRole('button', { name: 'Google 계정으로 로그인' })).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: '주요 메뉴' })).not.toBeInTheDocument()
    expect(createRepository).not.toHaveBeenCalled()
  })

  it('허용된 계정이면 Drive에서 데이터를 불러와 앱을 보여준다', async () => {
    const { user, repository } = await setup()
    await user.click(screen.getByRole('button', { name: 'Google 계정으로 로그인' }))
    expect(await screen.findByRole('navigation', { name: '주요 메뉴' })).toBeInTheDocument()
    expect(screen.getByText(ALLOWED)).toBeInTheDocument()
    expect(repository.load).toHaveBeenCalledTimes(1)
  })

  it('다른 계정은 토큰을 폐기하고 화면·데이터에 접근할 수 없다', async () => {
    const { user, auth, createRepository } = await setup({ email: 'intruder@example.com' })
    await user.click(screen.getByRole('button', { name: 'Google 계정으로 로그인' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('intruder@example.com 계정은 이 서비스에 접근할 수 없습니다')
    expect(auth.revoke).toHaveBeenCalledWith('token-1')
    expect(createRepository).not.toHaveBeenCalled()
    expect(screen.queryByRole('navigation', { name: '주요 메뉴' })).not.toBeInTheDocument()
  })

  it('변경은 Drive 저장소로 저장되고, 로그아웃하면 토큰을 폐기하고 로그인 화면으로 돌아간다', async () => {
    const { user, auth, repository } = await setup()
    await user.click(screen.getByRole('button', { name: 'Google 계정으로 로그인' }))
    await screen.findByRole('navigation', { name: '주요 메뉴' })

    await user.click(screen.getByRole('button', { name: '로그아웃' }))
    const dialog = screen.getByRole('dialog', { name: '로그아웃할까요?' })
    await user.click(within(dialog).getByRole('button', { name: '로그아웃' }))

    expect(await screen.findByText('로그아웃했습니다.')).toBeInTheDocument()
    expect(auth.revoke).toHaveBeenCalledWith('token-1')
    expect(screen.queryByRole('navigation', { name: '주요 메뉴' })).not.toBeInTheDocument()
    expect(repository.save).not.toHaveBeenCalled() // 변경하지 않았으면 저장도 없음
  })

  it('설정한 시간 동안 사용하지 않으면 자동 로그아웃한다', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const data = sampleData()
    data.settings.session.idleLogoutMinutes = 5
    const { auth } = await setup({ data })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await user.click(screen.getByRole('button', { name: 'Google 계정으로 로그인' }))
    await screen.findByRole('navigation', { name: '주요 메뉴' })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4 * 60_000)
    })
    expect(screen.getByRole('navigation', { name: '주요 메뉴' })).toBeInTheDocument() // 아직 5분 전
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2 * 60_000)
    })
    expect(await screen.findByText('오랫동안 사용하지 않아 자동으로 로그아웃했습니다.')).toBeInTheDocument()
    expect(auth.revoke).toHaveBeenCalled()
  })

  it('로그인 창을 닫으면 오류를 보여주고 로그인 화면에 머문다', async () => {
    const { user, auth } = await setup()
    auth.requestToken.mockRejectedValueOnce(new Error('로그인 창이 닫혔습니다.'))
    await user.click(screen.getByRole('button', { name: 'Google 계정으로 로그인' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('로그인 창이 닫혔습니다.')
  })
})
