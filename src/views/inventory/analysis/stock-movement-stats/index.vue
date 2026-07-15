<template>
  <div class="erp-module-page stock-movement-stats-page">
    <div class="stock-toolbar no-print">
      <el-button type="primary" @click="onPrint">打印统计报表</el-button>
      <el-button type="primary" @click="openQueryDialog">查询内容</el-button>
      <el-popover placement="bottom-start" trigger="click" width="300">
        <template #reference><el-button>列设置</el-button></template>
        <div class="column-setting-panel">
          <div class="column-setting-title">勾选要显示的列（打印、导出同步）</div>
          <el-checkbox-group v-model="checkedColumnKeys" @change="onColumnSettingChange">
            <el-checkbox v-for="col in availableColumns" :key="col.key" :label="col.key">{{ col.label }}</el-checkbox>
          </el-checkbox-group>
          <div class="column-setting-actions"><el-button link type="primary" @click="resetColumnSetting">恢复默认</el-button></div>
        </div>
      </el-popover>
      <el-button v-if="hasExportPermission" @click="exportReportXlsx">导出信息</el-button>
    </div>

    <section class="report-shell">
      <ReportHeader :print-config="printConfig" :logo-src="printLogoSrc" />
      <h2 class="report-title">出入库统计表</h2>
      <div class="report-meta">报表生成时间：{{ reportGeneratedAt || ' ' }} <span>报表代码：{{ reportCode || ' ' }}</span></div>
      <div class="report-meta">统计日期：{{ reportDateRangeText || ' ' }} <span>仓库：{{ reportContext.warehouseLabel || ' ' }}</span></div>
      <div class="report-done">统计完毕，一共：{{ detailRows.length }} 条记录</div>
      <el-skeleton :loading="loading" animated :rows="8">
        <template #default>
          <div class="legacy-table-wrap">
            <el-table v-erp-list-h-scroll class="legacy-report-table" :data="displayRows" border stripe row-key="rowKey" empty-text="暂无数据" :row-class-name="tableRowClassName">
              <el-table-column v-for="col in visibleColumns" :key="col.key" :prop="col.key" :label="col.label" :width="col.width" :min-width="col.minWidth" align="center">
                <template #default="{ row }"><span>{{ formatReportCell(row, col) }}</span></template>
              </el-table-column>
            </el-table>
          </div>
        </template>
      </el-skeleton>
    </section>

    <el-dialog v-model="dialogVisible" title="出入库统计条件查询" width="920px" destroy-on-close :close-on-click-modal="!loading" :show-close="!loading" @closed="onDialogClosed">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="120px" class="query-form">
        <div class="query-tip">选择条件后点击确定，系统会按日期顺序合并已审核的入库和出库明细。</div>
        <div class="query-grid">
          <el-form-item label="统计开始日期" prop="startDate"><el-date-picker v-model="form.startDate" type="date" value-format="YYYY-MM-DD" placeholder="请选择开始日期" /></el-form-item>
          <el-form-item label="统计结束日期" prop="endDate"><el-date-picker v-model="form.endDate" type="date" value-format="YYYY-MM-DD" placeholder="请选择结束日期" /></el-form-item>
          <el-form-item label="仓库" prop="warehouseCode">
            <el-select v-model="form.warehouseCode" filterable remote reserve-keyword :remote-method="fetchWarehouses" @focus="fetchWarehouses('')" placeholder="请选择仓库">
              <el-option label="全部仓库" :value="ALL_WAREHOUSE" />
              <el-option v-for="item in warehouseOptions" :key="item.code" :label="formatCodeName(item)" :value="item.code" />
            </el-select>
          </el-form-item>
          <el-form-item label="物料编码">
            <el-autocomplete v-model="form.materialCode" clearable :fetch-suggestions="queryMaterialSuggestions" placeholder="输入物料编码搜索" trigger-on-focus @input="onMaterialCodeInput" @select="onMaterialSelect" @clear="clearMaterial" />
          </el-form-item>
          <el-form-item label="收发类别">
            <el-select v-model="form.movementTypes" multiple collapse-tags collapse-tags-tooltip clearable placeholder="全部收发类别">
              <el-option-group label="入库类别"><el-option v-for="item in inboundTypeOptions" :key="`in-${item.value}`" :label="item.label" :value="`in:${item.value}`" /></el-option-group>
              <el-option-group label="出库类别"><el-option v-for="item in outboundTypeOptions" :key="`out-${item.value}`" :label="item.label" :value="`out:${item.value}`" /></el-option-group>
            </el-select>
          </el-form-item>
          <el-form-item label="材料分类">
            <el-select v-model="form.materialCategories" multiple filterable remote reserve-keyword clearable :remote-method="fetchCategories" @focus="fetchCategories('')" placeholder="请选择分类">
              <el-option v-for="item in categoryOptions" :key="item.code" :label="formatCodeName(item)" :value="item.code" />
            </el-select>
          </el-form-item>
        </div>
      </el-form>
      <div v-if="queryProgress.active" class="query-progress-panel">
        <el-progress :percentage="100" :indeterminate="true" :show-text="false" />
        <p class="query-progress-text">正在合并出入库流水，已等待 {{ queryProgress.elapsedSec }} 秒。</p>
        <p v-if="queryProgress.elapsedSec >= 15" class="query-progress-hint">查询范围较大，请耐心等待，仍在统计中。</p>
      </div>
      <template #footer><el-button :disabled="loading" @click="dialogVisible = false">取消</el-button><el-button type="primary" :loading="loading" @click="submitQuery">确定</el-button></template>
    </el-dialog>

    <section class="print-document" aria-hidden="true">
      <p class="print-time">打印时间：{{ reportGeneratedAt }}</p>
      <ReportHeader :print-config="printConfig" :logo-src="printLogoSrc" />
      <h2 class="report-title">出入库统计表</h2>
      <div class="report-meta">统计日期：{{ reportDateRangeText || ' ' }} <span>仓库：{{ reportContext.warehouseLabel || ' ' }}</span></div>
      <table class="print-table"><thead><tr><th v-for="col in visibleColumns" :key="col.key">{{ col.label }}</th></tr></thead><tbody><tr v-for="row in displayRows" :key="row.rowKey"><td v-for="col in visibleColumns" :key="`${row.rowKey}-${col.key}`">{{ formatReportCell(row, col) }}</td></tr></tbody></table>
    </section>
  </div>
