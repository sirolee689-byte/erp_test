<template>
  <section class="so-trace-panel">
    <div class="so-trace-toolbar">
      <div class="so-trace-toolbar__row">
        <span>分类</span>
        <el-select v-model="filters.categoryId" clearable class="so-trace-category" placeholder="全部分类">
          <el-option v-for="item in categories" :key="item.id" :label="item.flag1 || `分类 ${item.id}`" :value="item.id" />
        </el-select>
        <span>销售日期</span>
        <el-date-picker v-model="filters.startDate" class="so-trace-date" type="date" value-format="YYYY-MM-DD" placeholder="开始日期" @change="onDateChange" />
        <span>至</span>
        <el-date-picker v-model="filters.endDate" class="so-trace-date" type="date" value-format="YYYY-MM-DD" placeholder="结束日期" @change="onDateChange" />
      </div>
      <div class="so-trace-toolbar__row">
        <span>查询条件</span>
        <el-input v-model="filters.keyword" clearable class="so-trace-keyword" placeholder="销售订单、物料编码、名称、备注等" @keyup.enter="onSearch" />
        <span>组别</span>
        <el-input v-model="filters.groupName" clearable class="so-trace-group" placeholder="精确匹配，例如 MO" @keyup.enter="onSearch" />
        <el-button type="primary" :loading="loading" @click="onSearch">立即查询</el-button>
        <el-button :disabled="loading" @click="onReset">重置</el-button>
        <el-popover placement="bottom-start" trigger="click" width="320">
          <template #reference><el-button>列设置</el-button></template>
          <div class="column-setting-panel">
            <div class="column-setting-title">勾选要显示的列</div>
            <el-checkbox-group v-model="checkedColumns" @change="persistColumns">
              <el-checkbox v-for="column in dynamicColumns" :key="column.key" :label="column.key">{{ column.label }}</el-checkbox>
            </el-checkbox-group>
            <div class="column-setting-actions"><el-button link type="primary" @click="selectAllColumns">全选</el-button><el-button link @click="clearColumns">全不选</el-button></div>
          </div>
        </el-popover>
        <el-button :loading="exporting" @click="exportXlsx">导出信息</el-button>
      </div>
    </div>

    <ErpTableViewportHScroll>
      <el-table ref="tableRef" v-loading="loading" :data="rows" border stripe class="erp-list-table so-trace-table" :empty-text="emptyText">
        <el-table-column label="操作" width="88" fixed="left" align="center">
          <template #default="{ row }"><el-button type="info" plain size="small" @click="openViewer(row)">查看</el-button></template>
        </el-table-column>
        <el-table-column v-if="isColumnVisible('salesDate')" label="销售日期" width="112" fixed="left"><template #default="{ row }">{{ dateText(row.salesDate) }}</template></el-table-column>
        <el-table-column v-if="isColumnVisible('salesOrderNo')" label="销售订单单号" prop="salesOrderNo" min-width="145" fixed="left" show-overflow-tooltip />
        <el-table-column v-if="isColumnVisible('xsak03')" label="数量" width="96" align="right"><template #default="{ row }">{{ numberText(row.xsak03) }}</template></el-table-column>
        <el-table-column v-if="isColumnVisible('xsak04')" label="单价" width="96" align="right"><template #default="{ row }">{{ numberText(row.xsak04) }}</template></el-table-column>
        <el-table-column v-if="isColumnVisible('xsak05')" label="含税单价" width="110" align="right"><template #default="{ row }">{{ numberText(row.xsak05) }}</template></el-table-column>
        <el-table-column v-if="isColumnVisible('tax')" label="税点" width="82" align="right"><template #default="{ row }">{{ taxText(row.tax) }}</template></el-table-column>
        <el-table-column v-if="isColumnVisible('pi')" label="关联 PI" prop="pi" min-width="130" show-overflow-tooltip />
        <el-table-column v-if="isColumnVisible('supplierName')" label="供应商/外协商" prop="supplierName" min-width="160" show-overflow-tooltip />
        <el-table-column v-if="isColumnVisible('kcaa01')" label="编码" prop="kcaa01" min-width="155" show-overflow-tooltip />
        <el-table-column label="状态" width="92" fixed="right"><template #default="{ row }">{{ statusText(row.orderPass) }}</template></el-table-column>
        <el-table-column v-for="column in visibleDynamicColumns" :key="column.key" :label="column.label" :width="column.width" :min-width="column.minWidth" show-overflow-tooltip>
          <template #default="{ row }">{{ cellText(row, column) }}</template>
        </el-table-column>
      </el-table>
    </ErpTableViewportHScroll>
    <div class="so-trace-pagination">
      <el-pagination v-model:current-page="page.page" v-model:page-size="page.pageSize" background layout="total, sizes, prev, pager, next, jumper" :total="page.total" :page-sizes="PAGE_SIZES" @size-change="onPageSizeChange" @current-change="onPageChange" />
    </div>

    <el-dialog v-model="viewerVisible" :title="viewerTitle" width="94vw" top="4vh" destroy-on-close>
      <el-skeleton :loading="viewerLoading" animated :rows="8">
        <template #default>
          <el-alert v-if="viewerError" :title="viewerError" type="error" show-icon />
          <el-tabs v-else v-model="viewerTab">
            <el-tab-pane label="基础资料" name="basic"><el-descriptions v-if="viewer.basic" :column="3" border>
              <el-descriptions-item v-for="item in basicFields" :key="item.key" :label="item.label">{{ valueText(viewer.basic[item.key]) }}</el-descriptions-item>
            </el-descriptions><el-empty v-else description="暂无 PI-BOM 基础资料" /></el-tab-pane>
            <el-tab-pane label="配件明细" name="parts"><el-table :data="viewer.parts" border stripe class="erp-list-table" max-height="58vh"><el-table-column label="编码" prop="kcaa01" min-width="180" /><el-table-column label="名称" prop="kcaa02" min-width="180" /><el-table-column label="规格" prop="kcaa03" min-width="150" /><el-table-column label="单位" prop="kcaa04" width="80" /><el-table-column label="用量" width="110" align="right"><template #default="{ row }">{{ numberText(row.kcac04) }}</template></el-table-column><el-table-column label="损耗" width="100" align="right"><template #default="{ row }">{{ numberText(row.kcac05) }}</template></el-table-column><el-table-column label="合计" width="110" align="right"><template #default="{ row }">{{ numberText(row.kcac06) }}</template></el-table-column><el-table-column label="备注" prop="Describe" min-width="160" /></el-table></el-tab-pane>
            <el-tab-pane label="PI-BOM树形" name="tree">
              <div class="so-trace-tree-toolbar">
                <el-button :disabled="!viewer.tree.length" @click="expandAllViewerTree">展开全部</el-button>
                <el-button :disabled="!viewer.tree.length" @click="collapseAllViewerTree">关闭全部</el-button>
                <span class="so-trace-tree-hint">提示：点三角或编码，可手动展开/收起该行；展开时打开该支下全部层级</span>
              </div>
              <div class="so-trace-native-tree-wrap">
                <table v-if="viewer.tree.length" class="so-trace-native-tree-table">
                  <thead>
                    <tr>
                      <th class="so-trace-th-code">编码</th>
                      <th>名称</th>
                      <th>规格</th>
                      <th class="so-trace-th-center">单位</th>
                      <th class="so-trace-th-num">用量</th>
                      <th class="so-trace-th-num">损耗</th>
                      <th class="so-trace-th-num">合计</th>
                      <th>备注</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr
                      v-for="row in viewerTreeVisibleRows"
                      :key="row.id"
                      :class="{
                        'is-selected': viewerTreeSelectedId === row.id,
                        'is-top': row.depth === 0,
                      }"
                      @click="viewerTreeSelectedId = row.id"
                    >
                      <td class="so-trace-td-code">
                        <div class="so-trace-td-code-inner">
                          <span
                            class="so-trace-tree-indent"
                            :style="{ width: `${row.depth * SO_TRACE_TREE_INDENT_PX}px` }"
                          />
                          <button
                            type="button"
                            class="so-trace-tree-caret"
                            :class="{ 'so-trace-tree-caret--leaf': !row.hasKids }"
                            :disabled="!row.hasKids"
                            :title="row.hasKids ? (row.expanded ? '收起' : '展开') : undefined"
                            @click.stop="onViewerTreeRowToggle(row)"
                          >
                            <template v-if="row.hasKids">{{ row.expanded ? '▼' : '▶' }}</template>
                          </button>
                          <span
                            class="so-trace-tree-code"
                            :class="{ 'so-trace-tree-code--branch': row.hasKids }"
                            :title="row.kcaa01"
                            @click.stop="onViewerTreeCodeClick(row)"
                          >{{ row.kcaa01 }}</span>
                        </div>
                      </td>
                      <td :title="row.kcaa02">{{ row.kcaa02 }}</td>
                      <td :title="row.kcaa03">{{ row.kcaa03 }}</td>
                      <td class="so-trace-td-center">{{ row.kcaa04 }}</td>
                      <td class="so-trace-td-num">{{ numberText(row.kcac04) }}</td>
                      <td class="so-trace-td-num">{{ numberText(row.kcac05) }}</td>
                      <td class="so-trace-td-num">{{ numberText(row.kcac06) }}</td>
                      <td :title="row.Describe">{{ row.Describe }}</td>
                    </tr>
                  </tbody>
                </table>
                <el-empty v-else description="暂无PI-BOM树形数据" :image-size="72" />
              </div>
            </el-tab-pane>
            <el-tab-pane label="成本BOM用量表" name="cost"><el-table :data="viewer.costRows" border stripe class="erp-list-table" max-height="58vh"><el-table-column label="编码" prop="kcaa01" min-width="200" /><el-table-column label="名称" prop="kcaa02" min-width="170" /><el-table-column label="规格" prop="kcaa03" min-width="150" /><el-table-column label="单位" prop="kcaa04" width="80" /><el-table-column label="用量" width="110"><template #default="{ row }">{{ numberText(row.kcac04) }}</template></el-table-column><el-table-column label="损耗" width="100"><template #default="{ row }">{{ numberText(row.kcac05) }}</template></el-table-column><el-table-column label="合计" width="110"><template #default="{ row }">{{ numberText(row.kcac06) }}</template></el-table-column><el-table-column label="备注" prop="Describe" min-width="160" /></el-table></el-tab-pane>
          </el-tabs>
        </template>
      </el-skeleton>
    </el-dialog>
  </section>
