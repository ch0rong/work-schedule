import { describe, expect, it, vi } from 'vitest'
import { sampleData } from '../../test/fixtures'
import { createStore } from '../store'
import { fetchUserEmail, isAllowedEmail, sha256Hex } from './auth'
import { createDriveClient, DriveAuthError, DRIVE_FILE_NAME, type DriveClient, type DriveFile } from './drive'
import { createDriveRepository } from './driveRepository'

describe('허용 이메일 확인', () => {
  it('SHA-256 16진수', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })

  it('대소문자·공백을 무시하고 해시를 비교한다', async () => {
    const hash = await sha256Hex('me@example.com')
    expect(await isAllowedEmail(' Me@Example.com ', hash)).toBe(true)
    expect(await isAllowedEmail('other@example.com', hash)).toBe(false)
  })

  it('허용 해시가 비었거나 형식이 틀리면 아무도 허용하지 않는다', async () => {
    expect(await isAllowedEmail('me@example.com', '')).toBe(false)
    expect(await isAllowedEmail('me@example.com', 'not-a-hash')).toBe(false)
  })

  it('토큰으로 이메일을 조회한다', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ email: 'me@example.com', email_verified: true })))
    expect(await fetchUserEmail('tok', fetchFn)).toEqual({ email: 'me@example.com', verified: true })
    expect(fetchFn).toHaveBeenCalledWith(expect.stringContaining('userinfo'), { headers: { Authorization: 'Bearer tok' } })
  })
})

describe('Drive 클라이언트', () => {
  it('appDataFolder에서만 찾고, 만들 때 appDataFolder를 부모로 지정한다', async () => {
    const calls: { url: string; init?: RequestInit }[] = []
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init })
      if (url.includes('uploadType=multipart')) return new Response(JSON.stringify({ id: 'f1', version: '1' }))
      return new Response(JSON.stringify({ files: [] }))
    })
    const client = createDriveClient(() => 'tok', fetchFn)

    expect(await client.findFile()).toBeNull()
    const query = new URL(calls[0].url).searchParams
    expect(query.get('spaces')).toBe('appDataFolder')
    expect(query.get('q')).toContain(DRIVE_FILE_NAME)

    expect(await client.create('{}')).toEqual({ id: 'f1', version: '1' })
    expect(String(calls[1].init?.body)).toContain('"parents":["appDataFolder"]')
    expect((calls[1].init?.headers as Record<string, string>).Authorization).toBe('Bearer tok')
  })

  it('401·403은 로그인 만료 오류로 구분한다', async () => {
    const client = createDriveClient(() => 'expired', async () => new Response('', { status: 401 }))
    await expect(client.findFile()).rejects.toBeInstanceOf(DriveAuthError)
  })
})

/** 메모리 Drive: 다른 기기의 저장을 흉내 낼 수 있다 */
function fakeDrive() {
  let file: (DriveFile & { content: string }) | null = null
  let version = 0
  const client: DriveClient = {
    findFile: async () => (file ? { id: file.id, version: file.version } : null),
    download: async () => file!.content,
    getVersion: async () => file!.version,
    create: async (content) => {
      file = { id: 'f1', version: String(++version), content }
      return { id: file.id, version: file.version }
    },
    update: async (_id, content) => {
      file = { ...file!, version: String(++version), content }
      return { id: file.id, version: file.version }
    },
  }
  return {
    client,
    otherDeviceWrites: (content: string) => (file = { ...file!, version: String(++version), content }),
    content: () => file?.content,
  }
}

describe('Drive 저장소', () => {
  it('파일이 없으면 기본 데이터로 시작하고 첫 저장에서 만든 뒤 이후에는 갱신한다', async () => {
    const drive = fakeDrive()
    const repository = createDriveRepository(drive.client)
    expect((await repository.load()).status).toBe('empty')
    expect(await repository.save(sampleData())).toEqual({ ok: true })
    expect(await repository.save(sampleData({ entries: [] }))).toEqual({ ok: true })
    expect(JSON.parse(drive.content()!).entries).toEqual([])

    const reloaded = await createDriveRepository(drive.client).load()
    expect(reloaded.status).toBe('loaded')
  })

  it('다른 기기에서 먼저 저장했으면 덮어쓰지 않고 그 데이터를 돌려준다', async () => {
    const drive = fakeDrive()
    const repository = createDriveRepository(drive.client)
    await repository.load()
    await repository.save(sampleData())
    drive.otherDeviceWrites(JSON.stringify(sampleData({ entries: [] })))

    const result = await repository.save(sampleData())
    expect(result).toMatchObject({ ok: false, reason: 'remote-changed' })
    expect(result.ok === false && result.reason === 'remote-changed' && result.remote.entries).toEqual([])
    expect(JSON.parse(drive.content()!).entries).toEqual([])
    // 받은 버전을 기준으로 다시 저장하면 성공
    expect(await repository.save(sampleData())).toEqual({ ok: true })
  })

  it('pull: 버전이 같으면 unchanged, 다른 기기가 저장하면 changed', async () => {
    const drive = fakeDrive()
    const repository = createDriveRepository(drive.client)
    await repository.load()
    await repository.save(sampleData())
    expect(await repository.pull()).toEqual({ status: 'unchanged' })
    drive.otherDeviceWrites(JSON.stringify(sampleData({ entries: [] })))
    expect(await repository.pull()).toMatchObject({ status: 'changed', data: { entries: [] } })
    expect(await repository.pull()).toEqual({ status: 'unchanged' })
  })

  it('로그인 만료는 auth 사유로 돌려준다', async () => {
    const drive = fakeDrive()
    const repository = createDriveRepository({ ...drive.client, findFile: async () => Promise.reject(new DriveAuthError('x')) })
    expect(await repository.save(sampleData())).toMatchObject({ ok: false, reason: 'auth' })
  })

  it('Drive의 데이터가 손상되었으면 invalid로 알린다', async () => {
    const drive = fakeDrive()
    await drive.client.create('{broken')
    expect((await createDriveRepository(drive.client).load()).status).toBe('invalid')
  })
})

