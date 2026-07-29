<template>
  <div class="erp-module-page dispatch-page">
    <div class="dispatch-mode-bar erp-mode-bar">
      <el-button :type="pageMode === 'list' ? 'primary' : 'default'" plain @click="switchList">派工单管理</el-button>
      <el-button v-permission="'add'" :type="pageMode === 'form' && !editId ? 'primary' : 'default'" plain @click="newOrder">
        新增派工单
      </el-button>
    </div>

    <section v-show="pageMode === 'list'" class="erp-section">
      <div class="dispatch-filter-bar">
        <div class="dispatch-filter-row dispatch-filter-row--top">
          <el-select v-model="filters.dispatchType" clearable placeholder="派工类型" class="dispatch-filter-type">
            <el-option label="本厂" value="0" />
            <el-option label="大板" value="1" />
            <el-option label="委外" value="2" />
          </el-select>
        </div>
        <div class="dispatch-filter-row dispatch-filter-row--bottom">
          <el-input
            v-model="filters.keyword"
            clearable
            placeholder="派工单号 / PI / 车间 / 备注"
            class="dispatch-filter-keyword"
            @keyup.enter="loadList"
          />
          <el-button type="primary" size="small" @click="loadList">查询</el-button>
          <div class="dispatch-filter-divider" aria-hidden="true" />
          <div class="dispatch-filter-switch">
            <span class="switch-label">回收站</span>
            <el-switch v-model="showRecycle" @change="onRecycleChange" />
          </div>
          <template v-if="!showRecycle">
            <div class="dispatch-filter-divider" aria-hidden="true" />
            <div class="dispatch-filter-switch">
              <span class="switch-label">显示未审核</span>
              <el-switch v-model="showUnaudited" @change="loadList" />
            </div>
          </template>
          <el-button size="small" @click="resetSearch">重置</el-button>
        </div>
      </div>

      <el-alert v-if="showRecycle" type="info" show-icon title="当前是回收站：只能查看、恢复或彻底删除。" class="dispatch-alert" />
      <el-alert v-else-if="showUnaudited" type="warning" show-icon title="当前显示未审核派工单，可编辑、审核或删除。" class="dispatch-alert" />

      <div class="pagination-row pagination-row--top">
        <el-pagination
          v-model:current-page="pager.page"
          v-model:page-size="pager.pageSize"
          background
          layout="total, sizes, prev, pager, next, jumper"
          :total="pager.total"
          :page-sizes="ERP_PAGE_SIZE_OPTIONS"
          @size-change="loadList"
          @current-change="loadList"
        />
      </div>

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
       @row-contextmenu="onErpListRowContextMenu">
        <el-table-column type="expand" width="1">
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
        <el-table-column label="操作" fixed="left" :width="dispatchActionsColWidth" class-name="erp-col-actions">
          <template #default="{ row }">
            <ErpTableActions @click.stop>
              <template v-if="showRecycle">
                <el-button v-permission="'delete'" type="primary" plain :loading="row.__op === 'restore'" @click="runAction(row, 'restore')">恢复</el-button>
                <el-button v-if="row.pass !== '1' && $isErpSuperAdmin()" v-permission="'delete'" type="danger" plain :loading="row.__op === 'hard'" @click="runAction(row, 'hard')">彻底删除</el-button>
              </template>
              <template v-else>
                <el-button type="info" plain @click="viewOrder(row)">查看</el-button>
                <el-button v-if="showUnaudited && row.pass !== '1'" v-permission="'edit'" type="primary" plain @click="editOrder(row)">编辑</el-button>
                <el-button v-if="showUnaudited && row.pass !== '1'" v-permission="'audit'" type="success" plain :loading="row.__op === 'audit'" @click="runAction(row, 'audit')">审核</el-button>
                <el-button v-if="!showUnaudited && row.pass === '1'" v-permission="'unaudit'" type="warning" plain :loading="row.__op === 'unaudit'" @click="runAction(row, 'unaudit')">反审核</el-button>
                <el-button v-if="showUnaudited && row.pass !== '1'" v-permission="'delete'" type="danger" plain :loading="row.__op === 'delete'" @click="runAction(row, 'delete')">删除</el-button>
              </template>
            </ErpTableActions>
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

      <div class="pagination-row pagination-row--bottom">
        <el-pagination
          v-model:current-page="pager.page"
          v-model:page-size="pager.pageSize"
          background
          layout="total, sizes, prev, pager, next, jumper"
          :total="pager.total"
          :page-sizes="ERP_PAGE_SIZE_OPTIONS"
          @size-change="loadList"
          @current-change="loadList"
        />
      </div>
    </section>

    <section v-show="pageMode === 'form' || pageMode === 'view'" class="erp-section" :class="{ 'dispatch-form-section--readonly': isReadonlyForm }">
      <div class="form-head">
        <strong class="form-head-title">{{ pageMode === 'view' ? '查看派工单' : editId ? '编辑派工单' : '新增派工单' }}</strong>
        <div>
          <el-button v-if="pageMode === 'view'" @click="switchList">返回列表</el-button>
          <template v-else>
            <el-button @click="switchList">返回列表</el-button>
            <el-button type="primary" :loading="saving" @click="saveOrder">保存</el-button>
          </template>
        </div>
      </div>
      <el-tabs v-model="editTab" class="dispatch-edit-tabs">
        <el-tab-pane label="派工单基础资料" name="header">
          <el-form :model="form" label-width="92px" class="dispatch-form">
            <div class="dispatch-header-rows">
              <div class="dispatch-form-row dispatch-form-row--1">
                <el-form-item label="派工单号">
                  <el-input :model-value="displayDispatchOrderNo" disabled />
                </el-form-item>
              </div>
              <div class="dispatch-form-row dispatch-form-row--2">
                <el-form-item label="派工日期">
                  <el-date-picker v-model="form.dispatchDate" value-format="YYYY-MM-DD" type="date" :disabled="isReadonlyForm" />
                </el-form-item>
                <el-form-item label="交货日期">
                  <el-date-picker v-model="form.deliveryDate" value-format="YYYY-MM-DD" type="date" :disabled="isReadonlyForm" />
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
                      :disabled="isReadonlyForm || !!editId || opt.value !== '0'"
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
                    :disabled="isReadonlyForm || !!editId"
                    @select="onPickReferencePi"
                  />
                  <el-input v-else v-model="form.referenceNo" :disabled="isReadonlyForm || !!editId" placeholder="请输入供应商编码" />
                </el-form-item>
                <el-form-item v-if="form.dispatchType === '2'" label="关联PI">
                  <el-autocomplete
                    v-model="form.piNo"
                    :fetch-suggestions="fetchPiSuggestions"
                    value-key="piNo"
                    clearable
                    placeholder="输入第一个字开始联想 PI"
                    :disabled="isReadonlyForm || (!!editId && lines.length > 0)"
                    @select="onPickLinkedPi"
                  />
                </el-form-item>
              </div>
              <div class="dispatch-form-row dispatch-form-row--1">
                <el-form-item label="生产车间">
                  <el-select
                    v-model="form.workshopCode"
                    :disabled="isReadonlyForm || !!editId"
                    @change="onWorkshopChange"
                  >
                    <el-option v-for="w in workshops" :key="w.code" :label="`${w.code} ${w.name}`" :value="w.code" />
                  </el-select>
                </el-form-item>
              </div>
              <div class="dispatch-form-row dispatch-form-row--1">
                <el-form-item label="备注">
                  <el-input v-model="form.remark" class="dispatch-remark-input" :readonly="isReadonlyForm" />
                </el-form-item>
              </div>
            </div>
          </el-form>
        </el-tab-pane>
        <el-tab-pane label="派工单明细" name="lines">
          <div v-if="!isReadonlyForm" class="line-toolbar">
            <el-button type="danger" plain :disabled="!hasMarkedLines" @click="removeMarkedLines">删除选定明细</el-button>
            <el-button type="danger" plain :disabled="!lines.length" @click="removeAllLines">删除全部明细</el-button>
            <el-button type="primary" plain @click="openGoodsDialog">批量添加</el-button>
          </div>
          <el-table :data="lines" border stripe row-key="__key" class="erp-list-table">
            <el-table-column v-if="!isReadonlyForm" label="操作" width="86">
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
                <template v-if="isReadonlyForm">{{ formatQty(row.scak03) }}</template>
                <el-input v-else v-model="row.scak03" inputmode="decimal" @blur="normalizeLineQty(row)" />
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
import { useErpListRowContextMenu } from '@/composables/useErpListRowContextMenu'
import { useErpDeepLinkOpen } from '@/composables/useErpDeepLinkOpen'
import { ERP_PAGE_SIZE_OPTIONS } from '@/utils/erpPagination'
import { computed, onMounted, reactive, ref } from 'vue'
import axios from 'axios'
import { ElMessage, ElMessageBox } from 'element-plus'
import { getErpTableActionsColWidthByRows } from '@/utils/erpTableActionsLayout'
import { createExpandPrefetch } from '@/utils/erpExpandPrefetch.js'
import { getPermissionModelFromStorage, hasPageAction } from '@/utils/menuPermission'
import { isErpSuperAdmin } from '@/utils/erpSuperAdmin'