</template>

<script setup>
import { computed, nextTick, onMounted, reactive, ref } from 'vue'
import axios from 'axios'
import ExcelJS from 'exceljs'
import { ElMessage } from 'element-plus'
import ErpTableViewportHScroll from '@/components/erp/ErpTableViewportHScroll.vue'
import { refreshErpTableViewportHScroll } from '@/utils/erpTableViewportHScroll'

const PAGE_SIZES = [10, 25, 50, 100, 200, 300, 500]
const COLUMN_KEY = 'erp.salesOrderMaterialTrace.columnSetting.v2'
const dynamicColumns = [
  ['salesDate', '销售日期', 'date', true], ['salesOrderNo', '销售订单单号', '', true], ['xsak03', '数量', 'number', true], ['xsak04', '单价', 'number', true], ['xsak05', '含税单价', 'number', true], ['tax', '税点', 'tax', true], ['pi', '关联 PI', '', true], ['supplierName', '供应商/外协商', '', true], ['kcaa01', '编码', '', true],
  ['version', '版本'], ['kcaa02', '中文名称'], ['kcaa02_en', '英文名称'], ['kpname', '开票名称'], ['kcaa03', '规格'], ['kcaa04', '单位'], ['kcaa05', '分类'], ['kcaa06', '客户款号'], ['kcaa07', '最高存量'], ['kcaa08', '最低存量'], ['kcaa09', '工厂款号'], ['kcaa10', '组别'], ['kcaa11', '颜色编码/名称'], ['kcaa12', '是否采购', 'yes'], ['kcaa13', '是否外协', 'yes'], ['kcaa14', '是否自产', 'yes'], ['kcaa15', '生产车间'], ['kcaa16', '海关编码'], ['kcaa17', '海关名称'], ['kcaa18', '海关单位'], ['kcaa19', '海关转换率'], ['kcaa20', 'bag(cm)'], ['kcaa21', 'box(cm)'], ['kcaa22', 'empty(g)'], ['kcaa23', 'net(g)'], ['kcaa24', 'gross(g)'], ['kcaa25', '采购单位'], ['kcaa26', '采购转换率'], ['kcaa27', '采购转换方式', 'purchaseConvert'], ['kcaa28', '是否保税', 'yesNo'], ['kcaa29', '报价单位'], ['kcaa30', '报价转换率'], ['kcaa31', '报价转换方式', 'quoteConvert'], ['kcaa33', '物料损耗', 'six'], ['kcaa32', '报价损耗', 'six'], ['kcaa34', '报价币别'], ['kcaa35', '采购币别'], ['location', '产地'], ['sale_price', '销售价格'], ['cost_price', '成本价格'], ['Customer_supply', '客户供应', 'yesNo'], ['Customer_Name', '客户名称'], ['remark', '备注'],
].map(([key, label, format, fixed]) => ({ key, label, format, fixed, minWidth: 120 }))
const defaultColumnKeys = dynamicColumns.map((item) => item.key)
const filters = reactive({ categoryId: '', groupName: '', startDate: '', endDate: '', keyword: '' })
const page = reactive({ page: 1, pageSize: 10, total: 0 })
const categories = ref([]); const rows = ref([]); const loading = ref(false); const exporting = ref(false); const queried = ref(false); const tableRef = ref(null)
const checkedColumns = ref([...defaultColumnKeys])
const visibleDynamicColumns = computed(() => { const set = new Set(checkedColumns.value); return dynamicColumns.filter((item) => !item.fixed && set.has(item.key)) })
const viewerVisible = ref(false); const viewerLoading = ref(false); const viewerError = ref(''); const viewerTab = ref('basic'); const viewerRow = ref(null); const viewer = reactive({ basic: null, parts: [], tree: [], costRows: [] })
const viewerTreeExpandedIds = ref(new Set())
const viewerTreeSelectedId = ref(null)
/** DIY：每层缩进像素 */
const SO_TRACE_TREE_INDENT_PX = 18
const basicFields = [['piNo', 'PI号'], ['kcaa01', '编码'], ['kcaa02', '名称'], ['kcaa03', '规格'], ['kcaa04', '单位'], ['kcaa06', '客户款号'], ['kcaa09', '工厂款号'], ['kcaa10', '组别'], ['version', '版本'], ['remark', '备注']].map(([key, label]) => ({ key, label }))
const emptyText = computed(() => loading.value ? '加载中...' : queried.value ? '暂无数据' : '请填写条件后点“立即查询”')
const viewerTitle = computed(() => { const row = viewerRow.value || {}; return `查看 PI-BOM：${row.salesOrderNo || ''} / ${row.kcaa01 || ''}` })

