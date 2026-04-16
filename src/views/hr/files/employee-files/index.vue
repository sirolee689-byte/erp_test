<template>
  <div class="erp-module-page">
    <!--
      v1.0.9 人事档案精简管理（Hr_staff）
      - 只加载有效字段：code/name/sex/in_bm/card_number/meal_type/yn_history/intime/pass 等
      - 搜索：name 模糊优先；否则 code 精确；否则 card_number 精确
      - pass='1'：禁用编辑/删除；审核/反审互斥
      - card_number 不足 10 位：红字提示
    -->
    <el-card shadow="never">
      <template #header>
        <span class="page-title">{{ pageTitle }}</span>
      </template>
      <p class="page-desc">仅展示必用字段；已审核（pass=1）记录锁定，编辑与删除需先反审。</p>

      <div class="operator-toolbar">
        <el-button v-permission="'add'" class="toolbar-btn btn-action" @click="openCreate">
          <el-icon class="btn-icon"><Plus /></el-icon>
          新增员工
        </el-button>
        <div class="audit-switch">
          <span class="switch-label">显示未审核</span>
          <el-switch v-model="showUnAudited" />
        </div>
        <el-button class="toolbar-btn btn-view" :loading="loading" @click="loadList">
          <el-icon class="btn-icon"><Refresh /></el-icon>
          刷新
        </el-button>
      </div>

      <div class="search-row">
        <el-input
          v-model="qName"
          placeholder="姓名（模糊，优先）"
          clearable
          style="max-width: 220px"
          @keyup.enter="onSearch"
        />
        <el-input
          v-model="qCode"
          placeholder="工号（精确）"
          clearable
          style="max-width: 180px"
          @keyup.enter="onSearch"
        />
        <el-input
          v-model="qCard"
          placeholder="10位卡号（精确）"
          clearable
          style="max-width: 180px"
          @keyup.enter="onSearch"
        />
        <el-button type="primary" @click="onSearch">查询</el-button>
        <el-button @click="onReset">重置</el-button>
      </div>

      <el-alert v-if="errorMessage" :title="errorMessage" type="error" show-icon class="error-alert" />

      <el-skeleton :loading="loading" animated :rows="8">
        <template #default>
          <el-table
            :data="tableList"
            row-key="code"
            border
            stripe
            style="width: 100%"
            :empty-text="loading ? '加载中…' : '暂无数据'"
          >
            <el-table-column prop="code" label="工号" min-width="100" show-overflow-tooltip />
            <el-table-column prop="name" label="姓名" min-width="110" show-overflow-tooltip />
            <el-table-column prop="sex" label="性别" width="70" show-overflow-tooltip />
            <el-table-column prop="nation" label="民族" width="80" show-overflow-tooltip />
            <el-table-column prop="birth" label="出生日期" min-width="110" show-overflow-tooltip />
            <el-table-column prop="highest" label="文化程度" min-width="100" show-overflow-tooltip />
            <el-table-column prop="yn_firend" label="亲友在本司" width="100" show-overflow-tooltip />
            <el-table-column prop="in_bm" label="部门" min-width="120" show-overflow-tooltip />
            <el-table-column label="10位卡号" min-width="120" show-overflow-tooltip>
              <template #default="{ row }">
                <span :class="{ 'warn-text': cardNumberTooShort(row?.card_number) }">
                  {{ row?.card_number ?? '—' }}
                </span>
                <span v-if="cardNumberTooShort(row?.card_number)" class="warn-text-sub">（不足10位）</span>
              </template>
            </el-table-column>
            <el-table-column prop="meal_type" label="饭餐类型" min-width="90" show-overflow-tooltip />
            <el-table-column prop="remark" label="备注" min-width="100" show-overflow-tooltip />
            <el-table-column prop="intime" label="入职时间" min-width="140" show-overflow-tooltip />
            <el-table-column label="审核状态" width="90">
              <template #default="{ row }">
                <el-tag v-if="rowIsAudited(row)" type="success" effect="light">已审核</el-tag>
                <el-tag v-else type="info" effect="light">未审核</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="操作" min-width="360" fixed="right">
              <template #default="{ row }">
                <el-button v-permission="'edit'" size="small" :disabled="rowIsAudited(row)" @click="openEdit(row)">
                  编辑
                </el-button>
                <el-button
                  v-permission="'delete'"
                  size="small"
                  type="danger"
                  :disabled="rowIsAudited(row)"
                  @click="confirmDelete(row)"
                >
                  删除
                </el-button>
                <el-button
                  v-permission="'audit'"
                  size="small"
                  type="success"
                  plain
                  :disabled="rowIsAudited(row)"
                  @click="doAudit(row)"
                >
                  审核
                </el-button>
                <el-button
                  v-permission="'audit'"
                  size="small"
                  type="warning"
                  plain
                  :disabled="!rowIsAudited(row)"
                  @click="doUnaudit(row)"
                >
                  反审
                </el-button>
              </template>
            </el-table-column>
          </el-table>

          <div class="pagination-row">
            <el-pagination
              background
              layout="total, sizes, prev, pager, next, jumper"
              :total="total"
              :current-page="page"
              :page-size="pageSize"
              :page-sizes="[10, 20, 50, 100]"
              @size-change="onPageSizeChange"
              @current-change="onPageChange"
            />
          </div>
        </template>
      </el-skeleton>
    </el-card>

    <!-- 双列 + 分组：缩短弹窗纵向滚动；入职部门/岗位下拉仅已审数据由接口保证 -->
    <el-dialog
      v-model="dialogVisible"
      :title="dialogTitle"
      width="880px"
      class="staff-dialog"
      align-center
      destroy-on-close
    >
      <el-form
        ref="formRef"
        class="staff-form-dialog"
        :model="form"
        :rules="formRules"
        label-width="140px"
        label-position="right"
        size="small"
        require-asterisk-position="right"
      >
        <el-divider content-position="left">基本信息</el-divider>
        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="档案编码">
              <el-input v-model="form.code" disabled maxlength="50" placeholder="提交后自动生成" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="新档案编码" prop="new_code">
              <el-input v-model="form.new_code" maxlength="50" placeholder="可手动输入（可空）" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="姓名" prop="name">
              <el-input v-model="form.name" maxlength="50" placeholder="请输入姓名" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="卡号" prop="card_number">
              <el-input v-model="form.card_number" maxlength="10" placeholder="固定 10 位数字" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="性别" prop="sex">
              <el-select v-model="form.sex" clearable placeholder="请选择性别" style="width: 100%">
                <el-option label="男" value="男" />
                <el-option label="女" value="女" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="民族" prop="nation">
              <el-select v-model="form.nation" filterable clearable placeholder="请选择民族" style="width: 100%">
                <el-option v-for="n in nationOptions" :key="n" :label="n" :value="n" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="出生日期" prop="birth">
              <el-date-picker
                v-model="form.birth"
                type="date"
                value-format="YYYY-MM-DD"
                format="YYYY-MM-DD"
                placeholder="选择日期"
                style="width: 100%"
                clearable
              />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="入职时间" prop="intime">
              <el-date-picker
                v-model="form.intime"
                type="date"
                value-format="YYYY-MM-DD"
                format="YYYY-MM-DD"
                placeholder="选择日期"
                style="width: 100%"
              />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="饭餐类型" prop="meal_type">
              <el-select v-model="form.meal_type" clearable placeholder="默认员工餐" style="width: 100%">
                <el-option
                  v-for="opt in mealTypeSelectOptions"
                  :key="opt.value"
                  :label="opt.label"
                  :value="opt.value"
                />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>

        <el-divider content-position="left">岗位信息</el-divider>
        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="入职部门" prop="join_department">
              <el-select
                v-model="form.join_department"
                filterable
                clearable
                placeholder="仅显示已审核部门"
                style="width: 100%"
                @change="onDepartmentChange"
              >
                <el-option
                  v-for="d in deptOptions"
                  :key="String(d.code ?? '')"
                  :label="String(d.name ?? '')"
                  :value="String(d.code ?? '')"
                />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="岗位" prop="position">
              <el-select
                v-model="form.position"
                filterable
                clearable
                placeholder="仅显示已审核岗位"
                style="width: 100%"
                :disabled="!String(form.join_department ?? '').trim()"
              >
                <el-option
                  v-for="p in postOptions"
                  :key="String(p.code ?? '')"
                  :label="String(p.name ?? '')"
                  :value="String(p.code ?? '')"
                />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>

        <el-divider content-position="left">背景调查</el-divider>
        <el-row :gutter="16">
          <!-- 亲属问题置本区块首行左侧，减少滚动即可看到 -->
          <el-col :span="12">
            <!-- 库字段名为 yn_firend（历史拼写），勿改 -->
            <el-form-item label="是否有亲属或朋友在我司工作" prop="yn_firend" class="staff-form-item--multiline-label">
              <el-select v-model="form.yn_firend" clearable placeholder="请选择" style="width: 100%">
                <el-option label="是" value="是" />
                <el-option label="否" value="否" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="最高文化程度" prop="highest">
              <el-select v-model="form.highest" clearable placeholder="请选择" style="width: 100%">
                <el-option v-for="h in highestEduOptions" :key="h" :label="h" :value="h" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="是否曾在我司应聘" prop="yn_history">
              <el-select v-model="form.yn_history" clearable placeholder="请选择" style="width: 100%">
                <el-option label="是" value="是" />
                <el-option label="否" value="否" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="24">
            <el-form-item label="备注" prop="remark">
              <el-input
                v-model="form.remark"
                type="textarea"
                :rows="3"
                maxlength="500"
                show-word-limit
                placeholder="备注（可空，最多 500 字）"
              />
            </el-form-item>
          </el-col>
        </el-row>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="submitForm">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import axios from 'axios'
