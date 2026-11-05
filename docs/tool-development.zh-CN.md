# ToolDeck 工具包开发指南

[English](tool-development.md) | 简体中文 · [项目介绍](../README.zh-CN.md)

## 制作第一个工具包

创建一个目录，在其中放入两个 UTF-8 文件。先将以下内容保存为 `manifest.yaml`。这个工具只有一个操作，要求用户填写姓名。

~~~yaml
manifestVersion: 1
id: org.example.greeting
name: { en: Greeting, zh-CN: 问候 }
version: "1.0.0"
hostApi: "^1.0.0"
runtime: { kind: python, version: ">=3.10.0 <4.0.0", source: system }
actions:
  greet:
    name: { en: Greet, zh-CN: 打招呼 }
    entry: greet.py
    params:
      name:
        required: true
        schema: { type: string, minLength: 1 }
        ui:
          label: { en: Name, zh-CN: 姓名 }
          placeholder: { en: Enter a name, zh-CN: 请输入姓名 }
~~~

在同一目录中创建入口文件 `greet.py`：

~~~python
def main(ctx):
    name = ctx.params["name"]
    message = {"en": "Hello", "zh-CN": "你好"}.get(ctx.locale, "Hello")
    ctx.output({"message": f"{message}, {name}!"})
~~~

将两个文件压缩成 ZIP，使 `manifest.yaml` 位于压缩包根目录。导入 ZIP，安装 Python 环境，选择**打招呼**，输入姓名并运行。结果区会按应用显示语言展示问候语。需要实现多个操作时，可以参考完整的 [Python](../examples/python-example/)、[Node.js](../examples/node-example/)、[Bash](../examples/bash-example/) 和 [PowerShell](../examples/pws-example/) 工具包。

## 声明工具身份和环境

每次发布沿用相同的 `id`，并递增符合 SemVer 的 `version`。工具 ID 使用小写反向域名，例如 `org.example.greeting`。操作、字段和文档的标识符以英文字母开头，可包含字母、数字和下划线。每个操作声明自己的 `name` 和独立的 `entry` 文件，多个入口可以导入共用模块。包内路径相对于工具根目录，使用 `/`；绝对路径和向上跳转的路径会被拒绝。

| 顶层字段 | 是否必填 | 类型与用途 |
| --- | --- | --- |
| `manifestVersion` | 是 | 整数 `1`，表示工具包格式版本。 |
| `id` | 是 | 稳定的工具标识，也用于关联设置和持久数据。 |
| `name` | 是 | 工具显示名称，可以是文本或语言映射；映射缺少可用译文时显示工具 ID。 |
| `version` | 是 | 工具自身的 SemVer 版本字符串，例如 `"1.2.0"`。 |
| `description` | 否 | 工具名称下方的简短说明，支持多语言文本。 |
| `icon` | 否 | 包内图片的相对路径；缺省时界面使用工具名称的首字符。 |
| `hostApi` | 是 | 执行协议的 SemVer 版本范围，应包含当前版本 `1.0.0`。 |
| `platforms` | 否 | 非空的平台对象列表，声明操作系统和架构，见下文。 |
| `runtime` | 是 | 包含 `kind`、`version`（范围）和 `source` 的对象。 |
| `dependencies` | 否 | 对应运行时的包管理器及依赖文件。 |
| `settings` | 否 | 工具级持久设置的字段映射。 |
| `actions` | 是 | 非空映射，键为操作 ID，值为操作声明。 |
| `hooks` | 否 | 自动事件入口映射，详见“响应参数变化”。 |
| `docs` | 否 | 包内 Markdown 文档列表，每项包含 `id`、`title`、`path`，可选填 `locale`。 |

每个操作声明相对于工具目录的 `entry`。填写显示名称 `name`，按需提供 `description`、字段映射 `params`，以及 `execution: {timeoutSeconds: 60}` 等超时配置。每个入口都必须存在，且不同操作应指向不同文件。文档标题是字符串，翻译标题时在各语言的文档条目中分别填写。