function walkViewerTree(rows, fn) {
  for (const row of rows ?? []) {
    fn(row)
    if (row.children?.length) walkViewerTree(row.children, fn)
  }
}

const viewerTreeVisibleRows = computed(() => {
  const expanded = viewerTreeExpandedIds.value
  /** @type {any[]} */
  const out = []
  const walk = (nodes, depth) => {
    for (const n of nodes || []) {
      const kids = Array.isArray(n.children) ? n.children : []
      const hasKids = kids.length > 0
      const isExpanded = hasKids && expanded.has(n.id)
      out.push({
        id: n.id,
        depth,
        hasKids,
        expanded: isExpanded,
        node: n,
        kcaa01: n.kcaa01 || '',
        kcaa02: n.kcaa02 || '',
        kcaa03: n.kcaa03 || '',
        kcaa04: n.kcaa04 || '',
        kcac04: n.kcac04,
        kcac05: n.kcac05,
        kcac06: n.kcac06,
        Describe: n.Describe || '',
      })
      if (isExpanded) walk(kids, depth + 1)
    }
  }
  walk(viewer.tree, 0)
  return out
})

function toggleViewerTreeExpand(node) {
  if (!node?.children?.length || node.id == null) return
  const set = new Set(viewerTreeExpandedIds.value)
  if (set.has(node.id)) {
    set.delete(node.id)
    walkViewerTree(node.children, (n) => {
      if (n.id != null) set.delete(n.id)
    })
  } else {
    set.add(node.id)
    walkViewerTree(node.children, (n) => {
      if (n.children?.length && n.id != null) set.add(n.id)
    })
  }
  viewerTreeExpandedIds.value = set
}

