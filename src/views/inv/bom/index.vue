<template>
  <div class="erp-module-page">
    <!--
      v1.1.8：BOM 主档列表（bom_000），严格服务端分页；合并关键词搜索（kcaa01/kcaa02 全模糊 OR）。
      性能约定：关键词仅在后端「满 3 字」时生效（参数化 LIKE），降低大表扫描风险。
    -->
    <el-card shadow="never">
      <template #header>
        <span class="page-title">{{ pageTitle }}</span>
      </template>
      <p class="page-desc">
        数据来自物理表 <code>bom_000</code>（可通过环境变量 <code>INV_BOM_MASTER_TABLE</code> 覆盖表名）。默认每页 10 条，仅加载当前页数据。
      </p>

      <div class="search-row">
        <el-input
          v-model="keyword"
          placeholder="输入编码或名称关键词（支持全模糊）"
          clearable
          class="bom-keyword-input"
          @keyup.enter="onSearch"
        />
        <el-select
          v-if="!showRecycle"
          v-model="searchQuery.bom_cut"
          placeholder="裁片过滤"
          style="width: 200px"
          @change="onSearch"
        >
          <el-option label="不包含裁片编码（排除 CUT- 开头）" :value="0" />
          <el-option label="仅裁片编码（仅 CUT- 开头）" :value="1" />
        </el-select>
        <div class="audit-switch">
          <span class="switch-label">回收站</span>
          <el-switch v-model="showRecycle" @change="onRecycleChange" />
        </div>
        <div v-if="!showRecycle" class="audit-switch">
          <span class="switch-label">显示未审核</span>
          <el-switch v-model="showUnAudited" @change="onSearch" />
        </div>
        <el-button type="primary" @click="onSearch">查询</el-button>
        <el-button @click="onReset">重置</el-button>
        <el-button v-if="!showRecycle" v-permission="'add'" type="success" @click="openAddBom">新增 BOM</el-button>
      </div>

      <el-alert
        v-if="hintShort"
        type="info"
        show-icon
        :closable="false"
        class="hint-alert"
        title="提示：关键词不足 3 个字时不会作为筛选条件（避免大表慢查询）。"
      />

      <el-alert v-if="errorMessage" :title="errorMessage" type="error" show-icon class="error-alert" />

      <el-alert
        v-if="showRecycle"
        title="当前为回收站视图：仅显示已逻辑删除（del=1）的主档；可恢复或彻底删除（不可恢复）。"
        type="info"
        show-icon
        class="audit-view-alert"
      />
      <el-alert
        v-else-if="showUnAudited"
        title="当前显示：未审核（pass=0）的 BOM 行"
        type="warning"
        show-icon
        class="audit-view-alert"
      />

      <el-skeleton :loading="loading" animated :rows="8">
        <template #default>
          <el-table
            :data="tableList"
            border
            stripe
            style="width: 100%"
            row-key="rowKey"
            :empty-text="loading ? '加载中…' : '暂无数据'"
          >
            <el-table-column label="操作" width="218" fixed="left" align="left">
              <template #default="{ row }">
                <div class="bom-list-actions">
                  <template v-if="showRecycle">
                    <el-button
                      v-permission="'view'"
                      size="small"
                      @click="openDetail(row)"
                    >
                      查看详情
                    </el-button>
                    <el-button
                      v-permission="'edit'"
                      type="primary"
                      link
                      size="small"
                      :loading="busySystemcode === row.systemcode"
                      :disabled="!String(row.systemcode ?? '').trim()"
                      @click="onRestore(row)"
                    >
                      恢复
                    </el-button>
                    <el-button
                      v-permission="'delete'"
                      type="danger"
                      link
                      size="small"
                      :loading="busySystemcode === row.systemcode"
                      :disabled="!String(row.systemcode ?? '').trim() || rowIsAudited(row)"
                      @click="onHardDelete(row)"
                    >
                      彻底删除
                    </el-button>
                  </template>
                  <template v-else>
                    <el-button v-permission="'view'" size="small" @click="openDetail(row)">查看详情</el-button>
                    <el-button
                      v-permission="'add'"
                      size="small"
                      type="primary"
                      link
                      :loading="busyCopySystemcode === row.systemcode || busyCopySystemcode === row.code"
                      :disabled="!String(row.code ?? '').trim()"
                      @click="openCopyBom(row)"
                    >
                      复制
                    </el-button>
                    <el-button
                      v-if="showUnAudited"
                      v-permission="'edit'"
                      size="small"
                      :disabled="rowIsAudited(row)"
                      @click="onEdit(row)"
                    >
                      编辑
                    </el-button>
                    <el-button
                      v-if="showUnAudited && !rowIsAudited(row)"
                      v-permission="'audit'"
                      type="success"
                      link
                      size="small"
                      :loading="busySystemcode === row.systemcode"
                      @click="onAudit(row)"
                    >
                      审核
                    </el-button>
                    <el-button
                      v-if="!showUnAudited && rowIsAudited(row)"
                      v-permission="'audit'"
                      type="warning"
                      link
                      size="small"
                      :loading="busySystemcode === row.systemcode"
                      @click="onUnaudit(row)"
                    >
                      反审
                    </el-button>
                    <el-button
                      v-if="showUnAudited"
                      v-permission="'delete'"
                      type="danger"
                      link
                      size="small"
                      :disabled="rowIsAudited(row) || !String(row.systemcode ?? '').trim()"
                      :loading="busySystemcode === row.systemcode"
                      @click="onSoftDelete(row)"
                    >
                      删除
                    </el-button>
                  </template>
                </div>
              </template>
            </el-table-column>
            <el-table-column label="编码" min-width="220">
              <template #default="{ row }">
                <span class="bom-list-cell-wrap">{{ row.code }}</span>
              </template>
            </el-table-column>
            <el-table-column label="名称" min-width="140">
              <template #default="{ row }">
                <span class="bom-list-cell-wrap">{{ row.name }}</span>
              </template>
            </el-table-column>
            <el-table-column label="规格" min-width="140">
              <template #default="{ row }">
                <span class="bom-list-cell-wrap">{{ row.spec }}</span>
              </template>
            </el-table-column>
            <el-table-column prop="unit" label="单位" width="56" align="center" show-overflow-tooltip />
            <el-table-column label="输入/修改时间" min-width="158">
              <template #default="{ row }">
                <div class="usage-sum-cell">
                  <div>输入：{{ formatDateTime(row.addtime) }}</div>
                  <div>修改：{{ formatDateTime(row.edittime) }}</div>
                </div>
              </template>
            </el-table-column>
            <el-table-column prop="remark" label="备注" min-width="120" show-overflow-tooltip />
            <el-table-column label="采购" width="56" align="center">
              <template #default="{ row }">{{ ynText(row.isPurchase) }}</template>
            </el-table-column>
            <el-table-column label="外协" width="56" align="center">
              <template #default="{ row }">{{ ynText(row.isSubcontract) }}</template>
            </el-table-column>
            <el-table-column label="自产" width="56" align="center">
              <template #default="{ row }">{{ ynText(row.isSelfProduced) }}</template>
            </el-table-column>
            <el-table-column label="审核" width="72" align="center">
              <template #default="{ row }">
                <el-tag v-if="rowIsAudited(row)" type="success" size="small">已审</el-tag>
                <el-tag v-else type="info" size="small">未审</el-tag>
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

    <el-dialog
      v-model="detailVisible"
      :title="detailDialogTitle"
      width="min(1120px, 96vw)"
      top="4vh"
      destroy-on-close
      class="bom-detail-dialog"
      @closed="onDetailClosed"
    >
      <el-skeleton :loading="detailLoading" animated :rows="10">
        <template #default>
          <el-alert v-if="detailError" :title="detailError" type="error" show-icon class="bom-detail-alert" />
          <template v-else-if="bomBasic">
            <div v-if="detailDrillStack.length" class="bom-detail-drill-bar">
              <el-button type="primary" link @click="goBackDetailDrill">
                ← 返回上一层
              </el-button>
              <span v-if="detailDrillBackHint" class="bom-detail-drill-bar__hint">
                来自：{{ detailDrillBackHint }}
              </span>
            </div>
            <el-tabs v-model="detailActiveTab">
              <el-tab-pane label="基础资料" name="basic">
                <div class="bom-detail-body">
                  <el-form class="bom-detail-form" label-position="right" label-width="112px" size="default">
                    <div class="bom-section-title">系统</div>
                    <el-row :gutter="12" class="bom-edit-row-system">
                      <el-col :xs="24" :sm="15">
                        <el-form-item label="系统编码">
                          <el-input :model-value="dVal(bomBasic.systemcode)" readonly placeholder="—" />
                        </el-form-item>
                      </el-col>
                      <el-col :xs="24" :sm="9">
                        <el-form-item label="客供">
                          <div class="bom-edit-checkbox-cell">
                            <el-checkbox :model-value="bomBasic.customer_supply_checked" disabled>是</el-checkbox>
                          </div>
                        </el-form-item>
                      </el-col>
                    </el-row>

                    <div class="bom-section-title">基本资料</div>
                    <el-row :gutter="12">
                      <el-col :xs="24" :sm="12">
                        <el-form-item label="编码">
                          <el-input :model-value="dVal(bomBasic.kcaa01)" readonly />
                        </el-form-item>
                      </el-col>
                      <el-col :xs="24" :sm="12">
                        <el-form-item label="名称">
                          <el-input :model-value="dVal(bomBasic.kcaa02)" readonly />
                        </el-form-item>
                      </el-col>
                      <el-col :xs="24" :sm="12">
                        <el-form-item label="开票名称">
                          <el-input :model-value="dVal(bomBasic.kpname)" readonly />
                        </el-form-item>
                      </el-col>
                      <el-col :xs="24" :sm="12">
                        <el-form-item label="英文名称">
                          <el-input :model-value="dVal(bomBasic.kcaa02_en)" readonly />
                        </el-form-item>
                      </el-col>
                      <el-col :xs="24" :sm="12">
                        <el-form-item label="分类">
                          <el-input :model-value="dVal(detailCategoryDisplay)" readonly />
                        </el-form-item>
                      </el-col>
                      <el-col :xs="24" :sm="12">
                        <el-form-item label="规格">
                          <el-input :model-value="dVal(bomBasic.kcaa03)" readonly />
                        </el-form-item>
                      </el-col>
                      <el-col :xs="24" :sm="12">
                        <el-form-item label="组别">
                          <el-input :model-value="dVal(bomBasic.kcaa10)" readonly />
                        </el-form-item>
                      </el-col>
                      <el-col :xs="24" :sm="12">
                        <el-form-item label="颜色">
                          <el-input :model-value="dVal(bomBasic.kcaa11)" readonly />
                        </el-form-item>
                      </el-col>
                      <el-col :xs="24" :sm="12">
                        <el-form-item label="产地">
                          <el-input :model-value="dVal(bomBasic.location)" readonly />
                        </el-form-item>
                      </el-col>
                      <el-col :xs="24" :sm="12">
                        <el-form-item label="客户款号">
                          <el-input :model-value="dVal(bomBasic.kcaa06)" readonly />
                        </el-form-item>
                      </el-col>
                      <el-col :xs="24" :sm="12">
                        <el-form-item label="工厂款号">
                          <el-input :model-value="dVal(bomBasic.kcaa09)" readonly />
                        </el-form-item>
                      </el-col>
                    </el-row>

                    <div class="bom-section-title">单位与损耗</div>
                    <div class="bom-unit-loss-block">
                      <el-row :gutter="12">
                        <el-col :xs="24" :sm="12">
                          <el-form-item label="使用单位">
                            <el-input :model-value="dVal(bomBasic.kcaa04)" readonly />
                          </el-form-item>
                        </el-col>
                        <el-col :xs="24" :sm="12">
                          <el-form-item label="小数点配置">
                            <el-input :model-value="dVal(detailDecimalLabel)" readonly />
                          </el-form-item>
                        </el-col>
                      </el-row>
                      <el-row :gutter="12">
                        <el-col :xs="24" :sm="8">
                          <el-form-item label="采购单位">
                            <el-input :model-value="dVal(bomBasic.kcaa25)" readonly />
                          </el-form-item>
                        </el-col>
                        <el-col :xs="24" :sm="8">
                          <el-form-item label="转换方式">
                            <el-select :model-value="detailKcaa27Num" disabled style="width: 100%">
                              <el-option label="采购->使用" :value="0" />
                              <el-option label="使用->采购" :value="1" />
                            </el-select>
                          </el-form-item>
                        </el-col>
                        <el-col :xs="24" :sm="8">
                          <el-form-item label="转换率">
                            <el-input :model-value="dVal(bomBasic.kcaa26)" readonly />
                          </el-form-item>
                        </el-col>
                      </el-row>
                      <el-row :gutter="12">
                        <el-col :xs="24" :sm="8">
                          <el-form-item label="报价单位">
                            <el-input :model-value="dVal(bomBasic.kcaa29)" readonly />
                          </el-form-item>
                        </el-col>
                        <el-col :xs="24" :sm="8">
                          <el-form-item label="转换方式">
                            <el-select :model-value="detailKcaa31Num" disabled style="width: 100%">
                              <el-option label="报价->使用" :value="0" />
                              <el-option label="使用->报价" :value="1" />
                            </el-select>
                          </el-form-item>
                        </el-col>
                        <el-col :xs="24" :sm="8">
                          <el-form-item label="转换率">
                            <el-input :model-value="dVal(bomBasic.kcaa30)" readonly />
                          </el-form-item>
                        </el-col>
                      </el-row>
                      <el-row :gutter="12">
                        <el-col :xs="24" :sm="12">
                          <el-form-item label="报价损耗">
                            <el-input :model-value="dVal(bomBasic.kcaa32)" readonly />
                          </el-form-item>
                        </el-col>
                        <el-col :xs="24" :sm="12">
                          <el-form-item label="物料损耗">
                            <el-input :model-value="dVal(bomBasic.kcaa33)" readonly />
                          </el-form-item>
                        </el-col>
                      </el-row>
                    </div>

                    <div class="bom-section-title">价格与币别</div>
                    <el-row :gutter="12">
                      <el-col :xs="24" :sm="12">
                        <el-form-item label="BOM价格">
                          <el-input :model-value="dVal(bomBasic.sale_price)" readonly />
                        </el-form-item>
                      </el-col>
                      <el-col :xs="24" :sm="12">
                        <el-form-item label="币别(报价)">
                          <el-input :model-value="dVal(detailQuoteCurrencyText)" readonly />
                        </el-form-item>
                      </el-col>
                      <el-col :xs="24" :sm="12">
                        <el-form-item label="采购价格">
                          <el-input :model-value="dVal(bomBasic.cost_price)" readonly />
                        </el-form-item>
                      </el-col>
                      <el-col :xs="24" :sm="12">
                        <el-form-item label="币别(采购)">
                          <el-input :model-value="dVal(bomBasic.kcaa35)" readonly />
                        </el-form-item>
                      </el-col>
                      <el-col :span="24">
                        <el-form-item label="供应商">
                          <el-input :model-value="dVal(bomBasic.supplier_display)" readonly />
                        </el-form-item>
                      </el-col>
                    </el-row>

                    <div class="bom-section-title">工作方式与车间</div>
                    <el-row :gutter="12">
                      <el-col :span="24">
                        <el-form-item label="工作方式">
                          <div class="bom-detail-check-row">
                            <el-checkbox :model-value="bomBasic.kcaa12_checked" disabled>采购</el-checkbox>
                            <el-checkbox :model-value="bomBasic.kcaa13_checked" disabled>外协</el-checkbox>
                            <el-checkbox :model-value="bomBasic.kcaa14_checked" disabled>自产</el-checkbox>
                          </div>
                        </el-form-item>
                      </el-col>
                      <el-col :span="24">
                        <el-form-item label="生产车间">
                          <el-input :model-value="dVal(bomBasic.workshop_display)" readonly />
                        </el-form-item>
                      </el-col>
                    </el-row>

                    <div class="bom-section-title">其它</div>
                    <el-row :gutter="12">
                      <el-col :xs="24" :sm="12">
                        <el-form-item label="保税">
                          <el-switch :model-value="detailSignBool" disabled active-text="保税" inactive-text="非保税" />
                        </el-form-item>
                      </el-col>
                      <el-col :span="24">
                        <el-form-item label="备注">
                          <el-input :model-value="dVal(bomBasic.remark)" type="textarea" :rows="3" readonly />
                        </el-form-item>
                      </el-col>
                    </el-row>
                  </el-form>
                </div>
              </el-tab-pane>
              <el-tab-pane label="配件明细" name="parts" :disabled="!bomBasic">
                <el-alert
                  v-if="!bomSystemcode && bomBasic"
                  type="warning"
                  show-icon
                  :closable="false"
                  class="bom-parts-alert"
                  title="主档缺少 systemcode，无法加载或保存配件明细。"
                />
                <div v-else class="bom-parts-toolbar">
                  <el-button
                    v-if="detailDrillStack.length"
                    type="primary"
                    link
                    class="bom-detail-drill-bar__btn--toolbar"
                    @click="goBackDetailDrill"
                  >
                    ← 返回上一层
                  </el-button>
                  <el-button
                    type="primary"
                    :disabled="partsReadOnly || !bomSystemcode"
                    @click="materialSelectorVisible = true"
                  >
                    添加配件
                  </el-button>
                  <el-button :disabled="partsReadOnly || !bomSystemcode || partsLoading" @click="loadBomParts">
                    刷新
                  </el-button>
                  <el-button
                    type="success"
                    :disabled="partsReadOnly || !bomSystemcode || partsLoading"
                    @click="saveBomParts"
                  >
                    保存配件明细
                  </el-button>
                </div>
                <el-alert v-if="partsError" :title="partsError" type="error" show-icon class="bom-parts-alert" />
                <div class="bom-parts-table-wrap">
                  <el-table
                    v-loading="partsLoading"
                    :data="partsList"
                    border
                    stripe
                    size="small"
                    class="bom-parts-table"
                    :empty-text="partsLoading ? '加载中…' : '暂无配件'"
                    :row-key="partsRowKey"
                    max-height="calc(100vh - 320px)"
                  >
                    <el-table-column
                      type="index"
                      label="序号"
                      width="56"
                      align="center"
                      fixed="left"
                      :index="partsRowIndex"
                    />
                    <el-table-column label="操作" width="148" align="center" fixed="left">
                      <template #default="{ row }">
                        <el-button
                          type="primary"
                          size="small"
                          class="bom-part-view-action-btn"
                          :disabled="!String(row.kcaa01 ?? '').trim()"
                          @click="openLinkedBomDetailFromPart(row)"
                        >
                          查看
                        </el-button>
                        <el-button
                          type="danger"
                          link
                          size="small"
                          :disabled="partLineReadonly(row)"
                          @click="removeDetailPartRow(row)"
                        >
                          删除
                        </el-button>
                      </template>
                    </el-table-column>
                    <!-- 编码/名称/规格/颜色：GET 已按 bom_000.kcaa01 关联优先取主档 -->
                    <el-table-column prop="kcaa01" label="编码" min-width="120" fixed="left" show-overflow-tooltip />
                    <el-table-column prop="kcaa02" label="名称" min-width="108" show-overflow-tooltip />
                    <el-table-column prop="kcaa03" label="规格" min-width="92" show-overflow-tooltip />
                    <el-table-column prop="kcaa11" label="颜色" width="80" show-overflow-tooltip />
                    <el-table-column prop="kcaa04" label="单位" width="64" show-overflow-tooltip />
                    <el-table-column label="单位用量" width="118">
                      <template #default="{ row }">
                        <el-input-number
                          v-model="row.kcac04"
                          :disabled="partLineReadonly(row)"
                          :min="0"
                          :precision="6"
                          :step="0.000001"
                          controls-position="right"
                          class="bom-parts-num"
                          @change="() => syncPartKcac06(row)"
                        />
                      </template>
                    </el-table-column>
                    <el-table-column label="损耗率(%)" width="108">
                      <template #default="{ row }">
                        <el-input-number
                          :model-value="lossPctDisplay(row)"
                          :disabled="partLineReadonly(row)"
                          :min="0"
                          :precision="2"
                          :step="0.1"
                          controls-position="right"
                          class="bom-parts-num"
                          @update:model-value="(v) => onLossPctChange(row, v)"
                        />
                      </template>
                    </el-table-column>
                    <!-- 用量合计紧跟用量/损耗，避免窄屏需滚过单价才可见 -->
                    <el-table-column label="用量合计(kcac06)" width="124" align="right">
                      <template #default="{ row }">{{ formatUsageTotal(row) }}</template>
                    </el-table-column>
                    <el-table-column label="单价" width="112">
                      <template #default="{ row }">
                        <el-input-number
                          v-model="row.cost_price"
                          :disabled="partLineReadonly(row)"
                          :min="0"
                          :precision="4"
                          :step="0.0001"
                          controls-position="right"
                          class="bom-parts-num"
                        />
                      </template>
                    </el-table-column>
                    <el-table-column label="成本合计" width="110" align="right">
                      <template #default="{ row }">{{ formatMoney(partCostSum(row)) }}</template>
                    </el-table-column>
                    <el-table-column label="备注" min-width="140">
                      <template #default="{ row }">
                        <el-input
                          v-model="row.remark"
                          :disabled="partLineReadonly(row)"
                          maxlength="500"
                          show-word-limit
                        />
                      </template>
                    </el-table-column>
                  </el-table>
                </div>
                <div class="bom-parts-sum-row">
                  <span>实际用量总和：<strong>{{ formatQtySumFooter(partsSumActualUsage) }}</strong></span>
                  <span class="bom-parts-sum-gap">总成本：<strong>{{ formatMoney(partsSumCost) }}</strong></span>
                </div>
                <MaterialSelector v-model="materialSelectorVisible" @picked="onMaterialPicked" />
              </el-tab-pane>
              <el-tab-pane label="BOM用量表运算" name="usageCalc" :disabled="!bomBasic">
                <div class="bom-parts-toolbar bom-usage-calc-toolbar">
                  <el-button
                    v-if="detailDrillStack.length"
                    type="primary"
                    link
                    class="bom-detail-drill-bar__btn--toolbar"
                    @click="goBackDetailDrill"
                  >
                    ← 返回上一层
                  </el-button>
                  <el-button
                    type="primary"
                    :loading="bomUsageTreeLoading"
                    :disabled="!bomSystemcode || bomUsageTreeLoading"
                    @click="onBomUsageTableCalc"
                  >
                    运算
                  </el-button>
                  <el-button :disabled="!bomUsageTreeData.length" @click="expandAllBomUsageTree">展开全部</el-button>
                  <el-button :disabled="!bomUsageTreeData.length" @click="collapseAllBomUsageTree">关闭全部</el-button>
                  <el-button :disabled="!bomSystemcode || bomUsageTreeLoading" @click="onBomUsageTableCalc">
                    刷新
                  </el-button>
                  <span class="bom-usage-calc-toolbar__hint">树形表格数据源：嵌套 children，只读 Bom_parts</span>
                </div>
                <el-alert
                  v-if="bomUsageTreeError"
                  :title="bomUsageTreeError"
                  type="error"
                  show-icon
                  class="bom-parts-alert"
                />
                <div v-loading="bomUsageTreeLoading" class="bom-usage-tree-wrap">
                  <div v-if="bomUsageTreeData.length" class="bom-usage-table-outer">
                    <el-table
                      ref="bomUsageTableRef"
                      :data="bomUsageTreeData"
                      row-key="id"
                      border
                      stripe
                      size="small"
                      class="bom-usage-tree-table"
                      :tree-props="{ children: 'children' }"
                      default-expand-all
                      max-height="calc(100vh - 280px)"
                    >
                      <el-table-column prop="kcaa01" label="编码" min-width="200" fixed="left" show-overflow-tooltip />
                      <el-table-column prop="kcaa02" label="名称" min-width="120" show-overflow-tooltip />
                      <el-table-column prop="kcaa03" label="规格" min-width="120" show-overflow-tooltip />
                      <el-table-column prop="kcaa04" label="单位" width="72" align="center" show-overflow-tooltip />
                      <el-table-column label="用量(kcac04)" width="118" align="right">
                        <template #default="{ row }">{{ formatQty(row.kcac04) }}</template>
                      </el-table-column>
                      <el-table-column label="损耗(kcac05)" width="118" align="right">
                        <template #default="{ row }">{{ formatQty(row.kcac05) }}</template>
                      </el-table-column>
                      <el-table-column label="备用损耗(kcaa33)" width="132" align="right">
                        <template #default="{ row }">{{ formatQty(row.kcaa33) }}</template>
                      </el-table-column>
                      <el-table-column prop="Describe" label="备注" min-width="100" show-overflow-tooltip />
                      <el-table-column prop="Seq" label="Seq" width="64" align="center" />
                      <el-table-column prop="level" label="层级" width="64" align="center" />
                      <el-table-column prop="kcac02" label="下层BOM(kcac02)" min-width="160" show-overflow-tooltip />
                      <el-table-column prop="systemcode" label="行systemcode" min-width="160" show-overflow-tooltip />
                    </el-table>
                  </div>
                  <el-empty
                    v-else-if="!bomUsageTreeLoading && !bomUsageTreeError"
                    description="点击「运算」加载树形表格（嵌套 children）"
                    :image-size="72"
                  />
                </div>
              </el-tab-pane>
              <el-tab-pane label="成本BOM用量表" name="costBomUsage" :disabled="!bomBasic">
                <div class="bom-cost-usage-toolbar bom-parts-toolbar">
                  <template v-if="bomCostUsageRawRows.length">
                    <div class="bom-cost-hide-prefix-bar">
                      <span class="bom-cost-hide-prefix-bar__label">隐藏编码前缀</span>
                      <el-button size="small" type="primary" plain @click="openBomCostHidePrefixDialog">
                        配置前缀…
                      </el-button>
                      <span class="bom-cost-hide-prefix-bar__summary">{{ bomCostHidePrefixSummaryText }}</span>
                    </div>
                    <span class="bom-usage-calc-toolbar__hint bom-cost-usage-toolbar__hint">
                      本地筛选：匹配前缀的行不出现在下表（子件用量已在运算结果中）；确定配置后立即重算合并（只读、不落 bom_cost）
                    </span>
                  </template>
                  <span v-else class="bom-usage-calc-toolbar__hint bom-cost-usage-toolbar__hint">
                    请先在「BOM用量表运算」点击「运算」，加载完成后可在此筛选前缀并查看合并后的成本用量
                  </span>
                </div>
                <div v-loading="bomUsageTreeLoading" class="bom-cost-usage-wrap">
                  <div v-if="bomCostUsageFlatRows.length" class="bom-cost-usage-table-outer">
                    <el-table
                      :data="bomCostUsageFlatRows"
                      border
                      stripe
                      size="small"
                      class="bom-cost-usage-table"
                      max-height="calc(100vh - 280px)"
                      row-key="__bomCostRowKey"
                      show-summary
                      :summary-method="bomCostUsageSummaryMethod"
                    >
                      <el-table-column label="编码" min-width="200" fixed="left" show-overflow-tooltip>
                        <template #default="{ row }">
                          <span class="bom-cost-usage-code" :style="bomCostUsageCodeCellStyle(row)">{{
                            dVal(row.kcaa01)
                          }}</span>
                        </template>
                      </el-table-column>
                      <el-table-column prop="kcaa02" label="名称" min-width="140" show-overflow-tooltip>
                        <template #default="{ row }">{{ dVal(row.kcaa02) }}</template>
                      </el-table-column>
                      <el-table-column prop="kcaa03" label="规格" min-width="160" show-overflow-tooltip>
                        <template #default="{ row }">{{ dVal(row.kcaa03) }}</template>
                      </el-table-column>
                      <el-table-column prop="kcaa04" label="单位" width="80" align="center" show-overflow-tooltip>
                        <template #default="{ row }">{{ dVal(row.kcaa04) }}</template>
                      </el-table-column>
                      <el-table-column prop="Describe" label="备注" min-width="120" show-overflow-tooltip>
                        <template #default="{ row }">{{ dVal(row.Describe) }}</template>
                      </el-table-column>
                      <el-table-column label="用量" width="110" align="right">
                        <template #default="{ row }">{{ formatQty(row.yl) }}</template>
                      </el-table-column>
                      <el-table-column label="损耗" width="100" align="right">
                        <template #default="{ row }">{{ formatQty(row.loss_rate) }}</template>
                      </el-table-column>
                      <el-table-column label="合计" width="110" align="right">
                        <template #default="{ row }">{{ formatQty(row.total_qty) }}</template>
                      </el-table-column>
                    </el-table>
                  </div>
                  <el-empty
                    v-else-if="!bomUsageTreeLoading && bomCostUsageRawRows.length"
                    description="当前前缀筛选已隐藏全部行，请点击「配置前缀…」减少或清空条目"
                    :image-size="72"
                  />
                  <el-empty
                    v-else-if="!bomUsageTreeLoading"
                    :description="
                      bomUsageTreeError
                        ? '运算失败，请返回「BOM用量表运算」查看错误'
                        : '请先在「BOM用量表运算」点击「运算」生成平铺结果'
                    "
                    :image-size="72"
                  />
                </div>
              </el-tab-pane>
              <el-tab-pane label="成本BOM真实用量表" name="costBomRealUsage" :disabled="!bomBasic">
                <div class="bom-detail-tab-placeholder">
                  <el-empty description="功能开发中" :image-size="80" />
                </div>
              </el-tab-pane>
            </el-tabs>
          </template>
        </template>
      </el-skeleton>
    </el-dialog>

    <!-- 成本 BOM：隐藏编码前缀（逐行编辑） -->
    <el-dialog
      v-model="bomCostHidePrefixDialogVisible"
      title="配置隐藏编码前缀"
      width="520px"
      append-to-body
      destroy-on-close
      class="bom-cost-hide-prefix-dialog"
      @closed="onBomCostHidePrefixDialogClosed"
    >
      <p class="bom-cost-hide-prefix-dialog__tip">
        物料编码以任一前缀开头（忽略大小写）的行不出现在成本表中；子件用量已在运算结果中。
      </p>
      <div class="bom-cost-hide-prefix-dialog__rows">
        <div
          v-for="(dRow, dIdx) in bomCostHidePrefixDraftRows"
          :key="dRow._key"
          class="bom-cost-hide-prefix-dialog__row"
        >
          <el-input
            v-model="dRow.text"
            placeholder="例如 CUT-、BAG-"
            :maxlength="BOM_COST_HIDE_PREFIX_LEN"
            clearable
            size="small"
          />
          <el-button
            size="small"
            type="danger"
            link
            :disabled="bomCostHidePrefixDraftRows.length <= 1"
            @click="removeBomCostHidePrefixDraftRow(dIdx)"
          >
            删除
          </el-button>
        </div>
      </div>
      <div class="bom-cost-hide-prefix-dialog__actions">
        <el-button size="small" type="primary" link @click="addBomCostHidePrefixDraftRow">+ 添加一行</el-button>
        <span class="bom-cost-hide-prefix-dialog__quick-label">常用：</span>
        <el-button size="small" link type="primary" @click="appendQuickHidePrefix('CUT-')">CUT-</el-button>
        <el-button size="small" link type="primary" @click="appendQuickHidePrefix('BAG-')">BAG-</el-button>
      </div>
      <template #footer>
        <el-button size="small" @click="bomCostHidePrefixDialogVisible = false">取消</el-button>
        <el-button size="small" type="primary" @click="confirmBomCostHidePrefixDialog">确定</el-button>
      </template>
    </el-dialog>

    <!-- BOM 主档新增/编辑（bom_000） -->
    <el-dialog
      v-model="editVisible"
      :title="editDialogTitle"
      width="96%"
      top="3vh"
      destroy-on-close
      class="bom-edit-dialog"
      @closed="onEditClosed"
    >
      <div class="bom-edit-body">
        <el-alert
          v-if="editMode === 'add'"
          type="info"
          show-icon
          :closable="false"
          class="bom-edit-alert"
          :title="
            editOpenedFromCopy
              ? '已从所选 BOM 复制除物料编码外的资料（请填写新编码）；保存后将生成唯一 systemcode。配件明细请另行维护。'
              : '新增保存后将生成唯一 systemcode；编码不可含空格，且不能与在册记录重复。保存主档后可切换到「配件明细」。'
          "
        />
        <el-tabs v-model="editActiveTab" class="bom-edit-tabs">
          <el-tab-pane label="BOM基础资料" name="main">
            <el-form ref="editFormRef" :model="editForm" label-width="112px" size="default" @submit.prevent>
          <div class="bom-section-title">系统</div>
          <el-row :gutter="12" class="bom-edit-row-system">
            <el-col :xs="24" :sm="15">
              <el-form-item label="系统编码">
                <el-input v-model="editForm.systemcode" disabled placeholder="保存后自动生成" />
              </el-form-item>
            </el-col>
            <el-col :xs="24" :sm="9">
              <el-form-item label="客供">
                <div class="bom-edit-checkbox-cell">
                  <el-checkbox v-model="editForm.customer_supply_bool">是</el-checkbox>
                </div>
              </el-form-item>
            </el-col>
          </el-row>
          <div class="bom-section-title">基本资料</div>
          <el-row :gutter="12">
            <el-col :xs="24" :sm="12">
              <el-form-item label="编码" required>
                <el-input
                  v-model="editForm.kcaa01"
                  maxlength="300"
                  show-word-limit
                  placeholder="必填，不可含空格"
                  @keydown="onKcaa01Keydown"
                  @paste="onKcaa01Paste"
                  @blur="onKcaa01Blur"
                />
              </el-form-item>
            </el-col>
            <el-col :xs="24" :sm="12">
              <el-form-item label="名称" required>
                <el-input v-model="editForm.kcaa02" maxlength="500" show-word-limit />
              </el-form-item>
            </el-col>
            <el-col :xs="24" :sm="12">
              <el-form-item label="开票名称">
                <el-input v-model="editForm.kpname" maxlength="500" />
              </el-form-item>
            </el-col>
            <el-col :xs="24" :sm="12">
              <el-form-item label="英文名称">
                <el-input v-model="editForm.kcaa02_en" maxlength="500" />
              </el-form-item>
            </el-col>
            <el-col :xs="24" :sm="12">
              <el-form-item label="分类" required>
                <el-autocomplete
                  v-model="editForm.kcaa05_display"
                  :fetch-suggestions="fetchMaterialSuggest"
                  clearable
                  placeholder="必填，编码/名称检索"
                  style="width: 100%"
                  value-key="label"
                  @select="onPickMaterial"
                />
              </el-form-item>
            </el-col>
            <el-col :xs="24" :sm="12">
              <el-form-item label="规格">
                <el-input v-model="editForm.kcaa03" maxlength="500" />
              </el-form-item>
            </el-col>
            <el-col :xs="24" :sm="12">
              <el-form-item label="组别">
                <el-input v-model="editForm.kcaa10" maxlength="200" />
              </el-form-item>
            </el-col>
            <el-col :xs="24" :sm="12">
              <el-form-item label="颜色">
                <el-autocomplete
                  v-model="editForm.kcaa11_display"
                  :fetch-suggestions="fetchColorSuggest"
                  clearable
                  placeholder="编码/名称检索"
                  style="width: 100%"
                  value-key="label"
                  @select="onPickColor"
                />
              </el-form-item>
            </el-col>
            <el-col :xs="24" :sm="12">
              <el-form-item label="产地">
                <el-select v-model="editForm.location" placeholder="请选择" style="width: 100%">
                  <el-option label="国内" value="国内" />
                  <el-option label="进口" value="进口" />
                </el-select>
              </el-form-item>
            </el-col>
            <el-col :xs="24" :sm="12">
              <el-form-item label="客户款号">
                <el-input v-model="editForm.kcaa06" maxlength="300" />
              </el-form-item>
            </el-col>
            <el-col :xs="24" :sm="12">
              <el-form-item label="工厂款号">
                <el-input v-model="editForm.kcaa09" maxlength="300" />
              </el-form-item>
            </el-col>
          </el-row>

          <div class="bom-section-title">单位与损耗</div>
          <!-- 布局参考：第 1 行使用单位+小数；第 2、3 行各为三列「单位 | 转换方式 | 转换率」 -->
          <div class="bom-unit-loss-block">
            <el-row :gutter="12">
              <el-col :xs="24" :sm="12">
                <el-form-item label="使用单位" required>
                  <el-autocomplete
                    v-model="editForm.kcaa04"
                    :fetch-suggestions="fetchUnitSuggest"
                    clearable
                    placeholder="必填"
                    style="width: 100%"
                    value-key="value"
                    @select="onPickUnitUse"
                  />
                </el-form-item>
              </el-col>
              <el-col :xs="24" :sm="12">
                <el-form-item label="小数点配置">
                  <el-select v-model="editForm.decimal" placeholder="位数" style="width: 100%">
                    <el-option v-for="n in 6" :key="n" :label="`${n} 位`" :value="String(n)" />
                  </el-select>
                </el-form-item>
              </el-col>
            </el-row>
            <el-row :gutter="12">
              <el-col :xs="24" :sm="8">
                <el-form-item label="采购单位" required>
                  <el-autocomplete
                    v-model="editForm.kcaa25"
                    :fetch-suggestions="fetchUnitSuggest"
                    clearable
                    placeholder="必填"
                    style="width: 100%"
                    value-key="value"
                    @select="onPickUnitPo"
                  />
                </el-form-item>
              </el-col>
              <el-col :xs="24" :sm="8">
                <el-form-item label="转换方式">
                  <el-select v-model="editForm.kcaa27" style="width: 100%">
                    <el-option label="采购->使用" :value="0" />
                    <el-option label="使用->采购" :value="1" />
                  </el-select>
                </el-form-item>
              </el-col>
              <el-col :xs="24" :sm="8">
                <el-form-item label="转换率">
                  <el-input v-model="editForm.kcaa26" placeholder="填写使用单位与采购单位后自动换算" />
                </el-form-item>
              </el-col>
            </el-row>
            <el-row :gutter="12">
              <el-col :xs="24" :sm="8">
                <el-form-item label="报价单位">
                  <el-autocomplete
                    v-model="editForm.kcaa29"
                    :fetch-suggestions="fetchUnitSuggest"
                    clearable
                    placeholder="单位名称"
                    style="width: 100%"
                    value-key="value"
                    @select="onPickUnitQt"
                  />
                </el-form-item>
              </el-col>
              <el-col :xs="24" :sm="8">
                <el-form-item label="转换方式">
                  <el-select v-model="editForm.kcaa31" style="width: 100%">
                    <el-option label="报价->使用" :value="0" />
                    <el-option label="使用->报价" :value="1" />
                  </el-select>
                </el-form-item>
              </el-col>
              <el-col :xs="24" :sm="8">
                <el-form-item label="转换率">
                  <el-input v-model="editForm.kcaa30" placeholder="填写使用单位与报价单位后自动换算" />
                </el-form-item>
              </el-col>
            </el-row>
            <el-row :gutter="12">
              <el-col :xs="24" :sm="12">
                <el-form-item label="报价损耗">
                  <el-input v-model="editForm.kcaa32" @input="onNumericInput($event, 'kcaa32')" />
                </el-form-item>
              </el-col>
              <el-col :xs="24" :sm="12">
                <el-form-item label="物料损耗">
                  <el-input v-model="editForm.kcaa33" @input="onNumericInput($event, 'kcaa33')" />
                </el-form-item>
              </el-col>
            </el-row>
          </div>

          <div class="bom-section-title">价格与币别</div>
          <el-row :gutter="12">
            <el-col :xs="24" :sm="12">
              <el-form-item label="BOM价格">
                <el-input v-model="editForm.sale_price" @input="onNumericInput($event, 'sale_price')" />
              </el-form-item>
            </el-col>
            <el-col :xs="24" :sm="12">
              <el-form-item label="币别(报价)">
                <el-select
                  v-model="editForm.kcaa34"
                  filterable
                  clearable
                  placeholder="请选择币别"
                  style="width: 100%"
                >
                  <el-option
                    v-for="(name, idx) in currencyDropdownOptions"
                    :key="'c34-' + idx + '-' + name"
                    :label="name"
                    :value="name"
                  />
                </el-select>
              </el-form-item>
            </el-col>
            <el-col :xs="24" :sm="12">
              <el-form-item label="采购价格">
                <el-input v-model="editForm.cost_price" @input="onNumericInput($event, 'cost_price')" />
              </el-form-item>
            </el-col>
            <el-col :xs="24" :sm="12">
              <el-form-item label="币别(采购)">
                <el-select
                  v-model="editForm.kcaa35"
                  filterable
                  clearable
                  placeholder="请选择币别"
                  style="width: 100%"
                >
                  <el-option
                    v-for="(name, idx) in currencyDropdownOptions"
                    :key="'c35-' + idx + '-' + name"
                    :label="name"
                    :value="name"
                  />
                </el-select>
              </el-form-item>
            </el-col>
            <el-col :span="24">
              <el-form-item label="供应商">
                <el-autocomplete
                  v-model="editForm.supplier_display"
                  :fetch-suggestions="fetchSupplierSuggest"
                  clearable
                  placeholder="编码/名称"
                  style="width: 100%"
                  value-key="label"
                  @select="onPickSupplier"
                />
              </el-form-item>
            </el-col>
          </el-row>

          <div class="bom-section-title">工作方式与车间</div>
          <el-row :gutter="12">
            <el-col :span="24">
              <el-form-item label="工作方式">
                <el-checkbox v-model="editForm.kcaa12_bool">采购</el-checkbox>
                <el-checkbox v-model="editForm.kcaa13_bool">外协</el-checkbox>
                <el-checkbox v-model="editForm.kcaa14_bool">自产</el-checkbox>
              </el-form-item>
            </el-col>
            <el-col :span="24">
              <el-form-item label="生产车间">
                <el-autocomplete
                  v-model="editForm.workshop_display"
                  :fetch-suggestions="fetchWorkshopSuggest"
                  clearable
                  placeholder="编码/名称"
                  style="width: 100%"
                  value-key="label"
                  @select="onPickWorkshop"
                />
              </el-form-item>
            </el-col>
          </el-row>

          <div class="bom-section-title">其它</div>
          <el-row :gutter="12">
            <el-col :xs="24" :sm="12">
              <el-form-item label="保税">
                <el-switch v-model="editForm.sign_bool" active-text="保税" inactive-text="非保税" />
              </el-form-item>
            </el-col>
            <el-col :span="24">
              <el-form-item label="备注">
                <el-input v-model="editForm.remark" type="textarea" :rows="3" maxlength="2000" show-word-limit />
              </el-form-item>
            </el-col>
          </el-row>
            </el-form>
          </el-tab-pane>

          <el-tab-pane label="配件明细" name="parts">
            <el-alert
              v-if="!editBomSystemcode"
              type="warning"
              show-icon
              :closable="false"
              class="bom-parts-alert"
              title="请先在「BOM基础资料」中填写必填项并点击「保存主档」，生成系统编码后即可添加与保存配件。"
            />
            <template v-else>
              <div class="bom-parts-toolbar">
                <el-button
                  type="primary"
                  :disabled="editPartsReadOnly || !editBomSystemcode"
                  @click="appendEditPartBlankRow"
                >
                  + 增加配件明细
                </el-button>
                <el-button
                  :disabled="editPartsReadOnly || !editBomSystemcode || editPartsLoading"
                  @click="batchRemoveEditPartsSelected"
                >
                  - 删除选定明细
                </el-button>
                <el-button :disabled="editPartsReadOnly || !editBomSystemcode || editPartsLoading" @click="loadEditBomParts">
                  刷新
                </el-button>
                <el-button
                  type="success"
                  :disabled="editPartsReadOnly || !editBomSystemcode || editPartsLoading"
                  @click="saveEditBomParts"
                >
                  保存配件明细
                </el-button>
              </div>
              <el-alert v-if="editPartsError" :title="editPartsError" type="error" show-icon class="bom-parts-alert" />
              <div class="bom-parts-table-wrap">
                <el-table
                  v-loading="editPartsLoading"
                  :data="editPartsList"
                  border
                  stripe
                  size="small"
                  class="bom-parts-table bom-parts-table--edit"
                  :empty-text="editPartsLoading ? '加载中…' : '暂无配件'"
                  :row-key="partsRowKey"
                  max-height="420"
                >
                  <el-table-column label="选择" width="78" align="center" fixed="left">
                    <template #default="{ row }">
                      <el-button
                        size="small"
                        class="bom-part-mark-btn"
                        :class="{ 'bom-part-mark-btn--on': row._partsMarkSelected }"
                        :disabled="editPartLineReadonly(row)"
                        @click="toggleEditPartSelect(row)"
                      >
                        {{ row._partsMarkSelected ? '已选择' : '删除' }}
                      </el-button>
                    </template>
                  </el-table-column>
                  <el-table-column
                    type="index"
                    label="序号"
                    width="52"
                    align="center"
                    fixed="left"
                    :index="partsRowIndex"
                  />
                  <el-table-column label="操作" min-width="232" align="center" fixed="left">
                    <template #default="{ row }">
                      <el-button
                        type="primary"
                        link
                        size="small"
                        :disabled="editPartLineReadonly(row)"
                        @click="openEditPartMaterialPicker(row)"
                      >
                        添加配件
                      </el-button>
                      <el-button
                        type="primary"
                        size="small"
                        class="bom-part-view-action-btn"
                        :disabled="!String(row.kcaa01 ?? '').trim()"
                        @click="openLinkedBomDetailFromPart(row)"
                      >
                        查看配件
                      </el-button>
                    </template>
                  </el-table-column>
                  <el-table-column prop="kcaa01" label="编码" min-width="150" fixed="left" show-overflow-tooltip />
                  <el-table-column prop="kcaa02" label="名称" min-width="120" show-overflow-tooltip />
                  <el-table-column prop="kcaa03" label="规格" min-width="100" show-overflow-tooltip />
                  <el-table-column prop="kcaa11" label="颜色" width="88" show-overflow-tooltip />
                  <el-table-column prop="kcaa04" label="单位" width="72" show-overflow-tooltip />
                  <el-table-column label="单位用量" width="118">
                    <template #default="{ row }">
                      <el-input-number
                        v-model="row.kcac04"
                        :disabled="editPartLineReadonly(row)"
                        :min="0"
                        :precision="6"
                        :step="0.000001"
                        controls-position="right"
                        class="bom-parts-num"
                        @change="() => syncPartKcac06(row)"
                      />
                    </template>
                  </el-table-column>
                  <el-table-column label="损耗" width="88">
                    <template #default="{ row }">
                      <el-input-number
                        :model-value="lossPctDisplay(row)"
                        :disabled="editPartLineReadonly(row)"
                        :min="0"
                        :precision="2"
                        :step="0.1"
                        controls-position="right"
                        class="bom-parts-num"
                        @update:model-value="(v) => onLossPctChange(row, v)"
                      />
                    </template>
                  </el-table-column>
                  <el-table-column label="用量合计(kcac06)" width="128" align="right">
                    <template #default="{ row }">{{ formatUsageTotal(row) }}</template>
                  </el-table-column>
                  <el-table-column label="说明" min-width="105">
                    <template #default="{ row }">
                      <el-input
                        v-model="row.remark"
                        :disabled="editPartLineReadonly(row)"
                        maxlength="500"
                        show-word-limit
                      />
                    </template>
                  </el-table-column>
                  <el-table-column label="单价" width="105">
                    <template #default="{ row }">
                      <el-input-number
                        v-model="row.cost_price"
                        :disabled="editPartLineReadonly(row)"
                        :min="0"
                        :precision="4"
                        :step="0.0001"
                        controls-position="right"
                        class="bom-parts-num"
                      />
                    </template>
                  </el-table-column>
                  <el-table-column label="成本合计" width="105" align="right">
                    <template #default="{ row }">{{ formatMoney(partCostSum(row)) }}</template>
                  </el-table-column>
                </el-table>
              </div>
              <div class="bom-parts-sum-row">
                <span>实际用量总和：<strong>{{ formatQtySumFooter(editPartsSumActualUsage) }}</strong></span>
                <span class="bom-parts-sum-gap">总成本：<strong>{{ formatMoney(editPartsSumCost) }}</strong></span>
              </div>
              <MaterialSelector v-model="editPartsMaterialSelectorVisible" @picked="onEditMaterialPicked" />
            </template>
          </el-tab-pane>
        </el-tabs>
      </div>
      <template #footer>
        <el-button @click="editVisible = false">关闭</el-button>
        <el-button type="primary" :loading="editSaving" @click="submitBomEdit">保存主档</el-button>
        <el-button
          type="success"
          :disabled="!editBomSystemcode || editPartsReadOnly"
          @click="saveEditBomParts"
        >
          保存配件明细
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, nextTick, reactive, ref, watch } from 'vue'
import axios from 'axios'
import { ElMessage, ElMessageBox } from 'element-plus'
import MaterialSelector from '../../supply-chain/daily/purchase-quote/MaterialSelector.vue'

