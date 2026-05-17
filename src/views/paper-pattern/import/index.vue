<template>
  <div class="erp-module-page">
    <el-card shadow="never" class="block-card">
      <template #header>
        <span class="page-title">纸格资料导入</span>
      </template>
      <p class="page-desc">
        流程：选择 Excel → 上传并解析 → 顶部在「基础资料确认区」核对或修改导入类型、厂款号、组别、客款号、颜色编码 → 可查看
        <strong>Material 列表</strong>（材料单位、损耗等）并进入 <strong>ERP 物料校验工作台</strong> →
        系统根据「导入类型 + 厂款号 + 颜色编码」实时生成主 BOM 与 CUT 编码预览。确认无误后可<strong>正式导入</strong>写入
        Bom_000（主 BOM + CUT，事务）。客款号默认读 L2；组别优先读 M2，若 M2 为空则在前 10 行识别「组别」标签并取右侧单元格。
      </p>

      <el-divider content-position="left">模板下载</el-divider>
      <div class="section">
        <el-button type="primary" @click="downloadTemplate">下载纸格模板</el-button>
        <span class="hint">模板路径：/template/paper-pattern-template.xlsx（由管理员维护内容）</span>
      </div>

      <el-divider content-position="left">Excel 上传</el-divider>
      <div class="section">
        <input
          ref="fileInputRef"
          type="file"
          class="hidden-file"
          accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
          @change="onFileChange"
        />
        <el-button type="primary" plain @click="triggerPickFile">选择 Excel 文件</el-button>
        <span v-if="pickedLabel" class="picked-name">{{ pickedLabel }}</span>
        <span v-else class="picked-placeholder">未选择文件</span>
        <el-button type="primary" :disabled="!pickedFile" :loading="uploading" @click="onUploadParse">
          上传并解析
        </el-button>
      </div>

      <el-alert v-if="errorMessage" class="err" :title="errorMessage" type="error" show-icon />

      <template v-if="parseResult">
        <el-alert
          v-if="parseResult.warnings?.length"
          type="warning"
          show-icon
          class="warn-block"
          title="解析提示"
        >
          <ul class="warn-list">
            <li v-for="(w, i) in parseResult.warnings" :key="i">{{ w }}</li>
          </ul>
        </el-alert>

        <el-divider content-position="left">基础资料确认区</el-divider>
        <p class="confirm-desc">
          以下为 Excel 解析后的默认值，可直接修改；其中<strong>导入类型</strong>、<strong>厂款号</strong>、<strong>颜色编码</strong>任一变更时，下方主
          BOM 与 CUT 编码会实时重算（客款号、组别不参与编码）。客款号默认来自 <strong>L2</strong>；组别优先
        <strong>M2</strong>，否则由表头「组别」标签行解析。
        </p>
        <div v-if="importTypesError" class="hint err-inline">{{ importTypesError }}</div>
        <el-row :gutter="16" class="confirm-grid">
          <el-col :xs="24" :sm="12" :md="8" :lg="6">
            <div class="form-field">
              <div class="form-label">导入类型</div>
              <el-select
                v-model="basicForm.importTypeFlag5"
                placeholder="请选择"
                filterable
                clearable
                class="field-control"
                :loading="importTypesLoading"
              >
                <el-option
                  v-for="it in importTypeOptions"
                  :key="it.id"
                  :label="formatImportTypeLabel(it)"
                  :value="it.flag5"
                />
              </el-select>
            </div>
          </el-col>
          <el-col :xs="24" :sm="12" :md="8" :lg="6">
            <div class="form-field">
              <div class="form-label">厂款号</div>
              <el-input v-model="basicForm.factoryStyleNo" clearable class="field-control" placeholder="如 PQ-2803H1（模板 N2）" />
            </div>
          </el-col>
          <el-col :xs="24" :sm="12" :md="8" :lg="6">
            <div class="form-field">
              <div class="form-label">组别</div>
              <el-input
                v-model="basicForm.groupLabel"
                clearable
                class="field-control"
                placeholder="优先 M2，否则「组别」右侧"
              />
            </div>
          </el-col>
          <el-col :xs="24" :sm="12" :md="8" :lg="6">
            <div class="form-field">
              <div class="form-label">客款号</div>
              <el-input
                v-model="basicForm.customerStyleNo"
                clearable
                class="field-control"
                placeholder="默认 L2，如 -BV2960B2A"
              />
            </div>
          </el-col>
          <el-col :xs="24" :sm="12" :md="8" :lg="6">
            <div class="form-field">
              <div class="form-label">颜色编码</div>
              <el-input v-model="basicForm.colorNo" clearable class="field-control" placeholder="如 N-TEST" />
            </div>
          </el-col>
          <el-col :xs="24" :sm="12" :md="16" :lg="12">
            <div class="form-field">
              <div class="form-label">样品名称（仅资料确认，不写入 Bom_000）</div>
              <el-input
                v-model="basicForm.sampleName"
                clearable
                class="field-control"
                placeholder="默认取 Excel「样品名称」；正式导入时主 BOM 的 kcaa02 为导入类型名称（Bom_code.flag1）"
              />
            </div>
          </el-col>
        </el-row>
        <p class="norm-hint">
          编码用厂款号（已去掉 *、空格、中划线）：<code>{{ styleNoNormalizedForCode || '—' }}</code>
        </p>

        <div class="fold-toolbar">
          <el-button
            type="primary"
            :disabled="!liveMainBomCode || commitLoading"
            :loading="commitLoading"
            @click="onCommitBom000"
          >
            正式导入
          </el-button>
          <el-button plain @click="hideMaterialTable = !hideMaterialTable">
            {{ hideMaterialTable ? '显示物料信息' : '隐藏物料信息' }}
          </el-button>
          <el-button plain @click="hideCutPreviewTable = !hideCutPreviewTable">
            {{ hideCutPreviewTable ? '显示基础信息' : '隐藏基础信息' }}
          </el-button>
        </div>

        <el-alert type="error" show-icon :closable="false" class="danger-zone">
          <template #title>测试：按主 BOM 物理清理库内数据</template>
          <div class="danger-zone-body">
            <p>
              将<strong>物理删除</strong>指定主 BOM（Bom_000.kcaa01）及所有下属 CUT（<code>CUT-类型厂款号/颜色&lt;…&gt;</code>）对应的
              <strong>Bom_parts</strong> 与 <strong>Bom_000</strong> 行（先删明细再删主档；与纸格生成编码规则一致）。不涉及 bom_cost
              等其它表；若外键阻止删除，请根据报错在库中处理依赖。
            </p>
            <div class="danger-row">
              <el-input
                v-model="deleteMainKcaa01Input"
                clearable
                class="danger-input"
                placeholder="主 BOM 编码，如 BAG-PQ2803H1/R-TEST"
              />
              <el-button text type="primary" @click="fillDeleteMainKcaa01FromPreview">填入当前主 BOM</el-button>
              <el-button
                type="danger"
                plain
                :disabled="deleteBomTreeLoading || !String(deleteMainKcaa01Input || '').trim()"
                :loading="deleteBomTreeLoading"
                @click="onDeleteBomTree"
              >
                物理删除该主 BOM 及下属 CUT
              </el-button>
            </div>
          </div>
        </el-alert>

        <div class="material-top-block">
          <div class="material-top-head">
            <h3 class="sub-title material-top-title">Material 列表</h3>
            <el-button type="primary" @click="goErpWorkbenchFromParse">进入 ERP 物料校验工作台</el-button>
          </div>
          <div v-show="!hideMaterialTable">
            <p class="hint material-top-hint">对照 Bom_000.kcaa01 校验 Material / Accessory（仅校验，不写库）。</p>
            <p v-if="materialBomFieldsLoading" class="hint">正在加载材料单位与默认损耗（Bom_000）…</p>
            <el-table :data="materialPreviewRows" border size="small" class="preview-table" empty-text="无">
              <el-table-column prop="groupNo" label="分组" width="88" />
              <el-table-column prop="materialName" label="Material 名称" min-width="140" show-overflow-tooltip />
              <el-table-column prop="materialCode" label="ERP 编码" min-width="180" show-overflow-tooltip />
              <el-table-column prop="materialUnit" label="材料单位" width="100" />
              <el-table-column label="损耗比例" min-width="140">
                <template #default="{ row }">
                  <template v-if="row.wastageEditable">
                    <el-input-number
                      :model-value="row.wastageFraction"
                      :min="0"
                      :max="1"
                      :precision="4"
                      :step="0.0001"
                      size="small"
                      controls-position="right"
                      class="wastage-input"
                      @update:model-value="(v) => onMaterialWastageFractionInput(row.rowIndex, v)"
                    />
                  </template>
                  <span v-else>{{ row.wastageReadonlyText }}</span>
                </template>
              </el-table-column>
              <el-table-column prop="remarkDisplay" label="备注" min-width="160" show-overflow-tooltip />
            </el-table>
          </div>
        </div>

        <el-divider content-position="left">编码预览（实时）</el-divider>
        <div class="code-preview-block">
          <div class="main-bom-line">
            <span class="k">主 BOM 编码</span>
            <span class="v">{{ liveMainBomCode || '（请补全导入类型、厂款号、颜色编码）' }}</span>
          </div>
          <div v-show="!hideCutPreviewTable">
            <h4 class="sub-title sm">CUT 预览</h4>
            <el-table :data="liveCutsPreview" border size="small" class="preview-table cut-preview-table" empty-text="无 CUT 行">
              <el-table-column prop="cutCode" label="CUT 编码" min-width="280" fixed="left" />
              <el-table-column prop="cutNameDisplay" label="裁片名称" min-width="120" />
              <el-table-column prop="lengthDisplay" label="长" min-width="88" align="right" />
              <el-table-column prop="widthDisplay" label="宽" min-width="88" align="right" />
              <el-table-column prop="quantityDisplay" label="数量" min-width="88" align="right" />
              <el-table-column prop="fabricWidthDisplay" label="宽幅" min-width="88" align="right" />
              <el-table-column prop="unitConsumptionDisplay" label="单位用量" min-width="100" align="right" />
              <el-table-column prop="wastageDisplay" label="损耗" min-width="88" align="right" />
              <el-table-column prop="actualConsumptionDisplay" label="实际用量" min-width="100" align="right" />
              <el-table-column prop="unitPriceDisplay" label="单价" min-width="96" align="right" />
              <el-table-column prop="totalAmountDisplay" label="总价" min-width="96" align="right" />
              <el-table-column prop="matchingDisplay" label="搭配" min-width="100" />
              <el-table-column prop="unitDisplay" label="单位" min-width="72" />
            </el-table>
          </div>
        </div>

        <h3 class="sub-title">Accessory 列表</h3>
        <el-table :data="parseResult.accessories" border size="small" class="preview-table" empty-text="无">
          <el-table-column prop="accessoryName" label="名称" min-width="140" show-overflow-tooltip />
          <el-table-column prop="erpCode" label="ERP 编码" min-width="220" show-overflow-tooltip />
          <el-table-column prop="usageQty" label="用量" min-width="100" align="right" />
          <el-table-column prop="wastage" label="损耗" min-width="100" align="right" />
          <el-table-column prop="lineTotal" label="合计" min-width="100" align="right" />
          <el-table-column prop="matching" label="搭配" min-width="120" show-overflow-tooltip />
        </el-table>
      </template>
    </el-card>
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import axios from 'axios'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  buildCutCode,
  buildMainBomCode,
  normalizeFactoryStyleForEncoding,
} from '@/utils/paperPatternImportCodes.js'
import {
  formatPaperPatternCutNumericDisplay,
  formatPaperPatternCutTextDisplay,
} from '@/utils/paperPatternCutDisplayFormat.js'
import { erpCodeLookupKey, normalizeErpCodeDisplay } from '@/utils/paperPatternErpCodeNormalize.js'
import { canEditPaperPatternMaterialWastage } from '@/utils/paperPatternMaterialWastagePolicy.js'
import { formatFractionAsDecimalText } from '@/utils/paperPatternMaterialWastageInput.js'

