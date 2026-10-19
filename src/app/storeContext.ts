import { createContext, useContext, useSyncExternalStore } from 'react'
import type { AppStore } from '../lib/store'

export const StoreContext = createContext<AppStore | null>(null)

export function useAppStore(): AppStore {
  const store = useContext(StoreContext)
  if (!store) throw new Error('StoreContext.Provider 안에서만 사용할 수 있습니다.')
  return store
}

/** 저장소 상태를 구독한다. 상태가 바뀌면 다시 렌더링된다. */
export function useAppState() {
  const store = useAppStore()
  return useSyncExternalStore(store.subscribe, store.getState)
}
