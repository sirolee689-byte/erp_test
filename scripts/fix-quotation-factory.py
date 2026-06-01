"""Fix template-literal bugs in generated createQuotationHandlers.js"""
import pathlib
import re

path = pathlib.Path(__file__).resolve().parents[1] / "server/createQuotationHandlers.js"
text = path.read_text(encoding="utf-8")

text = text.replace("h.cgaa02 = addStr", "h[quoteDateCol] = addStr")
text = text.replace("req.query?.cgaa01", "req.query?.[checkDocNoQueryParam]")
text = text.replace(": '${label}'", ": `${label}`")

text = text.replace(
    "throw new Error(\n      ``[`${label}]` 未找到 ${LINE_TABLE} 指向 ${HEADER_TABLE} 的外键列；请在库中建立外键或为明细表增加 pid 等关联列`,\n    )",
    "throw new Error(\n      `[${label}] 未找到 ${LINE_TABLE} 指向 ${HEADER_TABLE} 的外键列；请在库中建立外键或为明细表增加 pid 等关联列`,\n    )",
)
text = text.replace(
    "if (!headerCols.length) throw new Error(``[`${label}]` 表 ${HEADER_TABLE} 无列或不存在`)",
    "if (!headerCols.length) throw new Error(`[${label}] 表 ${HEADER_TABLE} 无列或不存在`)",
)
text = text.replace(
    "if (!lineCols.length) throw new Error(``[`${label}]` 表 ${LINE_TABLE} 无列或不存在`)",
    "if (!lineCols.length) throw new Error(`[${label}] 表 ${LINE_TABLE} 无列或不存在`)",
)
text = text.replace(
    "throw new Error(``[`${label}]` ${HEADER_TABLE} 需要单列主键，当前：${pkH.join(',') || '无'}`)",
    "throw new Error(`[${label}] ${HEADER_TABLE} 需要单列主键，当前：${pkH.join(',') || '无'}`)",
)
text = text.replace(
    "throw new Error('`[${label}]` 主表缺少 ${docNoCol}/单号列，无法按明细外键类型关联')",
    "throw new Error(`[${label}] 主表缺少 ${docNoCol}/单号列，无法按明细外键类型关联`)",
)

text = text.replace(
    "msg: '主表缺少单号列（${docNoCol} 等）'",
    "msg: `主表缺少单号列（${docNoCol} 等）`",
)
text = text.replace(
    "msg: '参数错误：${checkDocNoQueryParam}'",
    "msg: `参数错误：${checkDocNoQueryParam}`",
)
text = text.replace(
    "msg: '新增失败：请填写${label}单号（cgaa01）以便关联明细'",
    "msg: `新增失败：请填写${label}单号（${docNoCol}）以便关联明细`",
)

text = re.sub(
    r"app\.(get|post|put|delete)\('\$\{apiBase\}([^']*)'",
    r"app.\1(`${apiBase}\2`",
    text,
)
text = re.sub(
    r"console\.error\('([^']*\$\{apiBase\}[^']*)'",
    r"console.error(`\1`",
    text,
)

path.write_text(text, encoding="utf-8")
print("fixed", path)
