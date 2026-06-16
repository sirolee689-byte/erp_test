<template>
  <div class="erp-module-page dispatch-page">
    <div class="dispatch-mode-bar">
      <el-button :type="pageMode === 'list' ? 'primary' : 'default'" plain @click="switchList">派工单管理</el-button>
      <el-button v-permission="'add'" :type="pageMode === 'form' && !editId ? 'primary' : 'default'" plain @click="newOrder">
        新增派工单
      </el-button>
    </div>

    <section v-show="pageMode === 'list'" class="erp-section">
      <div class="dispatch-toolbar">
        <el-input v-model="filters.keyword" clearable placeholder="派工单号 / PI / 车间 / 备注" class="filter-keyword" @keyup.enter="loadList" />
        <el-select v-model="filters.dispatchType" clearable placeholder="派工类型" class="filter-select">
          <el-option label="本厂" value="0" />
          <el-option label="大板" value="1" />
          <el-option label="委外" value="2" />
        </el-select>
        <el-switch v-model="showUnaudited" :disabled="showRecycle" active-text="显示未审核" @change="loadList" />
        <el-switch v-model="showRecycle" active-text="回收站" @change="onRecycleChange" />
        <el-button type="primary" @click="loadList">查询</el-button>
        <el-button @click="resetSearch">重置</el-button>
      </div>

      <el-alert v-if="showRecycle" type="info" show-icon title="当前是回收站：只能查看、恢复或彻底删除。" class="dispatch-alert" />
      <el-alert v-else-if="showUnaudited" type="warning" show-icon title="当前显示未审核派工单，可编辑、审核或删除。" class="dispatch-alert" />

      <el-table
        ref="listTableRef"
        v-loading="loading"
        v-erp-list-h-scroll
        :data="list"
        border
        stripe
        row-key="id"
        class="erp-list-table"
        :expand-row-keys="expandedRowKeys"
        :empty-text="loading ? '加载中' : '暂无数据'"
        @row-click="onListRowClick"
        @expand-change="onListExpandChange"
      >
        <el-table-column type="expand" width="48">
          <template #default="{ row }">
            <div class="dispatch-row-detail" @click.stop>
              <el-table
                v-loading="!!row.__detailLoading"
                :data="rowDetails(row)"
                border
                size="small"
                class="dispatch-row-detail-table"
                :empty-text="row.__detailLoading ? '加载中' : '暂无明细'"
              >
                <el-table-column label="序号" width="70" align="center">
                  <template #default="{ $index }">{{ $index + 1 }}</template>
                </el-table-column>
                <el-table-column label="操作" width="86" align="center">
                  <template #default="{ row: line }">
                    <el-button size="small" plain :disabled="!String(line.kcaa01 ?? '').trim()" @click.stop="openBomDetail(line)">查看</el-button>
                  </template>
                </el-table-column>
                <el-table-column label="货品编码" prop="kcaa01" min-width="150" show-overflow-tooltip />
                <el-table-column label="货品名称" prop="kcaa02" min-width="180" show-overflow-tooltip />
                <el-table-column label="规格" prop="kcaa03" min-width="160" show-overflow-tooltip />
                <el-table-column label="颜色" min-width="130" show-overflow-tooltip>
                  <template #default="{ row: line }">{{ formatColorCell(line) }}</template>
                </el-table-column>
                <el-table-column label="单位" prop="kcaa04" width="80" />
                <el-table-column label="派工数量" prop="scak03" width="110" align="right" />
                <el-table-column label="已派工数量" width="120" align="right">
                  <template #default="{ row: line }">{{ formatQty(line.stockProcessDispatchedQty) }}</template>
                </el-table-column>
                <el-table-column label="返修数量" prop="scak05" width="110" align="right" />
              </el-table>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="操作" fixed="left" width="300" class-name="erp-col-actions">
          <template #default="{ row }">
            <div class="action-bar" @click.stop>
              <el-button size="small" plain @click="viewOrder(row)">查看</el-button>
              <template v-if="!showRecycle">
                <el-button v-if="row.pass !== '1'" v-permission="'edit'" size="small" type="primary" plain @click="editOrder(row)">编辑</el-button>
                <el-button v-if="row.pass !== '1'" v-permission="'audit'" size="small" plain :loading="row.__op === 'audit'" @click="runAction(row, 'audit')">审核</el-button>
                <el-button v-if="row.pass === '1'" v-permission="'audit'" size="small" plain :loading="row.__op === 'unaudit'" @click="runAction(row, 'unaudit')">反审核</el-button>
                <el-button v-if="row.pass !== '1'" v-permission="'delete'" size="small" type="danger" plain :loading="row.__op === 'delete'" @click="runAction(row, 'delete')">删除</el-button>
              </template>
              <template v-else>
                <el-button v-permission="'delete'" size="small" type="primary" plain :loading="row.__op === 'restore'" @click="runAction(row, 'restore')">恢复</el-button>
                <el-button v-if="row.pass !== '1'" v-permission="'delete'" size="small" type="danger" plain :loading="row.__op === 'hard'" @click="runAction(row, 'hard')">彻底删除</el-button>
              </template>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="派工单号" prop="dispatchOrderNo" min-width="150" fixed="left" show-overflow-tooltip />
        <el-table-column label="派工类型" width="94">
          <template #default="{ row }">{{ dispatchTypeText(row.dispatchType) }}</template>
        </el-table-column>
        <el-table-column label="PI / 供应商" prop="referenceNo" min-width="150" show-overflow-tooltip />
        <el-table-column label="生产车间" prop="workshopName" min-width="150" show-overflow-tooltip />
        <el-table-column label="派工日期" width="120">
          <template #default="{ row }">{{ formatDate(row.dispatchDate) }}</template>
        </el-table-column>
        <el-table-column label="交货日期" width="120">
          <template #default="{ row }">{{ formatDate(row.deliveryDate) }}</template>
        </el-table-column>
        <el-table-column label="审核" width="90">
          <template #default="{ row }">
            <el-tag v-if="row.pass === '1'" type="success" size="small">已审</el-tag>
            <el-tag v-else type="warning" size="small">未审</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="明细数" prop="itemCount" width="90" align="right" />
        <el-table-column label="派工数量" prop="totalQty" width="110" align="right" />
        <el-table-column label="创建人" prop="creatorName" min-width="110" show-overflow-tooltip />
        <el-table-column label="备注" prop="remark" min-width="180" show-overflow-tooltip />
      </el-table>

      <el-pagination
        v-model:current-page="pager.page"
        v-model:page-size="pager.pageSize"
        :page-sizes="[10, 20, 50, 100]"
        layout="total, sizes, prev, pager, next, jumper"
        :total="pager.total"
        class="dispatch-pagination"
        @size-change="loadList"
        @current-change="loadList"
      />
    </section>

    <section v-show="pageMode === 'form'" class="erp-section">
      <div class="form-head">
        <strong>{{ editId ? '编辑派工单' : '新增派工单' }}</strong>
        <div>
          <el-button @click="switchList">返回列表</el-button>
          <el-button type="primary" :loading="saving" @click="saveOrder">保存</el-button>
        </div>
      </div>
      <el-tabs v-model="editTab" class="dispatch-edit-tabs">
        <el-tab-pane label="派工单基础资料" name="header">
          <el-form :model="form" label-width="92px" class="dispatch-form">
            <div class="dispatch-header-rows">
              <div class="dispatch-form-row dispatch-form-row--1">
                <el-form-item label="派工单号">
                  <el-input :value="editId ? String(detail.header?.scaj01 || '') : '保存后自动生成'" disabled />
                </el-form-item>
              </div>
              <div class="dispatch-form-row dispatch-form-row--2">
                <el-form-item label="派工日期">
                  <el-date-picker v-model="form.dispatchDate" value-format="YYYY-MM-DD" type="date" />
                </el-form-item>
                <el-form-item label="交货日期">
                  <el-date-picker v-model="form.deliveryDate" value-format="YYYY-MM-DD" type="date" />
                </el-form-item>
              </div>
              <div class="dispatch-form-row dispatch-form-row--3">
                <el-form-item label="派工类型">
                  <div class="dispatch-type-btns" role="radiogroup" aria-label="派工类型">
                    <button
                      v-for="opt in dispatchTypeOptions"
                      :key="opt.value"
                      type="button"
                      class="dispatch-type-btn"
                      :class="{ 'is-active': form.dispatchType === opt.value }"
                      :disabled="!!editId || opt.value !== '0'"
                      @click="onDispatchTypeClick(opt.value)"
                    >
                      {{ opt.label }}
                    </button>
                  </div>
                </el-form-item>
                <el-form-item :label="form.dispatchType === '2' ? '供应商' : 'PI号'">
                  <el-autocomplete
                    v-if="form.dispatchType !== '2'"
                    v-model="form.referenceNo"
                    :fetch-suggestions="fetchPiSuggestions"
                    value-key="piNo"
                    clearable
                    placeholder="输入第一个字开始联想 PI"
                    :disabled="!!editId"
                    @select="onPickReferencePi"
                  />
                  <el-input v-else v-model="form.referenceNo" :disabled="!!editId" placeholder="请输入供应商编码" />
                </el-form-item>
                <el-form-item v-if="form.dispatchType === '2'" label="关联PI">
                  <el-autocomplete
                    v-model="form.piNo"
                    :fetch-suggestions="fetchPiSuggestions"
                    value-key="piNo"
                    clearable
                    placeholder="输入第一个字开始联想 PI"
                    :disabled="!!editId && lines.length > 0"
                    @select="onPickLinkedPi"
                  />
                </el-form-item>
              </div>
              <div class="dispatch-form-row dispatch-form-row--1">
                <el-form-item label="生产车间">
                  <el-select
                    v-model="form.workshopCode"
                    :disabled="!!editId"
                    @change="onWorkshopChange"
                  >
                    <el-option v-for="w in workshops" :key="w.code" :label="`${w.code} ${w.name}`" :value="w.code" />
                  </el-select>
                </el-form-item>
              </div>
              <div class="dispatch-form-row dispatch-form-row--1">
                <el-form-item label="备注">
                  <el-input v-model="form.remark" />
                </el-form-item>
              </div>
            </div>
          </el-form>
        </el-tab-pane>
        <el-tab-pane label="派工单明细" name="lines">
          <div class="line-toolbar">
            <el-button type="primary" plain @click="openGoodsDialog">批量添加</el-button>
            <el-button type="danger" plain :disabled="!hasMarkedLines" @click="removeMarkedLines">删除选定明细</el-button>
            <el-button type="danger" plain :disabled="!lines.length" @click="removeAllLines">删除全部明细</el-button>
          </div>
          <el-table :data="lines" border stripe row-key="__key" class="erp-list-table">
            <el-table-column label="操作" width="86">
              <template #default="{ row }">
                <el-button size="small" :type="isLineMarked(row) ? 'success' : 'default'" plain @click="toggleLineMarked(row)">
                  {{ isLineMarked(row) ? '已选择' : '选择' }}
                </el-button>
              </template>
            </el-table-column>
            <el-table-column label="PI" prop="pi" min-width="130" />
            <el-table-column label="货品编码" prop="kcaa01" min-width="140" />
            <el-table-column label="本次派工" width="150">
              <template #default="{ row }">
                <el-input v-model="row.scak03" inputmode="decimal" @blur="normalizeLineQty(row)" />
              </template>
            </el-table-column>
            <el-table-column label="货品名称" prop="kcaa02" min-width="180" />
            <el-table-column label="单位" prop="kcaa04" width="80" />
            <el-table-column label="规格" prop="kcaa03" min-width="160" />
            <el-table-column label="已派工" prop="scak04" width="120" align="right" />
            <el-table-column label="返修数量" prop="scak05" width="110" align="right" />
          </el-table>
        </el-tab-pane>
      </el-tabs>
    </section>

    <el-dialog v-model="viewVisible" title="派工单详情" width="86%" destroy-on-close>
      <el-descriptions :column="4" border>
        <el-descriptions-item label="派工单号">{{ detail.header?.scaj01 }}</el-descriptions-item>
        <el-descriptions-item label="派工类型">{{ dispatchTypeText(detail.header?.scaj03) }}</el-descriptions-item>
        <el-descriptions-item label="PI/供应商">{{ detail.header?.scaj04 }}</el-descriptions-item>
        <el-descriptions-item label="生产车间">{{ detail.header?.cj }}</el-descriptions-item>
        <el-descriptions-item label="派工日期">{{ formatDate(detail.header?.scaj02) }}</el-descriptions-item>
        <el-descriptions-item label="交货日期">{{ formatDate(detail.header?.scaj06) }}</el-descriptions-item>
        <el-descriptions-item label="审核">{{ detail.header?.pass === '1' ? '已审' : '未审' }}</el-descriptions-item>
        <el-descriptions-item label="备注">{{ detail.header?.remark }}</el-descriptions-item>
      </el-descriptions>
      <el-table :data="detail.lines" border stripe class="detail-lines">
        <el-table-column label="PI" prop="pi" min-width="130" />
        <el-table-column label="货品编码" prop="kcaa01" min-width="140" />
        <el-table-column label="货品名称" prop="kcaa02" min-width="180" />
        <el-table-column label="规格" prop="kcaa03" min-width="160" />
        <el-table-column label="单位" prop="kcaa04" width="80" />
        <el-table-column label="版本" prop="version" width="90" />
        <el-table-column label="本次派工" prop="scak03" width="110" align="right" />
        <el-table-column label="已派工快照" prop="scak04" width="120" align="right" />
        <el-table-column label="返修数量" prop="scak05" width="110" align="right" />
      </el-table>
    </el-dialog>

    <el-dialog v-model="goodsVisible" :title="goodsDialogTitle" width="88%" destroy-on-close @open="onGoodsDialogOpen">
      <div class="goods-header-actions">
        <el-button type="primary" plain @click="selectAllSelectableGoods">全选</el-button>
      </div>
      <el-table v-loading="goodsLoading" :data="goodsList" border stripe>
        <el-table-column label="操作" width="170">
          <template #default="{ row }">
            <el-button size="small" plain :disabled="!String(row.kcaa01 ?? '').trim()" @click="openBomDetail(row)">查看</el-button>
            <el-button
              size="small"
              plain
              :type="isGoodsSelected(row.kcaa01) ? 'success' : 'primary'"
              :disabled="!row.selectable && !isGoodsSelected(row.kcaa01)"
              @click="toggleGoodsSelection(row)"
            >
              {{ !row.selectable && !isGoodsSelected(row.kcaa01) ? '不可选' : isGoodsSelected(row.kcaa01) ? '已选择' : '选择' }}
            </el-button>
          </template>
        </el-table-column>
        <el-table-column label="PI" prop="pi" min-width="130" />
        <el-table-column label="货品编码" prop="kcaa01" min-width="140" />
        <el-table-column label="货品名称" prop="kcaa02" min-width="180" />
        <el-table-column label="规格" prop="kcaa03" min-width="160" />
        <el-table-column label="销售数量" prop="salesQty" width="110" align="right" />
        <el-table-column label="已派工" prop="dispatchedQty" width="110" align="right" />
        <el-table-column label="可派工" prop="availableQty" width="110" align="right" />
        <el-table-column label="已入库" prop="storageQty" width="110" align="right" />
        <el-table-column label="返修" prop="repairQty" width="100" align="right" />
      </el-table>
      <div class="goods-footer-actions">
        <el-button type="primary" @click="saveSelectedGoods">保存已选数据</el-button>
        <el-button @click="resetGoodsSelection">全部重选</el-button>
      </div>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import axios from 'axios'