import { Plus, Refresh } from '@element-plus/icons-vue'

/** 页面标题（与左侧菜单一致） */
const pageTitle = '员工档案资料'

const tableList = ref([])
const total = ref(0)
const loading = ref(false)
const errorMessage = ref('')

/** 搜索条件（name 模糊优先） */
const qName = ref('')
const qCode = ref('')
const qCard = ref('')

const page = ref(1)
/** 默认每页 20（数据量大） */
const pageSize = ref(20)

/** 是否显示未审核（pass='0'） */
const showUnAudited = ref(false)

const dialogVisible = ref(false)
const dialogMode = ref('create')
const submitting = ref(false)
const formRef = ref()

/** 部门/岗位下拉（来自 HR_Departments） */
const deptOptions = ref([])
const postOptions = ref([])

/** 民族下拉（与常见档案口径一致，含「其他」） */
const nationOptions = [
  '汉族',
  '壮族',
  '满族',
  '回族',
  '苗族',
  '维吾尔族',
  '土家族',
  '彝族',
  '蒙古族',
  '藏族',
  '侗族',
  '布依族',
  '瑶族',
  '白族',
  '朝鲜族',
  '哈尼族',
  '黎族',
  '哈萨克族',
  '傣族',
  '畲族',
  '傈僳族',
  '东乡族',
  '仡佬族',
  '拉祜族',
  '佤族',
  '水族',
  '纳西族',
  '羌族',
  '土族',
  '锡伯族',
  '柯尔克孜族',
  '达斡尔族',
  '景颇族',
  '毛南族',
  '布朗族',
  '撒拉族',
  '塔吉克族',
  '阿昌族',
  '普米族',
  '鄂温克族',
  '怒族',
  '京族',
  '基诺族',
  '德昂族',
  '保安族',
  '俄罗斯族',
  '裕固族',
  '乌孜别克族',
  '门巴族',
  '鄂伦春族',
  '独龙族',
  '塔塔尔族',
  '赫哲族',
  '珞巴族',
  '其他',
]

