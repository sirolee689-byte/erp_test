import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  buildSystemPrintLogoSql,
  fetchSystemPrintLogoConfig,
  resolvePrintLogoSrc,
} from './systemPrintLogo.js'

describe('system print logo config', () => {
  test('pure image path is used as logo src', () => {
    assert.equal(resolvePrintLogoSrc('/system-kernel-images/a.png'), '/system-kernel-images/a.png')
  })

  test('old img tag logo extracts src value', () => {
    assert.equal(resolvePrintLogoSrc('<img src="/system-kernel-images/a.png" />'), '/system-kernel-images/a.png')
  })

  test('empty or non-image tag logo resolves to empty string', () => {
    assert.equal(resolvePrintLogoSrc(''), '')
    assert.equal(resolvePrintLogoSrc('<span>logo</span>'), '')
  })

  test('logo SQL reads first UB_ERP_System_Head row', () => {
    const sqlText = buildSystemPrintLogoSql()
    assert.match(sqlText, /UB_ERP_System_Head/i)
    assert.match(sqlText, /SELECT TOP \(1\)\s+logo,\s+info/is)
    assert.match(sqlText, /ORDER BY id ASC/i)
  })

  test('fetchSystemPrintLogoConfig returns resolved logo src', async () => {
    const pool = {
      request() {
        return {
          async query() {
            return { recordset: [{ logo: '<img src="/system-kernel-images/a.png" />', info: '<p>打印抬头</p>' }] }
          },
        }
      },
    }
    assert.deepEqual(await fetchSystemPrintLogoConfig(pool), {
      logoSrc: '/system-kernel-images/a.png',
      headerHtml: '<p>打印抬头</p>',
      info: '<p>打印抬头</p>',
    })
  })
})