import { ElMessage, ElMessageBox } from 'element-plus'

defineOptions({ name: 'production-daily-dispatch' })

const pageMode = ref('list')
const loading = ref(false)
const saving = ref(false)
const list = ref([])
const showUnaudited = ref(false)
const showRecycle = ref(false)
const filters = reactive({ keyword: '', dispatchType: '' })
const pager = reactive({ page: 1, pageSize: 20, total: 0 })
const editId = ref(null)
const form = reactive(defaultForm())
const lines = ref([])
const FIXED_WORKSHOPS = [
  { code: '03', name: '包装部' },
  { code: '04', name: '开料部' },
  { code: '0901', name: '车缝车间' },
]
const workshops = ref(FIXED_WORKSHOPS)
const viewVisible = ref(false)
const detail = reactive({ header: null, lines: [] })
const goodsVisible = ref(false)
const goodsLoading = ref(false)
const goodsList = ref([])
const selectedGoodsMap = ref({})
const markedLineMap = ref({})
const listTableRef = ref(null)
const expandedRowKeys = ref([])
const detailCache = ref({})
const editTab = ref('header')
const dispatchTypeOptions = [
  { label: '本厂派工', value: '0' },
  { label: '大板派工', value: '1' },
  { label: '委外派工', value: '2' },
]
const goodsDialogTitle = computed(() => {
  const code = String(form.workshopCode ?? '').trim()
  const name = String(form.workshopName ?? '').trim()
  if (code && name) return `生产车间：${code} ${name}`
  if (code) return `生产车间：${code}`
  if (name) return `生产车间：${name}`
  return '生产车间：未选择'
})
const hasMarkedLines = computed(() => Object.values(markedLineMap.value).some(Boolean))

