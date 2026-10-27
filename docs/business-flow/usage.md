# Business Flow skill

模型无关的代码库业务数据流程分析 skill。入口是 `skills/business-flow/SKILL.md`，整个目录可独立复制；不依赖现有 CodeScope 服务、React、SQLite 或模型 API。

## 调用

支持 SKILL.md 的宿主可将整个 `business-flow` 目录安装到其技能发现目录，重新加载后调用 `business-flow`。各宿主的安装路径不同，此处不假定统一目录。当前版本保存在本仓库，未安装到全局技能目录。

也可以直接把下面的指令交给有文件读取、检索和命令执行能力的大模型代理：

```text
请读取 <codescope-path>/skills/business-flow/SKILL.md，
按照该 skill 分析我当前所在的代码库。
优先分析一条核心业务数据流程，用中文解释，生成 JSON 和可离线打开的 HTML。
每条关系附源码证据；推测关系单独标记，不要虚构连接。
```

换机器时修改 skill 的绝对路径。纯聊天模型需要宿主提供源码和命令执行能力；skill 文件本身不是远程 API，也不会自动连接其他模型。

## 直接查看示例

打开 [订单业务图](order-service.html)。核心节点是“创建订单”“订单存储”“处理支付”。点击创建订单展开校验、计价和库存预占；点击处理支付展开支付记录与状态更新。再次点击当前节点或“收起展开”返回核心节点。

勾选 **“包含业务逻辑校验”** 可切换到详细数据流：SKU 真值、数量/单价拒绝条件、库存充足、订单存在、金额匹配，以及更新状态前再次查订单，共 7 项规则；另含总额计算、错误结果和 paid 状态写入。点击规则查看表达式、通过/拒绝行为与代码证据。绿色分支表示通过，红色表示拒绝；实线是数据流，点线是执行顺序/条件。关闭开关回到业务总览，规则节点焦点会返回所属业务。

支持上下游方向、一层/两层深度、隐藏节点搜索、推测关系开关、节点拖动、平移、缩放和证据侧栏。默认深色布局。展开时按上下游分列，按节点圆形与文字标签共同占位避让；保留选中节点和不冲突的旧节点位置，空间不足时扩展画布，不再挤压到屏幕边缘。拖动松手后重新避让。自动取景保持可读缩放，较大流程可平移查看，或点击“适应全图”查看全貌。Tab + Enter/空格可以选择节点。总览只显示 `core` 节点；可见关系来自模型生成并校验后的 JSON，点击时不再请求模型。

示例依据 `examples/order-service` 实际源码，明确标注内存存储、空路由实现和未连接支付服务。它用于演示静态分析，不代表真实交易执行。

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

2026-10-26：9 项 Python 测试及 10 项模拟 DOM 测试通过；skill-creator 格式校验通过；订单示例的引用校验、HTML 与快照生成通过。覆盖非法端点、重复 ID、证据缺失/越界、路径逃逸、符号链接、源码变更、嵌入脚本转义、失败保留旧 HTML，以及节点探索、方向/深度、推测开关、搜索、拖动与复位逻辑，以及详细模式切换、规则分支完整性、父业务归属、校验条件侧栏和隐藏汇总捷径。示例现含 20 个节点、34 条分视图关系。新增几何检查覆盖反复展开、160 个长名称节点，以及拖动重叠后的避让；这些检查仍不等于真实字体渲染验收。

当前环境浏览器工具返回空浏览器列表，未完成真实浏览器视觉验收；模拟 DOM 不证明布局、动画或真实输入事件效果。未实际运行 Claude、Gemini 等其他模型宿主，跨模型兼容性来自无专用 API 的文件协议与标准命令接口，而非已完成的跨宿主实测。
