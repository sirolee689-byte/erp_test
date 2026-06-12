/**
 * 采购报价 characterization（阶段 0 行为锁）
 * POST 新增 → GET 详情 → PUT 保存 → 清理
 *
 * 需 .env：DB_*、E2E_USERCODE、E2E_PASSWORD
 * 可选：E2E_PQ_MATERIAL_KCAA01（明细物料编码，默认 BN-0001/580）
 */
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import {
  authHeaders,
  hasE2eDb,
  loginToken,
  startE2eServer,
  stopE2eServer,
} from './testHelpers/e2eServer.mjs'

const e2ePort = Number(process.env.PURCHASE_QUOTATION_E2E_PORT ?? 3015)
const materialCode = String(process.env.E2E_PQ_MATERIAL_KCAA01 ?? 'BN-0001/580').trim()

/** @type {string} */
let apiBase = ''
/** @type {string} */
let authToken = ''
/** @type {string[]} */
const cleanupDocNos = []

function todayYmd() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const da = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${da}`
}

function newTestDocNo() {
  const doc = `PQ-TDD-${Date.now()}`
  cleanupDocNos.push(doc)
  return doc
}

function buildCreatePayload(docNo) {
  const qd = todayYmd()
  return {
    header: {
      cgaa01: docNo,
      kehu: 'TDD供应商',
      remark: 'characterization test',
      cgaa05: '001',
      rmb: '人民币',
      decimal: '4',
      decimal_view: '4',
      addtime: qd,
      cgaa02: qd,
    },
    lines: [
      {
        kcaa01: materialCode,
        kcaa02: 'TDD物料',
        cgab04: 100,
        cgab05: 113,
        Tax: 13,
        remark: 'line1',
        Seq: 1,
      },
    ],
  }
}

async function hardDeletePurchaseQuotation(docNo) {
  const { getPool, sql } = await import('./db.js')
  const pool = await getPool()
  const doc = String(docNo).trim()
  await pool.request().input('doc', sql.NVarChar(200), doc).query(`
    DELETE FROM dbo.[UB_ERP_Buy_offer_list]
    WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([cgab01], N'')))) = @doc;
    DELETE FROM dbo.[UB_ERP_Buy_offer]
    WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([cgaa01], N'')))) = @doc;
  `)
}

describe('purchase quotation API characterization', { skip: !hasE2eDb }, () => {
  before(async () => {
    apiBase = await startE2eServer(e2ePort)
    authToken = await loginToken(apiBase)
  })

  after(async () => {
    for (const doc of cleanupDocNos) {
      try {
        await hardDeletePurchaseQuotation(doc)
      } catch {
        // ignore cleanup errors
      }
    }
    await stopE2eServer()
  })

  test('未登录 GET list 返回 401', async () => {
    const res = await fetch(`${apiBase}/api/supply-chain/purchase-quotations/list?page=1&pageSize=5`)
    assert.equal(res.status, 401)
  })

  test('POST 新增主从 → GET 详情字段与审计列', async () => {
    const docNo = newTestDocNo()
    const body = buildCreatePayload(docNo)

    const postRes = await fetch(`${apiBase}/api/supply-chain/purchase-quotations`, {
      method: 'POST',
      headers: authHeaders(authToken),
      body: JSON.stringify(body),
    })
    const postJson = await postRes.json().catch(() => ({}))
    assert.equal(postRes.status, 200, postJson.msg ?? postRes.status)
    assert.equal(postJson.code, 200)
    const id = postJson?.data?.id
    assert.ok(id != null && String(id).trim() !== '', '应返回新主键 id')

    const getRes = await fetch(`${apiBase}/api/supply-chain/purchase-quotations/${id}`, {
      headers: authHeaders(authToken),
    })
    const getJson = await getRes.json().catch(() => ({}))
    assert.equal(getRes.status, 200, getJson.msg ?? getRes.status)
    assert.equal(getJson.code, 200)

    const header = getJson?.data?.header ?? {}
    const lines = Array.isArray(getJson?.data?.lines) ? getJson.data.lines : []

    assert.equal(String(header.cgaa01 ?? '').trim(), docNo)
    assert.equal(String(header.pass ?? '').trim(), '0')
    assert.equal(String(header.del ?? '').trim(), '0')
    assert.ok(lines.length >= 1, '应至少一条明细')
    assert.equal(String(lines[0]?.kcaa01 ?? '').trim(), materialCode)

    if ('uid' in header) assert.ok(String(header.uid ?? '').trim() !== '', 'uid 应由服务端写入')
    if ('uname' in header) assert.ok(String(header.uname ?? '').trim() !== '', 'uname 应由服务端写入')
  })

  test('PUT 保存：明细整批替换后行数与金额更新', async () => {
    const docNo = newTestDocNo()
    const createBody = buildCreatePayload(docNo)

    const postRes = await fetch(`${apiBase}/api/supply-chain/purchase-quotations`, {
      method: 'POST',
      headers: authHeaders(authToken),
      body: JSON.stringify(createBody),
    })
    const postJson = await postRes.json().catch(() => ({}))
    assert.equal(postJson.code, 200)
    const id = postJson?.data?.id

    const putBody = {
      id,
      header: {
        ...createBody.header,
        remark: 'characterization updated',
      },
      lines: [
        {
          kcaa01: materialCode,
          kcaa02: 'TDD物料-改',
          cgab04: 200,
          cgab05: 226,
          Tax: 13,
          remark: 'line-updated',
          Seq: 1,
        },
      ],
    }

    const putRes = await fetch(`${apiBase}/api/supply-chain/purchase-quotations`, {
      method: 'PUT',
      headers: authHeaders(authToken),
      body: JSON.stringify(putBody),
    })
    const putJson = await putRes.json().catch(() => ({}))
    assert.equal(putRes.status, 200, putJson.msg ?? putRes.status)
    assert.equal(putJson.code, 200)

    const getRes = await fetch(`${apiBase}/api/supply-chain/purchase-quotations/${id}`, {
      headers: authHeaders(authToken),
    })
    const getJson = await getRes.json().catch(() => ({}))
    const header = getJson?.data?.header ?? {}
    const lines = Array.isArray(getJson?.data?.lines) ? getJson.data.lines : []

    assert.equal(String(header.remark ?? '').trim(), 'characterization updated')
    assert.equal(lines.length, 1)
    assert.equal(Number(lines[0]?.cgab04 ?? 0), 200)
    assert.equal(String(lines[0]?.kcaa02 ?? '').trim(), 'TDD物料-改')
  })
})