### 运行时和安装配置

| manifest 字段 | 填写内容 |
| --- | --- |
| `manifestVersion`、`hostApi` | manifest 格式版本填写 1。另用 `hostApi` 指定兼容的执行协议版本范围，与工具自身的版本分别管理。 |
| `platforms` | 省略表示支持所有平台，也可列出 `{os: linux, arch: [amd64, arm64]}` 等条目。操作系统可选 `windows`、`macos`、`linux`。省略 `arch` 表示支持该系统的所有架构。 |
| `runtime` | 选择 `python`、`nodejs`、`bash` 或 `powershell`，声明 SemVer 版本范围和 `source: system`。PowerShell 使用 `pwsh`。 |
| `dependencies` | Python 使用 `{manager: pip, file: requirements.txt}`。即使省略依赖声明，uv 也会创建独立的 `.venv`。Node.js 使用 `{manager: npm, file: package.json}`，可选填 `lockfile: package-lock.json`。将声明的文件放在工具包根目录。 |

## 设计参数表单

将跨次运行共用的配置放在顶层 `settings` 中，将本次操作的输入放在对应操作的 `params` 中。两者都以字段名为键，每个字段都需要 `schema`。使用 `required: true` 要求字段必须提供。字段缺失时使用该字段的 `schema.default`；`ui.placeholder` 仅供输入提示。在设置字段上使用 `secret: true` 可以遮蔽界面上的值；保存的设置位于 `.tooldeck/settings.json`。

支持的类型有 string、number、integer、boolean、array、object 和 null。可使用 `enum`、`const`、数值上下限、字符串长度和正则、数组元素类型和数量、元素唯一性，以及对象属性、必填键和布尔型 `additionalProperties` 等约束。宿主会在执行前验证输入值。

### 字段声明参考

| 字段 | 含义 |
| --- | --- |
| `schema` | 必填，定义提交值的 JSON Schema。可使用 `type`、`default`、`const`、`enum`。字符串可用 `minLength`、`maxLength`、`pattern`，数值上下限使用 `minimum`、`maximum`。 |
| `schema.items`、`minItems`、`maxItems`、`uniqueItems` | 定义数组元素、数量和唯一性。对象使用 `properties`、属性名数组 `required` 及 `additionalProperties`。 |
| `required` | 字段级布尔值，默认 false，只检查是否提供。若要求非空字符串或非空数组，还应加 `minLength: 1` 或 `minItems: 1`。显式 null 按 schema 校验。 |
| `secret` | 布尔值，默认 false。配合密码框遮蔽输入值，并提供显示或隐藏按钮。 |
| `ui` | 控制展示，包括 `component`、`label`、`description`（悬停标签时显示）、`placeholder`。选择器还可配置 `mode`、`multiple`、`filters`，下拉框可配置 `options`。 |
| `path` | 指定 `kind: file` 或 `directory`，可选填 `mustExist`（默认 false）。已存在的路径必须符合指定类型。路径数组会逐项校验。 |
| `availableWhen` | 仅用于操作参数，读取同一操作内的其他字段；字段缺失时使用其默认值。 |

### 选择 UI 组件