/**
 * 默认用于「存货管理 / BOM资料查询」路由；
 * 库存菜单「inventory/basic/bom-data」以子组件方式嵌入时可传入与侧栏一致的标题。
 */
const props = defineProps({
  embeddedTitle: { type: String, default: '' },
})

const pageTitle = computed(() => {
  const t = String(props.embeddedTitle ?? '').trim()
  return t || 'BOM资料查询'
})

const loading = ref(false)
const errorMessage = ref('')
const tableList = ref([])
const total = ref(0)
const page = ref(1)
/** 默认每页 10 条：配合“按最近修改/新增优先”更符合使用习惯 */
const pageSize = ref(10)

/** 合并搜索：同时模糊匹配物料编码（kcaa01）与名称（kcaa02） */
const keyword = ref('')
/** 裁片过滤：0 排除 CUT- 开头料号；1 仅查询 CUT- 开头裁片主档（后端强制前缀） */
const searchQuery = reactive({
  bom_cut: 0,
})
const showUnAudited = ref(false)
/** 回收站视图（与「显示未审核」互斥） */
const showRecycle = ref(false)
/** 列表行 systemcode 正在请求（审核/删/恢复等） */
const busySystemcode = ref('')
/** 列表行正在「复制到新增」加载 */
const busyCopySystemcode = ref('')

