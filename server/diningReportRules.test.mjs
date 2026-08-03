import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { evaluateDiningReportDateRule, getDiningReportDateRule } from './diningReportRules.js'

describe('按月报餐规则', () => {
  test('未准备月份一律不能报餐，开放例外也不能绕过', () => {
    const result = evaluateDiningReportDateRule({
      date: '2026-08-03',
      prepared: false,
      exception: { rule_type: 'permanent', target_name: '保安部' },
    })
    assert.deepEqual(result, { allowed: false, reason: '本月尚未准备报餐' })
  })

  test('已准备月份工作日可报、周末不可报，特殊日期可覆盖默认规则', () => {
    assert.equal(evaluateDiningReportDateRule({ date: '2026-08-03', prepared: true }).allowed, true)
    assert.equal(evaluateDiningReportDateRule({ date: '2026-08-01', prepared: true }).allowed, false)
    assert.equal(evaluateDiningReportDateRule({ date: '2026-08-01', prepared: true, specialRule: { report_status: 'allowed' } }).allowed, true)
    assert.equal(evaluateDiningReportDateRule({ date: '2026-08-03', prepared: true, specialRule: { report_status: 'blocked' } }).allowed, false)
  })

  test('特定设置只对已准备且不可报的日期开放', () => {
    const result = evaluateDiningReportDateRule({
      date: '2026-08-01',
      prepared: true,
      exception: { rule_type: 'temporary', target_name: '保安部' },
    })
    assert.equal(result.allowed, true)
    assert.match(result.reason, /临时开放/)
  })

  test('部门历史编码未回填时，临时开放按员工部门名称和日期匹配', async () => {
    const requests = []
    const pool = {
      request() {
        const inputs = new Map()
        const request = {
          input(name, _type, value) { inputs.set(name, value); return request },
          async query(statement) {
            requests.push({ statement, inputs })
            if (statement.includes('report_month')) return { recordset: [{ month_key: '202608' }] }
            if (statement.includes('report_block')) return { recordset: [] }
            return { recordset: [{ rule_type: 'temporary', target_name: '办公室', start_date: '2026-08-01', end_date: '2026-08-01' }] }
          },
        }
        return request
      },
    }

    const result = await getDiningReportDateRule(
      { id: 7, in_bm: '办公室', in_bm_systemcode: '' },
      '2026-08-01',
      {
        getPool: async () => pool,
        tables: {
          reportMonths: '[test].[report_month]',
          reportBlocks: '[test].[report_block]',
          reportExceptions: '[test].[report_exception]',
        },
      },
    )

    const exceptionRequest = requests.find((item) => item.statement.includes('report_exception'))
    assert.equal(exceptionRequest.inputs.get('departmentName'), '办公室')
    assert.match(exceptionRequest.statement, /target_name=@departmentName/)
    assert.equal(result.allowed, true)
    assert.match(result.reason, /临时开放/)
  })
})