function defaultForm() {
  return {
    dispatchDate: new Date().toISOString().slice(0, 10),
    dispatchType: '0',
    workshopCode: '',
    workshopName: '',
    deliveryDate: '',
    referenceNo: '',
    piNo: '',
    remark: '',
  }
}

function resetForm() {
  Object.assign(form, defaultForm())
  lines.value = []
  markedLineMap.value = {}
  editId.value = null
  editTab.value = 'header'
}

function dispatchTypeText(v) {
  return String(v) === '1' ? '大板' : String(v) === '2' ? '委外' : '本厂'
}

function formatDate(v) {
  return String(v ?? '').slice(0, 10)
}

function formatQty(v) {
  const n = Number(v ?? 0)
  if (!Number.isFinite(n)) return '0'
  return String(Number(n.toFixed(4))).replace(/\.0+$/, '')
}

function formatColorCell(row) {
  const code = String(row?.kcaa11 ?? '').trim()
  if (!code) return '(-)'
  const name = String(row?.colorName ?? '').trim()
  return `${code}(${name || '-'})`
}

function buildBomDetailUrl(code) {
  const c = String(code ?? '').trim()
  if (!c) return ''
  const url = new URL(window.location.href)
  url.pathname = '/inventory/basic/bom-data-window'
  url.search = ''
  url.hash = ''
  url.searchParams.set('mode', 'detail')
  url.searchParams.set('code', c)
  return url.toString()
}

