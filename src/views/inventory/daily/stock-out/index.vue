<template>
  <div class="erp-module-page stock-out-page" :class="{ 'stock-out-page--form': pageMode === 'form' }">
    <div class="stock-out-mode-bar">
      <el-button :type="pageMode === 'list' ? 'primary' : 'default'" plain @click="switchList">管理出库单</el-button>
      <el-button v-permission="'add'" :type="pageMode === 'form' && !editId ? 'primary' : 'default'" plain @click="newOrder">出库单添加</el-button>
      <el-button plain @click="ElMessage.info('搜索出库单请直接使用列表上方查询条件')">搜索出库单</el-button>
      <el-button plain :type="showRecycle ? 'primary' : 'default'" @click="toggleRecycle">恢复出库单</el-button>
      <el-button plain @click="showUnaudited = true; showRecycle = false; loadList()">审核申请</el-button>
      <el-button v-permission="'export'" plain @click="ElMessage.info('真实 Excel 导出待开发，后续由后端生成并遵守价格权限')">导出信息</el-button>
    </div>

    <section v-show="pageMode === 'list'" class="erp-section">
      <div class="stock-filter-bar">
        <div class="stock-filter-row stock-filter-row--top">
          <el-select
            v-model="filters.relatedParty"
            clearable
            filterable
            remote
            reserve-keyword
            class="stock-filter-related"
            :remote-method="fetchFilterRelatedParties"
            :loading="filterRelatedPartyLoading"
            placeholder="供应商/外协商"
            @focus="handleFilterRelatedPartyFocus"
          >
            <el-option
              v-for="item in filterRelatedParties"
              :key="item.code"
              :label="`${item.code} ${item.name}`"
              :value="item.code"
            />
          </el-select>
          <el-select v-model="filters.outboundType" clearable class="stock-filter-type" placeholder="出库类型">
            <el-option v-for="opt in outboundTypeOptions" :key="opt.value" :label="opt.label" :value="opt.value" />
          </el-select>
        </div>
        <div class="stock-filter-row stock-filter-row--bottom">
          <el-input
            v-model="filters.keyword"
            clearable
            class="stock-filter-keyword"
            placeholder="出库单号 / 关联单号 / 备注"
            @keyup.enter="onSearch"
          />
          <el-button type="primary" size="small" @click="onSearch">查询</el-button>
          <div class="stock-filter-divider" aria-hidden="true" />
          <div class="stock-filter-switch">
            <span class="switch-label">回收站</span>
            <el-switch v-model="showRecycle" @change="onRecycleChange" />
          </div>
          <template v-if="!showRecycle">
            <div class="stock-filter-divider" aria-hidden="true" />
            <div class="stock-filter-switch">
              <span class="switch-label">显示未审核</span>
              <el-switch v-model="showUnaudited" @change="onSearch" />
            </div>
          </template>
          <el-button size="small" @click="resetSearch">重置</el-button>
        </div>
      </div>

      <el-alert v-if="showRecycle" type="info" show-icon title="当前是回收站：只处理已软删除的待审核出库单。" class="stock-alert" />
      <el-alert v-else-if="showUnaudited" type="warning" show-icon title="当前显示待审核出库单，可编辑、审核或删除。" class="stock-alert" />

      <el-table v-loading="loading" :data="list" border stripe row-key="id" class="erp-list-table" :empty-text="loading ? '加载中' : '暂无数据'">
        <el-table-column label="操作" fixed="left" width="260">
          <template #default="{ row }">
            <div class="row-actions">
              <el-button size="small" plain @click="viewOrder(row)">查看</el-button>
              <el-button size="small" plain @click="printOrder(row)">打印</el-button>
              <template v-if="!showRecycle">
                <el-button v-if="canEdit(row)" v-permission="'edit'" size="small" type="primary" plain @click="editOrder(row)">编辑</el-button>
                <el-button v-if="canAudit(row)" v-permission="'audit'" size="small" plain :loading="row.__op === 'audit'" @click="runAction(row, 'audit')">审核</el-button>
                <el-button v-if="canUnaudit(row)" v-permission="'audit'" size="small" plain :loading="row.__op === 'unaudit'" @click="runAction(row, 'unaudit')">反审核</el-button>
                <el-button v-if="canDelete(row)" v-permission="'delete'" size="small" type="danger" plain :loading="row.__op === 'delete'" @click="runAction(row, 'delete')">删除</el-button>
                <span v-if="isLocked(row)" class="locked-mark" title="此单已结案，不可操作">只读</span>
              </template>
              <template v-else>
                <el-button v-permission="'delete'" size="small" type="primary" plain :loading="row.__op === 'restore'" @click="runAction(row, 'restore')">恢复</el-button>
                <el-button v-permission="'delete'" size="small" type="danger" plain :loading="row.__op === 'hard'" @click="runAction(row, 'hard')">彻底删除</el-button>
              </template>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="150">
          <template #default="{ row }">
            <div class="status-tags">
              <el-tag :type="row.pass === '1' ? 'success' : 'warning'" size="small">{{ row.pass === '1' ? '已审核' : '待审核' }}</el-tag>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="出库类型" width="130">
          <template #default="{ row }">{{ outboundTypeText(row.outboundType) }}</template>
        </el-table-column>
        <el-table-column label="出库单号" prop="outboundNo" min-width="150" show-overflow-tooltip />
        <el-table-column label="关联单号" prop="sourceOrderNo" min-width="150" show-overflow-tooltip />
        <el-table-column label="出库日期" width="120">
          <template #default="{ row }">{{ formatDate(row.outboundDate) }}</template>
        </el-table-column>
        <el-table-column label="仓库" min-width="150" show-overflow-tooltip>
          <template #default="{ row }">{{ row.warehouseName || row.warehouseCode || '-' }}</template>
        </el-table-column>
        <el-table-column label="关联方" prop="relatedPartyName" min-width="180" show-overflow-tooltip />
        <el-table-column label="数量" prop="totalQty" width="100" align="right" />
        <template v-if="hasPricePermission">
          <el-table-column label="不含税金额" prop="taxExcludedTotal" width="120" align="right" />
          <el-table-column label="含税金额" prop="taxIncludedTotal" width="120" align="right" />
        </template>
        <el-table-column label="经手人" prop="handlerName" min-width="110" show-overflow-tooltip />
        <el-table-column label="备注" prop="remark" min-width="180" show-overflow-tooltip />
      </el-table>

      <el-pagination
        v-model:current-page="pager.page"
        v-model:page-size="pager.pageSize"
        :page-sizes="[10, 20, 50, 100]"
        layout="total, sizes, prev, pager, next, jumper"
        :total="pager.total"
        class="pagination"
        @size-change="loadList"
        @current-change="loadList"
      />
    </section>

    <section v-show="pageMode === 'form'" class="erp-section">
      <div class="form-head">
        <strong>{{ editId ? '编辑出库单' : '新增出库单' }}</strong>
        <div>
          <el-button @click="resetForm">重置</el-button>
          <el-button type="primary" :loading="saving" @click="saveOrder">保存</el-button>
        </div>
      </div>

      <el-tabs v-model="formTab">
        <el-tab-pane label="出库单基础资料" name="base">
          <el-form :model="form" label-width="96px" class="stock-form stock-form--base">
            <el-form-item label="出库单号">
              <el-input :model-value="displayOutboundNo" readonly class="stock-unified-input" />
            </el-form-item>
            <el-form-item label="出库日期">
              <el-date-picker v-model="form.outboundDate" type="datetime" value-format="YYYY-MM-DD HH:mm:ss" class="stock-unified-input" />
            </el-form-item>
            <el-form-item label="出库类型">
              <div class="stock-type-buttons">
                <el-button
                  v-for="opt in addableOutboundTypes"
                  :key="opt.value"
                  size="large"
                  class="stock-type-btn"
                  :type="form.outboundType === opt.value ? 'primary' : 'default'"
                  :plain="form.outboundType !== opt.value"
                  :disabled="!!editId"
                  @click="pickOutboundType(opt.value)"
                >
                  {{ opt.label }}
                </el-button>
              </div>
            </el-form-item>
            <el-form-item label="关联单号">
              <el-input v-model="form.sourceOrderNo" class="stock-unified-input" :disabled="!isLinkedType" placeholder="关联型出库必须填写来源单号" />
            </el-form-item>
            <el-form-item :label="relatedPartyLabel">
              <el-input v-if="form.outboundType === '0'" v-model="form.relatedPartyName" class="stock-unified-input" placeholder="可填写自由文本关联单位" />
              <span v-else-if="form.outboundType === '9'" class="muted">盘亏出库不强制关联单位</span>
              <el-select v-else v-model="form.relatedPartyCode" filterable remote reserve-keyword clearable class="stock-unified-input" :remote-method="fetchRelatedParties" @focus="fetchRelatedParties('')" placeholder="请选择关联方">
                <el-option v-for="item in relatedPartyOptions" :key="item.code" :label="`${item.code} ${item.name}`" :value="item.code" />
              </el-select>
            </el-form-item>
            <el-form-item label="仓库" class="form-row-inline">
              <div class="form-inline-pairs">
                <el-select v-model="form.warehouseCode" filterable remote reserve-keyword clearable class="stock-unified-input" :remote-method="fetchWarehouses" @focus="fetchWarehouses('')" placeholder="请选择仓库">
                  <el-option v-for="item in warehouseOptions" :key="item.code" :label="`${item.code} ${item.name}`" :value="item.code" />
                </el-select>
                <div class="inline-pair">
                  <span class="inline-pair__label">纸质单号</span>
                  <el-input v-model="form.paperNo" class="stock-unified-input" clearable placeholder="纸质单号" />
                </div>
                <div class="inline-pair">
                  <span class="inline-pair__label">预留单号</span>
                  <el-input v-model="form.reserveNo" class="stock-unified-input" clearable placeholder="预留单号" />
                </div>
              </div>
            </el-form-item>
            <el-form-item label="是否含税">
              <el-radio-group v-model="form.inTax">
                <el-radio-button label="1">含税</el-radio-button>
                <el-radio-button label="2">不含税</el-radio-button>
              </el-radio-group>
            </el-form-item>
            <el-form-item label="备注">
              <el-input v-model="form.remark" class="stock-remark-input" type="textarea" :rows="3" />
            </el-form-item>
          </el-form>
        </el-tab-pane>
        <el-tab-pane label="出库单明细" name="lines">
          <div class="line-toolbar">
            <el-input v-model="materialKeyword" clearable placeholder="库存物料编码关键字" class="line-search" @keyup.enter="openMaterialPicker" />
            <el-button type="primary" @click="openMaterialPicker">批量添加</el-button>
            <el-button @click="addBlankLine">增加明细</el-button>
            <span class="muted">关联型出库第一版先按来源标识校验，后续可细化独立来源窗口。</span>
          </div>
          <el-table :data="form.lines" border stripe class="erp-list-table">
            <el-table-column label="操作" width="80">
              <template #default="{ $index }">
                <el-button link type="danger" @click="removeLine($index)">删除</el-button>
              </template>
            </el-table-column>
            <el-table-column label="材料编码" min-width="140">
              <template #default="{ row }"><el-input v-model="row.kcaa01" /></template>
            </el-table-column>
            <el-table-column label="来源明细" min-width="140">
              <template #default="{ row }"><el-input v-model="row.kcaq02" :disabled="!isLinkedType" /></template>
            </el-table-column>
            <el-table-column label="名称" min-width="150">
              <template #default="{ row }"><el-input v-model="row.kcaa02" /></template>
            </el-table-column>
            <el-table-column label="规格" min-width="130">
              <template #default="{ row }"><el-input v-model="row.kcaa03" /></template>
            </el-table-column>
            <el-table-column label="颜色" min-width="100">
              <template #default="{ row }"><el-input v-model="row.kcaa11" /></template>
            </el-table-column>
            <el-table-column label="单位" width="90">
              <template #default="{ row }"><el-input v-model="row.kcaa04" /></template>
            </el-table-column>
            <el-table-column label="数量" width="130">
              <template #default="{ row }"><el-input-number v-model="row.kcaq03" :min="0" :precision="4" controls-position="right" /></template>
            </el-table-column>
            <template v-if="hasPricePermission">
              <el-table-column label="不含税单价" width="140">
                <template #default="{ row }"><el-input-number v-model="row.kcaq04" :min="0" :precision="4" controls-position="right" @change="recalcLine(row)" /></template>
              </el-table-column>
              <el-table-column label="含税单价" width="140">
                <template #default="{ row }"><el-input-number v-model="row.kcaq041" :min="0" :precision="4" controls-position="right" @change="reverseLine(row)" /></template>
              </el-table-column>
              <el-table-column label="税点" width="120">
                <template #default="{ row }"><el-input-number v-model="row.tax" :min="0" :precision="4" controls-position="right" @change="recalcLine(row)" /></template>
              </el-table-column>
              <el-table-column label="金额" width="110" prop="kcaq05" />
              <el-table-column label="含税金额" width="120" prop="kcaq051" />
            </template>
            <el-table-column label="备注" min-width="160">
              <template #default="{ row }"><el-input v-model="row.Describe" /></template>
            </el-table-column>
          </el-table>
        </el-tab-pane>
      </el-tabs>
    </section>

    <el-dialog v-model="detailVisible" title="出库单详情" width="86%">
      <el-descriptions v-if="detail.header" :column="3" border>
        <el-descriptions-item label="出库单号">{{ detail.header.kcap01 || detail.header.outboundNo }}</el-descriptions-item>
        <el-descriptions-item label="出库类型">{{ outboundTypeText(detail.header.kcap03 || detail.header.outboundType) }}</el-descriptions-item>
        <el-descriptions-item label="审核状态">{{ detail.header.pass === '1' ? '已审核' : '待审核' }}</el-descriptions-item>
        <el-descriptions-item label="仓库">{{ detail.header.ck || detail.header.kcap06 }}</el-descriptions-item>
        <el-descriptions-item label="关联方">{{ detail.header.kehu || detail.header.kcap05 }}</el-descriptions-item>
        <el-descriptions-item label="关联单号">{{ detail.header.kcap04 || '-' }}</el-descriptions-item>
      </el-descriptions>
      <el-table :data="detail.lines" border stripe class="detail-lines">
        <el-table-column type="index" label="序号" width="60" />
        <el-table-column prop="kcaa01" label="材料编码" min-width="140" />
        <el-table-column prop="kcaa02" label="名称" min-width="150" />
        <el-table-column prop="kcaa03" label="规格" min-width="130" />
        <el-table-column prop="kcaa11" label="颜色" width="100" />
        <el-table-column prop="kcaq03" label="数量" width="110" />
        <template v-if="hasPricePermission">
          <el-table-column prop="kcaq04" label="单价" width="110" />
          <el-table-column prop="kcaq05" label="金额" width="110" />
        </template>
        <el-table-column prop="Describe" label="备注" min-width="180" />
      </el-table>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import axios from 'axios'
