# Production return links to production issue outbound, not dispatch order

Status: accepted

## Context

The legacy ERP tied **生产退料** (stock-in type `5`) to **派工单** (`UB_ERP_Dispatch_order`). Operationally, return material is unused stock coming back from the shop floor after a **生产领料** outbound document actually issued it from the warehouse. Dispatch describes plan; outbound describes what left the warehouse.

## Decision

For **new** production-return documents, the association source is **生产领料类出库单** — outbound headers/lines where `kcap03` is one of:

- `4` — 生产领料
- `7` — 生产领料（计划外）
- `8` — 生产领料（补数）

Rules agreed 2026-06-22:

1. **【选择】弹窗**：列表展示出库单头 + 出库单明细；候选数据仅包含上述三种出库类型。
2. **无领料出库单**：不允许做生产退料；用户自行改选其他入库类型。
3. **计划外 / 补数**：类型 `7`/`8` 出库单属于合法退料来源。
4. **可退上限**：仅按**出库单行**（该行已出量 − 已对该行/该出库单的退料量）；不与派工明细池取 `min`。
5. **历史数据**：旧单 `kcan04` 仍按派工单展示，不迁移。

## Considered options

| Option | Summary | Rejected because |
|--------|---------|------------------|
| S1 派工锚点 | Keep legacy dispatch pick + dispatch-line batch | Cannot tie return to actual issue document; multi-issue per dispatch is ambiguous |
| S2 纯出库单 | User's choice | **Accepted** |
| S3 双层 | Outbound pick + dispatch cap | Rejected: user chose outbound-line-only cap |

## Consequences

- Replace production-return 【选择】and batch-add flows that currently use `production-dispatch-pick-page` / `production-batch-lines` (dispatch-based).
- New API(s) should list `UB_ERP_Stocks_out` + `UB_ERP_Stocks_out_list` filtered by `kcap03 ∈ (4,7,8)`.
- Return quantity validation and batch `tempx` must aggregate prior type-`5` inbound against the same outbound line key, not dispatch `scak02` pool alone.
- **Asymmetric** with 外协退料 (still order/BOM-based) — intentional: production return mirrors physical issue slip.
- Code shipped before this ADR (dispatch-based return pick/batch) is **superseded** for new documents only.

## Open (next grilling round)

- Whether production-return **audit** should reverse-write dispatch `scak04` (production issue currently increases it on outbound audit).
- New-document header mapping: `kcan04` = outbound `kcap01`? `kcan08` = outbound `kcap08` (PI)? Hidden `sourceSystemcodeId` = outbound header `systemcode`?
- Whether inbound header still requires **生产车间** when outbound already carries `kcap05`.