| 控件 | 适用类型和实际行为 |
| --- | --- |
| `text` | 单行字符串，适合标题、语言代码等。示例文字放在 placeholder，需要预填的值放在 `schema.default`。 |
| `textarea` | 多行字符串，保留输入的文字和换行，适合提示词或备注。 |
| `number` | 数值输入。整数使用 `type: integer`，允许小数使用 `number`。清空后移除该输入值。 |
| `checkbox` | 布尔开关。如果脚本要求未操作时也收到明确的 false，请设置 `default: false`。 |
| `select` | 按 `schema.enum` 的顺序显示选项。`ui.options` 可为枚举 `value` 指定显示用的 `label`，同一个值只可配置一次。脚本收到原始 JSON 类型的值。 |
| `tags` | 字符串数组，元素声明为 `items: {type: string}`。在多行编辑框中输入 JSON 数组，例如 `["draft", "review"]`。 |
| `file` | 单路径字符串，支持手动输入或浏览。`mode: open` 选择输入文件，`save` 打开保存对话框。保存时，若文件名没有扩展名，会补上首个筛选器的首个后缀。 |
| `file` 配合 `multiple: true` | 仅支持 open 模式。再次选择会追加路径、去重并保留选择顺序，列表中的文件可逐个移除。 |
| `directory` | 单个目录路径。可浏览已有目录，也可直接输入绝对路径。要允许尚未创建的输出目录，请设 `mustExist: false` 并由脚本创建。 |
| `password` | 使用字符串 schema，并设置 **`secret: true`** 来遮蔽输入。脚本收到字符串原值。 |
| JSON 编辑框 | 数组或对象省略 component 时，会显示多行 JSON 编辑框；格式错误会在表单中提示。 |

省略 `component` 时，优先根据枚举生成下拉框，其次按类型选择控件：布尔值用开关，整数和数值用数字输入框，数组和对象用 JSON 编辑框，其余使用文本框。

### 文件选择与条件字段

在 `ui` 下按需设置标签、说明和占位文字。可选控件为 `text`、`textarea`、`number`、`checkbox`、`select`、`tags`、`file`、`directory`、`password`。下面三个字段可以直接放在一个操作的 `params` 下：

~~~yaml
sources:
  required: true
  schema: { type: array, items: { type: string }, minItems: 1, uniqueItems: true }
  ui:
    component: file
    mode: open
    multiple: true
    filters: [{ name: Audio, extensions: [mp3, wav] }]
  path: { kind: file, mustExist: true }
mode:
  schema: { type: string, enum: [copy, encode], default: copy }
  ui:
    component: select
    options:
      - { value: encode, label: { en: Re-encode, zh-CN: 重新编码 } }
quality:
  required: true
  availableWhen: { op: eq, key: mode, value: encode }
  schema: { type: integer, minimum: 0, maximum: 51 }
~~~

- 文件和目录选择器返回绝对路径。选择保存位置用 `mode: save`，选择输入用 `mode: open`。多选需要在 open 模式的 file 控件上开启，并将字段声明为字符串数组。后缀筛选填写不带点的扩展名。用 `path.kind` 和 `mustExist` 校验所选路径，由脚本决定如何创建或覆盖产物。
- select 提交原始枚举值，选项标签仅控制显示。操作参数的 `availableWhen` 可读取同一操作的其他参数。隐藏字段按非必填处理；已提供的值仍会经过校验，也可能传入脚本。
- 比较运算支持 `eq`、`not`、`gt`、`gte`、`lt`、`lte`。`{op: 'null', key: x}` 判断字段缺失或为 null，`notNull` 与其相反，`empty` 同时匹配缺失、null 和空字符串。复合条件使用 `{op: and, cond: [...]}` 或 `or`，支持嵌套。

## 响应参数变化

在与 `actions` 同级的 `hooks` 中声明自动执行的入口。用户提交参数变化时，宿主调用匹配的入口；导入确认弹窗会列出这些自动执行项。以下配置来自 [Node.js 示例](../examples/node-example/preview-name.mjs)：

~~~yaml
hooks:
  previewName:
    event: paramsChange
    entry: preview-name.mjs
    paramKeys: [name]
~~~

每个 hook 需要唯一 ID、事件名和相对于包根目录的入口文件。监听参数编辑使用 `paramsChange`。可选的 `paramKeys` 仅用于此事件，宿主在启动进程前按操作参数名过滤。省略时监听所有操作参数；填写时至少指定一个键，各键不能重复，且必须在至少一个操作中声明。修改工具设置不会触发此事件。