import { ElMessage, ElMessageBox } from 'element-plus'

const OUTBOUND_TYPES = [
  { value: '0', label: '其他出库' },
  { value: '1', label: '采购退货' },
  { value: '2', label: '外协领料' },
  { value: '3', label: '外协退货' },
  { value: '4', label: '生产领料' },
  { value: '5', label: '生产返修' },
  { value: '6', label: '成品出库' },
  { value: '7', label: '生产领料（计划外）' },
  { value: '8', label: '生产领料（补数）' },
  { value: '9', label: '盘亏出库' },
  { value: '10', label: '销售出库' },
]
const pageMode = ref('list')
const formTab = ref('base')
const showRecycle = ref(false)
const showUnaudited = ref(false)
const loading = ref(false)
const saving = ref(false)
const list = ref([])
const editId = ref(null)
const suggestedNo = ref('')
const warehouseOptions = ref([])
const relatedPartyOptions = ref([])
const filterRelatedParties = ref([])
const filterRelatedPartyLoading = ref(false)
const materialKeyword = ref('')
const detailVisible = ref(false)
const detail = reactive({ header: null, lines: [] })

const pager = reactive({ page: 1, pageSize: 20, total: 0 })
const filters = reactive({ outboundType: '', keyword: '', relatedParty: '' })
const form = reactive(defaultForm())