const detailVisible = ref(false)
const detailLoading = ref(false)
const detailError = ref('')
/** @type {import('vue').Ref<string>} */
const detailTitleCode = ref('')
const bomBasic = ref(null)
/** 列表打开详情时的原始行（审核态等） */
const detailListRow = ref(null)
const detailActiveTab = ref('basic')

/** BOM用量表运算：树形表格数据源（GET /api/bom/tree，嵌套 children） */
const bomUsageTreeLoading = ref(false)
const bomUsageTreeError = ref('')
const bomUsageTreeData = ref([])
const bomUsageTableRef = ref(null)
/** 成本 BOM 用量表展示行（本地：前缀筛选 + 按编码+备注合并） */
const bomCostUsageFlatRows = ref([])
/** 「运算」返回的原始成本平铺（未筛选）；前缀改动仅据此内存重算，不再请求接口 */
const bomCostUsageRawRows = ref([])

/** 成本表不展示的物料编码前缀；由「配置前缀」弹窗确定后写入，变更后本地重算 */
const bomCostHidePrefixes = ref(['CUT-', 'BAG-'])

const BOM_COST_HIDE_PREFIX_CAP = 20
const BOM_COST_HIDE_PREFIX_LEN = 80

let bomCostHidePrefixDraftUid = 0
function newBomCostHidePrefixDraftKey() {
  bomCostHidePrefixDraftUid += 1
  return bomCostHidePrefixDraftUid
}