function onViewerTreeRowToggle(row) {
  viewerTreeSelectedId.value = row.id
  if (!row.hasKids) return
  toggleViewerTreeExpand(row.node)
}

function onViewerTreeCodeClick(row) {
  viewerTreeSelectedId.value = row.id
  if (!row.hasKids) return
  toggleViewerTreeExpand(row.node)
}

function expandAllViewerTree() {
  const set = new Set()
  walkViewerTree(viewer.tree, (row) => {
    if (row.children?.length && row.id != null) set.add(row.id)
  })
  viewerTreeExpandedIds.value = set
}

function collapseAllViewerTree() {
  viewerTreeExpandedIds.value = new Set()
}

function dateText(value) { const raw = String(value ?? ''); return raw ? raw.replace('T', ' ').slice(0, 10) : '' }
function numberText(value, digits = 6) { const n = Number(value); return Number.isFinite(n) ? n.toFixed(digits).replace(/\.?0+$/, '') : '' }
function valueText(value) { return value == null || value === '' ? '-' : String(value) }
function taxText(value) { const n = Number(value); return Number.isFinite(n) ? `${numberText(n * 100, 4)}%` : '' }
function statusText(value) { const item = { '0': '未审核', '1': '已审核', '2': '审核不通过', '3': '有效' }[String(value ?? '').trim()]; return item || '未审核' }
function cellText(row, column) { const value = row?.[column.key]; if (column.format === 'date') return dateText(value); if (column.format === 'number') return numberText(value); if (column.format === 'tax') return taxText(value); if (column.format === 'yes') return String(value).trim() === '1' ? '是' : '-'; if (column.format === 'yesNo') return String(value).trim() === '1' ? '是' : '否'; if (column.format === 'purchaseConvert') return String(value).trim() === '1' ? '使用→采购' : '采购→使用'; if (column.format === 'quoteConvert') return String(value).trim() === '1' ? '报价→使用' : '使用→报价'; if (column.format === 'six') return numberText(value, 6); return value == null ? '' : String(value) }
function isColumnVisible(key) { return checkedColumns.value.includes(key) }
function persistColumns() { localStorage.setItem(COLUMN_KEY, JSON.stringify(checkedColumns.value)); refreshScroll() }
function selectAllColumns() { checkedColumns.value = [...defaultColumnKeys]; persistColumns() }
function clearColumns() { checkedColumns.value = []; persistColumns() }
async function refreshScroll() { await nextTick(); tableRef.value?.doLayout?.(); if (tableRef.value?.$el) refreshErpTableViewportHScroll(tableRef.value.$el) }
async function loadCategories() { try { const { data } = await axios.get('/api/sales-order/material-trace/categories'); categories.value = data?.data?.list || [] } catch { ElMessage.error('读取分类失败') } }
function requestParams(overrides = {}) { return { page: page.page, pageSize: page.pageSize, categoryId: filters.categoryId || '', groupName: filters.groupName.trim(), startDate: filters.startDate || '', endDate: filters.endDate || '', keyword: filters.keyword || '', ...overrides } }
async function loadList() { queried.value = true; loading.value = true; try { const { data } = await axios.get('/api/sales-order/material-trace/list', { params: requestParams() }); if (data?.code !== 200) throw new Error(data?.msg || '读取失败'); rows.value = data.data?.list || []; page.total = Number(data.data?.total || 0) } catch (err) { ElMessage.error(err?.response?.data?.msg || err?.message || '读取销售订单物料失败') } finally { loading.value = false; refreshScroll() } }
function onSearch() { page.page = 1; loadList() }
function onReset() { Object.assign(filters, { categoryId: '', groupName: '', startDate: '', endDate: '', keyword: '' }); onSearch() }
function onDateChange() { if (filters.startDate && filters.endDate && filters.startDate > filters.endDate) ElMessage.warning('开始日期不能晚于结束日期') }
function onPageSizeChange() { page.page = 1; if (queried.value) loadList() }
function onPageChange() { if (queried.value) loadList() }
async function openViewer(row) {
  viewerRow.value = row
  viewerVisible.value = true
  viewerLoading.value = true
  viewerError.value = ''
  viewerTab.value = 'basic'
  viewerTreeExpandedIds.value = new Set()
  viewerTreeSelectedId.value = null
  Object.assign(viewer, { basic: null, parts: [], tree: [], costRows: [] })
  try {
    const { data } = await axios.get('/api/inventory/pi-bom-data/detail', { params: { orderId: row.orderId, kcaa01: row.kcaa01 } })
    if (data?.code !== 200) throw new Error(data?.msg || '加载 PI-BOM 详情失败')
    Object.assign(viewer, { basic: data.data?.basic || null, parts: data.data?.parts || [], tree: data.data?.tree || [], costRows: data.data?.costRows || [] })
    viewerTreeExpandedIds.value = new Set()
    viewerTreeSelectedId.value = null
  } catch (err) {
    viewerError.value = err?.response?.data?.msg || err?.message || '加载 PI-BOM 详情失败'
  } finally {
    viewerLoading.value = false
  }
}
async function exportXlsx() { if (!queried.value) return ElMessage.warning('请先执行查询'); exporting.value = true; try { const all = []; const size = 500; const pages = Math.max(1, Math.ceil(page.total / size)); for (let current = 1; current <= pages; current += 1) { const { data } = await axios.get('/api/sales-order/material-trace/list', { params: requestParams({ page: current, pageSize: size }) }); all.push(...(data?.data?.list || [])) }; const workbook = new ExcelJS.Workbook(); const sheet = workbook.addWorksheet('销售订单转向物料查询'); const configuredColumns = dynamicColumns.filter((column) => column.fixed && isColumnVisible(column.key)); const exportColumns = [...configuredColumns, { key: 'orderPass', label: '状态' }, ...visibleDynamicColumns.value]; sheet.addRow(exportColumns.map((item) => item.label)); all.forEach((row) => sheet.addRow(exportColumns.map((item) => item.key === 'orderPass' ? statusText(row.orderPass) : cellText(row, item)))); sheet.getRow(1).font = { bold: true }; sheet.columns.forEach((column) => { column.width = 18 }); const buffer = await workbook.xlsx.writeBuffer(); const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = '销售订单转向物料查询.xlsx'; link.click(); URL.revokeObjectURL(url) } catch (err) { ElMessage.error(err?.response?.data?.msg || err?.message || '导出失败') } finally { exporting.value = false } }
onMounted(() => { try { const raw = localStorage.getItem(COLUMN_KEY); const saved = raw == null ? null : JSON.parse(raw); const allowed = new Set(defaultColumnKeys); if (Array.isArray(saved)) checkedColumns.value = saved.filter((key) => allowed.has(key)) } catch {} loadCategories() })
</script>