const outboundTypeOptions = OUTBOUND_TYPES
const addableOutboundTypes = OUTBOUND_TYPES
const hasPricePermission = computed(() => true)
const displayOutboundNo = computed(() => form.outboundNo || suggestedNo.value || '保存时生成')
const isLinkedType = computed(() => ['1', '2', '3', '4', '5', '6'].includes(form.outboundType))
const relatedPartyLabel = computed(() => {
  if (['1'].includes(form.outboundType)) return '供应商'
  if (['2', '3'].includes(form.outboundType)) return '外协客户'
  if (['4', '5'].includes(form.outboundType)) return '生产车间'
  if (form.outboundType === '6') return '客户'
  return '关联单位'
})

function nowText() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

function formatDateTime(v) {
  if (!v) return ''
  return String(v).replace('T', ' ').slice(0, 19)
}

function defaultForm() {
  return {
    outboundNo: '',
    outboundDate: nowText(),
    outboundType: '0',
    sourceOrderNo: '',
    relatedPartyCode: '',
    relatedPartyName: '',
    warehouseCode: '',
    handlerName: '',
    paperNo: '',
    reserveNo: '',
    inTax: '1',
    remark: '',
    lines: [],
  }
}

function outboundTypeText(value) {
  return OUTBOUND_TYPES.find((item) => item.value === String(value ?? ''))?.label || '-'
}