const bomCostHidePrefixDialogVisible = ref(false)
/** @type {import('vue').Ref<{ _key: number, text: string }[]>} */
const bomCostHidePrefixDraftRows = ref([])

/** 工具栏摘要：完整列表在弹窗内编辑 */
const bomCostHidePrefixSummaryText = computed(() => {
  const arr = normalizeBomCostHidePrefixes(bomCostHidePrefixes.value)
  if (!arr.length) return '当前未配置隐藏前缀'
  const maxShow = 8
  const head = arr.slice(0, maxShow).join('、')
  if (arr.length <= maxShow) return `已配置 ${arr.length} 项：${head}`
  return `已配置 ${arr.length} 项：${head}…`
})

function openBomCostHidePrefixDialog() {
  const cur = normalizeBomCostHidePrefixes(bomCostHidePrefixes.value)
  if (cur.length) {
    bomCostHidePrefixDraftRows.value = cur.map((t) => ({
      _key: newBomCostHidePrefixDraftKey(),
      text: t,
    }))
  } else {
    bomCostHidePrefixDraftRows.value = [{ _key: newBomCostHidePrefixDraftKey(), text: '' }]
  }
  bomCostHidePrefixDialogVisible.value = true
}

function onBomCostHidePrefixDialogClosed() {
  bomCostHidePrefixDraftRows.value = []
}

function addBomCostHidePrefixDraftRow() {
  if (bomCostHidePrefixDraftRows.value.length >= BOM_COST_HIDE_PREFIX_CAP) {
    ElMessage.warning(`最多添加 ${BOM_COST_HIDE_PREFIX_CAP} 条前缀`)
    return
  }
  bomCostHidePrefixDraftRows.value.push({ _key: newBomCostHidePrefixDraftKey(), text: '' })
}

function removeBomCostHidePrefixDraftRow(idx) {
  if (bomCostHidePrefixDraftRows.value.length <= 1) return
  bomCostHidePrefixDraftRows.value.splice(idx, 1)
}

/** 弹窗内是否已有相同前缀（忽略大小写） */
function bomCostHidePrefixDraftHasText(prefix) {
  const k = String(prefix ?? '').trim().toLowerCase()
  if (!k) return false
  for (const r of bomCostHidePrefixDraftRows.value) {
    if (String(r.text ?? '').trim().toLowerCase() === k) return true
  }
  return false
}

/** 常用前缀一键填入（不重复则新增一行） */
function appendQuickHidePrefix(prefix) {
  const p = String(prefix ?? '').trim().slice(0, BOM_COST_HIDE_PREFIX_LEN)
  if (!p) return
  if (bomCostHidePrefixDraftHasText(p)) {
    ElMessage.info('列表中已有该前缀')
    return
  }
  if (bomCostHidePrefixDraftRows.value.length >= BOM_COST_HIDE_PREFIX_CAP) {
    ElMessage.warning(`最多 ${BOM_COST_HIDE_PREFIX_CAP} 条前缀`)
    return
  }
  const rows = bomCostHidePrefixDraftRows.value
  if (rows.length === 1 && !String(rows[0].text ?? '').trim()) {
    rows[0].text = p
    return
  }
  rows.push({ _key: newBomCostHidePrefixDraftKey(), text: p })
}

function confirmBomCostHidePrefixDialog() {
  const texts = bomCostHidePrefixDraftRows.value.map((r) => r.text)
  bomCostHidePrefixes.value = normalizeBomCostHidePrefixes(texts)
  bomCostHidePrefixDialogVisible.value = false
  ElMessage.success('已更新隐藏前缀')
}

/** @param {unknown[]} list */
function normalizeBomCostHidePrefixes(list) {
  const arr = Array.isArray(list) ? list : []
  const seen = new Set()
  const out = []
  for (const item of arr) {
    const t = String(item ?? '').trim().slice(0, BOM_COST_HIDE_PREFIX_LEN)
    if (!t) continue
    const k = t.toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    out.push(t)
    if (out.length >= BOM_COST_HIDE_PREFIX_CAP) break
  }
  return out
}

/** @param {string} kcaa01 @param {string[]} hidePrefixes */
function bomCostUsageMatchesHidePrefix(kcaa01, hidePrefixes) {
  if (!hidePrefixes || !hidePrefixes.length) return false
  const code = String(kcaa01 ?? '').trim().toLowerCase()
  if (!code) return false
  for (let i = 0; i < hidePrefixes.length; i++) {
    const pre = String(hidePrefixes[i] ?? '').trim().toLowerCase()
    if (pre && code.startsWith(pre)) return true
  }
  return false
}

/**
 * 与后端 flatten 之后逻辑一致：剔除前缀行后按 kcaa01+Describe 合并
 * @param {Record<string, unknown>[]} flatRows
 * @param {string[]} hidePrefixes
 */
function aggregateBomCostUsageFlatForDisplay(flatRows, hidePrefixes) {
  if (!Array.isArray(flatRows) || !flatRows.length) return []
  /** @type {Map<string, { kcaa01: string, kcaa02: string, kcaa03: string, kcaa04: string, Describe: string, sumYl: number, sumTotal: number }>} */
  const map = new Map()
  for (let i = 0; i < flatRows.length; i++) {
    const r = flatRows[i]
    const code = String(r?.kcaa01 ?? '').trim()
    if (!code || bomCostUsageMatchesHidePrefix(code, hidePrefixes)) continue
    const remark = String(r?.Describe ?? '').trim()
    const key = `${code}\u0000${remark}`
    const yl = Number(r?.yl ?? 0)
    const loss = Number(r?.loss_rate ?? 0)
    const rowTotal = Number.isFinite(Number(r?.total_qty)) ? Number(r.total_qty) : yl * (1 + loss)
    let g = map.get(key)
    if (!g) {
      g = {
        kcaa01: code,
        kcaa02: r?.kcaa02 != null ? String(r.kcaa02) : '',
        kcaa03: r?.kcaa03 != null ? String(r.kcaa03) : '',
        kcaa04: r?.kcaa04 != null ? String(r.kcaa04) : '',
        Describe: remark,
        sumYl: 0,
        sumTotal: 0,
      }
      map.set(key, g)
    } else {
      if (!g.kcaa02 && r?.kcaa02) g.kcaa02 = String(r.kcaa02)
      if (!g.kcaa03 && r?.kcaa03) g.kcaa03 = String(r.kcaa03)
      if (!g.kcaa04 && r?.kcaa04) g.kcaa04 = String(r.kcaa04)
    }
    g.sumYl += yl
    g.sumTotal += rowTotal
  }
  const out = []
  for (const g of map.values()) {
    const sumYl = g.sumYl
    let loss_rate = 0
    if (sumYl > 0) loss_rate = g.sumTotal / sumYl - 1
    const total_qty = sumYl * (1 + loss_rate)
    out.push({
      kcaa01: g.kcaa01,
      kcaa02: g.kcaa02,
      kcaa03: g.kcaa03,
      kcaa04: g.kcaa04,
      Describe: g.Describe,
      yl: sumYl,
      loss_rate,
      total_qty,
      level: 1,
    })
  }
  out.sort((a, b) => {
    const c = a.kcaa01.localeCompare(b.kcaa01, 'zh-Hans-CN', { sensitivity: 'accent' })
    if (c !== 0) return c
    return a.Describe.localeCompare(b.Describe, 'zh-Hans-CN', { sensitivity: 'accent' })
  })
  return out
}

function recomputeBomCostUsageDisplay() {
  const raw = bomCostUsageRawRows.value
  if (!Array.isArray(raw) || !raw.length) {
    bomCostUsageFlatRows.value = []
    return
  }
  const prefixes = normalizeBomCostHidePrefixes(bomCostHidePrefixes.value)
  const merged = aggregateBomCostUsageFlatForDisplay(raw, prefixes)
  bomCostUsageFlatRows.value = merged.map((r, i) => ({
    ...r,
    __bomCostRowKey: `bom-cost-flat-${i}`,
  }))
}

watch(
  () => [bomCostHidePrefixes.value, bomCostUsageRawRows.value],
  () => {
    recomputeBomCostUsageDisplay()
  },
  { deep: true },
)

/** 编码列按 level 预留缩进（与旧 ERP 展开表层次一致） */
function bomCostUsageCodeCellStyle(row) {
  const lv = Number(row?.level)
  const pad = Number.isFinite(lv) && lv > 1 ? (lv - 1) * 14 : 0
  return pad > 0 ? { paddingLeft: `${pad}px`, display: 'inline-block' } : {}
}

/**
 * 成本 BOM 用量表底部合计：SUM 用量、SUM 合计（与 formatQty 小数位一致）
 * @param {{ columns: import('element-plus').TableColumnCtx<unknown>[], data: Record<string, unknown>[] }} param0
 */
function bomCostUsageSummaryMethod({ columns, data }) {
  const rows = Array.isArray(data) ? data : []
  let sumYl = 0
  let sumTotalQty = 0
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const yl = Number(row?.yl ?? 0)
    const tq = Number(row?.total_qty ?? 0)
    if (Number.isFinite(yl)) sumYl += yl
    if (Number.isFinite(tq)) sumTotalQty += tq
  }
  /** @type {string[]} */
  const sums = []
  columns.forEach((column, index) => {
    const lab = String(column.label ?? '')
    if (lab === '编码') sums[index] = '合计'
    else if (lab === '用量') sums[index] = formatQty(sumYl)
    else if (lab === '合计') sums[index] = formatQty(sumTotalQty)
    else sums[index] = ''
  })
  return sums
}

/** 遍历树（先序），供展开/折叠 */
function walkBomUsageTree(rows, fn) {
  if (!Array.isArray(rows)) return
  for (const row of rows) {
    fn(row)
    if (row.children?.length) walkBomUsageTree(row.children, fn)
  }
}

function expandAllBomUsageTree() {
  nextTick(() => {
    const t = bomUsageTableRef.value
    if (!t) return
    walkBomUsageTree(bomUsageTreeData.value, (row) => {
      if (row.children?.length) t.toggleRowExpansion(row, true)
    })
  })
}

function collapseAllBomUsageTree() {
  nextTick(() => {
    const t = bomUsageTableRef.value
    if (!t) return
    walkBomUsageTree(bomUsageTreeData.value, (row) => {
      if (row.children?.length) t.toggleRowExpansion(row, false)
    })
  })
}

/** 详情弹窗 Tab 名集合（钻取返回时校验恢复） */
const DETAIL_VALID_TABS = new Set(['basic', 'parts', 'usageCalc', 'costBomUsage', 'costBomRealUsage'])

function normalizeRestoredDetailTab(name) {
  const n = String(name ?? '').trim()
  return DETAIL_VALID_TABS.has(n) ? n : 'basic'
}

/** 配件明细 Tab */
const partsList = ref([])
const partsLoading = ref(false)
const partsError = ref('')
const partsLoadedToken = ref('')
const materialSelectorVisible = ref(false)
/** 防止重复请求：systemcode + 时间戳在关闭弹窗时清空 */
const partsLoadGeneration = ref(0)
/** 详情弹窗：待保存的配件行软删 */
const partsPendingDeleteIds = ref([])

/**
 * 从配件「查看/查看配件」钻取下一层 BOM 时的返回栈（不含当前层）
 * @typedef {{ code: string, titleCode: string, listRow: { code: string, pass: unknown } | null, activeTab: 'basic'|'parts'|'usageCalc'|'costBomUsage'|'costBomRealUsage'|string, partsPendingDeleteIds: number[] }} DetailDrillFrame
 */
/** @type {import('vue').Ref<DetailDrillFrame[]>} */
const detailDrillStack = ref([])

/** 栈顶即「返回后」要恢复的上一层标题（kcaa01） */
const detailDrillBackHint = computed(() => {
  const arr = detailDrillStack.value
  if (!arr.length) return ''
  const top = arr[arr.length - 1]
  return String(top?.titleCode ?? top?.code ?? '').trim()
})