/** 最高文化程度 */
const highestEduOptions = ['小学', '初中', '高中/中专', '专科', '本科', '硕士研究生', '博士研究生', '其他']

/** 饭餐类型：默认员工餐，可选管理餐（写入 meal_type） */
const DEFAULT_MEAL_TYPE = '员工餐'
const MEAL_TYPE_STANDARD = [DEFAULT_MEAL_TYPE, '管理餐']

const form = ref({
  code: '',
  new_code: '',
  name: '',
  card_number: '',
  join_department: '',
  position: '',
  sex: '',
  nation: '',
  birth: '',
  highest: '',
  yn_firend: '',
  meal_type: DEFAULT_MEAL_TYPE,
  yn_history: '',
  remark: '',
  intime: '',
})

/** 下拉项：标准两项 + 编辑时若库中为旧值则多一行便于展示与保留 */
const mealTypeSelectOptions = computed(() => {
  const cur = String(form.value.meal_type ?? '').trim()
  const base = MEAL_TYPE_STANDARD.map((v) => ({ label: v, value: v }))
  if (cur && !MEAL_TYPE_STANDARD.includes(cur)) {
    return [{ label: `${cur}（旧数据）`, value: cur }, ...base]
  }
  return base
})

const dialogTitle = computed(() => (dialogMode.value === 'edit' ? '编辑员工' : '新增员工'))