function formatDate(value) {
  return String(value ?? '').slice(0, 10) || '-'
}

function canEdit(row) {
  return row.pass !== '1' && row.del !== '1' && row.closed !== '1'
}
function canAudit(row) {
  return row.pass !== '1' && row.del !== '1' && row.closed !== '1'
}
function canUnaudit(row) {
  return row.pass === '1' && row.del !== '1' && row.closed !== '1'
}
function canDelete(row) {
  return row.pass !== '1' && row.del !== '1' && row.closed !== '1'
}
function isLocked(row) {
  return row.closed === '1'
}

async function loadList() {
  loading.value = true
  try {
    const { data } = await axios.get('/api/stock-out/list', {
      params: {
        page: pager.page,
        pageSize: pager.pageSize,
        recycled: showRecycle.value ? 1 : 0,
        showUnaudited: showUnaudited.value ? 1 : 0,
        outboundType: filters.outboundType,
        keyword: filters.keyword,
        relatedParty: filters.relatedParty,
      },
    })
    list.value = data?.data?.list || []
    pager.total = Number(data?.data?.total || 0)
  } catch (err) {
    ElMessage.error(err?.response?.data?.msg || err.message || '读取出库单列表失败')
  } finally {
    loading.value = false
  }
}

function onSearch() {
  pager.page = 1
  loadList()
}
function resetSearch() {
  Object.assign(filters, { outboundType: '', keyword: '', relatedParty: '' })
  filterRelatedParties.value = []
  showUnaudited.value = false
  showRecycle.value = false
  pager.page = 1
  loadList()
}
function onRecycleChange() {
  showUnaudited.value = false
  onSearch()
}
function toggleRecycle() {
  showRecycle.value = !showRecycle.value
  onRecycleChange()
}
function switchList() {
  pageMode.value = 'list'
  loadList()
}

