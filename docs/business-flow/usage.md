# Business Flow skill

模型无关的代码库业务数据流程分析 skill。入口是 `skills/business-flow/SKILL.md`，整个目录可独立复制；不依赖现有 CodeScope 服务、React、SQLite 或模型 API。

## 调用

支持 SKILL.md 的宿主可将整个 `business-flow` 目录安装到其技能发现目录，重新加载后调用 `business-flow`。各宿主的安装路径不同，此处不假定统一目录。当前版本保存在本仓库，未安装到全局技能目录。

也可以直接把下面的指令交给有文件读取、检索和命令执行能力的大模型代理：

```text
请读取 <codescope-path>/skills/business-flow/SKILL.md，
按照该 skill 分析我当前所在的代码库。
优先分析一条核心业务数据流程，根据项目文档和代码注释决定报告语言，生成 JSON 和可离线打开的 HTML。
每条关系附源码证据；推测关系单独标记，不要虚构连接。
```

换机器时修改 skill 的绝对路径。纯聊天模型需要宿主提供源码和命令执行能力；skill 文件本身不是远程 API，也不会自动连接其他模型。

## 直接查看示例

打开 [订单业务图](order-service.html)。核心节点是“创建订单”“订单存储”“处理支付”。点击创建订单展开校验、计价和库存预占；点击处理支付展开支付记录与状态更新。再次点击当前节点或“收起展开”返回核心节点。

勾选 **“包含业务逻辑校验”** 可切换到详细数据流：SKU 真值、数量/单价拒绝条件、库存充足、订单存在、金额匹配，以及更新状态前再次查订单，共 7 项规则；另含总额计算、错误结果和 paid 状态写入。点击规则查看表达式、通过/拒绝行为与代码证据。绿色分支表示通过，红色表示拒绝；实线是数据流，点线是执行顺序/条件。关闭开关回到业务总览，规则节点焦点会返回所属业务。

支持上下游方向、一层/两层深度、隐藏节点搜索、推测关系开关、节点拖动、平移、缩放和证据侧栏。默认深色布局。展开时按上下游分列，按节点圆形与文字标签共同占位避让；保留选中节点和不冲突的旧节点位置，空间不足时扩展画布，不再挤压到屏幕边缘。拖动松手后重新避让。自动取景保持可读缩放，较大流程可平移查看，或点击“适应全图”查看全貌。Tab + Enter/空格可以选择节点。总览只显示 `core` 节点；可见关系来自模型生成并校验后的 JSON，点击时不再请求模型。

示例依据 `examples/order-service` 实际源码，明确标注内存存储、空路由实现和未连接支付服务。它用于演示静态分析，不代表真实交易执行。

## 报告语言

默认由调用 skill 的模型同时读取项目文档与业务代码注释/docstring 来判断语言，不按聊天语言、英文变量名或程序字符串推断。文档和注释一致时采用该语言；一方缺少有效内容时依据另一方并记录原因；实质性冲突且无法判定主语言时先询问用户。用户明确指定输出语言时优先遵循。没有有效证据时的回退须显式记录，不能假称来自项目。

流程图标题、节点/连线说明、详细规则、影响分析、建议测试，以及 HTML 按钮、图例、状态和无障碍标签统一使用所选语言。标识符、路径、公式和需精确保留的源码表达式保持原样。图数据的 `language` 字段记录语言代码、选择方式、原因与证据，报告侧栏显示判断依据。

模板内置英文与简体中文；其他语言由调用模型根据 `assets/locales.json` 的键和占位符提供完整 `ui` 翻译。渲染器只校验和使用结果，不自动识别项目语言，也不自动翻译业务内容。旧报告缺少语言字段时仅为兼容保留中文 UI；新分析必须写入语言决策。

## 变更需求与影响分析

对调用 skill 的大模型输入需求，例如：

```text
使用 business-flow 分析：订单数量必须为正整数，拒绝小数，金额计算公式保持不变。
先不要修改代码。红色高亮直接修改点和间接受影响的业务流程，
展示具体校验规则、影响原因、传播路径、源码证据与建议回归检查。
```

