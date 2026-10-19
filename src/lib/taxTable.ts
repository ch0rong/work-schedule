import { z } from 'zod'
import rawTaxTable from './tax_table.json'

/**
 * 근로소득 간이세액표 데이터 (tax_table.json).
 * 국세청 엑셀을 scripts/parse_income_tax_table.py 로 변환한 파일을 불러와, 쓰기 전에 형식을 검증한다.
 */
const won = z.number().int().min(0)
const familyTaxes = z.array(won).length(11, '공제대상가족 1~11명 세액이 있어야 합니다.')

export const taxTableSchema = z
  .object({
    source: z.string(),
    sourceFile: z.string(),
    effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    note: z.string().optional(),
    /** 본표: 월급여 [min, max) 원 구간별 가족 1~11명 세액 */
    rows: z.array(z.object({ min: won, max: won, tax: familyTaxes })).min(1),
    /** 월급여 10,000,000원일 때 세액 (없으면 그 이상은 계산하지 않음) */
    at10000k: familyTaxes.optional(),
    /** 10,000,000원 초과 계산식 */
    brackets: z
      .array(z.object({ over: won, upTo: won.nullable(), fixed: won, factorPercent: z.number().min(0).max(100), ratePercent: z.number().min(0).max(100) }))
      .default([]),
    /** 8세 이상 20세 이하 자녀 공제 */
    childCredit: z.object({ one: won, two: won, perExtra: won }),
  })
  .superRefine((table, ctx) => {
    table.rows.forEach((row, index) => {
      if (row.max <= row.min) ctx.addIssue({ code: 'custom', path: ['rows', index], message: '구간의 끝이 시작보다 커야 합니다.' })
      // 오름차순·겹치지 않음 (실제 표는 빈틈없이 이어지는지 변환 스크립트와 테스트에서 따로 검사)
      const prev = table.rows[index - 1]
      if (prev && row.min < prev.max) ctx.addIssue({ code: 'custom', path: ['rows', index], message: `구간이 겹치거나 순서가 바뀌었습니다: ${prev.max} → ${row.min}` })
    })
  })

export type TaxTable = z.infer<typeof taxTableSchema>

/** 앱이 쓰는 간이세액표 (잘못된 파일이면 시작할 때 바로 오류를 낸다) */
export const TAX_TABLE: TaxTable = taxTableSchema.parse(rawTaxTable)