const formRules = {
  name: [{ required: true, message: '请输入姓名', trigger: 'blur' }],
  card_number: [
    { required: true, message: '请输入卡号', trigger: 'blur' },
    { pattern: /^\d{10}$/, message: '卡号必须是 10 位数字', trigger: 'blur' },
  ],
}

/** pass === '1' 为已审核 */
function rowIsAudited(row) {
  return String(row?.pass ?? '').trim() === '1'
}

/** card_number 不足 10 位提示（空值不提示） */
function cardNumberTooShort(v) {
  const s = String(v ?? '').trim()
  if (!s) return false
  return s.length < 10
}

/** 组装搜索参数：name 优先，其次 code，其次 card_number */
function buildQueryParams() {
  const name = String(qName.value ?? '').trim()
  const code = String(qCode.value ?? '').trim()
  const card = String(qCard.value ?? '').trim()
  if (name) return { name }
  if (code) return { code }
  if (card) return { card_number: card }
  return {}
}

function todayString() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** 旧库 yn_history 常见为「有/无」，表单统一为「是/否」 */
function normalizeYnHistoryForForm(v) {
  const s = String(v ?? '').trim()
  if (s === '有') return '是'
  if (s === '无') return '否'
  return s
}

async function loadDeptOptions() {
  try {
    const res = await axios.get('/api/hr/staff/department-options')
    const body = res.data
    const list = body?.data?.list
    deptOptions.value = Array.isArray(list) ? list : []
  } catch {
    deptOptions.value = []
  }
}

async function loadPostOptions(parentId) {
  const pid = String(parentId ?? '').trim()
  if (!pid) {
    postOptions.value = []
    return
  }
  try {
    const res = await axios.get('/api/hr/staff/department-posts', { params: { parentId: pid } })
    const body = res.data
    const list = body?.data?.list
    postOptions.value = Array.isArray(list) ? list : []
  } catch {
    postOptions.value = []
  }
}

async function onDepartmentChange(v) {
  const pid = String(v ?? '').trim()
  form.value.position = ''
  await loadPostOptions(pid)
}

async function loadList() {
  loading.value = true
  errorMessage.value = ''
  try {
    const res = await axios.get('/api/hr/staff', {
      params: {
        page: page.value,
        pageSize: pageSize.value,
        pass: showUnAudited.value ? '0' : '1',
        ...buildQueryParams(),
      },
    })
    const body = res.data
    if (body?.code !== 200) {
      errorMessage.value = String(body?.msg ?? '加载失败')
      tableList.value = []
      total.value = 0
      return
    }
    tableList.value = Array.isArray(body?.data?.list) ? body.data.list : []
    total.value = Number(body?.data?.total ?? 0)
  } catch (e) {
    const msg = e?.response?.data?.msg
    errorMessage.value = String(msg ?? e?.message ?? '请求失败')
    tableList.value = []
    total.value = 0
  } finally {
    loading.value = false
  }
}

