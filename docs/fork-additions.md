# Fork 新增内容速查（给智能体读）

> 基线：上游 `awdr74100/figwright` 的 `964a32d`（0.7.0，135 个工具）。本 fork 现为 0.8.0，共 168 个工具定义（README 里的工具数以代码为准）。
> 本文按「能做什么」组织，不按提交顺序。要核对细节，读对应的 `packages/mcp/src/tools/<名字>.ts`（描述文字就是工具契约）和 `packages/plugin/src/handlers/<名字>.ts`（实现）。
> 构建、同步、版本钉住的环境问题见 [AGENTS.md](../AGENTS.md)；本文不重复。

## 1. 先记住的几条通用约定

- **写工具默认谨慎**：`rebind_variables`、`bind_variables_by_value`、`flatten_stage`、`relayout_frames` 等批量写工具都有 `dryRun` / `fix` 开关，**先预览再落盘**；跳过带样式的节点和实例继承字段。
- **不可批量（not batchable）**的工具：`save_version`、`reset_slot`、`set_aspect_ratio_lock`、`reorder_grid_tracks`、布局三件套、`rebind_variables` 等。它们的副作用无法按 id 回滚，不要放进 `batch`。
- **读取性能**：大文件上先 `load_page` 再读；`search_nodes` / `scan_*` 用 `brief:true` 和 `limit` 避免序列化 552KB 的全量结果；`get_instance_mains`、`get_component_instances`、`get_style_consumers` 用来替代整页遍历。
- **非当前标签页会被 Figma 限速**（调用卡 10 秒报 `Unable to establish connection`）：用 `focus_file`（仅 Windows）切前台，或让用户手动切。
- **库的限制**：库里的变量集合（远程集合）不会出现在 `get_variable_defs` 里，只出现在 `list_team_library`。库必须在文件的 Assets → Libraries 里由用户启用，插件 API 不能启用。

## 2. 新增工具（33 个）

### 2.1 组件与实例

| 工具                      | 作用                                      | 要点                                                                                                                                     |
| ------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `set_exposed_instance`    | 暴露 / 取消暴露组件内的嵌套实例属性       | 只能用于本地组件里的 primary 实例；前提是该实例有暴露的嵌套实例或子层绑了组件属性；读取结果多了 `isExposedInstance` / `exposedInstances` |
| `create_slot`             | 在主组件里创建原生 Slot，同时建 SLOT 属性 | 传变体 COMPONENT，不是 COMPONENT_SET；返回 `nodeId`、`componentId`、`propertyId`；实例里往 slot 里加子节点                               |
| `reset_slot`              | 把实例里的 slot 恢复为主组件内容          | 自定义子节点会删且无法恢复，不可批量                                                                                                     |
| `reset_overrides`         | 清掉实例的全部直接覆盖                    | `recursive` 同时重置嵌套实例；会丢换件与 slot 内容，破坏性                                                                               |
| `update_component`        | 改组件 / 组件集的描述与文档链接           | `description` 和 `descriptionMarkdown` 二选一；文档链接最多几条（见源码）                                                                |
| `get_component_instances` | 反查某组件（或组件集全部变体）的所有实例  | 含嵌套在别的实例里的；返回所在页和父路径；`limit` 默认 1000                                                                              |
| `get_instance_mains`      | 把实例映射到主组件，不序列化节点          | 并发解析；`scope: topLevel                                                                                                               | all`、`nameContains`、`includeTimings`；`root` 省略为当前页 |
| `get_style_consumers`     | 反查某样式被哪些节点使用                  | 返回节点 id、应用的字段、页与父路径；`limit` 默认 1000                                                                                   |

### 2.2 变量与库

