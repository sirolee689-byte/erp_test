import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import {
  buildPaperPatternSystemUploadFilepath,
  extractProjectNameFromTruefilename,
  formatPaperPatternStoredFilename,
  pickPaperPatternArchiveFilename,
} from './paperPatternSystemUploadFile.js'

describe('paperPatternSystemUploadFile', () => {
  test('formatPaperPatternStoredFilename 正式导入时刻', () => {
    const d = new Date(2026, 4, 19, 15, 45, 22)
    assert.equal(formatPaperPatternStoredFilename(d, '.xls'), '20260519154522.xls')
    assert.equal(formatPaperPatternStoredFilename(d, 'xlsx'), '20260519154522.xlsx')
  })

  test('buildPaperPatternSystemUploadFilepath', () => {
    assert.equal(
      buildPaperPatternSystemUploadFilepath('20260519154522.xls'),
      '\\ub_bom\\upload\\20260519154522.xls',
    )
  })

  test('extractProjectNameFromTruefilename', () => {
    assert.equal(extractProjectNameFromTruefilename('PQ-3672A1-TEST.xls'), 'PQ3672A1TEST')
    assert.equal(extractProjectNameFromTruefilename('PQ-3672A1-TEST'), 'PQ3672A1TEST')
  })

  test('pickPaperPatternArchiveFilename 避让已存在文件', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-arch-'))
    const uploadDir = path.join(tmp, 'upload')
    fs.mkdirSync(uploadDir, { recursive: true })
    const prev = process.env.PAPER_PATTERN_UPLOAD_DIR
    process.env.PAPER_PATTERN_UPLOAD_DIR = uploadDir
    try {
      const d = new Date(2026, 4, 19, 15, 45, 22)
      const first = formatPaperPatternStoredFilename(d, '.xls')
      fs.writeFileSync(path.join(uploadDir, first), 'x')
      const picked = pickPaperPatternArchiveFilename(d, '.xls')
      assert.equal(picked.filename, '20260519154523.xls')
    } finally {
      if (prev === undefined) delete process.env.PAPER_PATTERN_UPLOAD_DIR
      else process.env.PAPER_PATTERN_UPLOAD_DIR = prev
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })
})
