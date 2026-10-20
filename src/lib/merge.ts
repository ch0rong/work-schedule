import { appDataSchema, type AppData } from './schema'

/**
 * 3-way 자동 병합 (서버 없이 여러 기기에서 같은 문서를 고칠 때).
 * base: 마지막으로 Drive와 같았던 데이터, local: 이 기기의 현재 데이터, remote: Drive의 최신 데이터.
 * - 한쪽만 바꾼 값은 바꾼 쪽을 쓴다. 객체는 키별로, id가 있는 배열(일정·할 일 등)은 항목별로 합친다.
 * - 양쪽이 같은 값을 다르게 바꿨으면 이 기기(local)를 쓴다 (나중에 저장하는 쪽 우선).
 * - 한쪽에서 지우고 다른 쪽에서 고친 항목은 고친 내용을 남긴다 (데이터 보존).
 */

type Json = unknown
type Keyed = { id: string }

const isObject = (value: Json): value is Record<string, Json> => typeof value === 'object' && value !== null && !Array.isArray(value)
const isKeyedArray = (value: Json): value is Keyed[] =>
  Array.isArray(value) && value.every((item) => isObject(item) && typeof item.id === 'string')

export function deepEqual(a: Json, b: Json): boolean {
  if (a === b) return true
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((item, index) => deepEqual(item, b[index]))
  if (isObject(a)) {
    if (!isObject(b)) return false
    const keys = Object.keys(a)
    return keys.length === Object.keys(b).length && keys.every((key) => key in b && deepEqual(a[key], b[key]))
  }
  return false
}

/** 공통 항목의 순서가 base와 다른지 (순서를 바꾼 쪽을 찾는다) */
function reordered(base: string[], side: string[]): boolean {
  const common = new Set(side)
  const before = base.filter((id) => common.has(id))
  const inBase = new Set(base)
  const after = side.filter((id) => inBase.has(id))
  return before.some((id, index) => after[index] !== id)
}

/** 한쪽에만 남은 항목: 다른 쪽이 지웠는데 이쪽은 그대로면 지우고, 고쳤거나 새로 만들었으면 남긴다 */
function keepOneSided(baseValue: Json | undefined, value: Json): boolean {
  return baseValue === undefined || !deepEqual(baseValue, value)
}

function mergeKeyedArrays(base: Keyed[], local: Keyed[], remote: Keyed[]): Keyed[] {
  const baseById = new Map(base.map((item) => [item.id, item]))
  const localById = new Map(local.map((item) => [item.id, item]))
  const remoteById = new Map(remote.map((item) => [item.id, item]))
  const baseIds = base.map((item) => item.id)
  const localIds = local.map((item) => item.id)
  const remoteIds = remote.map((item) => item.id)

  const merged = new Map<string, Keyed>()
  for (const id of new Set([...localIds, ...remoteIds])) {
    const b = baseById.get(id)
    const l = localById.get(id)
    const r = remoteById.get(id)
    if (l && r) merged.set(id, merge3(b, l, r) as Keyed)
    else if (l && keepOneSided(b, l)) merged.set(id, l)
    else if (r && keepOneSided(b, r)) merged.set(id, r)
  }

  // 순서: 이 기기에서 순서를 바꿨으면 이 기기 순서, 아니면 Drive 순서. 다른 쪽에만 있는 항목은 그쪽의 앞 항목 뒤에 끼운다.
  const useLocalOrder = reordered(baseIds, localIds) || !reordered(baseIds, remoteIds)
  const [primary, secondary] = useLocalOrder ? [localIds, remoteIds] : [remoteIds, localIds]
  const order = primary.filter((id) => merged.has(id))
  secondary.forEach((id, index) => {
    if (!merged.has(id) || order.includes(id)) return
    const previous = secondary
      .slice(0, index)
      .reverse()
      .find((other) => order.includes(other))
    order.splice(previous === undefined ? 0 : order.indexOf(previous) + 1, 0, id)
  })
  return order.map((id) => merged.get(id)!)
}

function mergeObjects(base: Record<string, Json>, local: Record<string, Json>, remote: Record<string, Json>): Record<string, Json> {
  const result: Record<string, Json> = {}
  for (const key of new Set([...Object.keys(local), ...Object.keys(remote)])) {
    const inLocal = key in local
    const inRemote = key in remote
    if (inLocal && inRemote) result[key] = merge3(base[key], local[key], remote[key])
    else if (inLocal && keepOneSided(base[key], local[key])) result[key] = local[key]
    else if (inRemote && keepOneSided(base[key], remote[key])) result[key] = remote[key]
  }
  return result
}

export function merge3(base: Json | undefined, local: Json, remote: Json): Json {
  if (deepEqual(local, remote)) return local
  if (base !== undefined && deepEqual(base, local)) return remote
  if (base !== undefined && deepEqual(base, remote)) return local
  if (isObject(local) && isObject(remote)) return mergeObjects(isObject(base) ? base : {}, local, remote)
  if (isKeyedArray(local) && isKeyedArray(remote)) return mergeKeyedArrays(isKeyedArray(base) ? base : [], local, remote)
  return local
}

/**
 * 전체 문서를 병합한다. 바뀐 게 없으면 원래 객체를 그대로 돌려준다(참조 비교로 저장 여부를 판단).
 * 병합 결과가 검증에 실패하면(예: 지운 근무 유형을 다른 기기의 일정이 참조) 이 기기 데이터를 쓴다.
 */
export function mergeAppData(base: AppData, local: AppData, remote: AppData): AppData {
  const merged = merge3(base, local, remote)
  if (merged === remote || deepEqual(merged, remote)) return remote
  if (merged === local) return local
  const parsed = appDataSchema.safeParse(merged)
  return parsed.success ? parsed.data : local
}