function openBomDetail(line) {
  const code = String(line?.kcaa01 ?? '').trim()
  if (!code) {
    ElMessage.warning('当前行无货品编码，无法查看 BOM')
    return
  }
  const win = window.open(buildBomDetailUrl(code), '_blank')
  if (!win) {
    ElMessage.warning('浏览器拦截了新窗口，请允许本站弹出窗口后重试')
  } else {
    win.focus?.()
  }
}

function rowDetails(row) {
  const key = String(row?.id ?? '')
  return detailCache.value[key] ?? []
}

async function loadRowDetail(row) {
  const key = String(row?.id ?? '')
  if (!key || detailCache.value[key] || row.__detailLoading) return
  row.__detailLoading = true
  try {
    const res = await axios.get(`/api/dispatch-order/${row.id}`)
    detailCache.value = {
      ...detailCache.value,
      [key]: res.data?.data?.lines ?? [],
    }
  } catch (err) {
    ElMessage.error(err?.response?.data?.msg || '读取派工单明细失败')
  } finally {
    row.__detailLoading = false
  }
}

function onListExpandChange(row, expandedRows) {
  expandedRowKeys.value = (expandedRows ?? []).map((r) => r.id)
  if (expandedRowKeys.value.includes(row.id)) loadRowDetail(row)
}