| 工具                                      | 作用                                            | 要点                                                                                                                                |
| ----------------------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `scan_variable_bindings`                  | 只读扫描变量绑定                                | `variableIds` / `collectionIds` 交集过滤；`sampleLimit` 默认 3；远程变量过不了集合过滤                                              |
| `rebind_variables`                        | 在子树内批量把变量 A 换成变量 B                 | **`dryRun` 默认 true**；`mapping:[{from,to}]`；`includeOrphanMains` 同时处理已被删除的变体主组件，让下游实例不再继承旧绑定          |
| `bind_variables_by_value`                 | 把未绑定的纯色 / 数值字段按「等值」绑到候选变量 | 先校验所有候选和别名链再写；`modeId` 省略用各集合默认模式                                                                           |
| `update_variable`                         | 原地改变量的元数据                              | `description`、`scopes`（`["ALL_SCOPES"]` 重置）、`hiddenFromPublishing`                                                            |
| `get_publish_status`                      | 读发布状态（不能发布）                          | `CHANGED` = 有未发布改动，需用户在 Figma 界面重新发布；`kind` 默认 `VARIABLE_COLLECTION`，也可 `COMPONENT` 等；远程对象被跳过并计数 |
| `list_team_library`                       | 列出当前文件已启用的库里的变量集合              | 返回 `name` / `key` / `libraryName`；`collectionKey` 列该集合的变量；用户没启用的库不会出现                                         |
| `set_node_variable_mode`（扩展，见 §3.4） | 给节点切模式                                    | 现在也接受库集合                                                                                                                    |

### 2.3 样式与页面

| 工具                                          | 作用                                                 | 要点                                                                                     |
| --------------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `reorder_styles` / `reorder_style_folders`    | 调整本地样式 / 样式文件夹顺序                        | `kind` = PAINT / TEXT / EFFECT / GRID / CUSTOM_ANIMATION；传完整文件夹路径，不是 id      |
| `set_page_props`                              | 设页面画布背景（只支持 SOLID）和排序                 | `index` 在页面列表范围内                                                                 |
| `add_page` 的 `divider`（扩展）               | 建分隔页                                             | 分隔页名称提前校验，否则 Figma 会悄悄建成普通页                                          |
| `get_plugin_data` / `set_plugin_data`         | 读写节点、样式、变量、集合上的插件数据               | 私有数据按插件 id 隔离；共享命名空间至少 3 个字母数字；`search_nodes` 可按 pluginData 查 |
| `save_version`                                | 保存命名版本历史                                     | 等 1 秒收尾改动，不保证包含此前所有编辑；不可批量                                        |
| `get_export_settings` / `set_export_settings` | 读 / 替换节点的导出预设                              | `[]` 清空；PNG/JPG 带 constraint，SVG 带 `svgOutlineText` 等，PDF 只支持通用项           |
| `export_node_data`                            | 用 `exportAsync` 导出 `SVG_STRING` 或 `JSON_REST_V1` | 有大小预算；JSON 是 REST 形状，用于和 REST API 对照，不是 Figwright 序列化               |
| `set_aspect_ratio_lock`                       | 锁定 / 解锁宽高比                                    | 自动尺寸文本不支持；不可批量                                                             |

### 2.4 Grid 布局

| 工具                      | 作用                                                                                                                              | 要点                                                                         |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `set_grid_child`          | 放置 / 对齐 GRID 自动布局的子项                                                                                                   | `rowAnchorIndex` + `columnAnchorIndex` 成对给；`rowSpan` / `columnSpan` 跨轨 |
| `reorder_grid_tracks`     | 整行 / 整列移动并带着子项                                                                                                         | `axis` = ROWS / COLUMNS，`fromIndices`；跨多轨的子项会连带拖动，不可批量     |
| `set_auto_layout`（扩展） | 可设 `gridRowSizes` / `gridColumnSizes`（FIXED / FLEX / HUG）、`gridItemsPositioning`（MANUAL / ROW_AUTO_FLOW）、`gridAutoTracks` | FLEX 轨道不能放在 HUG 的轴上                                                 |
| `reparent_nodes`（扩展）  | GRID 父级可传 `rowAnchorIndex` / `columnAnchorIndex` 直接落格                                                                     |                                                                              |

### 2.5 布局整理（三件套，插件内计算，不序列化子树）

