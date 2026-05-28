<template>
  <el-form
    v-if="basic"
    class="erp-detail-form bom-detail-form"
    label-position="right"
    label-width="112px"
    size="default"
  >
    <div class="bom-section-title">系统</div>
    <el-row :gutter="12" class="bom-edit-row-system">
      <el-col :xs="24" :sm="15">
        <el-form-item label="系统编码">
          <el-input :model-value="dVal(basic.systemcode)" readonly placeholder="—" />
        </el-form-item>
      </el-col>
      <el-col :xs="24" :sm="9">
        <el-form-item label="客供">
          <div class="bom-edit-checkbox-cell">
            <el-checkbox :model-value="basic.customer_supply_checked" disabled>是</el-checkbox>
          </div>
        </el-form-item>
      </el-col>
    </el-row>

    <div class="bom-section-title">基本资料</div>
    <el-row :gutter="12">
      <el-col :xs="24" :sm="8">
        <el-form-item label="编码">
          <el-input :model-value="dVal(basic.kcaa01)" readonly />
        </el-form-item>
      </el-col>
      <el-col :xs="24" :sm="16">
        <el-form-item label="名称">
          <el-input :model-value="dVal(basic.kcaa02)" readonly />
        </el-form-item>
      </el-col>
      <el-col :xs="24" :sm="8">
        <el-form-item label="开票名称">
          <el-input :model-value="dVal(basic.kpname)" readonly />
        </el-form-item>
      </el-col>
      <el-col :xs="24" :sm="16">
        <el-form-item label="英文名称">
          <el-input :model-value="dVal(basic.kcaa02_en)" readonly />
        </el-form-item>
      </el-col>
      <el-col :xs="24" :sm="12">
        <el-form-item label="分类">
          <el-input :model-value="dVal(categoryDisplay)" readonly />
        </el-form-item>
      </el-col>
      <el-col :xs="24" :sm="12">
        <el-form-item label="规格">
          <el-input :model-value="dVal(basic.kcaa03)" readonly />
        </el-form-item>
      </el-col>
      <el-col :xs="24" :sm="12">
        <el-form-item label="组别">
          <el-input :model-value="dVal(basic.kcaa10)" readonly />
        </el-form-item>
      </el-col>
      <el-col :xs="24" :sm="12">
        <el-form-item label="颜色">
          <el-input :model-value="dVal(basic.kcaa11)" readonly />
        </el-form-item>
      </el-col>
      <el-col :xs="24" :sm="12">
        <el-form-item label="产地">
          <el-input :model-value="dVal(basic.location)" readonly />
        </el-form-item>
      </el-col>
      <el-col :xs="24" :sm="12">
        <el-form-item label="客户款号">
          <el-input :model-value="dVal(basic.kcaa06)" readonly />
        </el-form-item>
      </el-col>
      <el-col :xs="24" :sm="12">
        <el-form-item label="工厂款号">
          <el-input :model-value="dVal(basic.kcaa09)" readonly />
        </el-form-item>
      </el-col>
    </el-row>

    <div class="bom-section-title">单位与损耗</div>
    <div class="bom-unit-loss-block">
      <el-row :gutter="12">
        <el-col :xs="24" :sm="12">
          <el-form-item label="使用单位">
            <el-input :model-value="dVal(basic.kcaa04)" readonly />
          </el-form-item>
        </el-col>
        <el-col :xs="24" :sm="12">
          <el-form-item label="小数点配置">
            <el-input :model-value="dVal(decimalLabel)" readonly />
          </el-form-item>
        </el-col>
      </el-row>
      <el-row :gutter="12">
        <el-col :xs="24" :sm="8">
          <el-form-item label="采购单位">
            <el-input :model-value="dVal(basic.kcaa25)" readonly />
          </el-form-item>
        </el-col>
        <el-col :xs="24" :sm="8">
          <el-form-item label="转换方式">
            <el-select :model-value="kcaa27Num" disabled style="width: 100%">
              <el-option label="采购->使用" :value="0" />
              <el-option label="使用->采购" :value="1" />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :xs="24" :sm="8">
          <el-form-item label="转换率">
            <el-input :model-value="dVal(basic.kcaa26)" readonly />
          </el-form-item>
        </el-col>
      </el-row>
      <el-row :gutter="12">
        <el-col :xs="24" :sm="8">
          <el-form-item label="报价单位">
            <el-input :model-value="dVal(basic.kcaa29)" readonly />
          </el-form-item>
        </el-col>
        <el-col :xs="24" :sm="8">
          <el-form-item label="转换方式">
            <el-select :model-value="kcaa31Num" disabled style="width: 100%">
              <el-option label="报价->使用" :value="0" />
              <el-option label="使用->报价" :value="1" />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :xs="24" :sm="8">
          <el-form-item label="转换率">
            <el-input :model-value="dVal(basic.kcaa30)" readonly />
          </el-form-item>
        </el-col>
      </el-row>
      <el-row :gutter="12">
        <el-col :xs="24" :sm="12">
          <el-form-item label="报价损耗">
            <el-input :model-value="dVal(basic.kcaa32)" readonly />
          </el-form-item>
        </el-col>
        <el-col :xs="24" :sm="12">
          <el-form-item label="物料损耗">
            <el-input :model-value="dVal(basic.kcaa33)" readonly />
          </el-form-item>
        </el-col>
      </el-row>
    </div>

    <div class="bom-section-title">价格与币别</div>
    <el-row :gutter="12">
      <el-col :xs="24" :sm="12">
        <el-form-item label="BOM价格">
          <el-input :model-value="dVal(basic.sale_price)" readonly />
        </el-form-item>
      </el-col>
      <el-col :xs="24" :sm="12">
        <el-form-item label="币别(报价)">
          <el-input :model-value="dVal(quoteCurrencyText)" readonly />
        </el-form-item>
      </el-col>
      <el-col :xs="24" :sm="12">
        <el-form-item label="采购价格">
          <el-input :model-value="dVal(basic.cost_price)" readonly />
        </el-form-item>
      </el-col>
      <el-col :xs="24" :sm="12">
        <el-form-item label="币别(采购)">
          <el-input :model-value="dVal(basic.kcaa35)" readonly />
        </el-form-item>
      </el-col>
      <el-col :span="24">
        <el-form-item label="供应商">
          <el-input :model-value="dVal(basic.supplier_display)" readonly />
        </el-form-item>
      </el-col>
    </el-row>

    <div class="bom-section-title">工作方式与车间</div>
    <el-row :gutter="12">
      <el-col :span="24">
        <el-form-item label="工作方式">
          <div class="bom-detail-check-row">
            <el-checkbox :model-value="basic.kcaa12_checked" disabled>采购</el-checkbox>
            <el-checkbox :model-value="basic.kcaa13_checked" disabled>外协</el-checkbox>
            <el-checkbox :model-value="basic.kcaa14_checked" disabled>自产</el-checkbox>
          </div>
        </el-form-item>
      </el-col>
      <el-col :span="24">
        <el-form-item label="生产车间">
          <el-input :model-value="dVal(basic.workshop_display)" readonly />
        </el-form-item>
      </el-col>
    </el-row>

    <div class="bom-section-title">其它</div>
    <el-row :gutter="12">
      <el-col :xs="24" :sm="12">
        <el-form-item label="保税">
          <el-switch :model-value="signBool" disabled active-text="保税" inactive-text="非保税" />
        </el-form-item>
      </el-col>
      <el-col :span="24">
        <el-form-item label="备注">
          <el-input :model-value="dVal(basic.remark)" type="textarea" :rows="3" readonly />
        </el-form-item>
      </el-col>
    </el-row>
  </el-form>