function onListRowClick(row, _column, event) {
  if (event?.target?.closest?.('.erp-col-actions, .dispatch-row-detail, .el-button, .el-table__expand-icon, a')) return
  listTableRef.value?.toggleRowExpansion(row)
}

async function loadList() {
  loading.value = true
  try {
    const res = await axios.get('/api/dispatch-order/list', {
      params: {
        page: pager.page,
        pageSize: pager.pageSize,
        recycled: showRecycle.value ? '1' : '0',
        showUnaudited: showUnaudited.value ? '1' : '0',
        keyword: filters.keyword,
        dispatchType: filters.dispatchType,
      },
    })
    list.value = res.data?.data?.list ?? []
    expandedRowKeys.value = []
    detailCache.value = {}
    pager.total = Number(res.data?.data?.total ?? 0)
  } catch (err) {
    ElMessage.error(err?.response?.data?.msg || '读取派工单列表失败')
  } finally {
    loading.value = false
  }
}

function resetSearch() {
  filters.keyword = ''
  filters.dispatchType = ''
  pager.page = 1
  loadList()
}

function onRecycleChange() {
  if (showRecycle.value) showUnaudited.value = false
  pager.page = 1
  loadList()
}

function switchList() {
  pageMode.value = 'list'
  loadList()
}

