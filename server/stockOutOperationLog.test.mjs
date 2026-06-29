import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  buildStockOutAuditLogPayload,
  buildStockOutDeleteLogPayload,
  buildStockOutRestoreLogPayload,
  buildStockOutSaveLogPayload,
  buildStockOutUnauditLogPayload,
  stockOutTypeLogName,
  writeStockOutOperationLog,
} from './stockOutOperationLog.js'

function mockPoolWithLogColumns(cols) {
  const calls = []
  return {
    calls,
    request() {
      const req = {
        inputs: {},
        input(name, _type, value) {
          this.inputs[name] = value
          return this
        },
        async query(sqlText) {
          calls.push({ sqlText, inputs: { ...this.inputs } })
          if (/sys\.columns/i.test(sqlText)) {
            return { recordset: cols.map((name) => ({ name })) }
          }
          return { recordset: [] }
        },
      }
      return req
    },
  }
}

describe('stockOutOperationLog', () => {
  test('出库类型日志中文映射覆盖 0 到 10，9 按旧系统写盈亏出库', () => {
    assert.equal(stockOutTypeLogName('0'), '其他出库')
    assert.equal(stockOutTypeLogName('1'), '采购退货')
    assert.equal(stockOutTypeLogName('2'), '外协领料')
    assert.equal(stockOutTypeLogName('3'), '外协退货')
    assert.equal(stockOutTypeLogName('4'), '生产领料')
    assert.equal(stockOutTypeLogName('5'), '生产返修')
    assert.equal(stockOutTypeLogName('6'), '成品出库')
    assert.equal(stockOutTypeLogName('7'), '生产领料（计划外）')
    assert.equal(stockOutTypeLogName('8'), '生产领料（补数）')
    assert.equal(stockOutTypeLogName('9'), '盈亏出库')
    assert.equal(stockOutTypeLogName('10'), '销售出库')
  })

  test('新增和修改日志使用固定操作类型，并写出库单号、出库类型、操作者', () => {
    const actor = { utruename: '张三' }
    const create = buildStockOutSaveLogPayload({ action: 'create', outboundType: '2', outboundNo: 'C26062901', actor, now: '2026-06-29 10:00:00' })
    assert.equal(create.actName, '出库单录入')
    assert.equal(create.info, '出库单录入成功,等待审核！出库单号：C26062901，出库类型：外协领料，操作时间：2026-06-29 10:00:00，操作者：张三')

    const edit = buildStockOutSaveLogPayload({ action: 'edit', outboundType: '4', outboundNo: 'C26062902', actor, now: '2026-06-29 10:01:00' })
    assert.equal(edit.actName, '出库单修改')
    assert.equal(edit.info, '出库单修改成功,等待审核！出库单号：C26062902，出库类型：生产领料，操作时间：2026-06-29 10:01:00，操作者：张三')
  })

  test('审核和反审核日志使用出库单号和出库类型，不写页面标记或出库编码', () => {
    const actor = { utruename: '超级管理员' }
    const audit = buildStockOutAuditLogPayload({
      outboundNo: 'C26062904',
      outboundType: '0',
      actor,
      now: '2026-06-29 17:26:26',
    })
    assert.deepEqual(audit, {
      actName: '申请审核',
      info: '申请通过审核！出库单号：C26062904，出库类型：其他出库，操作时间：2026-06-29 17:26:26，操作者：超级管理员',
    })

    const unaudit = buildStockOutUnauditLogPayload({
      outboundNo: 'C26062904',
      outboundType: '0',
      actor,
      now: '2026-06-29 17:28:00',
      reason: '数量修正',
    })
    assert.deepEqual(unaudit, {
      actName: '出库单反审核',
      info: '出库单反审核操作！出库单号：C26062904，出库类型：其他出库，操作时间：2026-06-29 17:28:00，操作者：超级管理员，反审原因：数量修正',
    })

    for (const payload of [audit, unaudit]) {
      assert.doesNotMatch(payload.info, /<br>/i)
      assert.doesNotMatch(payload.info, /出库编码/)
      assert.doesNotMatch(payload.info, /出库单编码/)
    }
  })

  test('删除和恢复日志保留原旧系统文案', () => {
    const actor = { utruename: '李四' }
    assert.deepEqual(
      buildStockOutDeleteLogPayload({ outboundNo: 'C26062903', actor, now: '2026-06-29 10:02:00' }),
      {
        actName: '出库单删除',
        info: '出库单删除，出库单号：C26062903，操作时间：2026-06-29 10:02:00 ,操作人：李四',
      },
    )
    assert.deepEqual(
      buildStockOutRestoreLogPayload({ systemCode: 'SYS-1', now: '2026-06-29 10:03:00' }),
      {
        actName: '被删除出库单恢复成功',
        info: '恢复成功！系统唯一编码：SYS-1出库单名称、出库单编码：SYS-1，操作时间：2026-06-29 10:03:00',
      },
    )
  })

  test('出库单日志只写旧日志表存在字段，并包含 uid/uname/utruename/code/systemcode/ip/act_name/act_info', async () => {
    const pool = mockPoolWithLogColumns(['uid', 'uname', 'utruename', 'code', 'addtime', 'systemcode', 'ip', 'act_name', 'act_info'])
    await writeStockOutOperationLog(pool, {
      actName: '申请审核',
      info: '申请通过审核！出库单号：C26062904，出库类型：其他出库，操作时间：2026-06-29 17:26:26，操作者：超级管理员',
      actor: { uid: 9, uname: 'admin', utruename: '超级管理员', ip: '127.0.0.1' },
      systemCode: 'SYS-4',
      now: '2026-06-29 17:26:26',
    })
    const insert = pool.calls.find((call) => /INSERT\s+INTO\s+dbo\.\[UB_Date_ERP_Operation_log\]/i.test(call.sqlText))
    assert.ok(insert)
    assert.match(insert.sqlText, /\[uid\]/)
    assert.match(insert.sqlText, /\[uname\]/)
    assert.match(insert.sqlText, /\[utruename\]/)
    assert.match(insert.sqlText, /\[code\]/)
    assert.match(insert.sqlText, /\[systemcode\]/)
    assert.match(insert.sqlText, /\[ip\]/)
    assert.match(insert.sqlText, /\[act_name\]/)
    assert.match(insert.sqlText, /\[act_info\]/)
    assert.equal(insert.inputs.uid, '9')
    assert.equal(insert.inputs.uname, 'admin')
    assert.equal(insert.inputs.utruename, '超级管理员')
    assert.equal(insert.inputs.code, 'UB_ERP_Stocks_out')
    assert.equal(insert.inputs.systemcode, 'SYS-4')
    assert.equal(insert.inputs.ip, '127.0.0.1')
    assert.equal(insert.inputs.act_name, '申请审核')
    assert.equal(insert.inputs.act_info, '申请通过审核！出库单号：C26062904，出库类型：其他出库，操作时间：2026-06-29 17:26:26，操作者：超级管理员')
  })
})