</template>

<script setup>
import { computed, toRef } from 'vue'

const props = defineProps({
  /** bom_000 主档只读对象（可与主详情、子窗共用） */
  basic: { type: Object, default: null },
})

const basic = toRef(props, 'basic')

function dVal(v) {
  const s = String(v ?? '').trim()
  return s || '—'
}

const categoryDisplay = computed(() => {
  const b = basic.value
  if (!b) return ''
  const n = String(b.categoryName ?? '').trim()
  if (n) return n
  return String(b.kcaa05 ?? '').trim()
})

const kcaa27Num = computed(() => (Number(basic.value?.kcaa27) === 1 ? 1 : 0))
const kcaa31Num = computed(() => (Number(basic.value?.kcaa31) === 1 ? 1 : 0))

const decimalLabel = computed(() => {
  const d = String(basic.value?.decimal ?? '').trim()
  if (/^[1-6]$/.test(d)) return `${d} 位`
  return d
})

const quoteCurrencyText = computed(() => {
  const raw = String(basic.value?.kcaa34 ?? '').trim()
  if (raw) return raw
  return String(basic.value?.kcaa34_display ?? '').trim()
})

const signBool = computed(() => {
  const s = String(basic.value?.sign ?? '').trim()
  return s === '1' || s.toLowerCase() === 'y'
})
</script>