</template>

<script setup>
import { computed, defineComponent, h, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import axios from 'axios'
import ExcelJS from 'exceljs'
import { getPermissionModelFromStorage, hasPageAction } from '@/utils/menuPermission'

defineOptions({ name: 'InventoryAnalysisStockMovementStats' })

const MENU_PATH = 'inventory/analysis/stock-movement-stats'
const REPORT_TITLE = '出入库统计表'
const ALL_WAREHOUSE = '__ALL__'
const COLUMN_SETTING_KEY = 'erp.stockMovementStats.columnSetting.v1'
const inboundTypeOptions = [{ value: '0', label: '0 其他入库' }, { value: '1', label: '1 采购入库' }, { value: '2', label: '2 外协入库' }, { value: '3', label: '3 外协退料' }, { value: '4', label: '4 生产入库' }, { value: '5', label: '5 生产退料' }, { value: '6', label: '6 成品退货' }, { value: '7', label: '7 盘盈入库' }, { value: '8', label: '8 加工入库' }, { value: '9', label: '9 其他入库' }]
const outboundTypeOptions = [{ value: '1', label: '1 采购退货' }, { value: '2', label: '2 外协出库' }, { value: '3', label: '3 外协退货' }, { value: '4', label: '4 生产领料' }, { value: '6', label: '6 销售出库' }, { value: '7', label: '7 生产领料' }, { value: '8', label: '8 报损' }, { value: '9', label: '9 盘亏' }]
const baseColumns = [
  { key: 'movementDate', label: '日期', width: 108, format: 'date' }, { key: 'documentNo', label: '单号', minWidth: 150 }, { key: 'direction', label: '方向', width: 72 }, { key: 'movementTypeLabel', label: '收发类别', width: 118 }, { key: 'sourceOrderNo', label: '关联单号', minWidth: 140 },
  { key: 'materialCode', label: '物料编码', minWidth: 140 }, { key: 'materialName', label: '物料名称', minWidth: 190 }, { key: 'materialNameEn', label: '英文名称', minWidth: 180 }, { key: 'materialSpec', label: '规格', minWidth: 140 }, { key: 'color', label: '颜色', minWidth: 120 }, { key: 'unit', label: '单位', width: 70 }, { key: 'quantity', label: '数量', width: 92, format: 'qty' },
]
const priceColumns = [{ key: 'unitPrice', label: '单价', width: 96, format: 'money4' }, { key: 'unitPriceTax', label: '含税单价', width: 106, format: 'money4' }, { key: 'amount', label: '金额', width: 106, format: 'money2' }, { key: 'amountTax', label: '含税金额', width: 116, format: 'money2' }]
const tailColumns = [{ key: 'warehouse', label: '仓库', minWidth: 120 }, { key: 'materialCategory', label: '材料分类', minWidth: 140 }, { key: 'poPi', label: 'PO/PI', minWidth: 140 }, { key: 'remark', label: '备注', minWidth: 190 }]

const permissionModel = computed(() => getPermissionModelFromStorage())
const hasExportPermission = computed(() => hasPageAction(permissionModel.value, MENU_PATH, 'export'))
const loading = ref(false); const dialogVisible = ref(false); const formRef = ref(); const detailRows = ref([]); const canViewPrice = ref(false); const checkedColumnKeys = ref([])
const printConfig = reactive({ info: '' }); const printLogoSrc = ref(''); const reportGeneratedAt = ref(''); const reportCode = ref(''); const warehouseOptions = ref([]); const categoryOptions = ref([])
const reportContext = reactive({ startDate: '', endDate: '', warehouseLabel: '' }); const queryProgress = reactive({ active: false, elapsedSec: 0 }); let queryProgressTimer = null
const form = reactive({ startDate: '', endDate: '', warehouseCode: '', materialCode: '', materialSystemcode: '', movementTypes: [], materialCategories: [] })
const rules = { startDate: [{ required: true, message: '统计开始日期不能为空', trigger: 'change' }], endDate: [{ required: true, message: '统计结束日期不能为空', trigger: 'change' }], warehouseCode: [{ required: true, message: '仓库不能为空', trigger: 'change' }] }
const availableColumns = computed(() => [...baseColumns, ...(canViewPrice.value ? priceColumns : []), ...tailColumns])
const defaultColumnKeys = computed(() => availableColumns.value.map((item) => item.key))
const visibleColumns = computed(() => { const selected = new Set(checkedColumnKeys.value.length ? checkedColumnKeys.value : defaultColumnKeys.value); return availableColumns.value.filter((item) => selected.has(item.key)) })
const reportDateRangeText = computed(() => reportContext.startDate === reportContext.endDate ? reportContext.startDate : `${reportContext.startDate || ''} 至 ${reportContext.endDate || ''}`)
const displayRows = computed(() => { const totals = { quantity: 0, amount: 0, amountTax: 0 }; const rows = detailRows.value.map((row, index) => { totals.quantity += numberValue(row.quantity); if (canViewPrice.value) { totals.amount += numberValue(row.amount); totals.amountTax += numberValue(row.amountTax) } return { ...row, rowKey: row.rowKey || `row-${index}` } }); return rows.length ? [...rows, { rowKey: 'total', rowType: 'total', label: '总计', ...totals }] : rows })

const ReportHeader = defineComponent({ props: { printConfig: Object, logoSrc: String }, setup(props) { return () => h('header', { class: 'report-header' }, [props.logoSrc ? h('div', { class: 'logo-wrap' }, [h('img', { class: 'logo', src: props.logoSrc, alt: 'logo' })]) : null, h('div', { class: 'head-info' }, [props.printConfig?.info ? h('div', { class: 'head-info-html', innerHTML: props.printConfig.info }) : h('div', { class: 'head-info-placeholder' }, '请先在打印设定中维护抬头信息')])]) } })

function pad2(value) { return String(value).padStart(2, '0') }
function todayText() { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}` }
function threeMonthsAgoText() { const today = new Date(); const target = new Date(today.getFullYear(), today.getMonth() - 3, 1); const lastDay = new Date(today.getFullYear(), today.getMonth() - 2, 0).getDate(); target.setDate(Math.min(today.getDate(), lastDay)); return `${target.getFullYear()}-${pad2(target.getMonth() + 1)}-${pad2(target.getDate())}` }
function formatNow() { const d = new Date(); return `${todayText()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}` }
function makeReportCode() { return `${Date.now()}${Math.random().toString(16).slice(2)}`.toUpperCase().replace(/[^0-9A-F]/g, '').slice(0, 16) }
function numberValue(value) { const n = Number(value); return Number.isFinite(n) ? n : 0 }
function formatQty(value) { return numberValue(value).toFixed(3).replace(/\.?0+$/, '') || '0' }
function formatMoney(value, digits) { return numberValue(value).toFixed(digits).replace(/\.?0+$/, '') || '0' }
function formatDate(value) { return String(value ?? '').slice(0, 10) }
function formatCodeName(item) { return `${String(item?.code ?? '').trim()} ${String(item?.name ?? '').trim()}`.trim() }
function currentWarehouseLabel() { if (form.warehouseCode === ALL_WAREHOUSE) return '全部仓库'; const found = warehouseOptions.value.find((item) => String(item.code) === String(form.warehouseCode)); return found ? formatCodeName(found) : form.warehouseCode }
function pickDefaultWarehouseCode() { const rows = warehouseOptions.value; const found = rows.find((item) => item.code === '货仓' || item.name === '货仓') || rows.find((item) => String(item.code).includes('货仓') || String(item.name).includes('货仓')); return found?.code || rows[0]?.code || '' }
function formatReportCell(row, col) { if (row.rowType === 'total') { if (col.key === 'movementDate') return row.label; return ['quantity', 'amount', 'amountTax'].includes(col.key) ? formatValue(row[col.key], col) : '' } return formatValue(row[col.key], col) }
function formatValue(value, col) { if (col.format === 'date') return formatDate(value); if (col.format === 'qty') return formatQty(value); if (col.format === 'money4') return formatMoney(value, 4); if (col.format === 'money2') return formatMoney(value, 2); return value ?? '' }
function tableRowClassName({ row }) { return row.rowType === 'total' ? 'is-total-row' : '' }
function normalizeColumnKeys(keys) { const allowed = new Set(availableColumns.value.map((item) => item.key)); return [...new Set(Array.isArray(keys) ? keys.filter((key) => allowed.has(key)) : [])] }
function persistColumnSetting() { try { localStorage.setItem(COLUMN_SETTING_KEY, JSON.stringify(checkedColumnKeys.value)) } catch {} }
function loadColumnSetting() { try { const keys = normalizeColumnKeys(JSON.parse(localStorage.getItem(COLUMN_SETTING_KEY) || '[]')); checkedColumnKeys.value = keys.length ? keys : [...defaultColumnKeys.value] } catch { checkedColumnKeys.value = [...defaultColumnKeys.value] } }
function onColumnSettingChange(value) { const keys = normalizeColumnKeys(value); if (!keys.length) { ElMessage.warning('至少保留一列'); checkedColumnKeys.value = [...defaultColumnKeys.value] } else checkedColumnKeys.value = keys; persistColumnSetting() }
function resetColumnSetting() { checkedColumnKeys.value = [...defaultColumnKeys.value]; persistColumnSetting(); ElMessage.success('已恢复默认列显示') }

async function loadPrintConfig() { try { const { data } = await axios.get('/api/stock-movement-stats/print-header'); const cfg = data?.data ?? {}; printConfig.info = cfg.headerHtml || cfg.info || ''; printLogoSrc.value = cfg.logoSrc || '' } catch {} }
async function fetchWarehouses(keyword = '') { try { const { data } = await axios.get('/api/stock-movement-stats/warehouse-options', { params: { keyword } }); warehouseOptions.value = data?.data?.list || [] } catch { warehouseOptions.value = [] } }
async function fetchCategories(keyword = '') { try { const { data } = await axios.get('/api/stock-movement-stats/category-options', { params: { keyword } }); categoryOptions.value = data?.data?.list || [] } catch { categoryOptions.value = [] } }
async function queryMaterialSuggestions(keyword, cb) { try { const { data } = await axios.get('/api/stock-movement-stats/material-options', { params: { keyword } }); cb((data?.data?.list || []).map((item) => ({ value: item.code, systemcode: item.systemcode }))) } catch { cb([]) } }
function onMaterialSelect(item) { form.materialCode = item.value || ''; form.materialSystemcode = item.systemcode || '' }
function onMaterialCodeInput() { form.materialSystemcode = '' }
function clearMaterial() { form.materialSystemcode = '' }
function openQueryDialog() { if (!form.warehouseCode) form.warehouseCode = pickDefaultWarehouseCode(); dialogVisible.value = true }
function stopQueryProgressTimer() { if (queryProgressTimer) clearInterval(queryProgressTimer); queryProgressTimer = null; queryProgress.active = false }
function startQueryProgressTimer() { stopQueryProgressTimer(); queryProgress.active = true; queryProgress.elapsedSec = 0; queryProgressTimer = setInterval(() => { queryProgress.elapsedSec += 1 }, 1000) }
async function loadReport() { try { await formRef.value?.validate() } catch { return }; if (form.startDate > form.endDate) { ElMessage.warning('统计开始日期不能大于结束日期'); return }; loading.value = true; startQueryProgressTimer(); try { const { data } = await axios.get('/api/stock-movement-stats/report', { params: { startDate: form.startDate, endDate: form.endDate, warehouseCode: form.warehouseCode, materialCode: form.materialCode, materialSystemcode: form.materialSystemcode, movementTypes: form.movementTypes.join(','), materialCategories: form.materialCategories.join(',') }, timeout: 180000 }); const body = data?.data ?? {}; canViewPrice.value = body.canViewPrice === true; detailRows.value = body.list || []; reportContext.startDate = body.startDate || form.startDate; reportContext.endDate = body.endDate || form.endDate; reportContext.warehouseLabel = body.allWarehouse ? '全部仓库' : currentWarehouseLabel(); reportGeneratedAt.value = formatNow(); reportCode.value = makeReportCode(); checkedColumnKeys.value = normalizeColumnKeys(checkedColumnKeys.value); if (!checkedColumnKeys.value.length) checkedColumnKeys.value = [...defaultColumnKeys.value]; dialogVisible.value = false; ElMessage.success('统计完成') } catch (err) { ElMessage.error(String(err?.response?.data?.msg ?? err?.message ?? '读取出入库统计表失败')) } finally { loading.value = false; stopQueryProgressTimer() } }
function submitQuery() { loadReport() }
function onDialogClosed() { formRef.value?.clearValidate?.(); stopQueryProgressTimer() }
function onPrint() { if (!detailRows.value.length) return ElMessage.warning('暂无数据可打印'); window.print() }
function exportFileName() { return `${REPORT_TITLE}-${reportDateRangeText.value || '未查询'}-${reportContext.warehouseLabel || ''}`.replace(/[\\/:*?"<>|]/g, '_').slice(0, 160) + '.xlsx' }
async function exportReportXlsx() { if (!hasExportPermission.value) return ElMessage.warning('没有导出权限'); if (!detailRows.value.length) return ElMessage.warning('暂无数据可导出'); const columns = visibleColumns.value; const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet(REPORT_TITLE, { views: [{ state: 'frozen', ySplit: 5 }], pageSetup: { paperSize: 9, orientation: 'landscape', fitToWidth: 1 } }); const count = columns.length; const title = ws.addRow([REPORT_TITLE]); ws.mergeCells(title.number, 1, title.number, count); title.font = { bold: true, size: 14 }; title.alignment = { horizontal: 'center' }; const meta = ws.addRow([`报表生成时间：${reportGeneratedAt.value}`, `报表代码：${reportCode.value}`]); ws.mergeCells(meta.number, 1, meta.number, Math.max(1, Math.floor(count / 2))); ws.mergeCells(meta.number, Math.max(1, Math.floor(count / 2)) + 1, meta.number, count); const filter = ws.addRow([`统计日期：${reportDateRangeText.value}`, `仓库：${reportContext.warehouseLabel}`]); ws.mergeCells(filter.number, 1, filter.number, Math.max(1, Math.floor(count / 2))); ws.mergeCells(filter.number, Math.max(1, Math.floor(count / 2)) + 1, filter.number, count); ws.addRow([]); const header = ws.addRow(columns.map((col) => col.label)); header.font = { bold: true }; for (const row of displayRows.value) ws.addRow(columns.map((col) => formatReportCell(row, col))); ws.columns.forEach((col, index) => { col.width = Math.max(10, Math.min(36, Math.round((columns[index]?.width || columns[index]?.minWidth || 120) / 8))) }); const blob = new Blob([await wb.xlsx.writeBuffer()], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }); const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = exportFileName(); anchor.click(); URL.revokeObjectURL(url); ElMessage.success('已导出 xlsx') }

onBeforeUnmount(stopQueryProgressTimer)
onMounted(async () => { await Promise.all([loadPrintConfig(), fetchWarehouses(''), fetchCategories('')]); form.startDate = threeMonthsAgoText(); form.endDate = todayText(); form.warehouseCode = pickDefaultWarehouseCode(); loadColumnSetting() })
</script>

<style scoped>
.stock-movement-stats-page { min-height: calc(100vh - 118px); padding: 8px; background: #f5f7fb; }
.stock-toolbar { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 8px; }
.report-shell { min-height: calc(100vh - 170px); padding: 18px 40px 48px; background: #fff; color: #000; }
.report-header { display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; }
/* 抬头由渲染函数生成，内部节点需要穿透 scoped 样式，避免通用 img 规则撑满页面。 */
.report-header :deep(.logo-wrap) { width: 100%; display: flex; justify-content: center; align-items: center; }
.report-header :deep(.logo) { display: block; width: auto !important; height: auto !important; max-width: 260px !important; max-height: 48px !important; object-fit: contain; }
.report-header :deep(.head-info) { width: 100%; font-size: 14px; line-height: 1.3; text-align: center; color: #000; }
.report-header :deep(.head-info-placeholder) { color: #999; }
/* 与入库统计表一致，移除打印设定 HTML 自带段落边距，避免 LOGO 与地址之间留白。 */
.report-header :deep(.head-info-html *) { margin-top: 0; margin-bottom: 0; }
.report-title { margin: 4px 0 6px; text-align: center; font-size: 20px; }.report-meta { margin: 2px 0; font-size: 13px; }.report-meta span { margin-left: 28px; }.report-done { margin: 12px 0 4px; color: #d00; font-size: 13px; }.legacy-table-wrap { overflow-x: auto; }.legacy-report-table { min-width: 1700px; }.query-tip { margin: 0 0 14px; color: #667085; }.query-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 20px; }.query-grid :deep(.el-select), .query-grid :deep(.el-autocomplete), .query-grid :deep(.el-date-editor) { width: 100%; }.query-progress-panel { margin: 6px 0; }.query-progress-text, .query-progress-hint { margin: 8px 0 0; text-align: center; color: #606266; }.query-progress-hint { color: #d97706; }.is-total-row :deep(td) { font-weight: 700; background: #f3f4f6 !important; }.column-setting-title { margin-bottom: 8px; color: #606266; }.column-setting-panel :deep(.el-checkbox) { width: 48%; margin-right: 0; }.column-setting-actions { margin-top: 8px; }.print-document { display: none; }
@media print { .no-print, .stock-toolbar, .report-shell { display: none !important; }.print-document { display: block; color: #000; }.print-time { font-size: 10px; }.print-table { width: 100%; border-collapse: collapse; font-size: 9px; }.print-table th, .print-table td { border: 1px solid #333; padding: 3px; text-align: center; word-break: break-all; }.report-title { font-size: 16px; } }
@media (max-width: 760px) { .report-shell { padding: 12px; }.query-grid { grid-template-columns: 1fr; } }
</style>