| 工具              | 作用                                           | 要点                                                                                                                                                               |
| ----------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `audit_layout`    | 体检页或 frame                                 | 报 CLIP / OVERFLOW / BLANK / SPARSE / AL_BLANK / AL_CLIP / CROP / MASK_SHORT / WIDE_NOTE / TEXT_CLIP / OVERLAP；`fix:true` 修最内层；跳过隐藏子树和实例 / 组件内部 |
| `relayout_frames` | 用 MaxRects 装箱排布直接子 frame / 组件 / 实例 | 四种插入顺序 × smart 开关，不旋转；`mode: children                                                                                                                 | hierarchy`，`hierarchy` 由内向外并自动跑两遍刷新 HUG 尺寸；`gap` 默认 96，`padding` 默认 48 |
| `flatten_stage`   | 把命名壳里的碎片拍平进舞台 frame 后装箱        | `fix` 默认 false（只预览）；空壳隐藏而不删除，便于回滚                                                                                                             |

### 2.6 导航、性能与连接

| 工具             | 作用                                  | 要点                                                                                                                                                                           |
| ---------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `list_children`  | 只读某节点的直接子节点（含页）        | 不序列化子树；`types` 过滤；最多返回 5000 个                                                                                                                                   |
| `load_page`      | 预加载页面并计时                      | 逐页加载，100 秒预算后停止并报告剩余；`all:true` 逐页加载                                                                                                                      |
| `get_perf_stats` | 诊断慢读                              | 默认关，`enabled:true` 开始记录；字段有 `dispatchOverheadMs`、`serverCalls`（带 requestId，需新构建的插件与 leader）、`exposureMs/exposureCalls`；插件重启即清空               |
| `focus_file`     | 把某个文件标签页和 Figma 窗口切到前台 | 仅 Windows，会抢键盘焦点；`fileKey` 取自 `figma.com/design/<fileKey>/…`；也可在 `~/.figwright/files.json` 写 `{"文件名":"fileKey"}`；依赖 manifest 的 `enablePrivatePluginApi` |

## 3. 已有工具新增的能力

### 3.1 读取

- `search_nodes`：`brief`（只返 id / name / type / parentId / visible，约快 8 倍）、`limit`（达到数量停止并报 `truncated`）、`pluginData` 条件。
- `scan_nodes_by_types`、`scan_text_nodes`：同样支持 `brief` / `limit`；`get_selection` 支持 `brief`。
- 序列化结果新增：`isExposedInstance`、`exposedInstances`、文本的 `listSpacing` / 下划线细节 / `textWrapStyle` / `leadingTrim`、Slot 属性、`gridChild`、`scalingFactor`。
- `get_screenshot` / `save_screenshots`：`constraint`（SCALE / WIDTH / HEIGHT）、`suffix`、SVG 的 `svgOutlineText` / `svgIdAttribute` / `svgSimplifyStroke`、`colorProfile`、`contentsOnly`、`useAbsoluteBounds`。

### 3.2 写入

- 文本样式（`create_text_style` / `update_text_style`）：支持 `textCase`、`leadingTrim` 等；带大小写转换的文字现在可以绑样式（上游参数面不支持）。
- 效果：渐进模糊、三种噪点、纹理、玻璃，样式里同样可用。
- 填充：`set_fills` 支持 `VIDEO`（已有 hash）和 `SHADER`（已导入 id）；图片填充支持 `filters`、`imageTransform`、`rotation`、`scalingFactor`、paint 级 `blendMode`。
- `set_layout_props`：`overflowDirection`、`numberOfFixedChildren`。
- `batch`：失败那一步本身也会被回滚；创建类操作缓存父节点捕获，避免二次方退化（50 次创建 27 秒降到秒级）；GRID 的 FLEX / HUG 冲突在写之前检查。

### 3.3 连接与会话

- MCP 服务端在插件断线重连后**自动重新绑定**已 `use_file` 的文件，并短暂等待；后台标签页给出提示。
- 插件版本与服务端版本不一致时，每次调用都会带版本偏差提示（`MIN_PLUGIN_VERSION` 已提到 0.8.0）。
- 插件 manifest 声明了 `teamlibrary` 权限（`list_team_library`、`get_publish_status` 需要）和 `enablePrivatePluginApi`（`focus_file` 取文件 key）。

### 3.4 `set_node_variable_mode` 支持库里的集合（本分支新增）

