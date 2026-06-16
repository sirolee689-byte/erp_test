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

      <el-table v-loading="loading" v-erp-list-h-scroll :data="list" border stripe row-key="id" class="erp-list-table" :empty-text="loading ? '加载中' : '暂无数据'">
        <el-table-column label="操作" fixed="left" width="300" class-name="erp-col-actions">
          <template #default="{ row }">
            <div class="action-bar">
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
      <el-form :model="form" label-width="100px" class="dispatch-form">
        <el-row :gutter="16">
          <el-col :span="6"><el-form-item label="派工日期"><el-date-picker v-model="form.dispatchDate" value-format="YYYY-MM-DD" type="date" /></el-form-item></el-col>
          <el-col :span="6"><el-form-item label="派工类型"><el-select v-model="form.dispatchType" :disabled="!!editId" @change="onTypeChange"><el-option label="本厂" value="0" /><el-option label="大板" value="1" /><el-option label="委外" value="2" /></el-select></el-form-item></el-col>
          <el-col :span="6"><el-form-item label="生产车间"><el-select v-model="form.workshopCode" filterable remote :remote-method="loadWorkshops" :disabled="!!editId" @change="onWorkshopChange"><el-option v-for="w in workshops" :key="w.code" :label="`${w.code} ${w.name}`" :value="w.code" /></el-select></el-form-item></el-col>
          <el-col :span="6"><el-form-item label="交货日期"><el-date-picker v-model="form.deliveryDate" value-format="YYYY-MM-DD" type="date" /></el-form-item></el-col>
          <el-col :span="6"><el-form-item :label="form.dispatchType === '2' ? '供应商' : 'PI号'"><el-input v-model="form.referenceNo" :disabled="!!editId" /></el-form-item></el-col>
          <el-col v-if="form.dispatchType === '2'" :span="6"><el-form-item label="关联PI"><el-input v-model="form.piNo" :disabled="!!editId && lines.length > 0" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="备注"><el-input v-model="form.remark" /></el-form-item></el-col>
        </el-row>
      </el-form>

      <div class="line-toolbar">
        <el-button type="primary" plain @click="openGoodsDialog">批量添加</el-button>
        <el-button type="danger" plain :disabled="!lines.length" @click="lines = []">删除全部明细</el-button>
      </div>
      <el-table :data="lines" border stripe row-key="__key" class="erp-list-table">
        <el-table-column label="操作" width="86">
          <template #default="{ $index }"><el-button size="small" type="danger" plain @click="lines.splice($index, 1)">删除</el-button></template>
        </el-table-column>
        <el-table-column label="PI" prop="pi" min-width="130" />
        <el-table-column label="货品编码" prop="kcaa01" min-width="140" />
        <el-table-column label="货品名称" prop="kcaa02" min-width="180" />
        <el-table-column label="规格" prop="kcaa03" min-width="160" />
        <el-table-column label="单位" prop="kcaa04" width="80" />
        <el-table-column label="本次派工" width="150">
          <template #default="{ row }"><el-input-number v-model="row.scak03" :min="0" :precision="2" /></template>
        </el-table-column>
        <el-table-column label="已派工快照" prop="scak04" width="120" align="right" />
        <el-table-column label="返修数量" prop="scak05" width="110" align="right" />
      </el-table>
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

    <el-dialog v-model="goodsVisible" title="批量添加货品" width="88%" destroy-on-close @open="loadGoods">
      <div class="goods-toolbar">
        <el-input v-if="form.dispatchType !== '2'" v-model="goodsKeyword" clearable placeholder="货品编码 / 名称" class="filter-keyword" @keyup.enter="loadGoods" />
        <el-button type="primary" @click="loadGoods">查询</el-button>
      </div>
      <el-table v-loading="goodsLoading" :data="goodsList" border stripe>
        <el-table-column label="操作" width="110">
          <template #default="{ row }">
            <el-button size="small" :disabled="!row.selectable || hasLine(row.kcaa01)" @click="addGoods(row)">
              {{ !row.selectable ? '不可选' : hasLine(row.kcaa01) ? '已选择' : '选择' }}
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
    </el-dialog>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue'
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
const workshops = ref([])
const viewVisible = ref(false)
const detail = reactive({ header: null, lines: [] })
const goodsVisible = ref(false)
const goodsLoading = ref(false)
const goodsKeyword = ref('')
const goodsList = ref([])

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
  editId.value = null
}

function dispatchTypeText(v) {
  return String(v) === '1' ? '大板' : String(v) === '2' ? '委外' : '本厂'
}

function formatDate(v) {
  return String(v ?? '').slice(0, 10)
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

async function loadWorkshops(keyword = '') {
  const res = await axios.get('/api/dispatch-order/workshop-options', { params: { keyword } })
  workshops.value = res.data?.data?.list ?? []
}

function onWorkshopChange(code) {
  const picked = workshops.value.find((w) => w.code === code)
  form.workshopName = picked?.name || ''
}

function onTypeChange() {
  form.referenceNo = ''
  form.piNo = ''
  lines.value = []
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
        keyword: goodsKeyword.value,
        pageSize: form.dispatchType === '2' ? 100 : 10,
      },
    })
    goodsList.value = res.data?.data?.list ?? []
  } catch (err) {
    ElMessage.error(err?.response?.data?.msg || '读取可派工货品失败')
  } finally {
    goodsLoading.value = false
  }
}

function hasLine(kcaa01) {
  return lines.value.some((line) => line.kcaa01 === kcaa01)
}

function addGoods(row) {
  if (!row.selectable) {
    ElMessage.warning('可派工数量不足，不能选择')
    return
  }
  if (hasLine(row.kcaa01)) return
  lines.value.push({
    ...row,
    __key: `${row.kcaa01}-${Date.now()}`,
    scak02: row.systemcode || row.GUID,
    scak03: Number(row.availableQty ?? 0),
    scak04: Number(row.dispatchedQty ?? 0),
    scak05: Number(row.repairQty ?? 0),
  })
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
.detail-lines {
  margin-top: 14px;
}
.action-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
</style>