describe('비동기 저장 store', () => {
  it('저장 중 → 저장됨, 저장 중에 또 바뀌면 최신 데이터로 한 번 더 저장', async () => {
    const saved: number[] = []
    let release: () => void = () => {}
    const persist = vi.fn(async (data: { entries: unknown[] }) => {
      await new Promise<void>((resolve) => (release = resolve))
      saved.push(data.entries.length)
      return { ok: true as const }
    })
    const store = createStore({ status: 'loaded', data: sampleData() }, persist)
    store.update((data) => ({ ...data, entries: [] }))
    expect(store.getState().syncStatus).toBe('saving')
    store.update((data) => ({ ...data, entries: sampleData().entries }))
    release()
    await vi.waitFor(() => expect(persist).toHaveBeenCalledTimes(2))
    release()
    await store.flush()
    expect(saved).toEqual([0, 2])
    expect(store.getState().syncStatus).toBe('saved')
  })

  it('다른 기기에서 먼저 저장했으면 자동으로 병합해 다시 저장한다 (알림 없음)', async () => {
    const drive = fakeDrive()
    const repoA = createDriveRepository(drive.client)
    const repoB = createDriveRepository(drive.client)
    const storeA = createStore(await repoA.load(), (data) => repoA.save(data), undefined, () => repoA.pull())
    storeA.update((data) => ({ ...data, dayNotes: { '2026-10-01': '처음' } }))
    await storeA.flush()
    const storeB = createStore(await repoB.load(), (data) => repoB.save(data), undefined, () => repoB.pull())

    // 두 기기가 서로 다른 곳을 고친다
    storeA.update((data) => ({ ...data, todos: [{ id: 'a', text: '집에서 추가', done: false, date: '2026-10-20', doneOn: null }] }))
    await storeA.flush()
    storeB.update((data) => ({ ...data, dayNotes: { ...data.dayNotes, '2026-10-02': '회사에서 추가' } }))
    await storeB.flush()
    expect(storeB.getState().syncStatus).toBe('saved')
    expect(storeB.getState().data.todos).toEqual([{ id: 'a', text: '집에서 추가', done: false, date: '2026-10-20', doneOn: null }])

    // A는 주기 확인(refresh)으로 B의 변경을 받는다
    await storeA.refresh()
    expect(storeA.getState().data.dayNotes).toEqual({ '2026-10-01': '처음', '2026-10-02': '회사에서 추가' })
    const saved = JSON.parse(drive.content()!)
    expect(saved.todos).toHaveLength(1)
    expect(saved.dayNotes).toEqual({ '2026-10-01': '처음', '2026-10-02': '회사에서 추가' })
  })

  it('refresh: 이 기기의 저장 안 된 변경은 유지하고 다른 기기 변경과 합쳐 저장한다', async () => {
    const drive = fakeDrive()
    const repo = createDriveRepository(drive.client)
    let failing = true
    const store = createStore(await repo.load(), async (data) => (failing ? { ok: false as const, message: '네트워크' } : repo.save(data)), undefined, () => repo.pull())
    await drive.client.create(JSON.stringify(sampleData({ dayNotes: { '2026-10-03': '원격' } })))
    store.update((data) => ({ ...data, todos: [{ id: 't', text: '로컬', done: true, date: '2026-10-20', doneOn: '2026-10-20' }] }))
    await store.flush()
    expect(store.getState().syncStatus).toBe('error')
    failing = false
    await store.refresh()
    await store.flush()
    expect(store.getState().data.todos).toEqual([{ id: 't', text: '로컬', done: true, date: '2026-10-20', doneOn: '2026-10-20' }])
    expect(store.getState().data.dayNotes).toEqual({ '2026-10-03': '원격' })
    expect(JSON.parse(drive.content()!).todos).toHaveLength(1)
    expect(store.getState().syncStatus).toBe('saved')
  })
})