- `collectionId` 现在除了本地集合 id，还能传：库集合 key（`list_team_library` 返回的 `key`，带不带 `VariableCollectionId:` 前缀均可）或 `库名/集合名`（如 `widgets/Color`）。
- `modeId` 除了模式 id，还能写**模式名**（如 `Dark`）；库集合的模式 id 没有地方可查，所以按名字对。
- 实现：集合在本地找不到时，经 `teamLibrary` 找到该集合，导入它的第一个变量，再从变量的 `variableCollectionId` 取到远程集合并设置模式；导入是幂等的。
- 典型用法：页面文件里放了来自 widgets 库的框架实例，要出暗色版时：`set_node_variable_mode({ nodeId, collectionId: "widgets/Color", modeId: "Dark" })`。
- 前提：该库已在当前文件里启用（`list_team_library` 能看到）。

## 4. 已知限制与踩坑

- `getVariableByIdAsync` 在本地变量上会卡约 10 秒并报连接错误：变量相关工具一律先用 `getLocalVariablesAsync` 建解析表，远程变量才回退按 id。
- 本地变量与库变量是**两套对象**：同一份变量在页面文件本地有一份、库里有一份，key 不同，亮暗模式开关互不相通。判断某个节点用的是哪套，看它绑定的变量 id 是否带 `/`（远程 id 形如 `VariableID:<key>/…`）。
- 嵌套实例里的文字属性不能提升为外层属性；要改字，选中内层实例。
- 在实例里只有真正的 Slot 才能放入子节点；普通 frame 放不进去。
- `get_component_api` 对实例返回的是主组件的属性定义。
- Starter 计划的限制（变量集合只能 1 个模式等）按文件所在团队判定。
- 不要杀 node 进程来重启：figwright 服务端和 Claude Code 的 MCP 都是 node，误杀会断线；改完代码要重启 Claude Code，并在 Figma 里重新运行插件（插件代码只在启动时读取）。

## 5. 提交分组（相对上游 `964a32d`，22 个）

| 主题                                                                                                                               | 提交                                                                                                                    |
| ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 暴露实例                                                                                                                           | `bcd1746`、`6e848bb`、`7590416`（合并）                                                                                 |
| 第 1–3 批缺口（Grid 写入、文本 / 变量元数据、反查、Slot、效果、导出、版本）                                                        | `2d3c2a4`、`570ffe3`                                                                                                    |
| 0.8.0 与性能（`get_perf_stats`、`load_page`、brief / limit、`export_node_data`、批量创建缓存）                                     | `d2c7070`、`2507a37`、`a97aaac`、`4ba88cd`、`267e507`（修 `4ba88cd` 的语法错误，`4ba88cd` 本身不可单独使用）、`597996a` |
| 变量重绑与库（`scan_variable_bindings`、`rebind_variables`、`bind_variables_by_value`、`get_publish_status`、`list_team_library`） | `f258470`、`c1e0509`、`e9e1627`、`ce26446`、`2ddb89e`                                                                   |
| 连接与导航（重新绑定、`get_instance_mains`、`list_children`、`focus_file`）                                                        | `223337a`、`e6e58c7`、`f5aecf7`、`69b7a92`                                                                              |
| 布局整理三件套                                                                                                                     | `daabc17`                                                                                                               |
| 发布流程（Release 附安装 zip，不再发 npm）                                                                                         | `1a3d4aa`                                                                                                               |
| 库集合切模式                                                                                                                       | 本分支 `feat/remote-variable-mode`                                                                                      |

## 6. 怎么验证改动

```bash
export npm_config_manage_package_manager_versions=false npm_config_engine_strict=false
cd packages/shared && npx tsc --noEmit
cd ../mcp    && npx tsc --noEmit && npx tsdown
cd ../plugin && npx vue-tsc --noEmit -p tsconfig.json && npx vite build -c vite.config.main.ts && npx vite build
cd ../.. && pnpm lint && pnpm format:check && pnpm knip && pnpm test
```

本机 `pnpm knip` 会因 `Array buffer allocation failed` 崩溃，用 `KNIP_DISABLE_RAW_TRANSFER=1 pnpm knip`。已知基线失败：`get-motion-context.test.ts` 的 "wide tree" 用例在慢机器上 5 秒超时。