function newOrder() {
  resetForm()
  pageMode.value = 'form'
}

function onWorkshopChange(code) {
  const picked = workshops.value.find((w) => w.code === code)
  form.workshopName = picked?.name || ''
}

function onTypeChange() {
  form.referenceNo = ''
  form.piNo = ''
  lines.value = []
  markedLineMap.value = {}
}

function onDispatchTypeClick(value) {
  if (editId.value) return
  if (value !== '0') return
  if (form.dispatchType === value) return
  form.dispatchType = value
  onTypeChange()
}

function mapPiSuggestion(row) {
  const piNo = String(row?.piNo ?? '').trim()
  return {
    piNo,
    value: piNo,
  }
}

async function fetchPiSuggestions(query, cb) {
  const keyword = String(query ?? '').trim()
  if (!keyword) {
    cb([])
    return
  }
  try {
    const res = await axios.get('/api/sales-order/pi-suggest', { params: { keyword } })
    const list = Array.isArray(res?.data?.data?.list) ? res.data.data.list : []
    cb(list.map(mapPiSuggestion))
  } catch {
    cb([])
  }
}

function onPickReferencePi(row) {
  form.referenceNo = String(row?.piNo ?? '').trim()
}

function onPickLinkedPi(row) {
  form.piNo = String(row?.piNo ?? '').trim()
}

async function viewOrder(row) {
  const res = await axios.get(`/api/dispatch-order/${row.id}`)
  detail.header = res.data?.data?.header ?? null
  detail.lines = res.data?.data?.lines ?? []
  viewVisible.value = true
}

async function editOrder(row) {
  const res = await axios.get(`/api/dispatch-order/${row.id}`)
  const h = res.data?.data?.header ?? {}
  editId.value = row.id
  Object.assign(form, {
    dispatchDate: formatDate(h.scaj02),
    dispatchType: String(h.scaj03 ?? '0'),
    workshopCode: String(h.scaj05 ?? ''),
    workshopName: String(h.cj ?? ''),
    deliveryDate: formatDate(h.scaj06),
    referenceNo: String(h.scaj04 ?? ''),
    piNo: String(res.data?.data?.lines?.[0]?.pi ?? ''),
    remark: String(h.remark ?? ''),
  })
  if (form.workshopCode && !workshops.value.some((w) => w.code === form.workshopCode)) {
    workshops.value.push({ code: form.workshopCode, name: form.workshopName })
  }
  lines.value = (res.data?.data?.lines ?? []).map((line, idx) => ({ ...line, __key: `${line.kcaa01}-${idx}` }))
  markedLineMap.value = {}
  editTab.value = 'header'
  pageMode.value = 'form'
}

function savePayload() {
  return {
    header: {
      dispatchDate: form.dispatchDate,
      dispatchType: form.dispatchType,
      workshopCode: form.workshopCode,
      workshopName: form.workshopName,
      deliveryDate: form.deliveryDate,
      referenceNo: form.referenceNo,
      supplierCode: form.dispatchType === '2' ? form.referenceNo : '',
      remark: form.remark,
    },
    lines: lines.value,
  }
}

async function saveOrder() {
  saving.value = true
  try {
    const payload = savePayload()
    if (editId.value) await axios.put(`/api/dispatch-order/${editId.value}`, payload)
    else await axios.post('/api/dispatch-order', payload)
    ElMessage.success('保存成功，已回到未审核列表')
    showRecycle.value = false
    showUnaudited.value = true
    switchList()
  } catch (err) {
    ElMessage.error(err?.response?.data?.msg || '保存派工单失败')
  } finally {
    saving.value = false
  }
}