<style scoped>
.so-trace-toolbar { display: grid; gap: 8px; margin-bottom: 12px; }
.so-trace-toolbar__row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.so-trace-category { width: 180px; }.so-trace-group { width: 140px; }.so-trace-date { width: 142px; }.so-trace-keyword { width: min(420px, 100%); }.so-trace-category, .so-trace-group, .so-trace-date, .so-trace-keyword { --el-component-size: 32px; }.so-trace-toolbar :deep(.el-input__wrapper), .so-trace-toolbar :deep(.el-select__wrapper) { min-height: 32px; }.so-trace-pagination { margin-top: 12px; display: flex; justify-content: flex-end; }
.column-setting-panel { max-height: 52vh; overflow: auto; }.column-setting-panel :deep(.el-checkbox-group) { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; }.column-setting-actions { margin-top: 10px; }

.so-trace-tree-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}
.so-trace-tree-hint {
  color: var(--el-text-color-secondary);
  font-size: 12px;
  line-height: 1.5;
}
.so-trace-native-tree-wrap {
  width: 100%;
  max-height: 58vh;
  overflow: auto;
  border: 1px solid var(--el-border-color);
  border-radius: 4px;
  background: #fff;
}
.so-trace-native-tree-table {
  width: 100%;
  min-width: 980px;
  border-collapse: collapse;
  table-layout: fixed;
  font-size: 13px;
  color: var(--el-text-color-primary);
}
.so-trace-native-tree-table thead th {
  position: sticky;
  top: 0;
  z-index: 2;
  background: var(--el-fill-color-light);
  border-bottom: 1px solid var(--el-border-color);
  border-right: 1px solid var(--el-border-color-lighter);
  padding: 8px 10px;
  font-weight: 600;
  text-align: left;
  white-space: nowrap;
}
.so-trace-native-tree-table thead th:last-child {
  border-right: none;
}
.so-trace-th-code {
  width: 26%;
}
.so-trace-th-center,
.so-trace-td-center {
  text-align: center;
  width: 64px;
}
.so-trace-th-num,
.so-trace-td-num {
  text-align: right;
  width: 100px;
  font-variant-numeric: tabular-nums;
}
.so-trace-native-tree-table tbody td {
  border-bottom: 1px solid var(--el-border-color-lighter);
  border-right: 1px solid var(--el-border-color-extra-light);
  padding: 7px 10px;
  vertical-align: middle;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  background: #fff;
}
.so-trace-native-tree-table tbody td:last-child {
  border-right: none;
}
.so-trace-native-tree-table tbody tr:hover td {
  background: var(--el-fill-color-light);
}
.so-trace-native-tree-table tbody tr.is-selected td {
  background: var(--el-color-primary-light-7);
}
.so-trace-native-tree-table tbody tr.is-top .so-trace-tree-code {
  font-weight: 600;
}
.so-trace-td-code {
  white-space: normal !important;
  overflow: visible !important;
  text-overflow: clip !important;
}
.so-trace-td-code-inner {
  display: flex;
  align-items: flex-start;
  gap: 2px;
}
.so-trace-tree-indent {
  flex: 0 0 auto;
  height: 1px;
  margin-top: 11px;
}
.so-trace-tree-caret {
  flex: 0 0 20px;
  width: 20px;
  height: 22px;
  border: none;
  background: transparent;
  padding: 0;
  margin: 0;
  font-size: 10px;
  line-height: 22px;
  color: var(--el-text-color-secondary);
  cursor: pointer;
  user-select: none;
  text-align: center;
}
.so-trace-tree-caret--leaf {
  visibility: hidden;
  cursor: default;
}
.so-trace-tree-code {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  color: var(--el-text-color-primary);
  word-break: break-all;
  white-space: normal;
  line-height: 1.35;
  padding-top: 2px;
}
.so-trace-tree-code--branch {
  cursor: pointer;
}
.so-trace-tree-code--branch:hover {
  color: var(--el-color-primary);
}
</style>
