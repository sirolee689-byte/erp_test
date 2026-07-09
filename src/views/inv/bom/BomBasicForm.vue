<template>
  <el-form
    class="erp-detail-form bom-edit-form bom-basic-edit-form"
    :model="form"
    label-width="0"
    size="default"
    @submit.prevent
  >
    <div class="bom-basic-layout">
      <div class="bom-basic-row">
        <div class="bom-basic-field">
          <span class="bom-basic-label bom-basic-label--required">编码</span>
          <el-form-item>
            <el-input
              v-model="form.kcaa01"
              class="bom-basic-control bom-basic-control--a"
              maxlength="300"
              show-word-limit
              placeholder="必填，不可含空格"
              :readonly="readonly"
              @keydown="readonly ? undefined : onKcaa01Keydown($event)"
              @paste="readonly ? undefined : onKcaa01Paste($event)"
              @blur="readonly ? undefined : onKcaa01Blur($event)"
            />
          </el-form-item>
        </div>
      </div>

      <div class="bom-basic-row">
        <div class="bom-basic-field">
          <span class="bom-basic-label bom-basic-label--required">名称</span>
          <el-form-item>
            <el-input v-model="form.kcaa02" class="bom-basic-control bom-basic-control--a" maxlength="500" show-word-limit :readonly="readonly" />
          </el-form-item>
        </div>
        <div class="bom-basic-field">
          <span class="bom-basic-label">是否客供</span>
          <el-form-item>
            <div class="bom-basic-buttons">
              <el-button :type="form.customer_supply_bool ? 'primary' : ''" :disabled="readonly" @click="form.customer_supply_bool = true">是</el-button>
              <el-button :type="!form.customer_supply_bool ? 'primary' : ''" :disabled="readonly" @click="form.customer_supply_bool = false">否</el-button>
            </div>
          </el-form-item>
        </div>
      </div>

      <div class="bom-basic-row">
        <div class="bom-basic-field">
          <span class="bom-basic-label">开票名称</span>
          <el-form-item>
            <el-input v-model="form.kpname" class="bom-basic-control bom-basic-control--a" maxlength="500" :readonly="readonly" />
          </el-form-item>
        </div>
      </div>

      <div class="bom-basic-row">
        <div class="bom-basic-field">
          <span class="bom-basic-label">英文名称</span>
          <el-form-item>
            <el-input v-model="form.kcaa02_en" class="bom-basic-control bom-basic-control--a" maxlength="500" :readonly="readonly" />
          </el-form-item>
        </div>
        <div class="bom-basic-field">
          <span class="bom-basic-label bom-basic-label--required">分类</span>
          <el-form-item>
            <el-autocomplete
              v-model="form.kcaa05_display"
              class="bom-basic-control bom-basic-control--b"
              :fetch-suggestions="fetchMaterialSuggest"
              clearable
              placeholder="必填，编码/名称检索"
              value-key="label"
              :disabled="readonly"
              @select="onPickMaterial"
            />
          </el-form-item>
        </div>
      </div>

      <div class="bom-basic-row">
        <div class="bom-basic-field">
          <span class="bom-basic-label">规格</span>
          <el-form-item>
            <el-input v-model="form.kcaa03" class="bom-basic-control bom-basic-control--a" maxlength="500" :readonly="readonly" />
          </el-form-item>
        </div>
        <div class="bom-basic-field">
          <span class="bom-basic-label">组别</span>
          <el-form-item>
            <el-input v-model="form.kcaa10" class="bom-basic-control bom-basic-control--b" maxlength="200" :readonly="readonly" />
          </el-form-item>
        </div>
      </div>

      <div class="bom-basic-row">
        <div class="bom-basic-field">
          <span class="bom-basic-label">颜色</span>
          <el-form-item>
            <el-autocomplete
              v-model="form.kcaa11_display"
              class="bom-basic-control bom-basic-control--a"
              :fetch-suggestions="fetchColorSuggest"
              clearable
              placeholder="编码/名称检索"
              value-key="label"
              :disabled="readonly"
              @select="onPickColor"
            />
          </el-form-item>
        </div>
        <div class="bom-basic-field">
          <span class="bom-basic-label">产地</span>
          <el-form-item>
            <el-select v-model="form.location" class="bom-basic-control bom-basic-control--b" placeholder="请选择" :disabled="readonly">
              <el-option label="国内" value="国内" />
              <el-option label="进口" value="进口" />
            </el-select>
          </el-form-item>
        </div>
      </div>

      <div class="bom-basic-row">
        <div class="bom-basic-field">
          <span class="bom-basic-label">客户款号</span>
          <el-form-item>
            <el-input v-model="form.kcaa06" class="bom-basic-control bom-basic-control--b" maxlength="300" :readonly="readonly" />
          </el-form-item>
        </div>
        <div class="bom-basic-field">
          <span class="bom-basic-label">报价损耗</span>
          <el-form-item>
            <el-input v-model="form.kcaa32" class="bom-basic-control bom-basic-control--b" :readonly="readonly" @input="readonly ? undefined : onNumericInput($event, 'kcaa32')" />
          </el-form-item>
        </div>
      </div>

      <div class="bom-basic-row">
        <div class="bom-basic-field">
          <span class="bom-basic-label">工厂款号</span>
          <el-form-item>
            <el-input v-model="form.kcaa09" class="bom-basic-control bom-basic-control--b" maxlength="300" :readonly="readonly" />
          </el-form-item>
        </div>
        <div class="bom-basic-field">
          <span class="bom-basic-label">物料损耗</span>
          <el-form-item>
            <el-input v-model="form.kcaa33" class="bom-basic-control bom-basic-control--b" :readonly="readonly" @input="readonly ? undefined : onNumericInput($event, 'kcaa33')" />
          </el-form-item>
        </div>
      </div>

      <div class="bom-basic-row">
        <div class="bom-basic-field">
          <span class="bom-basic-label bom-basic-label--required">使用单位</span>
          <el-form-item>
            <el-autocomplete
              v-model="form.kcaa04"
              class="bom-basic-control bom-basic-control--b"
              :fetch-suggestions="fetchUnitSuggest"
              clearable
              placeholder="必填"
              value-key="value"
              :disabled="readonly"
              @select="onPickUnitUse"
            />
          </el-form-item>
        </div>
        <div class="bom-basic-field">
          <span class="bom-basic-label">小数点配置</span>
          <el-form-item>
            <el-select v-model="form.decimal" class="bom-basic-control bom-basic-control--b" placeholder="位数" :disabled="readonly">
              <el-option v-for="n in 6" :key="n" :label="`${n} 位`" :value="String(n)" />
            </el-select>
          </el-form-item>
        </div>
      </div>

      <div class="bom-basic-row">
        <div class="bom-basic-field">
          <span class="bom-basic-label bom-basic-label--required">采购单位</span>
          <el-form-item>
            <el-autocomplete
              v-model="form.kcaa25"
              class="bom-basic-control bom-basic-control--b"
              :fetch-suggestions="fetchUnitSuggest"
              clearable
              placeholder="必填"
              value-key="value"
              :disabled="readonly"
              @select="onPickUnitPo"
            />
          </el-form-item>
        </div>
        <div class="bom-basic-field">
          <span class="bom-basic-label">转换方式</span>
          <el-form-item>
            <el-select v-model="form.kcaa27" class="bom-basic-control bom-basic-control--b" :disabled="readonly">
              <el-option label="采购->使用" :value="0" />
              <el-option label="使用->采购" :value="1" />
            </el-select>
          </el-form-item>
        </div>
        <div class="bom-basic-field">
          <span class="bom-basic-label">转换率</span>
          <el-form-item>
            <el-input v-model="form.kcaa26" class="bom-basic-control bom-basic-control--b" placeholder="自动换算" :readonly="readonly" />
          </el-form-item>
        </div>
      </div>

      <div class="bom-basic-row">
        <div class="bom-basic-field">
          <span class="bom-basic-label">报价单位</span>
          <el-form-item>
            <el-autocomplete
              v-model="form.kcaa29"
              class="bom-basic-control bom-basic-control--b"
              :fetch-suggestions="fetchUnitSuggest"
              clearable
              placeholder="单位名称"
              value-key="value"
              :disabled="readonly"
              @select="onPickUnitQt"
            />
          </el-form-item>
        </div>
        <div class="bom-basic-field">
          <span class="bom-basic-label">转换方式</span>
          <el-form-item>
            <el-select v-model="form.kcaa31" class="bom-basic-control bom-basic-control--b" :disabled="readonly">
              <el-option label="报价->使用" :value="0" />
              <el-option label="使用->报价" :value="1" />
            </el-select>
          </el-form-item>
        </div>
        <div class="bom-basic-field">
          <span class="bom-basic-label">转换率</span>
          <el-form-item>
            <el-input v-model="form.kcaa30" class="bom-basic-control bom-basic-control--b" placeholder="自动换算" :readonly="readonly" />
          </el-form-item>
        </div>
      </div>

      <div class="bom-basic-row">
        <div class="bom-basic-field">
          <span class="bom-basic-label">BOM价格</span>
          <el-form-item>
            <el-input v-model="form.sale_price" class="bom-basic-control bom-basic-control--b" :readonly="readonly" @input="readonly ? undefined : onNumericInput($event, 'sale_price')" />
          </el-form-item>
        </div>
        <div class="bom-basic-field">
          <span class="bom-basic-label">币别</span>
          <el-form-item>
            <el-select v-model="form.kcaa34" class="bom-basic-control bom-basic-control--b" filterable clearable placeholder="请选择币别" :disabled="readonly">
              <el-option
                v-for="(name, idx) in currencyDropdownOptions"
                :key="'c34-' + idx + '-' + name"
                :label="name"
                :value="name"
              />
            </el-select>
          </el-form-item>
        </div>
        <div class="bom-basic-field">
          <span class="bom-basic-label">采购价格</span>
          <el-form-item>
            <el-input v-model="form.cost_price" class="bom-basic-control bom-basic-control--b" :readonly="readonly" @input="readonly ? undefined : onNumericInput($event, 'cost_price')" />
          </el-form-item>
        </div>
        <div class="bom-basic-field">
          <span class="bom-basic-label">币别</span>
          <el-form-item>
            <el-select v-model="form.kcaa35" class="bom-basic-control bom-basic-control--b" filterable clearable placeholder="请选择币别" :disabled="readonly">
              <el-option
                v-for="(name, idx) in currencyDropdownOptions"
                :key="'c35-' + idx + '-' + name"
                :label="name"
                :value="name"
              />
            </el-select>
          </el-form-item>
        </div>
      </div>

      <div class="bom-basic-row">
        <div class="bom-basic-field">
          <span class="bom-basic-label">供应商</span>
          <el-form-item>
            <el-autocomplete
              v-model="form.supplier_display"
              class="bom-basic-control bom-basic-control--a"
              :fetch-suggestions="fetchSupplierSuggest"
              clearable
              placeholder="编码/名称"
              value-key="label"
              :disabled="readonly"
              @select="onPickSupplier"
            />
          </el-form-item>
        </div>
      </div>

      <div class="bom-basic-row">
        <div class="bom-basic-field">
          <span class="bom-basic-label">工作方式</span>
          <el-form-item>
            <div class="bom-basic-buttons">
              <el-button :type="form.kcaa12_bool ? 'primary' : ''" :disabled="readonly" @click="form.kcaa12_bool = !form.kcaa12_bool">采购</el-button>
              <el-button :type="form.kcaa13_bool ? 'primary' : ''" :disabled="readonly" @click="form.kcaa13_bool = !form.kcaa13_bool">外协</el-button>
              <el-button :type="form.kcaa14_bool ? 'primary' : ''" :disabled="readonly" @click="form.kcaa14_bool = !form.kcaa14_bool">自产</el-button>
            </div>
          </el-form-item>
        </div>
        <div class="bom-basic-field">
          <span class="bom-basic-label">生产车间</span>
          <el-form-item>
            <el-autocomplete
              v-model="form.workshop_display"
              class="bom-basic-control bom-basic-control--b"
              :fetch-suggestions="fetchWorkshopSuggest"
              clearable
              placeholder="编码/名称"
              value-key="label"
              :disabled="readonly"
              @select="onPickWorkshop"
            />
          </el-form-item>
        </div>
      </div>

      <div class="bom-basic-row">
        <div class="bom-basic-field">
          <span class="bom-basic-label">是否保税</span>
          <el-form-item>
            <div class="bom-basic-buttons">
              <el-button :type="form.sign_bool ? 'primary' : ''" :disabled="readonly" @click="form.sign_bool = true">是</el-button>
              <el-button :type="!form.sign_bool ? 'primary' : ''" :disabled="readonly" @click="form.sign_bool = false">否</el-button>
            </div>
          </el-form-item>
        </div>
      </div>

      <div class="bom-basic-row">
        <div class="bom-basic-field">
          <span class="bom-basic-label">备注</span>
          <el-form-item>
            <el-input v-model="form.remark" class="bom-basic-control bom-basic-control--a" type="textarea" :rows="3" maxlength="2000" show-word-limit :readonly="readonly" />
          </el-form-item>
        </div>
      </div>
    </div>
  </el-form>
