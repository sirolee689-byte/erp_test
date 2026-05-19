import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  buildContentDispositionAttachment,
  pickPaperPatternDownloadDisplayName,
} from './paperPatternImportFileDownload.js'

describe('paperPatternImportFileDownload', () => {
  test('pickPaperPatternDownloadDisplayName 优先 filename 时间戳', () => {
    assert.equal(
      pickPaperPatternDownloadDisplayName(
        '\\ub_bom\\upload\\20260519155801.xls',
        '20260519155801.xls',
      ),
      '20260519155801.xls',
    )
  })

  test('buildContentDispositionAttachment 含 filename*', () => {
    const h = buildContentDispositionAttachment('20260519155801.xls')
    assert.match(h, /filename\*=UTF-8''/)
    assert.match(h, /attachment/)
  })
})