- 单行、多行、密码、数字、JSON 和 tags 输入框在离焦时提交。手动输入文件或目录路径也遵循此规则。改完又改回原值，离焦时不会触发。
- 下拉框、复选框、对话框确认选择及多选文件移除会立即提交。取消选择、填充默认值和切换操作不会触发 `paramsChange`。
- Node.js 导出 `main(ctx, event)`，Python 定义 `main(ctx, event)`。Bash 和 PowerShell 从 `TOOLDECK_EVENT` 环境变量读取 JSON 事件，用标准输出和标准错误输出文本。事件包含 `type: "paramsChange"` 和实际变化的参数名数组 `changedKeys`。`ctx.actionId` 标识当前操作，`ctx.params` 包含当前表单值及默认值，其他必填字段此时可能尚未填写。

~~~js
export function main(ctx) {
  ctx.clearOutput();
  if (ctx.params.name) ctx.log(`Name for this greeting: ${ctx.params.name}`);
}
~~~

直接返回时，历史输出保留；再次输出时，内容追加。Python 和 Node.js 的 hook 可调用 `ctx.clearOutput()`，仅清除当前工具、当前操作下该 hook 的输出。再次触发同一个 hook 后，宿主忽略上一次调用迟到的输出和清空请求。hook 需要兼容且已就绪的运行环境，超时为 30 秒。正式操作仍由用户点击运行来启动。

### 操作页生命周期

操作显示时触发 `actionOpen`，离开时触发 `actionClose`。切换操作下拉框、从左侧选择另一个工具，以及离开或返回“操作”标签页，都遵循这条规则。编辑参数或重复选择当前操作不会重复触发生命周期事件。只有已安装且兼容当前平台的工具才执行 hook。如果当前操作仍然可见，安装成功后会触发一次打开事件。

~~~yaml
hooks:
  onOpen: { event: actionOpen, entry: lifecycle.mjs }
  onClose: { event: actionClose, entry: lifecycle.mjs }
~~~

通过 `ctx.actionId` 读取操作 ID，通过 `event.type` 区分事件。这两个事件没有 `changedKeys`，也不能配置 `paramKeys`。关闭事件收到离开前的表单快照，打开事件收到进入时的快照。切换时先调度旧操作的关闭，再调度新操作的打开；页面切换不等待脚本执行完毕。关闭事件的输出归属旧操作，对表单的写回会被忽略。这两个事件用于应用内导航，不保证在退出应用时执行。可参考 [Node.js 生命周期示例](../examples/node-example/lifecycle.mjs)。

### 从 hook 更新当前表单

正式操作也可以调用 `ctx.updateParams(patch)`，例如在操作成功后复位一次性勾选框。操作中可用 `ctx.clearOutput(hookId)` 清除当前操作下指定 hook 的输出。hook 内的 `ctx.clearOutput()` 仍只清除自身的输出。

Python 和 Node.js 的 hook 可以调用 `ctx.updateParams(patch)`。补丁的键必须是当前操作已声明的参数名。一次调用中的修改一起生效，任一字段或值无效时整批拒绝。`ctx.params` 始终是本轮调用开始时的快照。写回会刷新表单并重新计算显隐条件，不会再次触发 `paramsChange`。过期调用不能写回；切换操作时动态修改会重置。

| 属性 | 行为 |
| --- | --- |
| `value` | 设置符合字段 schema 的 JSON 值。只有 schema 允许时才能显式设置 `null`。 |
| `unset: true` | 移除字段值，包括预填的默认值。要清空选择时使用它，不与 `value` 同时提供。 |
| `options` | 用 `{value, label?}` 对象数组替换下拉选项。值必须唯一且满足字段 schema；标签可省略，指定时须为非空字符串。空数组表示没有候选项。 |
| `visible` | 布尔值。只有该标志与 `availableWhen` 都允许时才显示。隐藏字段免于必填检查，已提供的值仍需校验。 |