查看 [数量校验影响示例](order-impact.html)。红色实框表示直接影响，红色虚框表示间接影响；总览中的业务节点会汇总其子规则影响。“定位影响流程”启用详细层并展开受影响节点；“红色标记变更影响”可开关标记。只有逐条分析过的关系才标红；未标红不等于已证明没有影响。

代码已经修改时，可输入“分析 `<base-commit>` 到当前工作区的实际修改对业务流程的影响”。模型需要先读取 diff、当前源码和上下游证据，重新校验图谱，再输出 `diff` 模式的单独报告，并记录比较基线。删除、重命名和无法映射的改动须在分析边界里说明。单纯命中文件或图可达不能证明业务受到影响。

需求预估与代码差异分析会明确标记；报告里的回归检查是建议，不代表已经运行。离线 HTML 不运行模型：需求通过宿主大模型输入，由该模型执行 skill 后生成报告。本次演示是依据实际示例源码进行的需求预估，未修改订单示例；diff 模式的契约和展示通过测试，但未做真实修改后的模型端到端验收。

```sh
python3 skills/business-flow/scripts/flow.py render docs/business-flow/order-impact.json --repo examples/order-service --out docs/business-flow/order-impact.html
```

## 运行与验证

skill 运行仅需 Python 3.10+；HTML 使用现代浏览器打开，无外部依赖，无 CDN 和网络请求。以下命令从仓库根目录执行：

```sh
python3 skills/business-flow/scripts/flow.py inventory --repo examples/order-service
python3 skills/business-flow/scripts/flow.py validate docs/business-flow/order-service.json --repo examples/order-service
python3 skills/business-flow/scripts/flow.py render docs/business-flow/order-service.json --repo examples/order-service --out docs/business-flow/order-service.html
python3 skills/business-flow/scripts/flow.py validate docs/business-flow/order-service.snapshot.json --repo examples/order-service
```

生成器同时写入 `.snapshot.json`，记录所有引用文件的 SHA-256。用 snapshot 重新验证可发现源文件变化；HTML 不会自动读取当前源码。重新分析后再生成报告。验证通过不代表模型的业务解释一定正确。

开发验证（JS 测试需 Node.js 22+，运行 skill 不需要 Node.js）：

```sh
python3 -m unittest discover -s tests/business-flow -p 'test_*.py' -v
node --test tests/business-flow/viewer.test.mjs
```

也可使用 `npm run test:skill`。格式检查：`npm run format:skill:check`（使用现有项目开发依赖）。

## 已验证边界

2026-10-26：13 项 Python 测试及 13 项模拟 DOM 测试通过；skill-creator 格式校验通过；订单示例的引用校验、HTML 与快照生成通过。覆盖非法端点、重复 ID、证据缺失/越界、路径逃逸、符号链接、源码变更、嵌入脚本转义、失败保留旧 HTML，以及节点探索、方向/深度、推测开关、搜索、拖动与复位逻辑，以及详细模式切换、规则分支完整性、父业务归属、校验条件侧栏和隐藏汇总捷径。示例现含 20 个节点、34 条分视图关系。新增几何检查覆盖反复展开、160 个长名称节点，以及拖动重叠后的避让；这些检查仍不等于真实字体渲染验收。

当前环境浏览器工具返回空浏览器列表，未完成真实浏览器视觉验收；模拟 DOM 不证明布局、动画或真实输入事件效果。未实际运行 Claude、Gemini 等其他模型宿主，跨模型兼容性来自无专用 API 的文件协议与标准命令接口，而非已完成的跨宿主实测。

影响分析补充验证（2026-10-27）：检查直接/间接分类、传播路径端点与连续性、影响证据的源码指纹、diff 基线元数据、总览父节点汇总、标记开关和详细流程定位。仍未完成真实浏览器视觉验收或其他模型宿主调用验收。

语言补充验证（2026-10-27）：英文 HTML 的 lang、静态控件与动态消息、中英文规则/影响侧栏、第三语言完整文案与占位符校验、语言依据引用检查通过。这些测试验证模板和数据契约，不证明任意模型对混合语言项目的判断质量。