/** 钻取前压入当前详情状态 */
function pushDetailDrillSnapshot() {
  const code = String(bomBasic.value?.kcaa01 ?? '').trim()
  if (!code) return
  detailDrillStack.value.push({
    code,
    titleCode: String(detailTitleCode.value ?? '').trim() || code,
    listRow: detailListRow.value
      ? { code: String(detailListRow.value.code ?? '').trim(), pass: detailListRow.value.pass }
      : null,
    activeTab: String(detailActiveTab.value ?? 'basic'),
    partsPendingDeleteIds: [...(partsPendingDeleteIds.value ?? [])],
  })
}

/** 弹出栈顶并恢复上一层 BOM 与 Tab */
async function goBackDetailDrill() {
  const prev = detailDrillStack.value.pop()
  if (!prev?.code) return
  detailLoading.value = true
  detailError.value = ''
  try {
    const res = await axios.get(`/api/inventory/bom/${encodeURIComponent(prev.code)}`)
    const body = res.data
    if (body?.code !== 200) {
      const msg = body?.msg || '加载失败'
      detailError.value = msg
      ElMessage.error(msg)
      detailDrillStack.value.push(prev)
      return
    }
    const basic = body?.data?.basic ?? null
    if (!basic) {
      detailError.value = '未返回基础资料数据'
      detailDrillStack.value.push(prev)
      return
    }
    bomBasic.value = basic
    detailTitleCode.value = String(prev.titleCode ?? basic.kcaa01 ?? '').trim() || String(basic.kcaa01 ?? '').trim()
    detailListRow.value = { code: String(basic.kcaa01 ?? '').trim(), pass: basic.pass }
    detailActiveTab.value = normalizeRestoredDetailTab(prev.activeTab)
    partsPendingDeleteIds.value = [...(prev.partsPendingDeleteIds ?? [])]
    partsError.value = ''
    partsList.value = []
    partsLoadedToken.value = ''
    bomUsageTreeError.value = ''
    bomUsageTreeData.value = []
    bomCostUsageRawRows.value = []
    bomCostUsageFlatRows.value = []
    if (detailActiveTab.value === 'parts' && String(basic.systemcode ?? '').trim()) {
      await loadBomParts()
    }
  } catch (e) {
    detailError.value = String(e?.response?.data?.msg ?? e?.message ?? '网络错误')
    detailDrillStack.value.push(prev)
  } finally {
    detailLoading.value = false
  }
}

/** BOM用量表运算：请求后端树 + 原始成本平铺；成本表前缀筛选在本地即时生效 */
async function onBomUsageTableCalc() {
  if (!bomSystemcode.value) {
    ElMessage.warning('主档缺少 systemcode，无法运算')
    return
  }
  bomUsageTreeLoading.value = true
  bomUsageTreeError.value = ''
  try {
    const res = await axios.get('/api/bom/tree', { params: { systemcode: bomSystemcode.value } })
    const body = res.data
    if (!body?.success) {
      const msg = String(body?.msg ?? '加载失败')
      bomUsageTreeError.value = msg
      bomUsageTreeData.value = []
      bomCostUsageRawRows.value = []
      bomCostUsageFlatRows.value = []
      ElMessage.error(msg)
      return
    }
    bomUsageTreeData.value = Array.isArray(body.data) ? body.data : []
    bomCostUsageRawRows.value = Array.isArray(body.flatCostUsageRaw) ? body.flatCostUsageRaw : []
    recomputeBomCostUsageDisplay()
    ElMessage.success('运算完成；成本表可在此调整前缀筛选（即时生效）')
    detailActiveTab.value = 'costBomUsage'
  } catch (e) {
    const msg = String(e?.response?.data?.msg ?? e?.message ?? '网络错误')
    bomUsageTreeError.value = msg
    bomUsageTreeData.value = []
    bomCostUsageRawRows.value = []
    bomCostUsageFlatRows.value = []
    ElMessage.error(msg)
  } finally {
    bomUsageTreeLoading.value = false
  }
}

const detailDialogTitle = computed(() => {
  const c = String(detailTitleCode.value ?? '').trim()
  return c ? `BOM 详情 - ${c}` : 'BOM 详情'
})

/** 详情「基础资料」只读布局与新增/编辑表单分区一致 */
const detailCategoryDisplay = computed(() => {
  const b = bomBasic.value
  if (!b) return ''
  const n = String(b.categoryName ?? '').trim()
  if (n) return n
  return String(b.kcaa05 ?? '').trim()
})

const detailKcaa27Num = computed(() => (Number(bomBasic.value?.kcaa27) === 1 ? 1 : 0))

const detailKcaa31Num = computed(() => (Number(bomBasic.value?.kcaa31) === 1 ? 1 : 0))

const detailDecimalLabel = computed(() => {
  const d = String(bomBasic.value?.decimal ?? '').trim()
  if (/^[1-6]$/.test(d)) return `${d} 位`
  return d
})

/** 报价币别：优先存库名称 kcaa34，否则兼容旧码 kcaa34_display */
const detailQuoteCurrencyText = computed(() => {
  const raw = String(bomBasic.value?.kcaa34 ?? '').trim()
  if (raw) return raw
  return String(bomBasic.value?.kcaa34_display ?? '').trim()
})

const detailSignBool = computed(() => {
  const s = String(bomBasic.value?.sign ?? '').trim()
  return s === '1' || s.toLowerCase() === 'y'
})

/** 主档新增/编辑弹窗 */
const editVisible = ref(false)
/** @type {import('vue').Ref<'add' | 'edit'>} */
const editMode = ref('add')
const editSaving = ref(false)

/** 新增/编辑弹窗标签：基础资料 | 配件明细 */
const editActiveTab = ref('main')
/** 当前编辑主档审核状态（'1' 已审则配件只读） */
const editMasterPass = ref('0')
/** 编辑弹窗内配件明细（独立自详情页 partsList） */
const editPartsList = ref([])
const editPartsLoading = ref(false)
const editPartsError = ref('')
const editPartsMaterialSelectorVisible = ref(false)
/** 选材弹窗回填目标行（`_localKey`）；null 表示追加到末尾 */
const editPartsPickerTargetKey = ref(null)
const editPartsLoadedToken = ref('')
const editPartsLoadGeneration = ref(0)
/** 由列表「复制」打开：标题与提示区分普通新增 */
const editOpenedFromCopy = ref(false)
/** 编辑弹窗：待保存的已入库配件行软删（PUT lines pendingDelete） */
const editPartsPendingDeleteIds = ref([])

const editDialogTitle = computed(() => {
  if (editMode.value === 'add' && editOpenedFromCopy.value) return '新增 BOM 主档（复制）'
  return editMode.value === 'add' ? '新增 BOM 主档' : '编辑 BOM 主档'
})

function createEmptyEditForm() {
  return {
    systemcode: '',
    kcaa01: '',
    kcaa02: '',
    kcaa02_en: '',
    kpname: '',
    kcaa03: '',
    kcaa05: '',
    kcaa05_display: '',
    kcaa06: '',
    kcaa09: '',
    kcaa10: '',
    kcaa11: '',
    kcaa11_display: '',
    location: '国内',
    kcaa04: '',
    decimal: '2',
    kcaa25: '',
    kcaa27: 0,
    kcaa26: '',
    kcaa29: '',
    kcaa31: 0,
    kcaa30: '',
    kcaa32: '',
    kcaa33: '',
    sale_price: '',
    kcaa34: '',
    cost_price: '',
    kcaa35: '',
    Customer_Name: '',
    supplier_display: '',
    kcaa12_bool: false,
    kcaa13_bool: false,
    kcaa14_bool: true,
    customer_supply_bool: false,
    workshop_display: '',
    kcaa15: '',
    remark: '',
    sign_bool: false,
  }
}

const editForm = reactive(createEmptyEditForm())

const editBomSystemcode = computed(() => String(editForm.systemcode ?? '').trim())

const editPartsReadOnly = computed(() => String(editMasterPass.value ?? '').trim() === '1')

const editPartsSumActualUsage = computed(() => {
  let s = 0
  for (const row of editPartsList.value || []) {
    s += partUsageSum(row)
  }
  return s
})

const editPartsSumCost = computed(() => {
  let s = 0
  for (const row of editPartsList.value || []) {
    s += partCostSum(row)
  }
  return s
})

/** bom_currency.cn_name 列表（下拉）；编辑时合并当前 kcaa34/kcaa35 防旧值不在表内无法展示 */
const bomCurrencyNames = ref([])

const currencyDropdownOptions = computed(() => {
  const set = new Set(bomCurrencyNames.value.map((s) => String(s ?? '').trim()).filter(Boolean))
  const q = String(editForm.kcaa34 ?? '').trim()
  const p = String(editForm.kcaa35 ?? '').trim()
  if (q) set.add(q)
  if (p) set.add(p)
  return [...set].sort((a, b) => a.localeCompare(b, 'zh-CN'))
})

async function loadBomCurrencyNames() {
  try {
    const res = await axios.get('/api/inventory/bom/currency-options')
    if (res.data?.code === 200 && Array.isArray(res.data?.data?.rows)) {
      bomCurrencyNames.value = res.data.data.rows
        .map((r) => String(r.cn_name ?? '').trim())
        .filter(Boolean)
    } else {
      bomCurrencyNames.value = []
    }
  } catch {
    bomCurrencyNames.value = []
  }
}

function resetEditForm() {
  const d = createEmptyEditForm()
  for (const k of Object.keys(d)) {
    editForm[k] = d[k]
  }
}

/** @param {Record<string, unknown>} b */
function fillEditFormFromBasic(b) {
  resetEditForm()
  editForm.systemcode = String(b.systemcode ?? '')
  editForm.kcaa01 = String(b.kcaa01 ?? '')
  editForm.kcaa02 = String(b.kcaa02 ?? '')
  editForm.kcaa02_en = String(b.kcaa02_en ?? '')
  editForm.kpname = String(b.kpname ?? '')
  editForm.kcaa03 = String(b.kcaa03 ?? '')
  editForm.kcaa05 = String(b.kcaa05 ?? '')
  const cat = String(b.categoryName ?? '').trim()
  editForm.kcaa05_display = editForm.kcaa05 ? (cat ? `${editForm.kcaa05},${cat}` : editForm.kcaa05) : ''
  editForm.kcaa06 = String(b.kcaa06 ?? '')
  editForm.kcaa09 = String(b.kcaa09 ?? '')
  editForm.kcaa10 = String(b.kcaa10 ?? '')
  editForm.kcaa11 = String(b.kcaa11 ?? '')
  editForm.kcaa11_display = editForm.kcaa11
  editForm.location = String(b.location ?? '').trim() || '国内'
  editForm.kcaa04 = String(b.kcaa04 ?? '')
  editForm.decimal = String(b.decimal ?? '2') || '2'
  editForm.kcaa25 = String(b.kcaa25 ?? '')
  editForm.kcaa29 = String(b.kcaa29 ?? '')
  editForm.kcaa26 = String(b.kcaa26 ?? '')
  editForm.kcaa30 = String(b.kcaa30 ?? '')
  const k27 = Number(b.kcaa27)
  editForm.kcaa27 = k27 === 1 ? 1 : 0
  const k31 = Number(b.kcaa31)
  editForm.kcaa31 = k31 === 1 ? 1 : 0
  editForm.kcaa32 = String(b.kcaa32 ?? '')
  editForm.kcaa33 = String(b.kcaa33 ?? '')
  editForm.sale_price = String(b.sale_price ?? '')
  editForm.kcaa34 = String(b.kcaa34 ?? '')
  editForm.cost_price = String(b.cost_price ?? '')
  editForm.kcaa35 = String(b.kcaa35 ?? '')
  editForm.Customer_Name = String(b.Customer_Name ?? '')
  editForm.supplier_display = String(b.supplier_display ?? '').trim() || editForm.Customer_Name
  editForm.kcaa15 = String(b.kcaa15 ?? '')
  editForm.workshop_display = String(b.workshop_display ?? '').trim()
  editForm.remark = String(b.remark ?? '')
  editForm.kcaa12_bool = !!b.kcaa12_checked
  editForm.kcaa13_bool = !!b.kcaa13_checked
  editForm.kcaa14_bool = b.kcaa14_checked !== false
  editForm.customer_supply_bool = !!b.customer_supply_checked
  const sig = String(b.sign ?? '').trim()
  editForm.sign_bool = sig === '1' || sig.toLowerCase() === 'y'
  editMasterPass.value = String(b.pass ?? '').trim()
}

function onEditClosed() {
  editActiveTab.value = 'main'
  editMasterPass.value = '0'
  editPartsList.value = []
  editPartsError.value = ''
  editPartsLoadedToken.value = ''
  editPartsLoadGeneration.value += 1
  editPartsMaterialSelectorVisible.value = false
  editPartsPickerTargetKey.value = null
  editOpenedFromCopy.value = false
  editPartsPendingDeleteIds.value = []
  resetEditForm()
}

function openAddBom() {
  editMode.value = 'add'
  editActiveTab.value = 'main'
  editMasterPass.value = '0'
  editOpenedFromCopy.value = false
  editPartsPendingDeleteIds.value = []
  editPartsList.value = []
  editPartsError.value = ''
  resetEditForm()
  editVisible.value = true
}

function onKcaa01Keydown(ev) {
  if (ev.key === ' ' || ev.code === 'Space') {
    ev.preventDefault()
  }
}

function onKcaa01Paste(ev) {
  ev.preventDefault()
  const t = ev.clipboardData?.getData('text') ?? ''
  editForm.kcaa01 = String(t).replace(/\s+/g, '')
}

function onNumericInput(val, key) {
  const s = String(val ?? '').replace(/[^\d.-]/g, '')
  editForm[key] = s
}

async function onKcaa01Blur() {
  const code = String(editForm.kcaa01 ?? '').trim()
  if (!code) return
  const exclude = editMode.value === 'edit' ? String(editForm.systemcode ?? '').trim() : ''
  try {
    const res = await axios.get('/api/inventory/bom/check-code', {
      params: { kcaa01: code, ...(exclude ? { excludeSystemcode: exclude } : {}) },
    })
    if (res.data?.code !== 200) return
    const dup = !!res.data?.data?.duplicate
    const rows = Array.isArray(res.data?.data?.rows) ? res.data.data.rows : []
    if (!dup) return
    const hint = rows.length
      ? `该编码已在库（示例：${rows[0].kcaa02 || '—'}，systemcode=${rows[0].systemcode || '—'}）`
      : '该编码可能已在库'
    if (editMode.value === 'add') {
      ElMessage.warning(`${hint}；保存时服务端将再次校验。`)
    }
  } catch {
    /* 忽略 */
  }
}

async function fetchMaterialSuggest(queryString, cb) {
  const q = String(queryString ?? '').trim()
  try {
    const res = await axios.get('/api/inventory/material-category/list', {
      params: { page: 1, pageSize: 50, keyword: q, pass: 1 },
    })
    const list = Array.isArray(res.data?.data?.list) ? res.data.data.list : []
    cb(
      list.map((r) => {
        const code = String(r.code ?? '').trim()
        const name = String(r.name ?? '').trim()
        const label = code && name ? `${code},${name}` : code || name
        return { value: label, label, code }
      }),
    )
  } catch {
    cb([])
  }
}

function onPickMaterial(item) {
  const code = String(item?.code ?? '').trim()
  editForm.kcaa05 = code
  editForm.kcaa05_display = String(item?.label ?? item?.value ?? '')
}

async function fetchColorSuggest(queryString, cb) {
  const q = String(queryString ?? '').trim()
  try {
    const res = await axios.get('/api/inventory/color-code/list', {
      params: { page: 1, pageSize: 50, keyword: q, pass: 1 },
    })
    const list = Array.isArray(res.data?.data?.list) ? res.data.data.list : []
    cb(
      list.map((r) => {
        const code = String(r.code ?? '').trim()
        const name = String(r.name ?? '').trim()
        const label = code && name ? `${code},${name}` : code || name
        return { value: label, label, code }
      }),
    )
  } catch {
    cb([])
  }
}