</template>

<script setup>
defineProps({
  form: { type: Object, required: true },
  readonly: { type: Boolean, default: false },
  currencyDropdownOptions: { type: Array, default: () => [] },
  fetchMaterialSuggest: { type: Function, required: true },
  fetchColorSuggest: { type: Function, required: true },
  fetchUnitSuggest: { type: Function, required: true },
  fetchSupplierSuggest: { type: Function, required: true },
  fetchWorkshopSuggest: { type: Function, required: true },
  onPickMaterial: { type: Function, required: true },
  onPickColor: { type: Function, required: true },
  onPickUnitUse: { type: Function, required: true },
  onPickUnitPo: { type: Function, required: true },
  onPickUnitQt: { type: Function, required: true },
  onPickSupplier: { type: Function, required: true },
  onPickWorkshop: { type: Function, required: true },
  onNumericInput: { type: Function, required: true },
  onKcaa01Keydown: { type: Function, required: true },
  onKcaa01Paste: { type: Function, required: true },
  onKcaa01Blur: { type: Function, required: true },
})
</script>

<style scoped>
.bom-basic-edit-form {
  width: 100%;
}
.bom-basic-layout {
  --bom-basic-label-width: 86px;
  --bom-basic-input-b: 220px;
  --bom-basic-input-a: calc(var(--bom-basic-input-b) * 2);
  --bom-basic-input-height: 40px;
  /* DIY：字段值字号，与主列表数据列 --erp-table-data-size 对齐（标准/舒适模式自动切换） */
  --bom-basic-control-font-size: var(--erp-table-data-size);
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-width: 1380px;
  padding: 10px 0 18px;
}
.bom-basic-row {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 14px 40px;
  width: 100%;
}
.bom-basic-field {
  display: inline-flex;
  align-items: flex-start;
  gap: 10px;
  min-width: 0;
}
.bom-basic-label {
  flex: 0 0 var(--bom-basic-label-width);
  min-height: var(--bom-basic-input-height);
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  font-size: 14px;
  font-weight: var(--erp-font-weight-body);
  color: var(--el-text-color-primary);
  white-space: nowrap;
}
.bom-basic-label--required {
  color: #e60000;
}
.bom-basic-field :deep(.el-form-item) {
  margin-bottom: 0;
}
.bom-basic-field :deep(.el-form-item__content) {
  margin-left: 0 !important;
  line-height: var(--bom-basic-input-height);
}
.bom-basic-field :deep(.el-input__wrapper),
.bom-basic-field :deep(.el-select__wrapper),
.bom-basic-field :deep(.el-textarea__inner) {
  min-height: var(--bom-basic-input-height);
}
/* DIY：基础资料字段值字体统一（与主列表「分类」列一致：常规字号、不加粗）——只影响展示，不动数据 */
/* 位置：BomBasicForm.vue <style scoped>；变量 --erp-table-data-size / --erp-font-weight-body */
.bom-basic-field :deep(.el-input__inner),
.bom-basic-field :deep(.el-select__selected-item),
.bom-basic-field :deep(.el-select__placeholder),
.bom-basic-field :deep(.el-textarea__inner) {
  font-size: var(--erp-table-data-size) !important;
  font-weight: var(--erp-font-weight-body) !important;
}
.bom-basic-control--a {
  width: var(--bom-basic-input-a);
}
.bom-basic-control--b {
  width: var(--bom-basic-input-b);
}
.bom-basic-buttons {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  min-height: var(--bom-basic-input-height);
}
.bom-basic-buttons :deep(.el-button) {
  min-width: 72px;
  font-size: var(--erp-table-data-size) !important;
  font-weight: var(--erp-font-weight-body) !important;
}
@media (max-width: 720px) {
  .bom-basic-layout {
    --bom-basic-input-b: min(220px, calc(100vw - 150px));
  }
  .bom-basic-field {
    width: 100%;
  }
  .bom-basic-control--a,
  .bom-basic-control--b {
    width: min(100%, calc(100vw - 150px));
  }
}
</style>