若选项在运行时才能确定，声明 `ui.component: select` 和基础 schema，例如 `{type: string}`。若同时声明了 `schema.enum`，动态选项只能是它的子集。旧选中值不在新列表中时，须在同一个补丁里选定新值或提供 `unset: true`。正式运行前，宿主会再次按当前选项校验提交值。若显隐完全取决于其他参数的值，优先使用 `availableWhen`。

~~~js
ctx.updateParams({
  sourceFile: {
    options: names.map(value => ({value, label: value})),
    visible: names.length > 0,
    ...(names.length ? {value: names[0]} : {unset: true}),
  },
});
~~~

可在 [Node.js 示例 manifest](../examples/node-example/manifest.yaml) 中选择 **Inspect a folder**。[目录 hook](../examples/node-example/list-files.mjs) 会在切换目录时尽量保留同名文件，否则选中第一个文件；目录为空时清空选中值并隐藏下拉框。

## 执行操作并返回结果

每个操作都会在工具目录中启动独立进程。可通过操作的 `execution.timeoutSeconds` 设置超时秒数，零或省略表示工具未指定超时。脚本从宿主接收输入，完成后退出。未捕获的异常或非零退出码会使运行失败。

**Python 与 Node.js。** Python 定义 `main(ctx)`，Node.js 导出 `main(ctx)`，两者均支持异步函数。读取 `ctx.params`、`ctx.settings` 和 `ctx.locale` 获取参数、设置和显示语言。运行信息包括 `apiVersion`、`runId`、`actionId`、`toolId`、`toolVersion`。用 `ctx.paths.tool` 查找包内文件，`ctx.paths.data` 保存持久状态，`ctx.paths.temp` 存放本次运行的临时文件。用户产物的保存位置应从操作参数获取。

~~~python
ctx.log("Processing")
ctx.progress({"value": 1, "total": 2})
ctx.table({"columns": [{"key": "name"}], "rows": [{"name": "Ada"}]})
ctx.link({"kind": "directory", "target": ctx.paths.data})
~~~

用 `ctx.output(value)` 输出 JSON 结果。`ctx.log(message, level)` 默认级别为 info，也可选 debug、warning、error。进度可以只提供消息，或给出有限数值和正的总量，当前值必须在零和总量之间。表格包含唯一列键、可选标签和行对象。链接支持绝对路径的文件或目录，以及 HTTP(S) 网址，可附显示标签。点击文件链接会在目录中定位文件。普通 stdout/stderr 会显示为文本日志。ToolDeck 会保存运行记录，避免将密钥写入输出。

### 可折叠输出

Python 和 Node.js 可通过 `ctx.details({id, title, text})` 向默认收起的区域追加纯文本。每次运行中，相同 ID 的片段按原样连续拼接，中间不会插入时间戳或分隔符。需要换行时，在 `text` 中传入换行符；要显示另一个区域，请使用不同的 ID。

~~~python
ctx.details({"id": "diagnostics", "title": "Diagnostics", "text": "Checking "})
ctx.details({"id": "diagnostics", "title": "Diagnostics", "text": "files…\n"})
~~~

### 用 `ctx.table` 输出表格

一次操作产生多条同类结果时（例如一批文件及其大小），可将它们放进一张表。每次调用都会在结果区追加一张独立表格。Python 和 Node.js 使用相同的 JSON 数据结构。

| 成员 | 格式与展示规则 |
| --- | --- |
| `columns` | 非空数组，顺序即展示顺序。每列必须有唯一、非空的字符串 `key`，可选字符串 `label`。省略标签时显示键名。 |
| `rows` | 行对象数组，按数组顺序展示。空数组只显示表头。每个单元格按列键取值，行中额外的属性不展示。 |
| 单元格 | 缺失或 null 显示为空白。字符串、有限数值和布尔值按文本展示。数组及普通对象显示为 JSON。所有数据都必须能序列化为 JSON。 |
| 可点击单元格 | 使用对象，`kind` 填 `file` 或 `directory`，`target` 填绝对路径，`label` 可省略。点击可定位文件或打开目录，未指定标签时显示路径。网页链接使用单独的 `ctx.link`。 |