function onPickColor(item) {
  const code = String(item?.code ?? '').trim()
  editForm.kcaa11 = code
  editForm.kcaa11_display = String(item?.label ?? item?.value ?? '')
}

async function fetchUnitSuggest(queryString, cb) {
  const q = String(queryString ?? '').trim()
  try {
    const res = await axios.get('/api/inventory/units/list', {
      params: { page: 1, pageSize: 50, keyword: q, pass: 1 },
    })
    const list = Array.isArray(res.data?.data?.list) ? res.data.data.list : []
    cb(list.map((r) => ({ value: String(r.name ?? '').trim() })))
  } catch {
    cb([])
  }
}

function onPickUnitUse(item) {
  editForm.kcaa04 = String(item?.value ?? '').trim()
}
function onPickUnitPo(item) {
  editForm.kcaa25 = String(item?.value ?? '').trim()
}
function onPickUnitQt(item) {
  editForm.kcaa29 = String(item?.value ?? '').trim()
}

async function fetchWorkshopSuggest(queryString, cb) {
  const q = String(queryString ?? '').trim()
  try {
    const res = await axios.get('/api/inventory/workshop-dept/list', {
      params: { page: 1, pageSize: 50, keyword: q, pass: 1 },
    })
    const list = Array.isArray(res.data?.data?.list) ? res.data.data.list : []
    cb(
      list.map((r) => {
        const code = String(r.code ?? '').trim()
        const name = String(r.name ?? '').trim()
        const label = code && name ? `${code},${name}` : code || name
        return { value: label, label, code }
      }),
    )
  } catch {
    cb([])
  }
}

function onPickWorkshop(item) {
  const code = String(item?.code ?? '').trim()
  editForm.kcaa15 = code
  editForm.workshop_display = String(item?.label ?? item?.value ?? '')
}

async function fetchSupplierSuggest(queryString, cb) {
  const q = String(queryString ?? '').trim()
  try {
    const res = await axios.get('/api/supply-chain/suppliers/list', {
      params: { page: 1, pageSize: 50, keyword: q, pass: 1 },
    })
    const list = Array.isArray(res.data?.data?.list) ? res.data.data.list : []
    cb(
      list.map((r) => {
        const code = String(r.s_code ?? '').trim()
        const name = String(r.s_name ?? '').trim()
        const label = code && name ? `${code},${name}` : code || name
        return { value: label, label, code }
      }),
    )
  } catch {
    cb([])
  }
}

function onPickSupplier(item) {
  const code = String(item?.code ?? '').trim()
  editForm.Customer_Name = code
  editForm.supplier_display = String(item?.label ?? item?.value ?? '')
}

/**
 * 采购侧转换率：依赖使用单位 + 采购单位
 * @param {{ silent?: boolean }} [opts] silent 时不弹出成功提示（自动换算用）
 */
async function fillPurchaseRate(opts = {}) {
  const silent = !!opts.silent
  const u = String(editForm.kcaa04 ?? '').trim()
  const o = String(editForm.kcaa25 ?? '').trim()
  if (!u || !o) {
    if (!silent) ElMessage.warning('请先填写使用单位与采购单位')
    return
  }
  try {
    const res = await axios.get('/api/inventory/bom/unit-rate-suggest', {
      params: { useUnit: u, otherUnit: o },
    })
    const d = res.data?.data
    const rate = d?.rate != null ? String(d.rate).trim() : ''
    const dir = d?.direction
    if (!rate) {
      editForm.kcaa26 = ''
      if (!silent) ElMessage.warning('单位换算表中未找到该组合或未审核')
      return
    }
    editForm.kcaa26 = rate
    if (dir === 0 || dir === 1) editForm.kcaa27 = dir
    if (!silent) ElMessage.success('已根据单位换算表填充采购转换')
  } catch (e) {
    ElMessage.error(String(e?.response?.data?.msg ?? e?.message ?? '请求失败'))
  }
}

/**
 * 报价侧转换率：依赖使用单位 + 报价单位
 * @param {{ silent?: boolean }} [opts]
 */
async function fillQuoteRate(opts = {}) {
  const silent = !!opts.silent
  const u = String(editForm.kcaa04 ?? '').trim()
  const o = String(editForm.kcaa29 ?? '').trim()
  if (!u || !o) {
    if (!silent) ElMessage.warning('请先填写使用单位与报价单位')
    return
  }
  try {
    const res = await axios.get('/api/inventory/bom/unit-rate-suggest', {
      params: { useUnit: u, otherUnit: o },
    })
    const d = res.data?.data
    const rate = d?.rate != null ? String(d.rate).trim() : ''
    const dir = d?.direction
    if (!rate) {
      editForm.kcaa30 = ''
      if (!silent) ElMessage.warning('单位换算表中未找到该组合或未审核')
      return
    }
    editForm.kcaa30 = rate
    if (dir === 0 || dir === 1) editForm.kcaa31 = dir
    if (!silent) ElMessage.success('已根据单位换算表填充报价转换')
  } catch (e) {
    ElMessage.error(String(e?.response?.data?.msg ?? e?.message ?? '请求失败'))
  }
}

function buildBomMasterPayload() {
  return {
    systemcode: String(editForm.systemcode ?? '').trim(),
    kcaa01: String(editForm.kcaa01 ?? '').trim(),
    kcaa02: String(editForm.kcaa02 ?? '').trim(),
    kcaa02_en: String(editForm.kcaa02_en ?? ''),
    kpname: String(editForm.kpname ?? ''),
    kcaa03: String(editForm.kcaa03 ?? ''),
    kcaa05: String(editForm.kcaa05 ?? '').trim(),
    kcaa06: String(editForm.kcaa06 ?? ''),
    kcaa09: String(editForm.kcaa09 ?? ''),
    kcaa10: String(editForm.kcaa10 ?? ''),
    kcaa11: String(editForm.kcaa11 ?? '').trim(),
    location: String(editForm.location ?? '').trim() || '国内',
    kcaa04: String(editForm.kcaa04 ?? '').trim(),
    decimal: String(editForm.decimal ?? '2'),
    kcaa25: String(editForm.kcaa25 ?? '').trim(),
    kcaa27: Number(editForm.kcaa27) === 1 ? 1 : 0,
    kcaa26: editForm.kcaa26,
    kcaa29: String(editForm.kcaa29 ?? '').trim(),
    kcaa31: Number(editForm.kcaa31) === 1 ? 1 : 0,
    kcaa30: editForm.kcaa30,
    kcaa32: editForm.kcaa32,
    kcaa33: editForm.kcaa33,
    sale_price: editForm.sale_price,
    kcaa34: String(editForm.kcaa34 ?? '').trim(),
    cost_price: editForm.cost_price,
    kcaa35: String(editForm.kcaa35 ?? '').trim(),
    Customer_Name: String(editForm.Customer_Name ?? '').trim(),
    kcaa12: editForm.kcaa12_bool ? 1 : 0,
    kcaa13: editForm.kcaa13_bool ? 1 : 0,
    kcaa14: editForm.kcaa14_bool ? 1 : 0,
    Customer_supply: editForm.customer_supply_bool ? 1 : 0,
    kcaa15: String(editForm.kcaa15 ?? '').trim(),
    remark: String(editForm.remark ?? ''),
    sign: editForm.sign_bool ? 1 : 0,
  }
}

/** 新增主档：优先 save-main；若后端未重启仍为旧路由则 404 回退 POST /api/inventory/bom */
async function postBomMasterInsert(payload) {
  try {
    return await axios.post('/api/inventory/bom/save-main', payload)
  } catch (e) {
    if (e?.response?.status === 404) {
      return await axios.post('/api/inventory/bom', payload)
    }
    throw e
  }
}

async function submitBomEdit() {
  const code = String(editForm.kcaa01 ?? '').trim()
  const name = String(editForm.kcaa02 ?? '').trim()
  const cat = String(editForm.kcaa05 ?? '').trim()
  const useU = String(editForm.kcaa04 ?? '').trim()
  const poU = String(editForm.kcaa25 ?? '').trim()
  if (!code || !name) {
    ElMessage.warning('请填写编码与名称')
    return
  }
  if (!cat) {
    ElMessage.warning('请选择分类')
    return
  }
  if (!useU || !poU) {
    ElMessage.warning('请填写使用单位与采购单位')
    return
  }
  if (/\s/.test(code)) {
    ElMessage.warning('编码不能包含空格')
    return
  }
  editSaving.value = true
  try {
    const payload = buildBomMasterPayload()
    if (editMode.value === 'add') {
      const res = await postBomMasterInsert(payload)
      if (res.data?.code !== 200) {
        ElMessage.error(res.data?.msg || '新增失败')
        return
      }
      const sc = String(res.data?.data?.systemcode ?? '').trim()
      if (sc) {
        editForm.systemcode = sc
        editMode.value = 'edit'
        editMasterPass.value = '0'
      }
      ElMessage.success(sc ? 'BOM 主资料保存成功' : '新增成功')
      editActiveTab.value = 'parts'
      page.value = 1
      await loadData()
      if (sc) await loadEditBomParts()
      return
    }
    if (!payload.systemcode) {
      ElMessage.warning('缺少 systemcode，无法保存')
      return
    }
    const res = await axios.put('/api/inventory/bom', payload)
    if (res.data?.code !== 200) {
      ElMessage.error(res.data?.msg || '保存失败')
      return
    }
    ElMessage.success('保存成功')
    editVisible.value = false
    await loadData()
  } catch (e) {
    ElMessage.error(String(e?.response?.data?.msg ?? e?.message ?? '请求失败'))
  } finally {
    editSaving.value = false
  }
}

/** 主档 systemcode 为空则无法加载配件表 */
const bomSystemcode = computed(() => String(bomBasic.value?.systemcode ?? '').trim())

/** 已审核主档：配件只读（与列表「编辑」禁用一致） */
const partsReadOnly = computed(() => rowIsAudited(detailListRow.value))

/** 与 server bomPartsDelLooksActive 一致：空 / '0' / 数值 0 视为在册可编辑 */
function bomPartDelLooksActive(delVal) {
  const s = String(delVal ?? '').trim().toLowerCase()
  if (!s) return true
  if (s === '0') return true
  const n = Number(s.replace(/^'+|'+$/g, ''))
  return Number.isFinite(n) && n === 0
}

/** 详情配件行：主档已审 或 该行 del 非在册（如 del=1）时只读 */
function partLineReadonly(row) {
  return partsReadOnly.value || !bomPartDelLooksActive(row?.del)
}

/** 编辑弹窗配件行：主档已审 或 该行 del 非在册时只读 */
function editPartLineReadonly(row) {
  return editPartsReadOnly.value || !bomPartDelLooksActive(row?.del)
}

function partsRowKey(row) {
  if (row?.id != null && Number(row.id) > 0) return `id-${row.id}`
  return String(row?._localKey ?? '')
}

/** 序号列：仅展示用；保存时按当前列表顺序写入 Bom_parts.[Seq]（1 起连续递增） */
function partsRowIndex(i) {
  return i + 1
}

/** 用量合计 = kcac04 * (1 + kcac05)；损耗率为小数（5% → 0.05） */
function partUsageSum(row) {
  const q = Number(row?.kcac04)
  const loss = Number(row?.kcac05)
  const qq = Number.isFinite(q) ? q : 0
  const ll = Number.isFinite(loss) ? loss : 0
  return qq * (1 + ll)
}

/** 与后端 bomPartRoundDecimal6 一致，降低浮点误差 */
function bomRound6(n) {
  const x = Number(n)
  if (!Number.isFinite(x)) return 0
  return Math.round(x * 1e6) / 1e6
}

/** 同步写入行上 kcac06，供保存入 SQL */
function syncPartKcac06(row) {
  if (!row) return
  row.kcac06 = bomRound6(partUsageSum(row))
}

/** 界面展示用量合计（kcac06） */
function formatUsageTotal(row) {
  return bomRound6(partUsageSum(row)).toFixed(6)
}

/** 成本合计 = 用量合计(kcac06 规整后) * 单价 */
function partCostSum(row) {
  const p = Number(row?.cost_price)
  const price = Number.isFinite(p) ? p : 0
  return bomRound6(partUsageSum(row)) * price
}

/** 底部汇总：未标记删除的行 */
const partsSumActualUsage = computed(() => {
  let s = 0
  for (const row of partsList.value || []) {
    s += partUsageSum(row)
  }
  return s
})

const partsSumCost = computed(() => {
  let s = 0
  for (const row of partsList.value || []) {
    s += partCostSum(row)
  }
  return s
})

function formatQty(n) {
  const x = Number(n)
  if (!Number.isFinite(x)) return '0.0000'
  return x.toFixed(4)
}

/** 底部「实际用量总和」等与 kcac06 精度一致 */
function formatQtySumFooter(n) {
  return bomRound6(n).toFixed(6)
}

function formatMoney(n) {
  const x = Number(n)
  if (!Number.isFinite(x)) return '0.00'
  return x.toFixed(2)
}

/** 损耗率编辑：界面百分比 vs 库内小数 */
function lossPctDisplay(row) {
  const v = Number(row?.kcac05)
  const d = Number.isFinite(v) ? v : 0
  return d * 100
}

function onLossPctChange(row, pctVal) {
  const p = Number(pctVal)
  row.kcac05 = Number.isFinite(p) ? p / 100 : 0
  syncPartKcac06(row)
}

