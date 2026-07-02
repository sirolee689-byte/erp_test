<template>
  <div class="erp-module-page stock-stats-page">
    <el-card shadow="never" class="toolbar-card no-print">
      <div class="action-strip">
        <el-button v-permission="'add'" type="primary" @click="openGenerateDialog">
          库存统计报表生成
        </el-button>
        <el-button disabled title="下期开发">库存统计报表生成（材料分类）</el-button>
        <el-button disabled title="下期开发">扣数表</el-button>
        <el-button disabled title="下期开发">超订量统计</el-button>
      </div>
    </el-card>

    <el-card shadow="never" class="search-card no-print">
      <div class="search-row">
        <span class="search-label">历史记录</span>
        <el-button type="primary" :loading="historyLoading" @click="loadHistory">查询</el-button>
        <el-button @click="resetHistory">重置</el-button>
      </div>
    </el-card>

    <el-card shadow="never" class="table-card no-print">
      <el-table
        v-loading="historyLoading"
        :data="historyList"
        stripe
        border
        highlight-current-row
        @current-change="onPickSnapshot"
      >
        <el-table-column label="操作" width="160" fixed="left">
          <template #default="{ row }">
            <el-button v-permission="'view'" size="small" type="primary" link @click="openDetail(row)">
              查看明细
            </el-button>
            <el-button
              v-permission="'delete'"
              size="small"
              type="danger"
              link
              :loading="row.__deleting"
              @click="removeSnapshot(row)"
            >
              删除
            </el-button>
          </template>
        </el-table-column>
        <el-table-column label="生成时间" prop="generatedAt" width="170" />
        <el-table-column label="统计区间" width="200">
          <template #default="{ row }">{{ row.startDate }} ~ {{ row.endDate }}</template>
        </el-table-column>
        <el-table-column label="仓库" min-width="160">
          <template #default="{ row }">{{ formatWarehouse(row) }}</template>
        </el-table-column>
        <el-table-column label="物料条件" prop="materialFilter" min-width="120">
          <template #default="{ row }">{{ row.materialFilter || '全部' }}</template>
        </el-table-column>
        <el-table-column label="行数" prop="rowCount" width="80" align="right" />
        <el-table-column label="生成人" prop="generatedBy" width="120" />
      </el-table>
      <div class="pager-row">
        <el-pagination
          v-model:current-page="historyPage"
          v-model:page-size="historyPageSize"
          :total="historyTotal"
          :page-sizes="[10, 20, 50, 100]"
          layout="total, sizes, prev, pager, next"
          @current-change="loadHistory"
          @size-change="onHistorySizeChange"
        />
      </div>
    </el-card>

    <el-card v-if="activeSnapshot" shadow="never" class="detail-card">
      <template #header>
        <div class="detail-head no-print">
          <span class="detail-title">统计明细</span>
          <span class="detail-meta muted">
            {{ activeSnapshot.startDate }} ~ {{ activeSnapshot.endDate }} ·
            {{ formatWarehouse(activeSnapshot) }} · 共 {{ detailTotal }} 行
          </span>
          <div class="detail-actions">
            <el-input
              v-model="detailKeyword"
              clearable
              class="detail-kw"
              placeholder="编码/名称筛选"
              @keyup.enter="loadDetailLines"
            />
            <el-button type="primary" :loading="detailLoading" @click="loadDetailLines">筛选</el-button>
            <el-button v-permission="'view'" :disabled="!detailLines.length" @click="exportExcel">导出 Excel</el-button>
            <el-button v-permission="'view'" :disabled="!detailLines.length" @click="exportPdf">导出 PDF</el-button>
            <el-button v-permission="'view'" :disabled="!detailLines.length" @click="onPrint">打印</el-button>
          </div>
        </div>
      </template>

      <div id="stock-stats-print-area" class="print-area">
        <header class="print-header-block">
          <div v-if="printLogoSrc" class="print-logo-wrap">
            <img class="print-logo" :src="printLogoSrc" alt="logo" @error="printLogoSrc = ''" />
          </div>
          <div class="print-head-text">
            <h1 class="print-company">{{ printConfig.qyname || '库存统计报表' }}</h1>
            <h2 class="print-title">库存统计报表</h2>
            <div class="print-meta">
              统计区间：{{ activeSnapshot.startDate }} ~ {{ activeSnapshot.endDate }}　
              仓库：{{ formatWarehouse(activeSnapshot) }}　
              物料：{{ activeSnapshot.materialFilter || '全部' }}　
              生成时间：{{ activeSnapshot.generatedAt }}
            </div>
          </div>
        </header>

        <div class="report-table-wrap">
          <table class="report-table">
            <thead>
              <tr>
                <th>序号</th>
                <th>物料编码</th>
                <th>名称</th>
                <th>规格</th>
                <th>单位</th>
                <th>期初数量</th>
                <th>期初单价</th>
                <th>期初金额</th>
                <th>本期入库数量</th>
                <th>本期入库单价</th>
                <th>本期入库金额</th>
                <th>本期出库数量</th>
                <th>本期出库单价</th>
                <th>本期出库金额</th>
                <th>报损数量</th>
                <th>报损单价</th>
                <th>报损金额</th>
                <th>调整差额数量</th>
                <th>调整金额</th>
                <th>结存数量</th>
                <th>结存单价</th>
                <th>结存金额</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, idx) in detailLines" :key="row.id ?? idx">
                <td>{{ (detailPage - 1) * detailPageSize + idx + 1 }}</td>
                <td>{{ row.kcaa01 }}</td>
                <td>{{ row.kcaa02 }}</td>
                <td>{{ row.kcaa03 }}</td>
                <td>{{ row.kcaa04 }}</td>
                <td class="num">{{ fmtQty(row.lastsum) }}</td>
                <td class="num">{{ fmtPrice(row.lastprice) }}</td>
                <td class="num">{{ fmtMoney(row.lastmoney) }}</td>
                <td class="num">{{ fmtQty(row.nowin) }}</td>
                <td class="num">{{ fmtPrice(row.nowinprice) }}</td>
                <td class="num">{{ fmtMoney(row.nowmoney) }}</td>
                <td class="num">{{ fmtQty(row.nowout) }}</td>
                <td class="num">{{ fmtPrice(row.nowoutprice) }}</td>
                <td class="num">{{ fmtMoney(row.nowoutmoney) }}</td>
                <td class="num">{{ fmtQty(row.nowbs) }}</td>
                <td class="num">{{ fmtPrice(row.nowbsprice) }}</td>
                <td class="num">{{ fmtMoney(row.nowbsmonney) }}</td>
                <td class="num">{{ fmtQty(row.hzkcm) }}</td>
                <td class="num">{{ fmtMoney(row.hzmoney) }}</td>
                <td class="num">{{ fmtQty(row.nowsum) }}</td>
                <td class="num">{{ fmtPrice(row.nowprice) }}</td>
                <td class="num">{{ fmtMoney(row.nowmoneys) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="pager-row no-print">
        <el-pagination
          v-model:current-page="detailPage"
          v-model:page-size="detailPageSize"
          :total="detailTotal"
          :page-sizes="[10, 20, 50, 100]"
          layout="total, sizes, prev, pager, next"
          @current-change="loadDetailLines"
          @size-change="onDetailSizeChange"
        />
      </div>
    </el-card>

    <el-dialog v-model="generateVisible" title="库存统计报表生成" width="520px" destroy-on-close>
      <el-form label-width="100px">
        <el-form-item label="开始日期" required>
          <el-date-picker v-model="generateForm.startDate" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
        </el-form-item>
        <el-form-item label="结束日期" required>
          <el-date-picker v-model="generateForm.endDate" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
        </el-form-item>
        <el-form-item label="仓库" required>
          <el-select
            v-model="generateForm.warehouseCode"
            filterable
            remote
            :remote-method="loadWarehouses"
            :loading="warehouseLoading"
            placeholder="请选择仓库"
            style="width: 100%"
          >
            <el-option
              v-for="w in warehouseOptions"
              :key="w.code"
              :label="`${w.code} ${w.name}`"
              :value="w.code"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="物料编码">
          <el-input v-model="generateForm.materialFilter" clearable placeholder="可选，按编码前缀筛选" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="generateVisible = false">取消</el-button>
        <el-button type="primary" :loading="generating" @click="submitGenerate">生成</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue'
import axios from 'axios'
import ExcelJS from 'exceljs'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  formatErpMoneyDisplay,
  formatErpPriceDisplay,
  formatErpQtyDisplay,
} from '@/utils/erpNumberDisplay.js'

defineOptions({ name: 'InventoryAnalysisStockStats' })

const historyList = ref([])
const historyLoading = ref(false)
const historyPage = ref(1)
const historyPageSize = ref(20)
const historyTotal = ref(0)

const activeSnapshot = ref(null)
const detailLines = ref([])
const detailLoading = ref(false)
const detailPage = ref(1)
const detailPageSize = ref(20)
const detailTotal = ref(0)
const detailKeyword = ref('')

const generateVisible = ref(false)
const generating = ref(false)
const generateForm = reactive({
  startDate: '',
  endDate: '',
  warehouseCode: '',
  materialFilter: '',
})

const warehouseOptions = ref([])
const warehouseLoading = ref(false)

const printConfig = reactive({ qyname: '', title: '', address: '' })
const printLogoSrc = ref('')

const EXPORT_COLUMNS = [
  ['序号', null],
  ['物料编码', 'kcaa01'],
  ['名称', 'kcaa02'],
  ['规格', 'kcaa03'],
  ['单位', 'kcaa04'],
  ['期初数量', 'lastsum', 'qty'],
  ['期初单价', 'lastprice', 'price'],
  ['期初金额', 'lastmoney', 'money'],
  ['本期入库数量', 'nowin', 'qty'],
  ['本期入库单价', 'nowinprice', 'price'],
  ['本期入库金额', 'nowmoney', 'money'],
  ['本期出库数量', 'nowout', 'qty'],
  ['本期出库单价', 'nowoutprice', 'price'],
  ['本期出库金额', 'nowoutmoney', 'money'],
  ['报损数量', 'nowbs', 'qty'],
  ['报损单价', 'nowbsprice', 'price'],
  ['报损金额', 'nowbsmonney', 'money'],
  ['调整差额数量', 'hzkcm', 'qty'],
  ['调整金额', 'hzmoney', 'money'],
  ['结存数量', 'nowsum', 'qty'],
  ['结存单价', 'nowprice', 'price'],
  ['结存金额', 'nowmoneys', 'money'],
]

function fmtQty(v) {
  return formatErpQtyDisplay(v)
}
function fmtPrice(v) {
  return formatErpPriceDisplay(v)
}
function fmtMoney(v) {
  return formatErpMoneyDisplay(v)
}

function formatCellValue(row, col) {
  const [, key, kind] = col
  if (!key) return ''
  const v = row[key]
  if (kind === 'qty') return fmtQty(v)
  if (kind === 'price') return fmtPrice(v)
  if (kind === 'money') return fmtMoney(v)
  return v ?? ''
}

function formatWarehouse(row) {
  const code = String(row?.warehouseCode ?? '').trim()
  const name = String(row?.warehouseName ?? '').trim()
  if (code && name) return `${code} ${name}`
  return code || name || '—'
}

async function loadPrintConfig() {
  try {
    const { data } = await axios.get('/api/stock-stats/print-header')
    const cfg = data?.data ?? {}
    printConfig.qyname = cfg.qyname || ''
    printConfig.title = cfg.title || ''
    printConfig.address = cfg.address || ''
    printLogoSrc.value = cfg.logoSrc || ''
  } catch {
    /* 抬头读取失败不阻断主流程 */
  }
}

async function loadWarehouses(keyword = '') {
  warehouseLoading.value = true
  try {
    const { data } = await axios.get('/api/stock-stats/warehouse-options', { params: { keyword } })
    warehouseOptions.value = data?.data?.list ?? []
  } catch (err) {
    ElMessage.error(err?.response?.data?.msg || '读取仓库失败')
  } finally {
    warehouseLoading.value = false
  }
}

function openGenerateDialog() {
  generateVisible.value = true
  if (!warehouseOptions.value.length) loadWarehouses()
}

async function submitGenerate() {
  if (!generateForm.startDate || !generateForm.endDate) {
    ElMessage.warning('请填写开始日期和结束日期')
    return
  }
  if (!generateForm.warehouseCode) {
    ElMessage.warning('请选择仓库')
    return
  }
  generating.value = true
  try {
    const { data } = await axios.post('/api/stock-stats/generate', { ...generateForm })
    const elapsed = data?.data?.elapsedMs
    ElMessage.success(
      `生成成功，共 ${data?.data?.rowCount ?? 0} 行${elapsed != null ? `（耗时 ${Math.round(elapsed / 1000)} 秒）` : ''}`,
    )
    generateVisible.value = false
    await loadHistory()
    const hit = historyList.value.find((x) => x.id === data?.data?.snapshotId)
    if (hit) openDetail(hit)
  } catch (err) {
    ElMessage.error(err?.response?.data?.msg || '生成失败')
  } finally {
    generating.value = false
  }
}

async function loadHistory() {
  historyLoading.value = true
  try {
    const { data } = await axios.get('/api/stock-stats/snapshots', {
      params: { page: historyPage.value, pageSize: historyPageSize.value },
    })
    historyList.value = data?.data?.list ?? []
    historyTotal.value = Number(data?.data?.total ?? 0)
  } catch (err) {
    ElMessage.error(err?.response?.data?.msg || '读取历史失败')
  } finally {
    historyLoading.value = false
  }
}

function resetHistory() {
  historyPage.value = 1
  loadHistory()
}

function onHistorySizeChange() {
  historyPage.value = 1
  loadHistory()
}

function onPickSnapshot(row) {
  if (row) activeSnapshot.value = row
}

async function openDetail(row) {
  activeSnapshot.value = row
  detailPage.value = 1
  detailKeyword.value = ''
  await loadDetailLines()
}

async function loadDetailLines() {
  if (!activeSnapshot.value?.id) return
  detailLoading.value = true
  try {
    const { data } = await axios.get(`/api/stock-stats/snapshots/${activeSnapshot.value.id}/lines`, {
      params: {
        page: detailPage.value,
        pageSize: detailPageSize.value,
        keyword: detailKeyword.value || undefined,
      },
    })
    const payload = data?.data ?? {}
    if (payload.header) activeSnapshot.value = { ...activeSnapshot.value, ...payload.header }
    detailLines.value = payload.list ?? []
    detailTotal.value = Number(payload.total ?? 0)
  } catch (err) {
    ElMessage.error(err?.response?.data?.msg || '读取明细失败')
  } finally {
    detailLoading.value = false
  }
}

function onDetailSizeChange() {
  detailPage.value = 1
  loadDetailLines()
}

async function fetchAllDetailLines() {
  if (!activeSnapshot.value?.id) return []
  const pageSize = Math.min(10000, Math.max(detailTotal.value, detailPageSize.value))
  const { data } = await axios.get(`/api/stock-stats/snapshots/${activeSnapshot.value.id}/lines`, {
    params: { page: 1, pageSize, keyword: detailKeyword.value || undefined },
  })
  return data?.data?.list ?? []
}

async function exportExcel() {
  const rows = detailTotal.value > detailLines.value.length ? await fetchAllDetailLines() : detailLines.value
  if (!rows.length) {
    ElMessage.warning('暂无数据可导出')
    return
  }
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('库存统计')
  ws.addRow([printConfig.qyname || '库存统计报表'])
  ws.addRow(['库存统计报表'])
  ws.addRow([
    `区间：${activeSnapshot.value.startDate} ~ ${activeSnapshot.value.endDate}`,
    `仓库：${formatWarehouse(activeSnapshot.value)}`,
    `物料：${activeSnapshot.value.materialFilter || '全部'}`,
  ])
  ws.addRow(EXPORT_COLUMNS.map((c) => c[0]))
  rows.forEach((row, idx) => {
    ws.addRow(EXPORT_COLUMNS.map((col, ci) => (ci === 0 ? idx + 1 : formatCellValue(row, col))))
  })
  const buf = await wb.xlsx.writeBuffer()
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `库存统计-${activeSnapshot.value.startDate}_${activeSnapshot.value.endDate}.xlsx`
  a.click()
  URL.revokeObjectURL(url)
  ElMessage.success('已导出 Excel')
}

function exportPdf() {
  if (!detailLines.value.length) {
    ElMessage.warning('暂无数据可导出')
    return
  }
  document.documentElement.classList.add('print-stock-stats')
  ElMessage.info('请在打印对话框中选择「另存为 PDF」')
  setTimeout(() => {
    window.print()
    setTimeout(() => document.documentElement.classList.remove('print-stock-stats'), 800)
  }, 100)
}

function onPrint() {
  document.documentElement.classList.add('print-stock-stats')
  setTimeout(() => {
    window.print()
    setTimeout(() => document.documentElement.classList.remove('print-stock-stats'), 800)
  }, 50)
}

async function removeSnapshot(row) {
  try {
    await ElMessageBox.confirm('确定删除该统计快照？', '提示', { type: 'warning' })
    row.__deleting = true
    await axios.delete(`/api/stock-stats/snapshots/${row.id}`)
    ElMessage.success('已删除')
    if (activeSnapshot.value?.id === row.id) {
      activeSnapshot.value = null
      detailLines.value = []
    }
    await loadHistory()
  } catch (err) {
    if (err !== 'cancel') ElMessage.error(err?.response?.data?.msg || '删除失败')
  } finally {
    row.__deleting = false
  }
}

onMounted(() => {
  loadPrintConfig()
  loadHistory()
  loadWarehouses()
})
</script>

<style scoped>
.stock-stats-page {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.action-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
.search-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.search-label {
  font-weight: 600;
}
.pager-row {
  margin-top: 12px;
  display: flex;
  justify-content: flex-end;
}
.detail-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
}
.detail-title {
  font-size: 16px;
  font-weight: 600;
}
.detail-meta {
  flex: 1;
  min-width: 200px;
}
.detail-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
.detail-kw {
  width: 200px;
}
.muted {
  color: var(--el-text-color-secondary);
}
.report-table-wrap {
  overflow-x: auto;
}
.report-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.report-table th,
.report-table td {
  border: 1px solid #dcdfe6;
  padding: 6px 8px;
  white-space: nowrap;
}
.report-table th {
  background: #f5f7fa;
  font-weight: 600;
}
.report-table td.num {
  text-align: right;
}
.print-header-block {
  display: flex;
  gap: 16px;
  margin-bottom: 16px;
  align-items: flex-start;
}
.print-logo {
  max-height: 56px;
  max-width: 160px;
}
.print-company {
  margin: 0 0 4px;
  font-size: 18px;
}
.print-title {
  margin: 0 0 8px;
  font-size: 16px;
  font-weight: 600;
}
.print-meta {
  font-size: 13px;
  color: #606266;
}
</style>

<style>
@media print {
  html.print-stock-stats body * {
    visibility: hidden;
  }
  html.print-stock-stats #stock-stats-print-area,
  html.print-stock-stats #stock-stats-print-area * {
    visibility: visible;
  }
  html.print-stock-stats #stock-stats-print-area {
    position: absolute;
    left: 0;
    top: 0;
    width: 100%;
  }
  html.print-stock-stats .no-print {
    display: none !important;
  }
}
</style>