async function newOrder() {
  editId.value = null
  Object.assign(form, defaultForm())
  form.lines = []
  pageMode.value = 'form'
  formTab.value = 'base'
  try {
    const { data } = await axios.get('/api/stock-out/suggest-doc-no')
    suggestedNo.value = data?.data?.suggested || ''
  } catch {
    suggestedNo.value = ''
  }
}

async function editOrder(row) {
  try {
    const { data } = await axios.get(`/api/stock-out/${row.id}`)
    const h = data?.data?.header || {}
    editId.value = row.id
    Object.assign(form, {
      outboundNo: h.kcap01 || row.outboundNo || '',
      outboundDate: formatDateTime(h.kcap02 || row.outboundDate),
      outboundType: String(h.kcap03 || row.outboundType || '0'),
      sourceOrderNo: h.kcap04 || '',
      relatedPartyCode: h.kcap05 || '',
      relatedPartyName: h.kehu || '',
      warehouseCode: h.kcap06 || '',
      handlerName: h.kcap07 || '',
      paperNo: h.kcap08 || '',
      reserveNo: h.kcap09 || '',
      inTax: String(h.in_tax || '1'),
      remark: h.remark || '',
      lines: (data?.data?.lines || []).map((line) => ({ ...line, tax: Number(line.tax ?? line.Tax ?? 0) })),
    })
    pageMode.value = 'form'
    formTab.value = 'base'
  } catch (err) {
    ElMessage.error(err?.response?.data?.msg || err.message || '读取出库单失败')
  }
}

