import test from 'node:test'
import assert from 'node:assert/strict'
import {
  getActorAuditTripletFromReq,
  getActorAuditFromReq,
} from './businessAuditFields.js'

test('getActorAuditTripletFromReq 使用 auditUserName 与 auditTruename', () => {
  const req = {
    user: {
      userId: 7,
      userCode: '7001',
      auditUserName: 'zhang.san',
      auditTruename: '张三',
      userName: '张三（人事显示）',
    },
  }
  const tri = getActorAuditTripletFromReq(req)
  assert.equal(tri.uidInt, 7)
  assert.equal(tri.uname, 'zhang.san')
  assert.equal(tri.utruename, '张三')
})

test('getActorAuditTripletFromReq 无 audit 字段时 uname 回退 usercode', () => {
  const tri = getActorAuditTripletFromReq({
    user: { userId: 1, userCode: 'u01', userName: '显示名' },
  })
  assert.equal(tri.uname, 'u01')
  assert.equal(tri.utruename, null)
})

test('getActorAuditFromReq uname 优先 auditUserName', () => {
  const { uname } = getActorAuditFromReq({
    user: { userId: 1, userCode: 'u01', auditUserName: 'login.name' },
  })
  assert.equal(uname, 'login.name')
})