defineOptions({ name: 'production-daily-dispatch' })

const menuPath = 'production/daily/dispatch'
const model = getPermissionModelFromStorage()

const { onErpListRowContextMenu } = useErpListRowContextMenu()
const pageMode = ref('list')
const loading = ref(false)
const saving = ref(false)
const list = ref([])
const showUnaudited = ref(false)
const showRecycle = ref(false)

const dispatchActionsColWidth = computed(() => {
  return getErpTableActionsColWidthByRows(list.value, getDispatchRowActionLabels)
})

/** 派工单主列表操作列按钮：与模板 v-if / v-permission 保持一致，用于估算列宽 */
function getDispatchRowActionLabels(row) {
  if (showRecycle.value) {
    if (!hasPageAction(model, menuPath, 'delete')) return []
    return ['恢复', row.pass !== '1' && isErpSuperAdmin() ? '彻底删除' : false]
  }
  const labels = ['查看']
  if (showUnaudited.value && row.pass !== '1') {
    if (hasPageAction(model, menuPath, 'edit')) labels.push('编辑')
    if (hasPageAction(model, menuPath, 'audit')) labels.push('审核')
    if (hasPageAction(model, menuPath, 'delete')) labels.push('删除')
  }
  if (!showUnaudited.value && row.pass === '1' && hasPageAction(model, menuPath, 'unaudit')) labels.push('反审核')
  return labels
}