function resetForm() {
  if (editId.value) return ElMessage.info('编辑时请重新打开单据恢复原内容')
  Object.assign(form, defaultForm())
  form.lines = []
}

function pickOutboundType(type) {
  if (form.outboundType === type) return
  form.outboundType = type
  form.sourceOrderNo = ''
  form.relatedPartyCode = ''
  form.relatedPartyName = ''
  form.lines = []
}

async function fetchWarehouses(keyword = '') {
  const { data } = await axios.get('/api/stock-out/warehouse-options', { params: { keyword } })
  warehouseOptions.value = data?.data?.list || []
}

async function fetchFilterRelatedParties(keyword = '') {
  const kw = String(keyword ?? '').trim()
  filterRelatedPartyLoading.value = true
  try {
    const useTyped = ['1', '2', '3', '4', '5', '6'].includes(String(filters.outboundType ?? ''))
    const url = useTyped ? '/api/stock-out/related-party-options' : '/api/stock-out/list-related-party-options'
    const params = { keyword: kw }
    if (useTyped) params.outboundType = filters.outboundType
    const { data } = await axios.get(url, { params })
    filterRelatedParties.value = data?.data?.list || []
  } catch {
    filterRelatedParties.value = []
  } finally {
    filterRelatedPartyLoading.value = false
  }
}

function handleFilterRelatedPartyFocus() {
  if (!filterRelatedParties.value.length) fetchFilterRelatedParties('')
}

async function fetchRelatedParties(keyword = '') {
  if (form.outboundType === '0' || form.outboundType === '9') return
  const { data } = await axios.get('/api/stock-out/related-party-options', { params: { outboundType: form.outboundType, keyword } })
  relatedPartyOptions.value = data?.data?.list || []
}

function validateBeforeSave() {
  if (!form.outboundType) return '请先选择出库类型。'
  if (!form.inTax) return '请先选择是否含税。'
  if (!form.warehouseCode) return '请先选择仓库。'
  if (isLinkedType.value && !form.sourceOrderNo) return '关联型出库必须填写关联单号'
  if (!form.lines.length) return '出库单至少需要一条明细'
  const bad = form.lines.findIndex((line) => !line.kcaa01 || Number(line.kcaq03 || 0) <= 0)
  if (bad >= 0) return `第 ${bad + 1} 行请填写材料编码和出库数量`
  return ''
}