function onSearch() {
  page.value = 1
  loadList()
}

watch(showUnAudited, () => {
  page.value = 1
  loadList()
})

function onReset() {
  qName.value = ''
  qCode.value = ''
  qCard.value = ''
  page.value = 1
  loadList()
}

function onPageSizeChange(size) {
  pageSize.value = size
  page.value = 1
  loadList()
}

function onPageChange(p) {
  page.value = p
  loadList()
}

function openCreate() {
  dialogMode.value = 'create'
  form.value = {
    code: '',
    new_code: '',
    name: '',
    card_number: '',
    join_department: '',
    position: '',
    sex: '',
    nation: '',
    birth: '',
    highest: '',
    yn_firend: '',
    meal_type: DEFAULT_MEAL_TYPE,
    yn_history: '',
    remark: '',
    intime: todayString(),
  }
  postOptions.value = []
  void loadDeptOptions()
  dialogVisible.value = true
}

function openEdit(row) {
  if (rowIsAudited(row)) return
  dialogMode.value = 'edit'
  form.value = {
    code: String(row?.code ?? ''),
    new_code: String(row?.new_code ?? ''),
    name: String(row?.name ?? ''),
    card_number: String(row?.card_number ?? ''),
    join_department: String(row?.join_department ?? ''),
    position: String(row?.position ?? ''),
    sex: String(row?.sex ?? ''),
    nation: String(row?.nation ?? ''),
    birth: String(row?.birth ?? ''),
    highest: String(row?.highest ?? ''),
    yn_firend: String(row?.yn_firend ?? ''),
    meal_type: String(row?.meal_type ?? '').trim() || DEFAULT_MEAL_TYPE,
    yn_history: normalizeYnHistoryForForm(row?.yn_history),
    remark: String(row?.remark ?? ''),
    intime: String(row?.intime ?? ''),
  }
  void loadDeptOptions()
  void loadPostOptions(form.value.join_department)
  dialogVisible.value = true
}

async function submitForm() {
  try {
    await formRef.value?.validate()
  } catch {
    return
  }
  submitting.value = true
  try {
    const payload = {
      name: String(form.value.name ?? '').trim(),
      new_code: String(form.value.new_code ?? '').trim(),
      card_number: String(form.value.card_number ?? '').trim(),
      join_department: String(form.value.join_department ?? '').trim(),
      position: String(form.value.position ?? '').trim(),
      sex: String(form.value.sex ?? '').trim(),
      nation: String(form.value.nation ?? '').trim(),
      birth: String(form.value.birth ?? '').trim(),
      highest: String(form.value.highest ?? '').trim(),
      yn_firend: String(form.value.yn_firend ?? '').trim(),
      meal_type: String(form.value.meal_type ?? '').trim() || DEFAULT_MEAL_TYPE,
      yn_history: String(form.value.yn_history ?? '').trim(),
      remark: String(form.value.remark ?? '').trim(),
      intime: String(form.value.intime ?? '').trim(),
    }
    if (dialogMode.value === 'edit') {
      payload.code = String(form.value.code ?? '').trim()
      const res = await axios.put('/api/hr/staff', payload)
      const body = res.data
      if (body?.code !== 200) {
        ElMessage.error(String(body?.msg ?? '保存失败'))
        return
      }
      ElMessage.success('已保存')
    } else {
      const res = await axios.post('/api/hr/staff', payload)
      const body = res.data
      if (body?.code !== 200) {
        ElMessage.error(String(body?.msg ?? '新增失败'))
        return
      }
      ElMessage.success('已新增')
    }
    dialogVisible.value = false
    await loadList()
  } catch (e) {
    const msg = e?.response?.data?.msg
    ElMessage.error(String(msg ?? e?.message ?? '请求失败'))
  } finally {
    submitting.value = false
  }
}

