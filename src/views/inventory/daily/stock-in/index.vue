<template>
  <div class="erp-module-page stock-in-page" :class="{ 'stock-in-page--form': pageMode === 'form' }">
    <div class="stock-in-mode-bar">
      <el-button :type="pageMode === 'list' ? 'primary' : 'default'" plain @click="switchList">管理入库单</el-button>
      <el-button v-permission="'add'" :type="pageMode === 'form' && !editId ? 'primary' : 'default'" plain @click="newReceipt">
        入库单添加
      </el-button>
      <el-button plain @click="showTodo('搜索入库单请直接使用列表上方查询条件')">搜索入库单</el-button>
      <el-button plain :type="showRecycle ? 'primary' : 'default'" @click="toggleRecycle">恢复入库单</el-button>
      <el-button plain @click="showUnaudited = true; showRecycle = false; loadList()">审核申请</el-button>
      <el-button v-permission="'export'" plain @click="showTodo('真实 Excel 导出待开发，后续由后端生成并遵守价格权限')">导出信息</el-button>
      <el-button plain @click="showTodo('超量入库配置待开发，第一版默认严控超量')">超量入库配置</el-button>
    </div>

    <section v-show="pageMode === 'list'" class="erp-section">
      <div class="stock-toolbar">
        <el-input v-model="filters.keyword" clearable placeholder="入库单号 / 关联单号 / 关联方 / 备注" class="filter-keyword" @keyup.enter="loadList" />
        <el-select v-model="filters.inboundType" clearable placeholder="入库类型" class="filter-select">
          <el-option v-for="opt in inboundTypeOptions" :key="opt.value" :label="opt.label" :value="opt.value" :disabled="opt.value === '8'" />
        </el-select>
        <el-input v-model="filters.warehouseCode" clearable placeholder="仓库编码" class="filter-small" @keyup.enter="loadList" />
        <el-input v-model="filters.receiptNo" clearable placeholder="入库单号" class="filter-small" @keyup.enter="loadList" />
        <el-switch v-model="showUnaudited" :disabled="showRecycle" active-text="显示未审核" @change="loadList" />
        <el-switch v-model="showRecycle" active-text="回收站" @change="onRecycleChange" />
        <el-button type="primary" @click="loadList">查询</el-button>
        <el-button @click="resetSearch">重置</el-button>
      </div>

      <el-alert v-if="showRecycle" type="info" show-icon title="当前是回收站：只处理已软删除的待审核入库单。" class="stock-alert" />
      <el-alert v-else-if="showUnaudited" type="warning" show-icon title="当前显示待审核入库单，可编辑、审核或删除。" class="stock-alert" />

      <el-table
        ref="listTableRef"
        v-loading="loading"
        :data="list"
        border
        stripe
        row-key="id"
        class="erp-list-table"
        :expand-row-keys="expandedRowKeys"
        :empty-text="loading ? '加载中' : '暂无数据'"
        @expand-change="onExpandChange"
        @row-click="onListRowClick"
      >
        <el-table-column type="expand" width="48">
          <template #default="{ row }">
            <div v-loading="row.__linesLoading" class="stock-expand-inner">
              <div class="stock-expand-summary">
                <span>总项数：{{ formatNumber(expandSummary(row).itemCount, 0) }}</span>
                <span>总数量：{{ formatNumber(expandSummary(row).totalQty) }}</span>
                <span v-if="hasPricePermission">含税总价：{{ formatMoney(expandSummary(row).taxIncludedTotal) }}</span>
                <span v-if="hasPricePermission">不含税总价：{{ formatMoney(expandSummary(row).taxExcludedTotal) }}</span>
                <span v-if="hasPricePermission">税点总价：{{ formatMoney(expandSummary(row).taxTotal) }}</span>
                <span>入库总数量：{{ formatNumber(expandSummary(row).inboundTotalQty) }}</span>
              </div>
              <el-table :data="row.__lines || []" border stripe size="small" class="stock-expand-lines-table">
                <el-table-column label="序号" type="index" width="60" align="center" />
                <el-table-column label="关联单号相关信息" prop="kcao02" min-width="170" show-overflow-tooltip />
                <el-table-column label="关联单号" prop="kcan04" min-width="150" show-overflow-tooltip />
                <el-table-column label="材料编码" prop="kcaa01" min-width="140" show-overflow-tooltip />
                <el-table-column label="材料名称" prop="kcaa02" min-width="160" show-overflow-tooltip />
                <el-table-column label="规格" prop="kcaa03" min-width="140" show-overflow-tooltip />
                <el-table-column label="颜色" prop="kcaa11" min-width="100" show-overflow-tooltip />
                <el-table-column label="单位" prop="kcaa04" width="80" />
                <el-table-column label="入库数量" prop="kcao03" width="110" align="right" />
                <template v-if="hasPricePermission">
                  <el-table-column label="单价" prop="kcao04" width="110" align="right" />
                  <el-table-column label="单价（含税）" prop="kcao041" width="130" align="right" />
                  <el-table-column label="金额" prop="kcao05" width="110" align="right" />
                  <el-table-column label="金额（含税）" prop="kcao051" width="130" align="right" />
                  <el-table-column label="税点" prop="tax" width="100" align="right" />
                </template>
                <el-table-column label="PO/PI" prop="reference" min-width="120" show-overflow-tooltip />
                <el-table-column label="备注" prop="Describe" min-width="180" show-overflow-tooltip />
              </el-table>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="操作" fixed="left" width="360" class-name="erp-col-actions">
          <template #default="{ row }">
            <div class="stock-actions">
              <el-button size="small" plain @click="viewReceipt(row)">查看</el-button>
              <el-button size="small" plain @click="printReceipt(row)">打印</el-button>
              <template v-if="!showRecycle">
                <el-button v-if="canEdit(row)" v-permission="'edit'" size="small" type="primary" plain @click="editReceipt(row)">编辑</el-button>
                <el-button v-if="canAudit(row)" v-permission="'audit'" size="small" plain :loading="row.__op === 'audit'" @click="runAction(row, 'audit')">审核</el-button>
                <el-button v-if="canUnaudit(row)" v-permission="'audit'" size="small" plain :loading="row.__op === 'unaudit'" @click="runAction(row, 'unaudit')">反审核</el-button>
                <el-button v-if="canDelete(row)" v-permission="'delete'" size="small" type="danger" plain :loading="row.__op === 'delete'" @click="runAction(row, 'delete')">删除</el-button>
                <span v-if="isLocked(row)" class="locked-mark" title="此单只读，不可操作">🚫</span>
              </template>
              <template v-else>
                <el-button v-if="row.pass !== '1'" v-permission="'delete'" size="small" type="primary" plain :loading="row.__op === 'restore'" @click="runAction(row, 'restore')">恢复</el-button>
                <el-button v-if="row.pass !== '1'" v-permission="'delete'" size="small" type="danger" plain :loading="row.__op === 'hard'" @click="runAction(row, 'hard')">彻底删除</el-button>
              </template>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="入库单号" prop="receiptNo" fixed="left" min-width="150" show-overflow-tooltip />
        <el-table-column label="类型" width="110">
          <template #default="{ row }">{{ inboundTypeText(row.inboundType) }}</template>
        </el-table-column>
        <el-table-column label="入库日期" width="160">
          <template #default="{ row }">{{ formatDateTime(row.inboundDate) }}</template>
        </el-table-column>
        <el-table-column label="仓库" min-width="150" show-overflow-tooltip>
          <template #default="{ row }">{{ row.warehouseName || row.warehouseCode }}</template>
        </el-table-column>
        <el-table-column label="关联方" prop="relatedPartyName" min-width="160" show-overflow-tooltip />
        <el-table-column label="关联单号" prop="sourceOrderNo" min-width="150" show-overflow-tooltip />
        <el-table-column label="纸质单号" prop="paperNo" min-width="130" show-overflow-tooltip />
        <el-table-column label="审核" width="90">
          <template #default="{ row }">
            <el-tag v-if="row.pass === '1'" type="success" size="small">已审</el-tag>
            <el-tag v-else type="warning" size="small">待审</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="锁定" width="100">
          <template #default="{ row }">
            <el-tag v-if="row.spFlag === '1'" type="danger" size="small">已复核</el-tag>
            <el-tag v-else-if="row.closed === '1'" type="info" size="small">已结案</el-tag>
            <el-tag v-else-if="row.inboundType === '8'" type="info" size="small">只读</el-tag>
            <span v-else>—</span>
          </template>
        </el-table-column>
        <el-table-column label="入库单数据" min-width="260">
          <template #default="{ row }">
            <div class="stock-data-cell">
              <span>项数 {{ formatNumber(row.itemCount, 0) }}</span>
              <span>总数量 {{ formatNumber(row.totalQty) }}</span>
              <span>入库 {{ formatNumber(row.inboundTotalQty) }}</span>
              <template v-if="hasPricePermission">
                <span>含税 {{ formatMoney(row.taxIncludedTotal ?? row.totalAmount) }}</span>
                <span>不含税 {{ formatMoney(row.taxExcludedTotal) }}</span>
                <span>税额 {{ formatMoney(row.taxTotal) }}</span>
              </template>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="经手人" prop="handlerName" min-width="110" show-overflow-tooltip />
        <el-table-column label="创建人" prop="creatorName" min-width="110" show-overflow-tooltip />
        <el-table-column label="备注" prop="remark" min-width="180" show-overflow-tooltip />
      </el-table>

      <el-pagination
        v-model:current-page="pager.page"
        v-model:page-size="pager.pageSize"
        :page-sizes="[10, 20, 50, 100]"
        layout="total, sizes, prev, pager, next, jumper"
        :total="pager.total"
        class="stock-pagination"
        @size-change="loadList"
        @current-change="loadList"
      />
    </section>

    <section v-show="pageMode === 'form'" class="erp-section">
      <div class="form-head">
        <strong>{{ editId ? '编辑入库单' : '新增入库单' }}</strong>
        <div>
          <el-button @click="switchList">返回列表</el-button>
          <el-button type="primary" :loading="saving" @click="saveReceipt">保存</el-button>
        </div>
      </div>

      <el-form :model="form" label-width="90px" class="stock-form">
        <div class="form-grid">
          <el-form-item label="入库类型">
            <el-radio-group v-model="form.inboundType" :disabled="!!editId" @change="onInboundTypeChange">
              <el-radio-button v-for="opt in addableInboundTypes" :key="opt.value" :label="opt.value">{{ opt.label }}</el-radio-button>
            </el-radio-group>
          </el-form-item>
          <el-form-item label="入库单号">
            <el-input :value="editId ? form.receiptNo : suggestedNo || '保存后生成最终单号'" disabled />
          </el-form-item>
          <el-form-item label="入库日期">
            <el-date-picker v-model="form.inboundDate" type="datetime" value-format="YYYY-MM-DD HH:mm:ss" :disabled="formReadOnly" />
          </el-form-item>
          <el-form-item label="仓库">
            <el-select v-model="form.warehouseCode" filterable remote reserve-keyword :remote-method="loadWarehouses" @change="onWarehouseChange">
              <el-option v-for="w in warehouses" :key="w.code" :label="`${w.code} ${w.name}`" :value="w.code" />
            </el-select>
          </el-form-item>
          <el-form-item :label="relatedLabel">
            <el-input v-if="isFreeType" v-model="form.relatedPartyName" placeholder="可填写自由文本关联单位" />
            <el-select v-else v-model="form.relatedPartyCode" filterable remote reserve-keyword :remote-method="loadRelatedParties" @change="onRelatedPartyChange">
              <el-option v-for="p in relatedParties" :key="p.code" :label="`${p.code} ${p.name}`" :value="p.code" />
            </el-select>
          </el-form-item>
          <el-form-item v-if="needsSourceOrder || form.inboundType === '5'" :label="sourceOrderLabel">
            <el-select v-model="form.sourceOrderNo" clearable filterable remote reserve-keyword :remote-method="loadSourceOrders" :disabled="form.inboundType === '4' && !form.relatedPartyCode">
              <el-option v-for="o in sourceOrders" :key="o.sourceOrderNo" :label="o.sourceOrderNo" :value="o.sourceOrderNo" />
            </el-select>
          </el-form-item>
          <el-form-item label="是否含税">
            <el-radio-group v-model="form.inTax" @change="onTaxModeChange">
              <el-radio-button label="1">含税</el-radio-button>
              <el-radio-button label="2">不含税</el-radio-button>
            </el-radio-group>
          </el-form-item>
          <el-form-item :label="paperNoLabel">
            <el-input v-model="form.paperNo" />
          </el-form-item>
          <el-form-item label="备注" class="form-wide">
            <el-input v-model="form.remark" />
          </el-form-item>
        </div>
      </el-form>

      <div class="line-toolbar">
        <el-button type="primary" plain @click="openBatchDialog">批量添加</el-button>
        <el-button plain :disabled="!canManualAdd" @click="addManualLine">增加明细</el-button>
        <el-button type="danger" plain :disabled="!selectedLineKeys.length" @click="removeSelectedLines">删除选定明细</el-button>
        <el-button type="danger" plain :disabled="!lines.length" @click="removeAllLines">删除全部明细</el-button>
      </div>

      <el-table :data="lines" border stripe row-key="__key" class="erp-list-table" @selection-change="onLineSelectionChange">
        <el-table-column type="selection" width="44" />
        <el-table-column label="序号" type="index" width="60" align="center" />
        <el-table-column label="材料编码" prop="kcaa01" min-width="150" show-overflow-tooltip />
        <el-table-column label="名称" prop="kcaa02" min-width="160" show-overflow-tooltip />
        <el-table-column label="规格" prop="kcaa03" min-width="140" show-overflow-tooltip />
        <el-table-column label="颜色" prop="kcaa11" min-width="100" show-overflow-tooltip />
        <el-table-column label="单位" prop="kcaa04" width="80" />
        <el-table-column label="可入库" width="110" align="right">
          <template #default="{ row }">{{ row.availableQty ?? '—' }}</template>
        </el-table-column>
        <el-table-column label="入库数量" width="130">
          <template #default="{ row }">
            <el-input-number v-model="row.kcao03" :min="0" :precision="2" controls-position="right" @change="recalcLine(row)" />
          </template>
        </el-table-column>
        <template v-if="hasPricePermission">
          <el-table-column label="不含税单价" width="140">
            <template #default="{ row }"><el-input-number v-model="row.kcao04" :precision="4" controls-position="right" @change="recalcLine(row)" /></template>
          </el-table-column>
          <el-table-column label="税点" width="120">
            <template #default="{ row }"><el-input-number v-model="row.tax" :min="0" :precision="4" controls-position="right" @change="recalcLine(row)" /></template>
          </el-table-column>
          <el-table-column label="含税单价" width="140">
            <template #default="{ row }"><el-input-number v-model="row.kcao041" :precision="4" controls-position="right" @change="recalcLineFromTaxPrice(row)" /></template>
          </el-table-column>
          <el-table-column label="不含税金额" prop="kcao05" width="120" align="right" />
          <el-table-column label="含税金额" prop="kcao051" width="120" align="right" />
        </template>
        <el-table-column label="库位" width="130">
          <template #default="{ row }"><el-input v-model="row.location" /></template>
        </el-table-column>
        <el-table-column label="版本" prop="version" width="110" show-overflow-tooltip />
        <el-table-column label="备注" min-width="180">
          <template #default="{ row }"><el-input v-model="row.info" /></template>
        </el-table-column>
      </el-table>
    </section>

    <el-dialog v-model="detailVisible" title="入库单详情" width="92%" class="stock-detail-dialog">
      <div v-if="detail.header" class="detail-body">
        <div class="detail-grid">
          <span>入库单号：{{ detail.header.kcan01 }}</span>
          <span>类型：{{ inboundTypeText(detail.header.kcan03) }}</span>
          <span>入库日期：{{ formatDateTime(detail.header.kcan02) }}</span>
          <span>仓库：{{ detail.header.ck || detail.header.kcan06 }}</span>
          <span>关联方：{{ detail.header.kehu }}</span>
          <span>关联单号：{{ detail.header.kcan04 || '—' }}</span>
          <span>纸质单号：{{ detail.header.kcan08 || '—' }}</span>
          <span>状态：{{ detail.header.pass === '1' ? '已审核' : '待审核' }}</span>
        </div>
        <el-table :data="detail.lines" border stripe>
          <el-table-column label="序号" type="index" width="60" />
          <el-table-column label="材料编码" prop="kcaa01" min-width="140" />
          <el-table-column label="名称" prop="kcaa02" min-width="160" />
          <el-table-column label="规格" prop="kcaa03" min-width="140" />
          <el-table-column label="颜色" prop="kcaa11" width="100" />
          <el-table-column label="单位" prop="kcaa04" width="80" />
          <el-table-column label="数量" prop="kcao03" width="100" align="right" />
          <template v-if="hasPricePermission">
            <el-table-column label="不含税单价" prop="kcao04" width="120" align="right" />
            <el-table-column label="含税金额" prop="kcao051" width="120" align="right" />
          </template>
          <el-table-column label="库位" prop="location" width="120" />
          <el-table-column label="备注" prop="Describe" min-width="160" />
        </el-table>
      </div>
    </el-dialog>

    <el-dialog v-model="batchVisible" :title="batchTitle" width="88%">
      <div class="batch-toolbar">
        <el-input v-model="batchKeyword" clearable placeholder="编码 / 名称" @keyup.enter="loadBatchLines" />
        <el-button type="primary" @click="loadBatchLines">查询</el-button>
      </div>
      <el-table v-loading="batchLoading" :data="batchLines" border stripe @selection-change="onBatchSelectionChange">
        <el-table-column type="selection" width="44" />
        <el-table-column label="材料编码" prop="kcaa01" min-width="150" />
        <el-table-column label="名称" prop="kcaa02" min-width="180" />
        <el-table-column label="规格" prop="kcaa03" min-width="140" />
        <el-table-column label="颜色" prop="kcaa11" width="100" />
        <el-table-column label="单位" prop="kcaa04" width="80" />
        <el-table-column label="可入库" prop="availableQty" width="110" align="right" />
      </el-table>
      <template #footer>
        <el-button @click="batchVisible = false">取消</el-button>
        <el-button type="primary" @click="applyBatchLines">加入明细</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="printVisible" title="打印入库单" width="900px" class="stock-print-dialog">
      <div v-if="printData.header" class="stock-print-page">
        <h2>入库单</h2>
        <div class="print-grid">
          <span>入库单号：{{ printData.header.kcan01 }}</span>
          <span>入库日期：{{ formatDateTime(printData.header.kcan02) }}</span>
          <span>类型：{{ inboundTypeText(printData.header.kcan03) }}</span>
          <span>仓库：{{ printData.header.ck || printData.header.kcan06 }}</span>
          <span>关联方：{{ printData.header.kehu }}</span>
          <span>经手人：{{ printData.header.kcan07 }}</span>
          <span>纸质单号：{{ printData.header.kcan08 }}</span>
          <span>备注：{{ printData.header.remark }}</span>
        </div>
        <table class="print-table">
          <thead>
            <tr>
              <th>序号</th><th>编码</th><th>名称</th><th>规格</th><th>颜色</th><th>单位</th><th>数量</th>
              <th v-if="hasPricePermission">单价</th><th v-if="hasPricePermission">金额</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(line, idx) in printData.lines" :key="idx">
              <td>{{ idx + 1 }}</td><td>{{ line.kcaa01 }}</td><td>{{ line.kcaa02 }}</td><td>{{ line.kcaa03 }}</td>
              <td>{{ line.kcaa11 }}</td><td>{{ line.kcaa04 }}</td><td class="num">{{ line.kcao03 }}</td>
              <td v-if="hasPricePermission" class="num">{{ line.kcao04 }}</td><td v-if="hasPricePermission" class="num">{{ line.kcao051 }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <template #footer>
        <el-button @click="printVisible = false">关闭</el-button>
        <el-button type="primary" @click="doPrint">打印</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import axios from 'axios'
import { ElMessage, ElMessageBox } from 'element-plus'
import { getPermissionModelFromStorage, hasPageAction } from '@/utils/menuPermission'

defineOptions({ name: 'inventory-daily-stock-in' })

const MENU_PATH = 'inventory/daily/stock-in'
const permissionModel = computed(() => getPermissionModelFromStorage())
const hasPricePermission = computed(() => hasPageAction(permissionModel.value, MENU_PATH, 'price'))

const inboundTypeOptions = [
  { value: '0', label: '其他入库' },
  { value: '1', label: '采购入库' },
  { value: '2', label: '外协入库' },
  { value: '3', label: '外协退料' },
  { value: '4', label: '生产入库' },
  { value: '5', label: '生产退料' },
  { value: '6', label: '销售退货' },
  { value: '7', label: '盘盈入库' },
  { value: '8', label: '加工入库' },
]
const addableInboundTypes = inboundTypeOptions.filter((x) => x.value !== '8')

const pageMode = ref('list')
const loading = ref(false)
const saving = ref(false)
const showUnaudited = ref(true)
const showRecycle = ref(false)
const listTableRef = ref(null)
const expandedRowKeys = ref([])
const list = ref([])
const pager = reactive({ page: 1, pageSize: 20, total: 0 })
const filters = reactive({ keyword: '', receiptNo: '', inboundType: '', warehouseCode: '' })

const suggestedNo = ref('')
const editId = ref(null)
const warehouses = ref([])
const relatedParties = ref([])
const sourceOrders = ref([])
const selectedLineKeys = ref([])
const lines = ref([])
const form = reactive(defaultForm())

const detailVisible = ref(false)
const detail = reactive({ header: null, lines: [] })
const batchVisible = ref(false)
const batchLoading = ref(false)
const batchKeyword = ref('')
const batchLines = ref([])
const batchSelected = ref([])
const printVisible = ref(false)
const printData = reactive({ header: null, lines: [] })

const isFreeType = computed(() => ['0', '7'].includes(form.inboundType))
const needsSourceOrder = computed(() => ['1', '2', '3', '4', '6'].includes(form.inboundType))
const canManualAdd = computed(() => isFreeType.value || (form.inboundType === '5' && !form.sourceOrderNo))
const formReadOnly = computed(() => false)
const relatedLabel = computed(() => {
  if (['1'].includes(form.inboundType)) return '供应商'
  if (['2', '3'].includes(form.inboundType)) return '外协客户'
  if (['4', '5'].includes(form.inboundType)) return '生产车间'
  if (form.inboundType === '6') return '客户'
  return '关联单位'
})
const sourceOrderLabel = computed(() => (['4', '5'].includes(form.inboundType) ? '派工单' : form.inboundType === '6' ? '销售单' : form.inboundType === '1' ? '采购单' : '外协单'))
const paperNoLabel = computed(() => (form.inboundType === '4' || form.inboundType === '5' ? 'PI号' : form.inboundType === '6' ? 'PO号' : ['1', '2', '3'].includes(form.inboundType) ? '来货单号' : '纸质单号'))
const batchTitle = computed(() => (canManualAdd.value ? '手工选择物料' : '从关联单据批量添加'))

function defaultForm() {
  return {
    receiptNo: '',
    inboundType: '0',
    inboundDate: nowText(),
    warehouseCode: '',
    warehouseName: '',
    relatedPartyCode: '',
    relatedPartyName: '',
    sourceOrderNo: '',
    inTax: '1',
    paperNo: '',
    remark: '',
  }
}

function nowText() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

function inboundTypeText(v) {
  return inboundTypeOptions.find((x) => x.value === String(v ?? ''))?.label || String(v ?? '')
}

function formatDateTime(v) {
  if (!v) return ''
  return String(v).replace('T', ' ').slice(0, 19)
}

function round(n, d = 2) {
  const m = 10 ** d
  return Math.round((Number(n) + Number.EPSILON) * m) / m
}

function toNumber(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function formatNumber(v, precision = 2) {
  const n = toNumber(v)
  return n.toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: precision })
}