function genLocalKey() {
  return `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

/** @param {import('vue').Ref<number[]>} idsRef */
function pushPendingDeleteId(idsRef, rawId) {
  const n = Number(rawId)
  if (!Number.isFinite(n) || n <= 0) return
  if (!idsRef.value.includes(n)) idsRef.value.push(n)
}

function toggleEditPartSelect(row) {
  if (editPartLineReadonly(row)) return
  row._partsMarkSelected = !row._partsMarkSelected
}

/** 文档：批量移除「已选择」行；已入库行记入待软删 */
async function batchRemoveEditPartsSelected() {
  if (editPartsReadOnly.value) return
  const marked = (editPartsList.value ?? []).filter((r) => r._partsMarkSelected)
  if (!marked.length) {
    ElMessage.warning('请先在「选择」列点击「删除」标记要移除的行')
    return
  }
  try {
    await ElMessageBox.confirm(
      `将移除 ${marked.length} 行明细；已保存过的配件需点击「保存配件明细」后才会从系统中删除。`,
      '删除选定明细',
      { type: 'warning', confirmButtonText: '确定', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  for (const row of marked) {
    const id = row?.id != null && Number(row.id) > 0 ? Number(row.id) : null
    if (id) pushPendingDeleteId(editPartsPendingDeleteIds, id)
    const idx = editPartsList.value.indexOf(row)
    if (idx >= 0) editPartsList.value.splice(idx, 1)
  }
}

function appendEditPartBlankRow() {
  if (editPartsReadOnly.value || !editBomSystemcode.value) return
  editPartsList.value.push({
    _localKey: genLocalKey(),
    id: null,
    kcac01: '',
    kcaa01: '',
    kcaa02: '',
    kcaa03: '',
    kcaa04: '',
    kcaa11: '',
    kcac04: 0,
    kcac05: 0,
    kcac06: 0,
    cost_price: 0,
    remark: '',
    _partsMarkSelected: false,
  })
}

function openEditPartMaterialPicker(row) {
  if (editPartLineReadonly(row)) return
  editPartsPickerTargetKey.value = row?._localKey ?? null
  editPartsMaterialSelectorVisible.value = true
}

/** 详情弹窗配件表：同上 */
async function removeDetailPartRow(row) {
  if (!bomPartDelLooksActive(row?.del)) {
    ElMessage.warning('该行已删除标记，不可从列表移除')
    return
  }
  if (partsReadOnly.value) return
  try {
    await ElMessageBox.confirm(
      '确认从明细中移除该行吗？已保存过的配件需点击「保存配件明细」后才会从系统中删除。',
      '删除确认',
      { type: 'warning', confirmButtonText: '确定', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  const id = row?.id != null && Number(row.id) > 0 ? Number(row.id) : null
  if (id) pushPendingDeleteId(partsPendingDeleteIds, id)
  const idx = partsList.value.indexOf(row)
  if (idx >= 0) partsList.value.splice(idx, 1)
}

/** 选材回调：kcaa05 为选材组件内的「单位」别名，映射到配件表 kcaa04 */
function onMaterialPicked(payload) {
  const kcaa01 = String(payload?.kcaa01 ?? '').trim()
  if (!kcaa01) return
  const row = {
    _localKey: genLocalKey(),
    id: null,
    kcaa01,
    kcaa02: String(payload?.kcaa02 ?? '').trim(),
    kcaa03: String(payload?.kcaa03 ?? '').trim(),
    kcaa04: String(payload?.kcaa05 ?? payload?.kcaa04 ?? '').trim(),
    kcaa11: String(payload?.kcaa11 ?? '').trim(),
    kcac04: 1,
    kcac05: 0,
    kcac06: 1,
    cost_price: 0,
    remark: '',
  }
  syncPartKcac06(row)
  partsList.value.push(row)
}

async function loadBomParts() {
  const sc = bomSystemcode.value
  if (!sc) {
    partsError.value = '主档缺少 systemcode，无法加载配件明细（请确认库内 bom_000.systemcode）。'
    partsList.value = []
    return
  }
  const token = `${sc}@@${partsLoadGeneration.value}`
  partsLoadedToken.value = token
  partsLoading.value = true
  partsError.value = ''
  try {
    const res = await axios.get(`/api/inventory/bom/parts/${encodeURIComponent(sc)}`)
    const body = res.data
    if (body?.code !== 200) {
      if (partsLoadedToken.value !== token) return
      partsError.value = body?.msg || '加载失败'
      partsList.value = []
      return
    }
    const list = Array.isArray(body?.data?.list) ? body.data.list : []
    if (partsLoadedToken.value !== token) return
    partsPendingDeleteIds.value = []
    partsList.value = list.map((r) => {
      const row = { ...r, _localKey: genLocalKey() }
      syncPartKcac06(row)
      return row
    })
  } catch (e) {
    if (partsLoadedToken.value !== token) return
    partsError.value = String(e?.response?.data?.msg ?? e?.message ?? '网络错误')
    partsList.value = []
  } finally {
    if (partsLoadedToken.value === token) partsLoading.value = false
  }
}

async function saveBomParts() {
  const sc = bomSystemcode.value
  if (!sc) {
    ElMessage.warning('主档缺少 systemcode，无法保存')
    return
  }
  if (partsReadOnly.value) {
    ElMessage.warning('已审核的 BOM 不可修改配件')
    return
  }
  try {
    // 仅提交在册行（del 空/0）；历史 del=1 行不写入，避免 UPDATE 命中 0 行导致 Seq 错乱
    const activeRows = (partsList.value ?? []).filter((r) => bomPartDelLooksActive(r?.del))
    const kept = activeRows.map((r, idx) => {
      syncPartKcac06(r)
      return {
        id: r.id != null && Number(r.id) > 0 ? Number(r.id) : undefined,
        pendingDelete: false,
        kcac01: sc,
        kcaa01: String(r.kcaa01 ?? '').trim(),
        kcaa02: r.kcaa02,
        kcaa03: r.kcaa03,
        kcaa04: r.kcaa04,
        kcaa11: r.kcaa11,
        kcac04: r.kcac04,
        kcac05: r.kcac05,
        kcac06: r.kcac06,
        cost_price: r.cost_price,
        remark: r.remark,
        seq: idx + 1,
      }
    })
    const dels = (partsPendingDeleteIds.value ?? []).map((pid) => ({
      id: Number(pid),
      pendingDelete: true,
      kcac01: sc,
      kcaa01: '',
    }))
    const lines = [...kept, ...dels]
    if (!lines.length) {
      ElMessage.warning('没有需要保存的变更')
      return
    }
    const res = await axios.put(`/api/inventory/bom/parts/${encodeURIComponent(sc)}`, { lines })
    const body = res.data
    if (body?.code !== 200) {
      ElMessage.error(body?.msg || '保存失败')
      return
    }
    ElMessage.success('配件明细已保存')
    partsPendingDeleteIds.value = []
    await loadBomParts()
  } catch (e) {
    ElMessage.error(String(e?.response?.data?.msg ?? e?.message ?? '保存失败'))
  }
}

/** 新增/编辑弹窗：加载配件明细 */
async function loadEditBomParts() {
  const sc = editBomSystemcode.value
  if (!sc) {
    editPartsError.value = ''
    editPartsList.value = []
    return
  }
  const token = `edit-${sc}@@${editPartsLoadGeneration.value}`
  editPartsLoadedToken.value = token
  editPartsLoading.value = true
  editPartsError.value = ''
  try {
    const res = await axios.get(`/api/inventory/bom/parts/${encodeURIComponent(sc)}`)
    const body = res.data
    if (body?.code !== 200) {
      if (editPartsLoadedToken.value !== token) return
      editPartsError.value = body?.msg || '加载失败'
      editPartsList.value = []
      return
    }
    const list = Array.isArray(body?.data?.list) ? body.data.list : []
    if (editPartsLoadedToken.value !== token) return
    editPartsPendingDeleteIds.value = []
    editPartsList.value = list.map((r) => {
      const row = {
        ...r,
        _localKey: genLocalKey(),
        _partsMarkSelected: false,
      }
      syncPartKcac06(row)
      return row
    })
  } catch (e) {
    if (editPartsLoadedToken.value !== token) return
    editPartsError.value = String(e?.response?.data?.msg ?? e?.message ?? '网络错误')
    editPartsList.value = []
  } finally {
    if (editPartsLoadedToken.value === token) editPartsLoading.value = false
  }
}

/** 新增/编辑弹窗：保存配件明细 */
async function saveEditBomParts() {
  const sc = editBomSystemcode.value
  if (!sc) {
    ElMessage.warning('请先保存主档以生成系统编码')
    return
  }
  if (editPartsReadOnly.value) {
    ElMessage.warning('已审核的 BOM 不可修改配件')
    return
  }
  try {
    let seqAcc = 0
    const kept = []
    for (const r of editPartsList.value ?? []) {
      if (!String(r.kcaa01 ?? '').trim()) continue
      if (!bomPartDelLooksActive(r?.del)) continue
      syncPartKcac06(r)
      seqAcc += 1
      kept.push({
        id: r.id != null && Number(r.id) > 0 ? Number(r.id) : undefined,
        pendingDelete: false,
        kcac01: sc,
        kcaa01: String(r.kcaa01 ?? '').trim(),
        kcaa02: r.kcaa02,
        kcaa03: r.kcaa03,
        kcaa04: r.kcaa04,
        kcaa11: r.kcaa11,
        kcac04: r.kcac04,
        kcac05: r.kcac05,
        kcac06: r.kcac06,
        cost_price: r.cost_price,
        remark: r.remark,
        seq: seqAcc,
      })
    }
    const dels = (editPartsPendingDeleteIds.value ?? []).map((pid) => ({
      id: Number(pid),
      pendingDelete: true,
      kcac01: sc,
      kcaa01: '',
    }))
    const lines = [...kept, ...dels]
    if (!lines.length) {
      ElMessage.warning('没有需要保存的变更')
      return
    }
    const res = await axios.put(`/api/inventory/bom/parts/${encodeURIComponent(sc)}`, { lines })
    const body = res.data
    if (body?.code !== 200) {
      ElMessage.error(body?.msg || '保存失败')
      return
    }
    ElMessage.success('配件明细已保存')
    editPartsPendingDeleteIds.value = []
    await loadEditBomParts()
  } catch (e) {
    ElMessage.error(String(e?.response?.data?.msg ?? e?.message ?? '保存失败'))
  }
}

function onEditMaterialPicked(payload) {
  const kcaa01 = String(payload?.kcaa01 ?? '').trim()
  if (!kcaa01) return
  const key = editPartsPickerTargetKey.value
  editPartsPickerTargetKey.value = null
  const target = key ? editPartsList.value.find((r) => r._localKey === key) : null
  if (target) {
    if (editPartLineReadonly(target)) {
      ElMessage.warning('该行已删除标记，不可修改')
      return
    }
    target.kcaa01 = kcaa01
    target.kcaa02 = String(payload?.kcaa02 ?? '').trim()
    target.kcaa03 = String(payload?.kcaa03 ?? '').trim()
    target.kcaa04 = String(payload?.kcaa05 ?? payload?.kcaa04 ?? '').trim()
    target.kcaa11 = String(payload?.kcaa11 ?? '').trim()
    if (!(Number(target.kcac04) > 0)) target.kcac04 = 1
    syncPartKcac06(target)
    return
  }
  const row = {
    _localKey: genLocalKey(),
    id: null,
    kcac01: '',
    kcaa01,
    kcaa02: String(payload?.kcaa02 ?? '').trim(),
    kcaa03: String(payload?.kcaa03 ?? '').trim(),
    kcaa04: String(payload?.kcaa05 ?? payload?.kcaa04 ?? '').trim(),
    kcaa11: String(payload?.kcaa11 ?? '').trim(),
    kcac04: 1,
    kcac05: 0,
    kcac06: 1,
    cost_price: 0,
    remark: '',
    _partsMarkSelected: false,
  }
  syncPartKcac06(row)
  editPartsList.value.push(row)
}

watch(
  () => [detailActiveTab.value, bomSystemcode.value, detailVisible.value],
  ([tab, sc, vis]) => {
    if (!vis || !sc) return
    if (tab === 'parts') loadBomParts()
  },
)

watch(
  () => [editActiveTab.value, editVisible.value, editBomSystemcode.value],
  ([tab, vis, sc]) => {
    if (!vis || !String(sc ?? '').trim()) return
    if (tab === 'parts') void loadEditBomParts()
  },
)

/** 空值展示为 em dash，与只读详情习惯一致 */
function dVal(v) {
  const s = String(v ?? '').trim()
  return s || '—'
}

function onDetailClosed() {
  detailError.value = ''
  detailDrillStack.value = []
  bomBasic.value = null
  detailTitleCode.value = ''
  detailActiveTab.value = 'basic'
  detailListRow.value = null
  partsList.value = []
  partsPendingDeleteIds.value = []
  partsError.value = ''
  partsLoadedToken.value = ''
  partsLoadGeneration.value += 1
  materialSelectorVisible.value = false
  bomUsageTreeLoading.value = false
  bomUsageTreeError.value = ''
  bomUsageTreeData.value = []
  bomCostUsageRawRows.value = []
  bomCostUsageFlatRows.value = []
}

const hintShort = computed(() => {
  const k = String(keyword.value ?? '').trim()
  return k.length > 0 && k.length < 3
})

function formatDateTime(v) {
  const s = String(v ?? '').trim()
  if (!s) return '—'
  // 常见格式：YYYY-MM-DD HH:mm:ss / YYYY-MM-DDTHH:mm:ss.sssZ / 其它字符串
  const t = s.replace('T', ' ').replace('Z', '')
  // 若包含秒，取到分钟；否则原样返回（并做长度保护）
  if (/^\d{4}-\d{1,2}-\d{1,2}\s+\d{1,2}:\d{1,2}/.test(t)) {
    const m = t.match(/^(\d{4}-\d{1,2}-\d{1,2})\s+(\d{1,2}:\d{1,2})/)
    if (m) return `${m[1]} ${m[2]}`
  }
  return t.length > 16 ? t.slice(0, 16) : t
}

function rowIsAudited(row) {
  return String(row?.pass ?? '').trim() === '1'
}

function ynText(v) {
  const s = String(v ?? '').trim()
  if (s === '1' || s.toLowerCase() === 'y' || s === '是') return '是'
  if (s === '0' || s.toLowerCase() === 'n' || s === '否') return '否'
  return s || '—'
}

function withRowKey(list) {
  return (list ?? []).map((r) => ({
    ...r,
    rowKey: `${String(r.systemcode ?? '')}@@${String(r.code ?? '')}@@${String(r.version ?? '')}`,
  }))
}

async function loadData() {
  loading.value = true
  errorMessage.value = ''
  try {
    const kw = String(keyword.value ?? '').trim()
    const params = {
      page: page.value,
      pageSize: pageSize.value,
      ...(showRecycle.value
        ? { recycled: '1' }
        : {
            pass: showUnAudited.value ? '0' : '1',
            bom_cut: searchQuery.bom_cut === 1 ? 1 : 0,
          }),
      ...(kw.length >= 3 ? { keyword: kw } : {}),
    }
    const res = await axios.get('/api/inv/bom/list', { params })
    const body = res.data
    if (body?.code !== 200) {
      errorMessage.value = body?.msg || '加载失败'
      tableList.value = []
      total.value = 0
      return
    }
    const data = body.data ?? {}
    total.value = Number(data.total ?? 0)
    tableList.value = withRowKey(data.list ?? [])
  } catch (e) {
    const msg = e?.response?.data?.msg || e?.message || '网络错误'
    errorMessage.value = String(msg)
    tableList.value = []
    total.value = 0
  } finally {
    loading.value = false
  }
}

function onSearch() {
  page.value = 1
  loadData()
}

function onReset() {
  keyword.value = ''
  searchQuery.bom_cut = 0
  showUnAudited.value = false
  showRecycle.value = false
  page.value = 1
  loadData()
}

function onRecycleChange() {
  if (showRecycle.value) {
    showUnAudited.value = false
  }
  page.value = 1
  loadData()
}

function onPageChange(p) {
  page.value = p
  loadData()
}

function onPageSizeChange(ps) {
  pageSize.value = ps
  page.value = 1
  loadData()
}

async function openDetail(row) {
  const code = String(row?.code ?? '').trim()
  if (!code) {
    ElMessage.warning('当前行无编码，无法查看详情')
    return
  }
  detailDrillStack.value = []
  detailTitleCode.value = code
  detailListRow.value = row
  detailVisible.value = true
  detailLoading.value = true
  detailError.value = ''
  bomBasic.value = null
  try {
    const res = await axios.get(`/api/inventory/bom/${encodeURIComponent(code)}`)
    const body = res.data
    if (body?.code !== 200) {
      detailError.value = body?.msg || '加载失败'
      return
    }
    bomBasic.value = body?.data?.basic ?? null
    if (!bomBasic.value) detailError.value = '未返回基础资料数据'
    else {
      detailListRow.value = { code: bomBasic.value.kcaa01, pass: bomBasic.value.pass }
    }
  } catch (e) {
    detailError.value = String(e?.response?.data?.msg ?? e?.message ?? '网络错误')
  } finally {
    detailLoading.value = false
  }
}

/** 从配件行钻取：打开该配件编码对应 BOM，并切到「配件明细」Tab（下一层） */
async function openLinkedBomDetailFromPart(partRow) {
  const code = String(partRow?.kcaa01 ?? '').trim()
  if (!code) {
    ElMessage.warning('请先选择配件')
    return
  }
  const curCode = String(bomBasic.value?.kcaa01 ?? '').trim()
  if (curCode && curCode === code) {
    ElMessage.warning('已在当前 BOM')
    return
  }
  if (bomBasic.value && curCode) {
    pushDetailDrillSnapshot()
  }
  detailLoading.value = true
  detailError.value = ''
  bomBasic.value = null
  partsList.value = []
  partsError.value = ''
  detailTitleCode.value = code
  try {
    const res = await axios.get(`/api/inventory/bom/${encodeURIComponent(code)}`)
    const body = res.data
    if (body?.code !== 200) {
      const msg = body?.msg || '加载失败'
      detailError.value = msg
      ElMessage.error(msg)
      return
    }
    const basic = body?.data?.basic ?? null
    if (!basic) {
      detailError.value = '未返回基础资料数据'
      return
    }
    bomBasic.value = basic
    detailListRow.value = { code: basic.kcaa01, pass: basic.pass }
    detailActiveTab.value = 'parts'
  } catch (e) {
    const msg = String(e?.response?.data?.msg ?? e?.message ?? '网络错误')
    detailError.value = msg
    ElMessage.error(msg)
  } finally {
    detailLoading.value = false
  }
}

async function onAudit(row) {
  const sc = String(row?.systemcode ?? '').trim()
  const label = String(row?.name ?? row?.code ?? '').trim() || sc
  if (!sc) {
    ElMessage.warning('缺少 systemcode，无法审核')
    return
  }
  try {
    await ElMessageBox.confirm(`确认要审核「${label}」吗？审核后将出现在默认（已审核）列表中，并可供业务单据选用。`, '确认审核', {
      type: 'warning',
      confirmButtonText: '确定',
      cancelButtonText: '取消',
    })
  } catch {
    return
  }
  busySystemcode.value = sc
  try {
    const res = await axios.put('/api/inventory/bom/audit', { systemcode: sc })
    if (res.data?.code === 200) {
      ElMessage.success('审核成功')
      await loadData()
    } else {
      ElMessage.error(res.data?.msg || '审核失败')
    }
  } catch (e) {
    ElMessage.error(String(e?.response?.data?.msg ?? e?.message ?? '审核失败'))
  } finally {
    busySystemcode.value = ''
  }
}

async function onUnaudit(row) {
  const sc = String(row?.systemcode ?? '').trim()
  const label = String(row?.name ?? row?.code ?? '').trim() || sc
  if (!sc) {
    ElMessage.warning('缺少 systemcode，无法反审')
    return
  }
  try {
    await ElMessageBox.confirm(`确认要反审「${label}」吗？反审后可编辑或逻辑删除；已引用的业务不受影响。`, '确认反审', {
      type: 'warning',
      confirmButtonText: '确定',
      cancelButtonText: '取消',
    })
  } catch {
    return
  }
  busySystemcode.value = sc
  try {
    const res = await axios.put('/api/inventory/bom/unaudit', { systemcode: sc })
    if (res.data?.code === 200) {
      ElMessage.success('反审成功')
      await loadData()
    } else {
      ElMessage.error(res.data?.msg || '反审失败')
    }
  } catch (e) {
    ElMessage.error(String(e?.response?.data?.msg ?? e?.message ?? '反审失败'))
  } finally {
    busySystemcode.value = ''
  }
}

async function onSoftDelete(row) {
  const sc = String(row?.systemcode ?? '').trim()
  const label = String(row?.name ?? row?.code ?? '').trim() || sc
  if (!sc) {
    ElMessage.warning('缺少 systemcode，无法删除')
    return
  }
  if (rowIsAudited(row)) {
    ElMessage.warning('该记录已审核，需先反审后才能删除。')
    return
  }
  try {
    await ElMessageBox.confirm(`确认要删除「${label}」吗？删除后将移入回收站，可在回收站恢复。`, '确认删除', {
      type: 'warning',
      confirmButtonText: '确定',
      cancelButtonText: '取消',
    })
  } catch {
    return
  }
  busySystemcode.value = sc
  try {
    const res = await axios.delete(`/api/inventory/bom/systemcode/${encodeURIComponent(sc)}`)
    if (res.data?.code === 200) {
      ElMessage.success('已移入回收站')
      await loadData()
    } else {
      ElMessage.error(res.data?.msg || '删除失败')
    }
  } catch (e) {
    ElMessage.error(String(e?.response?.data?.msg ?? e?.message ?? '删除失败'))
  } finally {
    busySystemcode.value = ''
  }
}

async function onRestore(row) {
  const sc = String(row?.systemcode ?? '').trim()
  const label = String(row?.name ?? row?.code ?? '').trim() || sc
  if (!sc) {
    ElMessage.warning('缺少 systemcode，无法恢复')
    return
  }
  try {
    await ElMessageBox.confirm(`确认恢复「${label}」吗？恢复后将回到在册列表（按审核状态筛选）。`, '确认恢复', {
      type: 'warning',
      confirmButtonText: '确定',
      cancelButtonText: '取消',
    })
  } catch {
    return
  }
  busySystemcode.value = sc
  try {
    const res = await axios.put('/api/inventory/bom/restore', { systemcode: sc })
    if (res.data?.code === 200) {
      ElMessage.success('恢复成功')
      await loadData()
    } else {
      ElMessage.error(res.data?.msg || '恢复失败')
    }
  } catch (e) {
    ElMessage.error(String(e?.response?.data?.msg ?? e?.message ?? '恢复失败'))
  } finally {
    busySystemcode.value = ''
  }
}

async function onHardDelete(row) {
  const sc = String(row?.systemcode ?? '').trim()
  const label = String(row?.name ?? row?.code ?? '').trim() || sc
  if (!sc) {
    ElMessage.warning('缺少 systemcode，无法彻底删除')
    return
  }
  if (rowIsAudited(row)) {
    ElMessage.warning('该记录已审核，需先反审后才能删除。请先恢复后再反审。')
    return
  }
  try {
    await ElMessageBox.confirm(
      `确认彻底删除「${label}」吗？该操作将永久删除数据库记录且不可恢复。`,
      '彻底删除',
      { type: 'error', confirmButtonText: '确定删除', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  busySystemcode.value = sc
  try {
    const res = await axios.delete(`/api/inventory/bom/systemcode/${encodeURIComponent(sc)}/permanent`)
    if (res.data?.code === 200) {
      ElMessage.success('已彻底删除')
      await loadData()
    } else {
      ElMessage.error(res.data?.msg || '彻底删除失败')
    }
  } catch (e) {
    ElMessage.error(String(e?.response?.data?.msg ?? e?.message ?? '彻底删除失败'))
  } finally {
    busySystemcode.value = ''
  }
}

/** 弹窗打开时间戳：避免回填表单时立即触发自动换算 */
const editDialogOpenedAt = ref(0)
let purchaseRateAutoTimer = null
let quoteRateAutoTimer = null

watch(editVisible, (open) => {
  if (open) {
    editDialogOpenedAt.value = Date.now()
    void loadBomCurrencyNames()
  }
})

watch(
  () => [
    editVisible.value,
    String(editForm.kcaa04 ?? '').trim(),
    String(editForm.kcaa25 ?? '').trim(),
  ],
  ([vis, u, o]) => {
    if (purchaseRateAutoTimer) clearTimeout(purchaseRateAutoTimer)
    if (!vis || !u || !o) return
    purchaseRateAutoTimer = setTimeout(() => {
      purchaseRateAutoTimer = null
      if (!editVisible.value) return
      if (Date.now() - editDialogOpenedAt.value < 650) return
      void fillPurchaseRate({ silent: true })
    }, 450)
  },
)

watch(
  () => [
    editVisible.value,
    String(editForm.kcaa04 ?? '').trim(),
    String(editForm.kcaa29 ?? '').trim(),
  ],
  ([vis, u, q]) => {
    if (quoteRateAutoTimer) clearTimeout(quoteRateAutoTimer)
    if (!vis || !u || !q) return
    quoteRateAutoTimer = setTimeout(() => {
      quoteRateAutoTimer = null
      if (!editVisible.value) return
      if (Date.now() - editDialogOpenedAt.value < 650) return
      void fillQuoteRate({ silent: true })
    }, 450)
  },
)

async function onEdit(row) {
  if (rowIsAudited(row)) {
    ElMessage.warning('该数据已审核，需先反审后才能编辑。')
    return
  }
  const code = String(row?.code ?? '').trim()
  if (!code) {
    ElMessage.warning('当前行无编码，无法编辑')
    return
  }
  editMode.value = 'edit'
  editActiveTab.value = 'main'
  resetEditForm()
  editVisible.value = true
  try {
    const res = await axios.get(`/api/inventory/bom/${encodeURIComponent(code)}`)
    const basic = res.data?.data?.basic
    if (res.data?.code !== 200 || !basic) {
      ElMessage.error(res.data?.msg || '加载主档失败')
      editVisible.value = false
      return
    }
    fillEditFormFromBasic(basic)
  } catch (e) {
    ElMessage.error(String(e?.response?.data?.msg ?? e?.message ?? '网络错误'))
    editVisible.value = false
  }
}

/** 复制到新增：除物料编码 kcaa01、系统编码外带入主档字段（不复制配件明细） */
async function openCopyBom(row) {
  const code = String(row?.code ?? '').trim()
  if (!code) {
    ElMessage.warning('当前行无编码，无法复制')
    return
  }
  const sc = String(row?.systemcode ?? '').trim()
  busyCopySystemcode.value = sc || code
  editMode.value = 'add'
  editActiveTab.value = 'main'
  editOpenedFromCopy.value = true
  editMasterPass.value = '0'
  editPartsList.value = []
  editPartsError.value = ''
  editPartsPendingDeleteIds.value = []
  resetEditForm()
  editVisible.value = true
  try {
    const res = await axios.get(`/api/inventory/bom/${encodeURIComponent(code)}`)
    const basic = res.data?.data?.basic
    if (res.data?.code !== 200 || !basic) {
      ElMessage.error(res.data?.msg || '加载主档失败')
      editVisible.value = false
      return
    }
    fillEditFormFromBasic(basic)
    editForm.systemcode = ''
    editForm.kcaa01 = ''
    editMasterPass.value = '0'
  } catch (e) {
    ElMessage.error(String(e?.response?.data?.msg ?? e?.message ?? '网络错误'))
    editVisible.value = false
  } finally {
    busyCopySystemcode.value = ''
  }
}

loadData()
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
  margin: 0 0 12px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
.search-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}
.bom-keyword-input {
  flex: 1;
  min-width: 280px;
  max-width: 520px;
}
.audit-switch {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-left: 4px;
}
.switch-label {
  font-size: 13px;
  color: var(--el-text-color-regular);
}
.hint-alert,
.error-alert,
.audit-view-alert {
  margin-bottom: 12px;
}
/* 列表：操作列收窄允许按钮折行；编码/名称/规格自动换行完整展示 */
.bom-list-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 6px;
  max-width: 100%;
}
.bom-list-actions :deep(.el-button) {
  margin-left: 0;
}
.bom-list-cell-wrap {
  display: inline-block;
  width: 100%;
  white-space: normal;
  word-break: break-word;
  line-height: 1.35;
  font-size: 12px;
  vertical-align: top;
}
.pagination-row {
  margin-top: 14px;
  display: flex;
  justify-content: flex-end;
}
.usage-sum-cell {
  line-height: 18px;
  font-size: 12px;
}
.bom-detail-alert {
  margin-bottom: 12px;
}
.bom-detail-drill-bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px 14px;
  margin-bottom: 10px;
  padding: 6px 10px;
  border-radius: var(--el-border-radius-base);
  background: var(--el-fill-color-light);
}
.bom-detail-drill-bar__hint {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.bom-detail-drill-bar__btn--toolbar {
  margin-right: 4px;
}
.bom-detail-form {
  padding-top: 4px;
}
.bom-detail-body {
  max-height: calc(92vh - 160px);
  overflow-x: hidden;
  overflow-y: auto;
  padding-right: 4px;
}
.bom-detail-check-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px 20px;
}
.bom-detail-dialog :deep(.el-dialog__body) {
  padding-top: 8px;
  /* 避免与 el-table 内部横向滚动条重复：宽表仅由表格自身滚动 */
  overflow-x: hidden;
}
.bom-section-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  margin: 14px 0 8px;
  padding-bottom: 4px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}
.bom-sub-block-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--el-text-color-regular);
  margin: 10px 0 6px;
}
.bom-usage-calc-toolbar__hint {
  margin-left: 8px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

.bom-detail-tab-placeholder {
  min-height: 220px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px 0;
}

.bom-usage-tree-wrap {
  min-height: 240px;
  margin-top: 8px;
  padding: 8px 4px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
}

/* 树形表：横向字段多，外层横向滚动 + 视口限高（.cursorrules 超长表格约定） */
.bom-usage-table-outer {
  width: 100%;
  overflow-x: auto;
  max-height: calc(100vh - 260px);
}

.bom-usage-tree-table {
  min-width: 1100px;
}

/* 成本 BOM 用量：普通表 + 横向滚动 + 限高（与超长表约定一致） */
.bom-cost-usage-wrap {
  min-height: 240px;
  margin-top: 8px;
  padding: 8px 4px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
}
.bom-cost-usage-table-outer {
  width: 100%;
  overflow-x: auto;
  max-height: calc(100vh - 260px);
}
.bom-cost-usage-table {
  min-width: 920px;
}
.bom-cost-usage-toolbar {
  margin-bottom: 0;
}

.bom-cost-hide-prefix-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  width: 100%;
}
.bom-cost-hide-prefix-bar__label {
  font-size: 13px;
  color: var(--el-text-color-regular);
  white-space: nowrap;
}
.bom-cost-hide-prefix-bar__summary {
  font-size: 13px;
  color: var(--el-text-color-secondary);
  flex: 1 1 200px;
  min-width: 0;
  line-height: 1.4;
}
.bom-cost-hide-prefix-dialog__tip {
  margin: 0 0 12px;
  font-size: 13px;
  color: var(--el-text-color-secondary);
  line-height: 1.5;
}
.bom-cost-hide-prefix-dialog__rows {
  max-height: min(52vh, 360px);
  overflow-y: auto;
  padding-right: 4px;
}
.bom-cost-hide-prefix-dialog__row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.bom-cost-hide-prefix-dialog__row .el-input {
  flex: 1;
  min-width: 0;
}
.bom-cost-hide-prefix-dialog__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 10px;
  margin-top: 4px;
}
.bom-cost-hide-prefix-dialog__quick-label {
  font-size: 13px;
  color: var(--el-text-color-regular);
  margin-left: 4px;
}
.bom-cost-usage-toolbar__hint {
  margin-left: 0;
  flex-basis: 100%;
}

.bom-parts-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 10px;
}
.bom-parts-alert {
  margin-bottom: 10px;
}
.bom-parts-table-wrap {
  width: 100%;
  overflow-x: hidden;
}
.bom-parts-table {
  min-width: 1100px;
}
.bom-parts-table--edit {
  min-width: 1580px;
}
.bom-parts-num {
  width: 100%;
}
/** 选择列：未标记＝删除（橘色），已标记＝已选择（灰） */
.bom-part-mark-btn {
  min-width: 64px;
  background-color: #ff7800;
  border-color: #ff7800;
  color: #fff;
}
.bom-part-mark-btn:hover {
  background-color: #e56e00;
  border-color: #e56e00;
  color: #fff;
}
.bom-part-mark-btn--on {
  background-color: #ccc !important;
  border-color: #ccc !important;
  color: #333 !important;
}
/** 操作列「查看配件」：实心 small 主色按钮 */
.bom-part-view-action-btn {
  min-width: 72px;
}
.bom-parts-sum-row {
  margin-top: 10px;
  font-size: 13px;
  color: var(--el-text-color-regular);
}
.bom-parts-sum-gap {
  margin-left: 24px;
}
.bom-edit-dialog :deep(.el-dialog__body) {
  padding-top: 8px;
  overflow-x: hidden;
}
.bom-edit-body {
  max-height: calc(92vh - 160px);
  overflow-x: hidden;
  overflow-y: auto;
  padding-right: 4px;
}
.bom-edit-alert {
  margin-bottom: 12px;
}
.bom-edit-tabs {
  margin-top: 4px;
}
.bom-edit-tabs :deep(.el-tab-pane) {
  padding-top: 4px;
}
/* 新增/编辑弹窗：系统编码与客供同一行，复选框与输入框垂直对齐 */
.bom-edit-row-system .bom-edit-checkbox-cell {
  display: flex;
  align-items: center;
  min-height: 32px;
}
/* 单位与损耗：多行分区，行间距略收紧以贴近参考稿 */
.bom-unit-loss-block > .el-row:not(:last-child) {
  margin-bottom: 4px;
}
</style>