const ERP_WORKBENCH_STORAGE = 'paperPatternErpWorkbenchPayloadV1'

const router = useRouter()
const templateHref = '/template/paper-pattern-template.xlsx'

function downloadTemplate() {
  const a = document.createElement('a')
  a.href = templateHref
  a.download = 'paper-pattern-template.xlsx'
  a.rel = 'noopener'
  a.click()
}

const fileInputRef = ref(null)
const pickedFile = ref(null)
const pickedLabel = ref('')
const uploading = ref(false)
const errorMessage = ref('')
/** @type {import('vue').Ref<Array<{ id: number, flag1: string, flag5: string }>>} */
const importTypeOptions = ref([])
const importTypesLoading = ref(false)
const importTypesError = ref('')

/** 基础资料确认（与解析默认值同步，可改） */
const basicForm = reactive({
  /** Bom_code.flag5 */
  importTypeFlag5: '',
  /** 厂款号展示/编辑（可含横线、空格等，编码时标准化） */
  factoryStyleNo: '',
  /** 组别（资料 M2，不参与 BOM/CUT 编码） */
  groupLabel: '',
  customerStyleNo: '',
  /** 颜色编码（参与 BOM/CUT；原「色号」逻辑） */
  colorNo: '',
  /** Excel 样品名称，仅页面参考；正式导入主 BOM kcaa02 使用 Bom_code.flag1 */
  sampleName: '',
})

