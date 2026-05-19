import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import {
  formatSystemUploadFilesizeKb,
  parseFilesizeKeywordPart,
  parseSystemUploadFilesizeBytes,
} from './paperPatternImportFilesList.js'
import {
  resolvePaperPatternDownloadAbsolutePath,
  getPaperPatternDownloadRoot,
} from './paperPatternFilePaths.js'

describe('paperPatternImportFilesList', () => {
  test('formatSystemUploadFilesizeKb', () => {
    assert.equal(formatSystemUploadFilesizeKb('185344'), '181 KB')
    assert.equal(formatSystemUploadFilesizeKb(''), '—')
    assert.equal(formatSystemUploadFilesizeKb('abc'), '—')
  })

  test('parseSystemUploadFilesizeBytes', () => {
    assert.equal(parseSystemUploadFilesizeBytes('185344'), 185344)
    assert.equal(parseSystemUploadFilesizeBytes(''), null)
  })

  test('parseFilesizeKeywordPart', () => {
    assert.deepEqual(parseFilesizeKeywordPart('181'), { mode: 'bytes', value: '181' })
    assert.deepEqual(parseFilesizeKeywordPart('670 KB'), { mode: 'kb', value: '670' })
    assert.deepEqual(parseFilesizeKeywordPart('PQ-3672'), { mode: 'none', value: '' })
  })
})

describe('resolvePaperPatternDownloadAbsolutePath', () => {
  test('basename 拼接下载根目录', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-dl-'))
    const root = path.join(tmp, 'upload')
    fs.mkdirSync(root, { recursive: true })
    const file = path.join(root, '20260518170635.xls')
    fs.writeFileSync(file, 'x')

    const prev = process.env.PAPER_PATTERN_DOWNLOAD_ROOT
    process.env.PAPER_PATTERN_DOWNLOAD_ROOT = root
    try {
      const resolved = resolvePaperPatternDownloadAbsolutePath(
        '\\ub_bom\\upload\\20260518170635.xls',
        '20260518170635.xls',
      )
      assert.equal(resolved, file)
    } finally {
      if (prev === undefined) delete process.env.PAPER_PATTERN_DOWNLOAD_ROOT
      else process.env.PAPER_PATTERN_DOWNLOAD_ROOT = prev
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })

  test('路径穿越拒绝', () => {
    const prev = process.env.PAPER_PATTERN_DOWNLOAD_ROOT
    process.env.PAPER_PATTERN_DOWNLOAD_ROOT = path.join(os.tmpdir(), 'pp-safe-root')
    try {
      assert.equal(
        resolvePaperPatternDownloadAbsolutePath('..\\..\\windows\\system.ini', ''),
        null,
      )
    } finally {
      if (prev === undefined) delete process.env.PAPER_PATTERN_DOWNLOAD_ROOT
      else process.env.PAPER_PATTERN_DOWNLOAD_ROOT = prev
    }
  })
})