async function runAction(row, action) {
  const textMap = { audit: '审核', unaudit: '反审核', delete: '删除', restore: '恢复', hard: '彻底删除' }
  await ElMessageBox.confirm(`确认${textMap[action]}这张派工单？`, '确认操作', { type: action === 'delete' || action === 'hard' ? 'warning' : 'info' })
  row.__op = action
  try {
    if (action === 'delete') await axios.delete(`/api/dispatch-order/${row.id}`)
    else if (action === 'hard') await axios.delete(`/api/dispatch-order/${row.id}/hard`)
    else await axios.post(`/api/dispatch-order/${row.id}/${action}`)
    ElMessage.success(`${textMap[action]}成功`)
    loadList()
  } catch (err) {
    ElMessage.error(err?.response?.data?.msg || `${textMap[action]}失败`)
  } finally {
    row.__op = ''
  }
}

function selectionPi() {
  return form.dispatchType === '2' ? form.piNo : form.referenceNo
}

function openGoodsDialog() {
  if (!form.workshopCode) {
    ElMessage.warning('请先选择生产车间')
    return
  }
  if (!selectionPi()) {
    ElMessage.warning('请先填写关联 PI')
    return
  }
  goodsVisible.value = true
}

function buildGoodsLine(row) {
  return {
    ...row,
    __key: `${row.kcaa01}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    scak02: row.systemcode || row.GUID,
    scak03: Number(row.availableQty ?? 0),
    scak04: Number(row.dispatchedQty ?? 0),
    scak05: Number(row.repairQty ?? 0),
  }
}

function normalizeLineQty(row) {
  const n = Number(row?.scak03 ?? 0)
  row.scak03 = Number.isFinite(n) && n >= 0 ? Number(n.toFixed(2)) : 0
}

function isLineMarked(row) {
  const key = String(row?.__key ?? '')
  return !!markedLineMap.value[key]
}

function toggleLineMarked(row) {
  const key = String(row?.__key ?? '')
  if (!key) return
  markedLineMap.value = {
    ...markedLineMap.value,
    [key]: !markedLineMap.value[key],
  }
}

async function removeMarkedLines() {
  if (!hasMarkedLines.value) {
    ElMessage.warning('请先选择要删除的明细')
    return
  }
  try {
    await ElMessageBox.confirm('确认删除已选择的明细吗？', '确认操作', { type: 'warning' })
    lines.value = lines.value.filter((line) => !markedLineMap.value[String(line?.__key ?? '')])
    markedLineMap.value = {}
    ElMessage.success('已删除选定明细')
  } catch {
    // 用户取消删除
  }
}

async function removeAllLines() {
  if (!lines.value.length) return
  try {
    await ElMessageBox.confirm('确认删除全部明细吗？', '确认操作', { type: 'warning' })
    lines.value = []
    markedLineMap.value = {}
    ElMessage.success('已删除全部明细')
  } catch {
    // 用户取消删除
  }
}

function initSelectedGoodsMap() {
  const map = {}
  for (const line of lines.value) {
    const code = String(line?.kcaa01 ?? '').trim()
    if (code) map[code] = true
  }
  selectedGoodsMap.value = map
}

function onGoodsDialogOpen() {
  initSelectedGoodsMap()
  loadGoods()
}

function selectAllSelectableGoods() {
  const map = { ...selectedGoodsMap.value }
  for (const row of goodsList.value) {
    const code = String(row?.kcaa01 ?? '').trim()
    if (!code) continue
    if (!row.selectable) continue
    map[code] = true
  }
  selectedGoodsMap.value = map
}

async function loadGoods() {
  goodsLoading.value = true
  try {
    const res = await axios.get('/api/dispatch-order/goods-options', {
      params: {
        pi: selectionPi(),
        dispatchType: form.dispatchType,
        workshopCode: form.workshopCode,
        workshopName: form.workshopName,
        excludeOrderNo: editId.value ? lines.value[0]?.scak01 || '' : '',
        pageSize: 100,
      },
    })
    goodsList.value = res.data?.data?.list ?? []
  } catch (err) {
    ElMessage.error(err?.response?.data?.msg || '读取可派工货品失败')
  } finally {
    goodsLoading.value = false
  }
}

function isGoodsSelected(kcaa01) {
  const code = String(kcaa01 ?? '').trim()
  return !!selectedGoodsMap.value[code]
}

function toggleGoodsSelection(row) {
  const code = String(row?.kcaa01 ?? '').trim()
  if (!code) return
  const selected = !!selectedGoodsMap.value[code]
  if (!selected && !row.selectable) {
    ElMessage.warning('可派工数量不足，不能选择')
    return
  }
  selectedGoodsMap.value = {
    ...selectedGoodsMap.value,
    [code]: !selected,
  }
}

function resetGoodsSelection() {
  selectedGoodsMap.value = {}
}

function saveSelectedGoods() {
  const selectedCodes = Object.entries(selectedGoodsMap.value)
    .filter(([, picked]) => !!picked)
    .map(([code]) => code)
  const selectedSet = new Set(selectedCodes)
  const goodsByCode = new Map(goodsList.value.map((row) => [String(row?.kcaa01 ?? '').trim(), row]))
  const nextLines = []
  for (const code of selectedSet) {
    const goodsRow = goodsByCode.get(code)
    if (goodsRow) {
      nextLines.push(buildGoodsLine(goodsRow))
      continue
    }
    const oldLine = lines.value.find((line) => String(line?.kcaa01 ?? '').trim() === code)
    if (oldLine) nextLines.push({ ...oldLine })
  }
  lines.value = nextLines
  markedLineMap.value = {}
  goodsVisible.value = false
  ElMessage.success('已保存本次选择')
}

onMounted(() => {
  loadList()
})
</script>

<style scoped>
.dispatch-page {
  min-height: 100%;
}
.dispatch-mode-bar,
.dispatch-toolbar,
.form-head,
.line-toolbar,
.goods-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}
.erp-section {
  padding: 12px;
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color-light);
  border-radius: 6px;
}
.filter-keyword {
  width: 280px;
}
.filter-select {
  width: 130px;
}
.dispatch-alert {
  margin-bottom: 12px;
}
.dispatch-pagination {
  margin-top: 12px;
  justify-content: flex-end;
}
.form-head {
  justify-content: space-between;
}
.dispatch-form {
  max-width: 1280px;
}
.dispatch-header-rows {
  display: flex;
  flex-direction: column;
  --dispatch-field-width: 290px;
  --dispatch-row-gap: 14px;
}
.dispatch-form-row {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  column-gap: var(--dispatch-row-gap);
  row-gap: 8px;
}
.dispatch-form-row--1 {
  flex-direction: column;
}
.dispatch-form-row :deep(.el-input),
.dispatch-form-row :deep(.el-select),
.dispatch-form-row :deep(.el-date-editor),
.dispatch-form-row :deep(.el-autocomplete) {
  width: var(--dispatch-field-width);
  max-width: 100%;
}
.dispatch-form-row :deep(.el-form-item__content) {
  justify-content: flex-start;
}
.dispatch-type-btns {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.dispatch-type-btn {
  min-height: 34px;
  min-width: 98px;
  padding: 0 12px;
  border: 1px solid var(--el-border-color);
  border-radius: 4px;
  background: #fff;
  color: var(--el-text-color-primary);
  line-height: 1.4;
  cursor: pointer;
}
.dispatch-type-btn.is-active {
  background: #ff7800;
  border-color: #ff7800;
  color: #fff;
}
.dispatch-type-btn:disabled {
  cursor: not-allowed;
  opacity: 0.65;
}
.dispatch-edit-tabs {
  margin-top: 4px;
}
.dispatch-edit-tabs :deep(.el-tabs__content) {
  padding-top: 4px;
}
.detail-lines {
  margin-top: 14px;
}
.dispatch-row-detail {
  padding: 10px 12px;
  background: var(--el-fill-color-extra-light);
}
.dispatch-row-detail-table {
  width: 100%;
}
.goods-header-actions {
  margin-bottom: 10px;
}
.goods-footer-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 12px;
}
.action-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
</style>