async function saveOrder() {
  const msg = validateBeforeSave()
  if (msg) return ElMessage.warning(msg)
  saving.value = true
  try {
    const body = { header: { ...form }, lines: form.lines }
    const { data } = editId.value
      ? await axios.put(`/api/stock-out/${editId.value}`, body)
      : await axios.post('/api/stock-out', body)
    ElMessage.success(data?.msg || '保存成功')
    pageMode.value = 'list'
    await loadList()
  } catch (err) {
    ElMessage.error(err?.response?.data?.msg || err.message || '保存出库单失败')
  } finally {
    saving.value = false
  }
}

async function viewOrder(row) {
  try {
    const { data } = await axios.get(`/api/stock-out/${row.id}`)
    detail.header = data?.data?.header || null
    detail.lines = data?.data?.lines || []
    detailVisible.value = true
  } catch (err) {
    ElMessage.error(err?.response?.data?.msg || err.message || '读取出库单失败')
  }
}

function printOrder(row) {
  window.open(`/api/stock-out/print-data?id=${encodeURIComponent(row.id)}`, '_blank')
}

async function runAction(row, action) {
  const map = {
    audit: { method: 'post', url: `/api/stock-out/${row.id}/audit`, text: '审核' },
    unaudit: { method: 'post', url: `/api/stock-out/${row.id}/unaudit`, text: '反审核' },
    restore: { method: 'post', url: `/api/stock-out/${row.id}/restore`, text: '恢复' },
    delete: { method: 'delete', url: `/api/stock-out/${row.id}`, text: '删除' },
    hard: { method: 'delete', url: `/api/stock-out/${row.id}/hard`, text: '彻底删除' },
  }
  const cfg = map[action]
  if (!cfg) return
  await ElMessageBox.confirm(`确认${cfg.text}这张出库单？`, '确认操作', { type: action === 'hard' || action === 'delete' ? 'warning' : 'info' })
  row.__op = action
  try {
    const { data } = await axios({ method: cfg.method, url: cfg.url })
    ElMessage.success(data?.msg || `${cfg.text}成功`)
    await loadList()
  } catch (err) {
    ElMessage.error(err?.response?.data?.msg || err.message || `${cfg.text}失败`)
  } finally {
    row.__op = ''
  }
}

function addBlankLine() {
  form.lines.push({ kcaa01: '', kcaq02: isLinkedType.value ? form.sourceOrderNo : '', kcaa02: '', kcaa03: '', kcaa11: '', kcaa04: '', kcaq03: 1, kcaq04: 0, kcaq041: 0, kcaq05: 0, kcaq051: 0, tax: 0, Describe: '' })
}

function removeLine(index) {
  form.lines.splice(index, 1)
}

async function openMaterialPicker() {
  if (!form.outboundType) return ElMessage.warning('请先选择出库类型。')
  if (!form.inTax) return ElMessage.warning('请先选择是否含税。')
  if (!form.warehouseCode) return ElMessage.warning('请先选择仓库。')
  try {
    const { data } = await axios.get('/api/stock-out/material-options', { params: { warehouseCode: form.warehouseCode, keyword: materialKeyword.value, excludeOutboundNo: form.outboundNo } })
    const first = data?.data?.list?.[0]
    if (!first) return ElMessage.info('当前仓库没有可出库存')
    form.lines.push({
      kcaa01: first.materialCode,
      kcaa02: first.kcaa02 || '',
      kcaa03: first.kcaa03 || '',
      kcaa11: first.color || '',
      location: first.location || '',
      version: first.version || '',
      kcaq02: isLinkedType.value ? form.sourceOrderNo || first.materialCode : '',
      kcaq03: Math.max(0, Number(first.availableQty || 0)),
      availableQty: Number(first.availableQty || 0),
      kcaq04: 0,
      kcaq041: 0,
      kcaq05: 0,
      kcaq051: 0,
      tax: 0,
      Describe: '',
    })
    ElMessage.success('已带入第一条可出库存；更复杂的批量选择窗口后续可继续细化')
  } catch (err) {
    ElMessage.error(err?.response?.data?.msg || err.message || '读取可出库存失败')
  }
}