function formatMoney(v) {
  return toNumber(v).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function calcLineSummary(lines = []) {
  return lines.reduce((acc, line) => {
    acc.itemCount += 1
    acc.totalQty += toNumber(line.kcao031 ?? line.kcao03)
    acc.inboundTotalQty += toNumber(line.kcao03)
    acc.taxExcludedTotal += toNumber(line.kcao05)
    acc.taxIncludedTotal += toNumber(line.kcao051 ?? line.kcao05)
    return acc
  }, { itemCount: 0, totalQty: 0, inboundTotalQty: 0, taxExcludedTotal: 0, taxIncludedTotal: 0, taxTotal: 0 })
}

function expandSummary(row) {
  const fromLines = Array.isArray(row?.__lines) && row.__lines.length ? calcLineSummary(row.__lines) : null
  const summary = fromLines || {
    itemCount: toNumber(row?.itemCount),
    totalQty: toNumber(row?.totalQty),
    inboundTotalQty: toNumber(row?.inboundTotalQty ?? row?.totalQty),
    taxExcludedTotal: toNumber(row?.taxExcludedTotal),
    taxIncludedTotal: toNumber(row?.taxIncludedTotal ?? row?.totalAmount),
    taxTotal: toNumber(row?.taxTotal),
  }
  summary.taxTotal = round(summary.taxIncludedTotal - summary.taxExcludedTotal, 2)
  return summary
}

function recalcLine(row) {
  if (form.inTax === '2') row.tax = 0
  const qty = Number(row.kcao03 || 0)
  const ex = Number(row.kcao04 || 0)
  const tax = Number(row.tax || 0)
  row.kcao041 = round(ex * (1 + tax), 4)
  row.kcao05 = round(qty * ex, 2)
  row.kcao051 = round(qty * row.kcao041, 2)
}

function recalcLineFromTaxPrice(row) {
  if (form.inTax === '2') row.tax = 0
  const tax = Number(row.tax || 0)
  const inc = Number(row.kcao041 || 0)
  row.kcao04 = round(tax ? inc / (1 + tax) : inc, 4)
  recalcLine(row)
}

async function loadList() {
  loading.value = true
  try {
    const res = await axios.get('/api/stock-in/list', {
      params: {
        page: pager.page,
        pageSize: pager.pageSize,
        recycled: showRecycle.value ? 1 : 0,
        showUnaudited: showUnaudited.value ? 1 : 0,
        ...filters,
      },
    })
    list.value = res.data?.data?.list || []
    expandedRowKeys.value = []
    pager.total = Number(res.data?.data?.total || 0)
  } catch (err) {
    ElMessage.error(err.response?.data?.msg || err.message || '读取入库单失败')
  } finally {
    loading.value = false
  }
}

function resetSearch() {
  Object.assign(filters, { keyword: '', receiptNo: '', inboundType: '', warehouseCode: '' })
  pager.page = 1
  loadList()
}

function switchList() {
  pageMode.value = 'list'
  editId.value = null
  loadList()
}

function toggleRecycle() {
  showRecycle.value = !showRecycle.value
  onRecycleChange()
}

function onRecycleChange() {
  if (showRecycle.value) showUnaudited.value = false
  pager.page = 1
  loadList()
}

async function newReceipt() {
  editId.value = null
  Object.assign(form, defaultForm())
  lines.value = []
  pageMode.value = 'form'
  await Promise.all([loadWarehouses(), loadSuggestedNo()])
}

async function editReceipt(row) {
  const data = await fetchDetail(row.id)
  editId.value = row.id
  Object.assign(form, {
    receiptNo: data.header.kcan01,
    inboundType: String(data.header.kcan03 || '0'),
    inboundDate: formatDateTime(data.header.kcan02),
    warehouseCode: data.header.kcan06 || '',
    warehouseName: data.header.ck || '',
    relatedPartyCode: data.header.kcan05 || '',
    relatedPartyName: data.header.kehu || '',
    sourceOrderNo: data.header.kcan04 || '',
    inTax: String(data.header.in_tax || '1'),
    paperNo: data.header.kcan08 || '',
    remark: data.header.remark || '',
  })
  lines.value = (data.lines || []).map((line, idx) => ({ ...line, info: line.Describe || '', __key: `${idx}-${line.systemcode || line.id || Date.now()}` }))
  pageMode.value = 'form'
  await Promise.all([loadWarehouses(), loadRelatedParties(), loadSourceOrders()])
}

async function fetchDetail(id) {
  const res = await axios.get(`/api/stock-in/${id}`)
  return res.data?.data || { header: null, lines: [] }
}

async function loadExpandedLines(row) {
  if (!row || row.__linesLoaded || row.__linesLoading) return
  row.__linesLoading = true
  try {
    const data = await fetchDetail(row.id)
    row.__lines = data.lines || []
    row.__linesLoaded = true
  } catch (err) {
    row.__lines = []
    ElMessage.error(err.response?.data?.msg || err.message || '读取入库单明细失败')
  } finally {
    row.__linesLoading = false
  }
}

function onExpandChange(row, expandedRows) {
  expandedRowKeys.value = (expandedRows || []).map((item) => item.id)
  if (expandedRowKeys.value.includes(row.id)) loadExpandedLines(row)
}

function onListRowClick(row, column, event) {
  const target = event?.target
  if (target?.closest?.('.erp-col-actions, .el-button, .el-table__expand-icon, a')) return
  listTableRef.value?.toggleRowExpansion(row)
}

async function viewReceipt(row) {
  const data = await fetchDetail(row.id)
  detail.header = data.header
  detail.lines = data.lines || []
  detailVisible.value = true
}

async function printReceipt(row) {
  const res = await axios.get('/api/stock-in/print-data', { params: { id: row.id } })
  printData.header = res.data?.data?.header || null
  printData.lines = res.data?.data?.lines || []
  printVisible.value = true
}

function doPrint() {
  document.documentElement.classList.add('print-stock-in')
  setTimeout(() => {
    window.print()
    document.documentElement.classList.remove('print-stock-in')
  }, 50)
}

async function loadSuggestedNo() {
  const res = await axios.get('/api/stock-in/suggest-doc-no')
  suggestedNo.value = res.data?.data?.suggested || ''
}

async function loadWarehouses(keyword = '') {
  const res = await axios.get('/api/stock-in/warehouse-options', { params: { keyword } })
  warehouses.value = res.data?.data?.list || []
}

async function loadRelatedParties(keyword = '') {
  if (isFreeType.value) return
  const res = await axios.get('/api/stock-in/related-party-options', { params: { inboundType: form.inboundType, keyword } })
  relatedParties.value = res.data?.data?.list || []
}

async function loadSourceOrders(keyword = '') {
  if (!needsSourceOrder.value && form.inboundType !== '5') return
  const res = await axios.get('/api/stock-in/source-options', {
    params: { inboundType: form.inboundType, relatedPartyCode: form.relatedPartyCode, keyword },
  })
  sourceOrders.value = res.data?.data?.list || []
}

function onWarehouseChange(v) {
  form.warehouseName = warehouses.value.find((w) => w.code === v)?.name || ''
}

function onRelatedPartyChange(v) {
  form.relatedPartyName = relatedParties.value.find((p) => p.code === v)?.name || ''
  form.sourceOrderNo = ''
  sourceOrders.value = []
  loadSourceOrders()
}

async function onInboundTypeChange() {
  if (lines.value.length) {
    await ElMessageBox.confirm('切换入库类型会清空当前明细，是否继续？', '提示', { type: 'warning' })
    lines.value = []
  }
  form.relatedPartyCode = ''
  form.relatedPartyName = ''
  form.sourceOrderNo = ''
  relatedParties.value = []
  sourceOrders.value = []
  loadRelatedParties()
}

function onTaxModeChange() {
  if (form.inTax === '2') lines.value.forEach((row) => { row.tax = 0; recalcLine(row) })
}

function onLineSelectionChange(selection) {
  selectedLineKeys.value = selection.map((x) => x.__key)
}

function removeSelectedLines() {
  const s = new Set(selectedLineKeys.value)
  lines.value = lines.value.filter((x) => !s.has(x.__key))
}

async function removeAllLines() {
  await ElMessageBox.confirm('确定删除全部明细吗？', '提示', { type: 'warning' })
  lines.value = []
}

async function addManualLine() {
  const res = await axios.get('/api/stock-in/material-options', { params: { pageSize: 20 } })
  const first = res.data?.data?.list?.[0]
  if (!first) return ElMessage.warning('暂无可选物料')
  lines.value.push(makeLine(first))
}

async function openBatchDialog() {
  if (!form.inboundType) return ElMessage.warning('请先选择入库类型')
  if (!form.inTax) return ElMessage.warning('请先选择是否含税')
  if (!form.warehouseCode) return ElMessage.warning('请先选择仓库')
  if (needsSourceOrder.value && !form.sourceOrderNo) return ElMessage.warning(form.inboundType === '4' ? '请先选择派工单' : '请先选择关联单号')
  if (!isFreeType.value && form.inboundType !== '5' && !form.relatedPartyCode) return ElMessage.warning(`请先选择${relatedLabel.value}`)
  batchVisible.value = true
  batchKeyword.value = ''
  await loadBatchLines()
}

async function loadBatchLines() {
  batchLoading.value = true
  try {
    const url = canManualAdd.value ? '/api/stock-in/material-options' : '/api/stock-in/source-lines'
    const res = await axios.get(url, {
      params: canManualAdd.value
        ? { keyword: batchKeyword.value }
        : { inboundType: form.inboundType, sourceOrderNo: form.sourceOrderNo, keyword: batchKeyword.value },
    })
    batchLines.value = (res.data?.data?.list || []).map((row) => ({ ...row, availableQty: row.availableQty ?? row.kcao03 ?? 0 }))
  } catch (err) {
    ElMessage.error(err.response?.data?.msg || err.message || '读取明细失败')
  } finally {
    batchLoading.value = false
  }
}

function onBatchSelectionChange(selection) {
  batchSelected.value = selection
}

function makeLine(row) {
  const line = {
    __key: `${Date.now()}-${Math.random()}`,
    kcao02: row.kcao02 || '',
    kcan04: form.sourceOrderNo,
    availableQty: row.availableQty,
    kcao03: Number(row.availableQty || 0) || 1,
    kcao031: Number(row.availableQty || 0) || 1,
    kcao04: Number(row.kcao04 || row.cost_price || 0) || 0,
    tax: form.inTax === '2' ? 0 : Number(row.tax || 0) || 0,
    kcaa01: row.kcaa01,
    kcaa02: row.kcaa02,
    kcaa03: row.kcaa03,
    kcaa04: row.kcaa04,
    kcaa11: row.kcaa11,
    location: row.location || '',
    version: row.version || '',
    info: row.info || '',
  }
  recalcLine(line)
  return line
}

function applyBatchLines() {
  if (!batchSelected.value.length) return ElMessage.warning('请选择明细')
  lines.value.push(...batchSelected.value.map(makeLine))
  batchVisible.value = false
}

function buildPayload() {
  return {
    header: { ...form },
    lines: lines.value.map((line) => ({
      ...line,
      Describe: line.info,
      kcan04: form.sourceOrderNo || line.kcan04,
    })),
  }
}

async function saveReceipt() {
  if (!lines.value.length) return ElMessage.warning('请至少添加一条明细')
  saving.value = true
  try {
    const payload = buildPayload()
    const res = editId.value ? await axios.put(`/api/stock-in/${editId.value}`, payload) : await axios.post('/api/stock-in', payload)
    ElMessage.success(res.data?.data?.autoApproved ? '保存成功，已自动审核' : '保存成功，等待审核')
    switchList()
  } catch (err) {
    ElMessage.error(err.response?.data?.msg || err.message || '保存失败')
  } finally {
    saving.value = false
  }
}

function isLocked(row) {
  return row.spFlag === '1' || row.closed === '1' || row.inboundType === '8'
}

function canEdit(row) {
  return row.pass !== '1' && row.del !== '1' && !isLocked(row)
}

function canAudit(row) {
  return row.pass !== '1' && row.del !== '1' && !isLocked(row)
}

function canUnaudit(row) {
  return row.pass === '1' && row.del !== '1' && !isLocked(row)
}

function canDelete(row) {
  return row.pass !== '1' && row.del !== '1' && !isLocked(row)
}

async function runAction(row, action) {
  const actionText = { audit: '审核', unaudit: '反审核', delete: '删除', restore: '恢复', hard: '彻底删除' }[action]
  await ElMessageBox.confirm(`确定${actionText}这张入库单吗？`, '提示', { type: action === 'delete' || action === 'hard' ? 'warning' : 'info' })
  row.__op = action
  try {
    if (action === 'delete') await axios.delete(`/api/stock-in/${row.id}`)
    else if (action === 'hard') await axios.delete(`/api/stock-in/${row.id}/hard`)
    else await axios.post(`/api/stock-in/${row.id}/${action}`)
    ElMessage.success(`${actionText}成功`)
    loadList()
  } catch (err) {
    ElMessage.error(err.response?.data?.msg || err.message || `${actionText}失败`)
  } finally {
    row.__op = ''
  }
}

function showTodo(msg) {
  ElMessage.info(msg)
}

onMounted(() => {
  loadList()
  loadWarehouses()
})
</script>

<style scoped>
.stock-in-page {
  --stock-chrome: 48px;
}
.stock-in-mode-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
}
.stock-toolbar,
.line-toolbar,
.batch-toolbar,
.form-head {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  margin-bottom: 12px;
}
.filter-keyword {
  width: 300px;
}
.filter-select,
.filter-small {
  width: 150px;
}
.stock-alert {
  margin-bottom: 12px;
}
.stock-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}
.locked-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
}
.stock-data-cell {
  display: grid;
  grid-template-columns: repeat(2, minmax(90px, 1fr));
  gap: 4px 12px;
  font-size: 12px;
  line-height: 1.45;
}
.stock-expand-inner {
  padding: 12px 14px;
  background: #f8fafc;
}
.stock-expand-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
  margin-bottom: 10px;
  color: #334155;
  font-size: 13px;
}
.stock-expand-lines-table {
  width: 100%;
}
.stock-pagination {
  margin-top: 12px;
  justify-content: flex-end;
}
.form-head {
  justify-content: space-between;
}
.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(280px, 1fr));
  gap: 0 16px;
}
.form-wide {
  grid-column: 1 / -1;
}
.detail-grid,
.print-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(140px, 1fr));
  gap: 10px 18px;
  margin-bottom: 14px;
}
.stock-print-page h2 {
  text-align: center;
  margin: 0 0 16px;
}
.print-table {
  width: 100%;
  border-collapse: collapse;
}
.print-table th,
.print-table td {
  border: 1px solid #333;
  padding: 6px;
  font-size: 13px;
}
.print-table .num {
  text-align: right;
}
@media (max-width: 900px) {
  .form-grid,
  .detail-grid,
  .print-grid {
    grid-template-columns: 1fr;
  }
  .filter-keyword,
  .filter-select,
  .filter-small {
    width: 100%;
  }
}
@media print {
  :global(html.print-stock-in body *) {
    visibility: hidden;
  }
  :global(html.print-stock-in .stock-print-dialog),
  :global(html.print-stock-in .stock-print-dialog *) {
    visibility: visible;
  }
  :global(html.print-stock-in .el-dialog__header),
  :global(html.print-stock-in .el-dialog__footer) {
    display: none !important;
  }
  :global(html.print-stock-in .stock-print-dialog .el-dialog) {
    box-shadow: none;
    width: 100% !important;
    margin: 0 !important;
  }
}
</style>