const filters = reactive({ keyword: '', dispatchType: '' })
const pager = reactive({ page: 1, pageSize: 20, total: 0 })
const editId = ref(null)
const viewId = ref(null)
const form = reactive(defaultForm())
const lines = ref([])
// 派工单仅允许从业务指定的生产车间中选择；名称始终以车间主档为准。
const DISPATCH_WORKSHOP_CODES = ['01', '02', '03', '04', '06', '07', '0901', '0902', 'c']
const workshops = ref([])
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
const isReadonlyForm = computed(() => pageMode.value === 'view')
const displayDispatchOrderNo = computed(() => (editId.value || viewId.value ? form.dispatchOrderNo : '保存后自动生成'))

function defaultForm() {
  return {
    dispatchOrderNo: '',
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
  viewId.value = null
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

const expandPrefetch = createExpandPrefetch({
  fetchBatch: async (ids) => {
    const { data } = await axios.get('/api/dispatch-order/expand-lines/batch', { params: { ids: ids.join(',') } })
    if (data.code !== 200) throw new Error(data.msg)
    return data.data || {}
  },
  fetchSingle: async (id) => {
    const res = await axios.get(`/api/dispatch-order/${id}`)
    return { lines: res.data?.data?.lines ?? [] }
  },
  getRowId: (row) => Number(row?.id),
  applyToRow: (row, payload) => {
    const key = String(row?.id ?? '')
    if (!key) return
    detailCache.value = {
      ...detailCache.value,
      [key]: Array.isArray(payload?.lines) ? payload.lines : [],
    }
    row.__detailLoading = false
  },
  resetRow: (row) => {
    const key = String(row?.id ?? '')
    if (key) {
      const next = { ...detailCache.value }
      delete next[key]
      detailCache.value = next
    }
    row.__detailLoading = false
  },
  onError: (msg) => ElMessage.error(msg),
})

function rowDetails(row) {
  const key = String(row?.id ?? '')
  return detailCache.value[key] ?? []
}

async function loadRowDetail(row) {
  const key = String(row?.id ?? '')
  if (!key || detailCache.value[key] || row.__detailLoading) return
  await expandPrefetch.ensureLoaded(row)
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
    expandPrefetch.prefetch(list.value)
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
  editId.value = null
  viewId.value = null
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

async function loadWorkshops() {
  try {
    const res = await axios.get('/api/dispatch-order/workshop-options')
    const all = res.data?.data?.list ?? []
    const byCode = new Map(all.map((row) => [String(row?.code ?? '').trim().toLowerCase(), row]))
    workshops.value = DISPATCH_WORKSHOP_CODES
      .map((code) => byCode.get(code.toLowerCase()))
      .filter(Boolean)
  } catch (err) {
    workshops.value = []
    ElMessage.error(err?.response?.data?.msg || '读取生产车间失败')
  }
}

function onTypeChange() {
  form.referenceNo = ''
  form.piNo = ''
  lines.value = []
  markedLineMap.value = {}
}

function onDispatchTypeClick(value) {
  if (editId.value || isReadonlyForm.value) return
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

async function loadOrderIntoForm(id) {
  const res = await axios.get(`/api/dispatch-order/${id}`)
  const h = res.data?.data?.header ?? {}
  Object.assign(form, {
    dispatchOrderNo: String(h.scaj01 ?? ''),
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
}

async function viewOrder(row) {
  try {
    await loadOrderIntoForm(row.id)
    viewId.value = row.id
    editId.value = null
    pageMode.value = 'view'
  } catch (err) {
    ElMessage.error(err?.response?.data?.msg || '读取派工单失败')
  }
}

useErpDeepLinkOpen({
  handlers: {
    view: async (recordId) => {
      const id = Number(recordId)
      if (!Number.isFinite(id) || id <= 0) return
      await viewOrder({ id })
    },
  },
})

async function editOrder(row) {
  await loadOrderIntoForm(row.id)
  editId.value = row.id
  viewId.value = null
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
  loadWorkshops()
  loadList()
})
</script>

<style scoped>
.dispatch-page {
  min-height: 100%;
}
/* 顶栏与出入库一致：外框/留白走全局 erp-mode-bar */
.dispatch-mode-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
}
.form-head,
.line-toolbar,
.goods-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}
/* DIY：派工单明细工具栏按钮（删除选定/删除全部/批量添加）；高度建议 36～48，字号建议 13～16 */
.line-toolbar {
  --dispatch-line-toolbar-btn-height: 36px;
  --dispatch-line-toolbar-btn-font-size: 16px;
}
.line-toolbar :deep(.el-button) {
  height: var(--dispatch-line-toolbar-btn-height);
  min-height: var(--dispatch-line-toolbar-btn-height);
  font-size: var(--dispatch-line-toolbar-btn-font-size);
}
/* DIY：派工单添加/编辑表单头（标题「新增/编辑/查看派工单」+ 返回列表/保存）
   标题字号建议 16～22；按钮高度建议 36～48，字号建议 13～16 */
.form-head {
  --dispatch-form-head-title-font-size: 18px;
  --dispatch-form-head-btn-height: 36px;
  --dispatch-form-head-btn-font-size: 16px;
}
.form-head-title {
  font-size: var(--dispatch-form-head-title-font-size);
}
.form-head :deep(.el-button) {
  height: var(--dispatch-form-head-btn-height);
  min-height: var(--dispatch-form-head-btn-height);
  font-size: var(--dispatch-form-head-btn-font-size);
}
.dispatch-page {
  --dispatch-filter-type-width: 160px;
  --dispatch-filter-keyword-width: 420px;
  --dispatch-filter-switch-gap: 20px;
}
.dispatch-filter-bar {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 10px;
  width: 100%;
  margin-bottom: 12px;
}
.dispatch-filter-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-start;
  gap: 8px;
  width: 100%;
}
.dispatch-filter-type {
  width: min(var(--dispatch-filter-type-width, 160px), 100%);
}
.dispatch-filter-keyword {
  flex: 0 1 var(--dispatch-filter-keyword-width, 420px);
  width: min(var(--dispatch-filter-keyword-width, 420px), 100%);
}
.dispatch-filter-divider {
  width: 1px;
  height: 22px;
  margin: 0 var(--dispatch-filter-switch-gap, 20px);
  background: var(--el-border-color);
  flex-shrink: 0;
}
.dispatch-filter-switch {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.switch-label {
  color: var(--el-text-color-regular);
  font-size: 14px;
  white-space: nowrap;
}
/* 与出入库一致：列表/添加内容区不加外框线 */
.erp-section {
  background: transparent;
  border: none;
  border-radius: 0;
  padding: 0;
}
.dispatch-alert {
  margin-bottom: 12px;
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
  /* DIY：基础资料单行输入高度（对齐出库单）；不含派工类型按钮 */
  --dispatch-base-input-height: var(--el-component-size);
  /* DIY：备注高度（派工单备注为单行，默认与单行同高） */
  --dispatch-remark-input-height: calc(var(--dispatch-base-input-height) * 1);
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
/* 只统一单行输入/下拉/日期/自动完成高度；不碰派工类型按钮 */
.dispatch-header-rows :deep(.el-input__wrapper),
.dispatch-header-rows :deep(.el-select__wrapper) {
  height: var(--dispatch-base-input-height);
  min-height: var(--dispatch-base-input-height);
  box-sizing: border-box;
}
.dispatch-header-rows :deep(.el-date-editor),
.dispatch-header-rows :deep(.el-autocomplete) {
  height: var(--dispatch-base-input-height);
}
.dispatch-header-rows :deep(.dispatch-remark-input .el-input__wrapper) {
  height: var(--dispatch-remark-input-height);
  min-height: var(--dispatch-remark-input-height);
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
  background: var(--erp-surface, #fff);
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
.dispatch-form-section--readonly :deep(.el-input.is-disabled .el-input__wrapper),
.dispatch-form-section--readonly :deep(.el-input__wrapper) {
  background-color: var(--el-fill-color-blank);
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