~~~python
from pathlib import Path

def main(ctx):
    folder = Path(ctx.paths.data)
    report = folder / "report.txt"
    report.write_text("Done\n", encoding="utf-8")
    ctx.table({
        "columns": [
            {"key": "artifact", "label": "Artifact"},
            {"key": "bytes", "label": "Bytes"},
        ],
        "rows": [
            {"artifact": {"kind": "file", "target": str(report), "label": report.name},
             "bytes": report.stat().st_size},
            {"artifact": {"kind": "directory", "target": str(folder), "label": "Folder"}},
        ],
    })
~~~

这个例子会生成两行可点击的结果。目录行没有提供 `bytes`，因此大小一栏留空。相同写法的 JavaScript 入口见 [Node.js 表格示例](../examples/node-example/table.mjs)。如需翻译列标题和链接标签，请在调用 `ctx.table` 前根据 `ctx.locale` 选择文字。

### Shell 脚本

**Bash 与 PowerShell。** 从环境变量读取 `TOOLDECK_LOCALE`、`TOOLDECK_PARAM_<KEY>` 和 `TOOLDECK_SETTING_<KEY>`。字段名直接转为大写，保留已有下划线。命名时应确保转换后仍唯一。字符串按原文传递，布尔值为 `true` 或 `false`，数值使用 JSON 数字格式，数组、对象和 null 使用紧凑 JSON。缺失的字段没有对应变量。在 Bash 中用引号包住变量展开，在 PowerShell 中用 `$env:NAME` 读取，布尔值显式比较。普通输出写入 stdout，诊断信息写入 stderr。宿主还提供 `TOOLDECK_TOOL_DIR`、`TOOLDECK_DATA_DIR`、`TOOLDECK_TEMP_DIR`、`TOOLDECK_RUN_ID`、`TOOLDECK_ACTION_ID`、`TOOLDECK_TOOL_ID`、`TOOLDECK_TOOL_VERSION` 和 `TOOLDECK_API_VERSION`。

## 提供双语内容并验证工具包

[Python 示例](../examples/python-example/manifest.yaml)和 [Bash 示例](../examples/bash-example/manifest.yaml)演示多语言写法：字段标签使用语言映射，文档分别提供英文和简体中文版，脚本也会根据应用语言选择输出文字。[Node.js 示例](../examples/node-example/manifest.yaml)和 [PowerShell 示例](../examples/pws-example/manifest.yaml)演示单语言写法：直接填写英文字符串，在两种应用语言下都显示相同的英文。

工具和操作的名称、描述，以及字段标签、说明、占位文字和选项标签都支持纯文本或语言映射。映射会先查找当前语言，再查英文。两者都缺失时，工具和操作名称使用 ID，字段标签使用字段名，选项标签使用枚举值；说明和占位文字留空。

同一篇 Markdown 文档的多个译本共用 ID，各自指定语言和文件。宿主依次选择当前语言、英文、未指定语言的通用文档。需要可点击的引用时，请使用显式 Markdown 链接。

~~~yaml
docs:
  - { id: guide, locale: en, title: User guide, path: README.md }
  - { id: guide, locale: zh-CN, title: 使用说明, path: README.zh.md }
~~~

发布前，将 ZIP 导入 ToolDeck，安装环境并逐个运行操作。验证遗漏必填项时的提示、两种显示语言和实际产物位置。发布更新时，在旧版本上导入更高版本验证升级流程。[应用使用说明](user-guide.zh-CN.md)介绍了导入和升级的具体步骤。