function recalcLine(row) {
  if (form.inTax === '2') row.tax = 0
  const qty = Number(row.kcaq03 || 0)
  const ex = Number(row.kcaq04 || 0)
  const tax = Number(row.tax || 0)
  row.kcaq041 = Number((ex * (1 + tax)).toFixed(4))
  row.kcaq05 = Number((qty * ex).toFixed(2))
  row.kcaq051 = Number((qty * row.kcaq041).toFixed(2))
}

function reverseLine(row) {
  if (form.inTax === '2') row.tax = 0
  const tax = Number(row.tax || 0)
  const inc = Number(row.kcaq041 || 0)
  row.kcaq04 = Number((tax === 0 ? inc : inc / (1 + tax)).toFixed(4))
  recalcLine(row)
}

onMounted(() => {
  loadList()
  fetchWarehouses('')
})
</script>

<style scoped>
.stock-out-page {
  display: flex;
  flex-direction: column;
  gap: 12px;
  /* DIY：第一行供应商/外协商输入框宽度（与入库单一致） */
  --stock-filter-related-width: 240px;
  /* DIY：第一行出库类型下拉宽度 */
  --stock-filter-type-width: 160px;
  /* DIY：第二行关键词搜索框宽度 */
  --stock-filter-keyword-width: 420px;
  /* DIY：筛选开关组之间的间隔 */
  --stock-filter-switch-gap: 20px;
}
.stock-out-mode-bar,
.line-toolbar,
.form-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.stock-filter-bar {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 10px;
  width: 100%;
  margin-bottom: 12px;
}
.stock-filter-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-start;
  gap: 8px;
  width: 100%;
}
.stock-filter-related {
  width: min(var(--stock-filter-related-width, 240px), 100%);
}
.stock-filter-type {
  width: min(var(--stock-filter-type-width, 160px), 100%);
}
.stock-filter-keyword {
  flex: 0 1 var(--stock-filter-keyword-width, 420px);
  width: min(var(--stock-filter-keyword-width, 420px), 100%);
}
.stock-filter-divider {
  width: 1px;
  height: 22px;
  margin: 0 var(--stock-filter-switch-gap, 20px);
  background: var(--el-border-color);
  flex-shrink: 0;
}
.stock-filter-switch {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.erp-section {
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color-light);
  border-radius: 6px;
  padding: 12px;
}
.switch-label,
.muted {
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
.stock-alert {
  margin: 10px 0;
}
.row-actions {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.status-tags {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}
.locked-mark {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
.pagination {
  margin-top: 12px;
  justify-content: flex-end;
}
.form-head {
  justify-content: space-between;
  margin-bottom: 12px;
}
.stock-form {
  max-width: 980px;
}
.stock-form--base {
  --stock-base-input-width: 320px;
  --stock-inline-gap: 12px;
  --stock-type-btn-gap: 10px;
  --stock-type-btn-height: 42px;
  --stock-type-btn-padding-x: 14px;
  --stock-type-btn-font-size: 16px;
  --stock-type-btn-radius: 6px;
}
.stock-unified-input {
  width: var(--stock-base-input-width);
}
.stock-remark-input {
  width: min(100%, calc(var(--stock-base-input-width) * 2 + var(--stock-inline-gap)));
}
.stock-type-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: var(--stock-type-btn-gap);
}
.stock-type-buttons :deep(.stock-type-btn) {
  height: var(--stock-type-btn-height);
  padding: 0 var(--stock-type-btn-padding-x);
  font-size: var(--stock-type-btn-font-size);
  border-radius: var(--stock-type-btn-radius);
}
.form-row-inline :deep(.el-form-item__content) {
  width: 100%;
}
.form-inline-pairs {
  display: flex;
  align-items: center;
  gap: var(--stock-inline-gap);
  width: 100%;
  flex-wrap: wrap;
}
.inline-pair {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-left: 2px;
}
.inline-pair__label {
  color: var(--el-text-color-regular);
  white-space: nowrap;
}
.line-search {
  width: 260px;
}
.detail-lines {
  margin-top: 12px;
}
</style>