async function confirmDelete(row) {
  if (rowIsAudited(row)) {
    ElMessage.warning('该记录已审核锁定，请反审后再操作')
    return
  }
  const code = String(row?.code ?? '')
  try {
    await ElMessageBox.confirm(`确定删除员工「${row?.name}」（工号=${code}）吗？`, '确认删除', { type: 'warning' })
  } catch {
    return
  }
  try {
    const res = await axios.delete(`/api/hr/staff/${encodeURIComponent(code)}`)
    const body = res.data
    if (body?.code !== 200) {
      ElMessage.error(String(body?.msg ?? '删除失败'))
      return
    }
    ElMessage.success('已删除')
    await loadList()
  } catch (e) {
    const msg = e?.response?.data?.msg
    ElMessage.error(String(msg ?? e?.message ?? '请求失败'))
  }
}

async function doAudit(row) {
  if (rowIsAudited(row)) return
  try {
    await ElMessageBox.confirm(
      `确定审核员工「${row?.name}」（工号=${row?.code}）吗？审核后将锁定编辑/删除，需反审后再操作。`,
      '确认审核',
      { type: 'warning' }
    )
  } catch {
    return
  }
  try {
    const res = await axios.put('/api/hr/staff/audit', { code: row.code })
    const body = res.data
    if (body?.code !== 200) {
      ElMessage.error(String(body?.msg ?? '审核失败'))
      return
    }
    ElMessage.success('已审核')
    await loadList()
  } catch (e) {
    const msg = e?.response?.data?.msg
    ElMessage.error(String(msg ?? e?.message ?? '请求失败'))
  }
}

async function doUnaudit(row) {
  if (!rowIsAudited(row)) return
  try {
    await ElMessageBox.confirm(`确定反审员工「${row?.name}」吗？反审后可再编辑或删除。`, '确认反审', {
      type: 'warning',
    })
  } catch {
    return
  }
  try {
    const res = await axios.put('/api/hr/staff/unaudit', { code: row.code })
    const body = res.data
    if (body?.code !== 200) {
      ElMessage.error(String(body?.msg ?? '反审失败'))
      return
    }
    ElMessage.success('已反审')
    await loadList()
  } catch (e) {
    const msg = e?.response?.data?.msg
    ElMessage.error(String(msg ?? e?.message ?? '请求失败'))
  }
}

onMounted(() => {
  loadList()
})
</script>

<style scoped>
.erp-module-page {
  min-height: 200px;
}
.page-title {
  font-size: 18px;
  font-weight: 600;
}
.page-desc {
  margin: 0;
  color: var(--el-text-color-secondary);
}

.error-alert {
  margin: 12px 0;
}
.search-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin: 8px 0 12px;
}
.operator-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin: 10px 0 12px;
}
.audit-switch {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 0 10px;
  border-radius: 8px;
  background: #f5f7fa;
}
.switch-label {
  font-size: 13px;
  color: var(--el-text-color-regular);
}
.toolbar-btn {
  height: 45px;
  padding: 0 18px;
  border-radius: 8px;
  font-weight: 500;
}
.btn-icon {
  margin-right: 8px;
}
.btn-action {
  background-color: #d6ecff;
  border-color: #bcdfff;
  color: #1f5faa;
}
.btn-view {
  background-color: #d6ecff;
  border-color: #bcdfff;
  color: #1f5faa;
}
.pagination-row {
  display: flex;
  justify-content: flex-end;
  margin-top: 12px;
}
.warn-text {
  color: #d12f19;
  font-weight: 700;
}
.warn-text-sub {
  color: #d12f19;
  margin-left: 6px;
}

/* 弹窗表单：双列紧凑、长标签换行不挤占控件 */
.staff-dialog :deep(.el-dialog__body) {
  padding-top: 8px;
}
.staff-form-dialog :deep(.el-divider) {
  margin: 14px 0 12px;
}
.staff-form-dialog :deep(.el-form-item) {
  margin-bottom: 14px;
}
.staff-form-dialog :deep(.el-form-item__label) {
  line-height: 1.35;
  align-items: flex-start;
  padding-top: 4px;
}
.staff-form-item--multiline-label :deep(.el-form-item__label) {
  white-space: normal;
  word-break: break-all;
}
</style>