/** @type {import('vue').Ref<null | { mainBom: object, cuts: any[], materials: any[], accessories: any[], warnings: string[] }>} */
const parseResult = ref(null)
/** 折叠：仅隐藏 Material 表格区域（标题与 ERP 工作台按钮仍显示） */
const hideMaterialTable = ref(false)
/** 折叠：仅隐藏 CUT 预览标题与表格（主 BOM 编码行仍显示） */
const hideCutPreviewTable = ref(false)
const commitLoading = ref(false)
/** 测试：按主 BOM 物理删除 */
const deleteMainKcaa01Input = ref('')
const deleteBomTreeLoading = ref(false)

function fillDeleteMainKcaa01FromPreview() {
  deleteMainKcaa01Input.value = liveMainBomCode.value || ''
}

async function onDeleteBomTree() {
  const code = String(deleteMainKcaa01Input.value ?? '').trim()
  if (!code) {
    ElMessage.warning('请填写主 BOM 编码')
    return
  }
  try {
    await ElMessageBox.confirm(
      `将物理删除主 BOM「${code}」及所有匹配的 CUT 主档与全部 Bom_parts 明细（不可恢复）。是否继续？`,
      '危险操作',
      { type: 'error', confirmButtonText: '确定删除', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  deleteBomTreeLoading.value = true
  try {
    const res = await axios.post('/api/paper-pattern/import/delete-bom-tree', { mainKcaa01: code })
    const data = res?.data
    if (!data?.success) {
      ElMessage.error(String(data?.message || '删除失败'))
      return
    }
    const d = data.data || {}
    ElMessage.success(
      `已删除：Bom_parts ${d.bomPartsDeleted ?? 0} 行，Bom_000 ${d.bom000Deleted ?? 0} 行（CUT 匹配：${d.cutKcaa01Like ?? '—'}）`,
    )
  } catch (e) {
    const msg = e?.response?.data?.message || e?.message || '删除失败'
    ElMessage.error(String(msg))
  } finally {
    deleteBomTreeLoading.value = false
  }
}

function formatImportTypeLabel(it) {
  const f1 = String(it?.flag1 ?? '').trim()
  const f5 = String(it?.flag5 ?? '').trim()
  if (f1 && f5) return `${f1}(${f5})`
  return f5 || f1 || '—'
}

async function loadImportTypes() {
  importTypesError.value = ''
  importTypesLoading.value = true
  try {
    const res = await axios.get('/api/paper-pattern/import-types')
    const data = res?.data
    if (!data?.success) {
      importTypesError.value = String(data?.message || '加载导入类型失败')
      importTypeOptions.value = []
      return
    }
    importTypeOptions.value = Array.isArray(data.items) ? data.items : []
  } catch (e) {
    importTypesError.value = String(
      e?.response?.data?.message || e?.response?.data?.msg || e?.message || '加载导入类型失败',
    )
    importTypeOptions.value = []
  } finally {
    importTypesLoading.value = false
  }
}

/** 从解析结果填充确认区 */
function hydrateBasicFormFromParseMain(main) {
  const m = main || {}
  basicForm.importTypeFlag5 = String(m.importTypeFlag5 ?? '').trim()
  const raw = String(m.styleNoRaw ?? '').trim()
  const sn = String(m.styleNo ?? m.styleNoNormalized ?? '').trim()
  basicForm.factoryStyleNo = raw || sn
  basicForm.groupLabel = String(m.groupLabel ?? '').trim()
  basicForm.customerStyleNo = String(m.customerStyleNo ?? '').trim()
  basicForm.colorNo = String(m.colorNo ?? '').trim()
  basicForm.sampleName = String(m.sampleName ?? '').trim()
}

const styleNoNormalizedForCode = computed(() => normalizeFactoryStyleForEncoding(basicForm.factoryStyleNo))

const liveMainBomCode = computed(() =>
  buildMainBomCode({
    importTypeFlag5: basicForm.importTypeFlag5,
    styleNo: styleNoNormalizedForCode.value,
    colorNo: basicForm.colorNo,
  }),
)

const liveCutsPreview = computed(() => {
  const cuts = parseResult.value?.cuts
  if (!Array.isArray(cuts)) return []
  const flag5 = basicForm.importTypeFlag5
  const sn = styleNoNormalizedForCode.value
  const col = basicForm.colorNo
  return cuts.map((c) => ({
    cutSeq: c.cutSeq,
    cutNameDisplay: formatPaperPatternCutTextDisplay(c.cutName),
    cutCode: buildCutCode({
      importTypeFlag5: flag5,
      styleNo: sn,
      colorNo: col,
      cutSeq: c.cutSeq,
    }),
    lengthDisplay: formatPaperPatternCutNumericDisplay(c.length),
    widthDisplay: formatPaperPatternCutNumericDisplay(c.width),
    quantityDisplay: formatPaperPatternCutNumericDisplay(c.quantity),
    fabricWidthDisplay: formatPaperPatternCutNumericDisplay(c.fabricWidth),
    unitConsumptionDisplay: formatPaperPatternCutNumericDisplay(c.unitConsumption),
    wastageDisplay: formatPaperPatternCutNumericDisplay(c.wastage),
    actualConsumptionDisplay: formatPaperPatternCutNumericDisplay(c.actualConsumption),
    unitPriceDisplay: formatPaperPatternCutNumericDisplay(c.unitPrice),
    totalAmountDisplay: formatPaperPatternCutNumericDisplay(c.totalAmount),
    matchingDisplay: formatPaperPatternCutTextDisplay(c.matching),
    // CUT 裁片属纸格 BOM，单位与旧系统一致统一为「张」；预览阶段不展示 Excel 单位列
    unitDisplay: '张',
  }))
})

/** Bom_000：按 ERP 编码拉取 kcaa04 / kcaa33（仅预览） */
const materialBomFieldByKey = ref(
  /** @type {Record<string, { kcaa04?: string, kcaa33?: number | null }>} */ ({}),
)
const materialBomFieldsLoading = ref(false)
/** Material 预览行（含可编辑损耗小数，与 kcaa33 一致，不写库） */
const materialPreviewRows = ref([])

function rebuildMaterialPreviewRows() {
  const mats = parseResult.value?.materials
  if (!Array.isArray(mats) || mats.length === 0) {
    materialPreviewRows.value = []
    return
  }
  const byKey = materialBomFieldByKey.value || {}
  materialPreviewRows.value = mats.map((m, idx) => {
    const display = normalizeErpCodeDisplay(m?.materialCode ?? '')
    const key = erpCodeLookupKey(display)
    const fld = key && byKey[key] ? byKey[key] : null
    const exists = !!(key && fld)
    const unit = exists ? String(fld.kcaa04 ?? '').trim() : ''
    const dbFrac =
      fld && fld.kcaa33 !== null && fld.kcaa33 !== undefined && Number.isFinite(Number(fld.kcaa33))
        ? Number(fld.kcaa33)
        : null
    const wastageEditable = canEditPaperPatternMaterialWastage(display)
    const remarkRaw = String(m.remark ?? '').trim()
    const remarkDisplay = remarkRaw ? remarkRaw : '*'
    const wastageReadonlyText =
      dbFrac === null || dbFrac === undefined || Number.isNaN(Number(dbFrac))
        ? ''
        : formatFractionAsDecimalText(dbFrac)
    return {
      rowIndex: idx,
      groupNo: m.groupNo,
      materialName: m.materialName,
      materialCode: m?.materialCode ?? '',
      materialUnit: unit,
      remarkDisplay,
      wastageEditable,
      /** 损耗小数（如 0.06），与 Bom_000.kcaa33 一致 */
      wastageFraction: dbFrac,
      dbWastageFraction: dbFrac,
      wastageReadonlyText,
    }
  })
}

/**
 * @param {number} rowIndex
 * @param {number | null | undefined} v el-input-number（小数，如 0.06）
 */
function onMaterialWastageFractionInput(rowIndex, v) {
  const row = materialPreviewRows.value[rowIndex]
  if (!row?.wastageEditable) return
  if (v === undefined || v === null || v === '') {
    row.wastageFraction = null
    return
  }
  const n = Number(v)
  row.wastageFraction = Number.isFinite(n) ? n : null
}

/** 防止快速连续上传时旧请求覆盖新数据 */
let materialBomFetchSeq = 0

async function loadMaterialBomFieldsForPreview() {
  const mats = parseResult.value?.materials
  if (!Array.isArray(mats) || mats.length === 0) {
    materialBomFieldByKey.value = {}
    materialPreviewRows.value = []
    return
  }

  const seq = ++materialBomFetchSeq
  materialBomFieldsLoading.value = true
  // 先按当前 byKey 渲染表格（含 ERP 列），避免等待接口期间整表空白
  rebuildMaterialPreviewRows()
  try {
    const seen = new Set()
    const codeList = []
    for (const m of mats) {
      const d = normalizeErpCodeDisplay(m?.materialCode ?? '')
      const k = erpCodeLookupKey(d)
      if (!k || seen.has(k)) continue
      seen.add(k)
      codeList.push(d)
    }
    if (codeList.length === 0) {
      materialBomFieldByKey.value = {}
      return
    }

    const res = await axios.post('/api/paper-pattern/material-bom-fields', { codes: codeList })
    if (seq !== materialBomFetchSeq) return

    const data = res?.data
    const rawByKey = data?.success && data.byKey && typeof data.byKey === 'object' ? data.byKey : {}
    materialBomFieldByKey.value = { ...rawByKey }
    // 立即按新 byKey 重算预览行，避免仅依赖 finally 时序导致表格短暂空白
    rebuildMaterialPreviewRows()

    if (data?.success === false) {
      const m = String(data?.message || '接口返回失败')
      ElMessage.warning(`材料主档字段：${m}`)
    } else if (codeList.length > 0 && Object.keys(rawByKey).length === 0) {
      ElMessage.warning(
        'Bom_000 未命中任何 ERP 编码（材料单位/损耗为空）。请在后端控制台查看 [paper-pattern-material-bom-fields] 库命中= 与请求示例编码是否一致。',
      )
    }

    if (import.meta.env.DEV && Array.isArray(data?.items)) {
      console.info('[material-bom-fields] 回填命中', data.items.length, data.items)
    }
  } catch (e) {
    if (seq !== materialBomFetchSeq) return
    materialBomFieldByKey.value = {}
    const st = e?.response?.status
    const body = e?.response?.data
    const detail = body && typeof body.detail === 'string' && body.detail.trim() ? `（${body.detail.trim()}）` : ''
    const msg = body?.message || body?.msg || e?.message || '未知错误'
    console.error('[material-bom-fields] 请求失败', st, body ?? e)
    ElMessage.warning(`材料主档字段加载失败（${st || '网络'}）：${msg}${detail}`)
  } finally {
    if (seq === materialBomFetchSeq) {
      materialBomFieldsLoading.value = false
      rebuildMaterialPreviewRows()
    }
  }
}

watch(
  parseResult,
  async () => {
    await nextTick()
    await loadMaterialBomFieldsForPreview()
  },
  { deep: true },
)

onMounted(() => {
  loadImportTypes()
})

function goErpWorkbenchFromParse() {
  if (!parseResult.value) return
  try {
    sessionStorage.setItem(
      ERP_WORKBENCH_STORAGE,
      JSON.stringify({
        savedAt: Date.now(),
        materials: parseResult.value.materials || [],
        accessories: parseResult.value.accessories || [],
      }),
    )
  } catch {
    // 忽略存储失败（隐私模式等）
  }
  router.push({ path: '/paper-pattern/import/erp-workbench' })
}

function triggerPickFile() {
  errorMessage.value = ''
  fileInputRef.value?.click()
}

function resolveImportTypeFlag1ForCommit() {
  const f5 = String(basicForm.importTypeFlag5 ?? '').trim()
  const hit = importTypeOptions.value.find((it) => String(it?.flag5 ?? '').trim() === f5)
  return String(hit?.flag1 ?? '').trim()
}

function buildMaterialsPayloadForCommit() {
  const base = parseResult.value?.materials
  const preview = materialPreviewRows.value
  if (Array.isArray(preview) && preview.length > 0 && Array.isArray(base)) {
    return preview.map((row) => {
      const b = base[row.rowIndex] || {}
      return {
        groupNo: row.groupNo,
        materialName: row.materialName,
        materialCode: row.materialCode,
        remark: b.remark ?? '',
        usageQty: b.usageQty ?? '',
        wastageFraction: row.wastageFraction,
      }
    })
  }
  return Array.isArray(base) ? base.map((m) => ({ ...m })) : []
}

/** 正式导入请求体（不含 overwrite） */
function buildCommitPayloadBody() {
  return {
    importTypeFlag5: basicForm.importTypeFlag5,
    importTypeFlag1: resolveImportTypeFlag1ForCommit(),
    factoryStyleNo: basicForm.factoryStyleNo,
    colorNo: basicForm.colorNo,
    customerStyleNo: basicForm.customerStyleNo,
    groupLabel: basicForm.groupLabel,
    cuts: parseResult.value.cuts,
    materials: buildMaterialsPayloadForCommit(),
    accessories: parseResult.value.accessories || [],
  }
}

function showCommitSuccessMessage(data) {
  const code = data?.mainBomCode ?? ''
  const nCut = data?.cutCount ?? 0
  const nPart = data?.bomPartsInserted ?? 0
  const rep = data?.overwriteReplaced
  let extra = ''
  if (rep && (rep.bom000Deleted > 0 || rep.bomPartsDeleted > 0)) {
    extra = `（已覆盖旧数据：删除 Bom_000 ${rep.bom000Deleted} 条、Bom_parts ${rep.bomPartsDeleted} 行）`
  }
  ElMessage.success(`导入成功。主 BOM：${code}；CUT 数量：${nCut}；Bom_parts：${nPart} 行${extra}`)
}

async function onCommitBom000() {
  if (!parseResult.value || !liveMainBomCode.value) {
    ElMessage.warning('请先完成解析，并确保导入类型、厂款号、颜色编码可生成主 BOM 编码')
    return
  }
  try {
    await ElMessageBox.confirm(
      '将把主 BOM、全部 CUT 写入 Bom_000，并写入 Bom_parts（单事务，失败全部回滚）。是否继续？',
      '正式导入',
      { type: 'warning', confirmButtonText: '确定导入', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  commitLoading.value = true
  const postCommit = (overwrite) =>
    axios.post('/api/paper-pattern/import/commit-bom000', {
      ...buildCommitPayloadBody(),
      ...(overwrite ? { overwrite: true } : {}),
    })
  try {
    const res = await postCommit(false)
    const data = res?.data
    if (!data?.success) {
      ElMessage.error(String(data?.message || '导入失败'))
      return
    }
    showCommitSuccessMessage(data.data)
  } catch (e) {
    const d = e?.response?.data
    if (d?.code === 'MAIN_BOM_EXISTS') {
      const codeHint = String(d?.data?.mainBomCode ?? liveMainBomCode.value ?? '').trim()
      try {
        await ElMessageBox.confirm(
          `Bom_000 在册记录中已存在主 BOM「${codeHint}」。是否覆盖？\n将先物理删除该主 BOM、同批纸格 CUT 及关联 Bom_parts，再重新导入（仍为单事务，失败全部回滚）。`,
          '主 BOM 已存在',
          { type: 'warning', confirmButtonText: '覆盖并导入', cancelButtonText: '取消' },
        )
      } catch {
        return
      }
      try {
        const res2 = await postCommit(true)
        const data2 = res2?.data
        if (!data2?.success) {
          ElMessage.error(String(data2?.message || '导入失败'))
          return
        }
        showCommitSuccessMessage(data2.data)
      } catch (e2) {
        const d2 = e2?.response?.data
        ElMessage.error(String(d2?.message || e2?.message || '导入失败'))
      }
    } else {
      ElMessage.error(String(d?.message || e?.message || '导入失败'))
    }
  } finally {
    commitLoading.value = false
  }
}

function onFileChange(ev) {
  const input = ev.target
  const file = input?.files?.[0]
  if (!file) {
    pickedFile.value = null
    pickedLabel.value = ''
    return
  }
  const name = String(file.name || '')
  const lower = name.toLowerCase()
  if (!lower.endsWith('.xlsx') && !lower.endsWith('.xls')) {
    pickedFile.value = null
    pickedLabel.value = ''
    errorMessage.value = '仅允许上传 .xlsx 或 .xls 文件'
    input.value = ''
    return
  }
  pickedFile.value = file
  pickedLabel.value = name
  input.value = ''
}

async function onUploadParse() {
  if (!pickedFile.value) return
  errorMessage.value = ''
  uploading.value = true
  parseResult.value = null
  try {
    const fd = new FormData()
    fd.append('file', pickedFile.value)
    const res = await axios.post('/api/paper-pattern/upload', fd)
    const data = res?.data
    if (!data?.success) {
      errorMessage.value = String(data?.message || '解析失败')
      return
    }
    parseResult.value = {
      mainBom: data.mainBom || {},
      cuts: Array.isArray(data.cuts) ? data.cuts : [],
      materials: Array.isArray(data.materials) ? data.materials : [],
      accessories: Array.isArray(data.accessories) ? data.accessories : [],
      warnings: Array.isArray(data.warnings) ? data.warnings : [],
    }
    hideMaterialTable.value = false
    hideCutPreviewTable.value = false
    hydrateBasicFormFromParseMain(data.mainBom)
  } catch (e) {
    const msg =
      e?.response?.data?.message ||
      e?.response?.data?.msg ||
      e?.message ||
      '上传或解析失败'
    errorMessage.value = String(msg)
  } finally {
    uploading.value = false
  }
}
</script>

<style scoped>
.erp-module-page {
  min-height: 200px;
}
.block-card {
  max-width: 1100px;
}
.page-title {
  font-size: 18px;
  font-weight: 600;
}
.page-desc {
  margin: 0 0 8px;
  color: var(--el-text-color-secondary);
}
.section {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
}
.err-inline {
  color: var(--el-color-danger);
}
.hidden-file {
  display: none;
}
.picked-name {
  color: var(--el-text-color-primary);
}
.picked-placeholder {
  color: var(--el-text-color-placeholder);
}
.hint {
  font-size: 13px;
  color: var(--el-text-color-secondary);
}
.warn-list {
  margin: 8px 0 0;
  padding-left: 1.2em;
}
.warn-block {
  margin-bottom: 12px;
}
.err {
  margin-bottom: 12px;
}
.confirm-desc {
  margin: 0 0 12px;
  font-size: 13px;
  color: var(--el-text-color-secondary);
  line-height: 1.5;
}
.confirm-grid {
  margin-bottom: 8px;
}
.form-field {
  margin-bottom: 12px;
}
.form-label {
  font-size: 13px;
  color: var(--el-text-color-regular);
  margin-bottom: 6px;
}
.field-control {
  width: 100%;
}
.norm-hint {
  margin: 0 0 16px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.norm-hint code {
  font-size: 12px;
}
.fold-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin: 0 0 16px;
}
.danger-zone {
  margin: 0 0 20px;
}
.danger-zone-body p {
  margin: 0 0 10px;
  font-size: 13px;
  line-height: 1.5;
}
.danger-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}
.danger-input {
  flex: 1;
  min-width: 220px;
  max-width: 420px;
}
.material-top-block {
  margin-bottom: 20px;
  padding: 12px 14px;
  border-radius: 6px;
  background: var(--el-fill-color-light);
  border: 1px solid var(--el-border-color-lighter);
}
.material-top-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 6px;
}
.material-top-title {
  margin: 0;
  flex: 1;
  min-width: 140px;
}
.material-top-hint {
  margin: 0 0 8px;
}
.code-preview-block {
  margin-bottom: 20px;
  padding: 12px 14px;
  border-radius: 6px;
  background: var(--el-fill-color-light);
  border: 1px solid var(--el-border-color-lighter);
}
.main-bom-line {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 10px;
  margin-bottom: 12px;
  font-size: 15px;
}
.main-bom-line .k {
  font-weight: 600;
  color: var(--el-text-color-primary);
}
.main-bom-line .v {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  color: var(--el-color-primary);
  word-break: break-all;
}
.sub-title {
  margin: 16px 0 8px;
  font-size: 15px;
  font-weight: 600;
}
.sub-title.sm {
  margin: 0 0 8px;
  font-size: 14px;
}
.preview-table {
  margin-bottom: 8px;
}
.wastage-input {
  width: 132px;
}
</style>
