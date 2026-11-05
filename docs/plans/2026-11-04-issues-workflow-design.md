# Issue 集成与 Tomato 开发流程设计

状态：交互设计已确认，尚未实施。本文是未来行为的设计，不代表当前已支持这些能力。

## 目标与范围

Issue 正文和 comments 是团队的持久交接记录，而不是 Agent 聊天备份。换人、换机器后，应能仅通过 Issue 及其中的 commit/MR 引用理解目标、决策、进度和后续工作，并开启新会话接续开发。原始 pi 会话仍由 pi 管理，不导出完整聊天、内部推理、工具原始输出或凭据。

首期支持 GitLab CE 免费版全流程，使用个人 access token，每个本地项目绑定一个 GitLab 项目。首期不支持多人共享同一个宿主。Git push 复用本机 Git 凭据，API token 不注入仓库 URL、Agent 提示或浏览器共享状态。

模块命名为 `issues`，而非 `tomato`。Tomato 是其上的开发流程；未来 GitHub Issues 复用同一入口、交接记录模型和会话编排。首期不实现 GitHub 适配器。

## 架构与边界

采用独立 Issue 模块加窄宿主接缝：

- Web 通过 `packages/contracts` 的类型化、版本化协议获取摘要和触发操作，不导入 server/shared/pi。Token 仅短暂存在表单局部输入，提交前清空，不进入共享状态或持久化。面板保持布局无关，由 shell 放置。
- 宿主内 Issue 模块负责项目绑定、GitLab API、同步、验收核验及操作恢复；通过显式服务接口复用会话、workspace 和 Git 能力，不另建 Agent runtime。
- GitLab 特有的 IID、角色、API 和 MR 语义留在内部适配层。公共模型使用带 provider、实例、项目和工单标识的 Issue 引用；MR/PR 引用保留 provider 身份，不把相同数字当作同一个工单。
- Agent 在现有 pi 内使用现有 workflow 与 Tomato 阶段 skill，提交设计和执行产物；宿主校验批准和前置条件后执行受控副作用。skill 不得替代人工验收或最终合并授权。
- GitLab 是正文、评论、标签、MR 和 CI 的事实来源；本地仅保存会话/worktree 关联和恢复所需记录，不另建独立工单数据库。远端记录须足够支持新机器接手，不要求拥有原机器的会话 ID。

现有扩展 descriptor 尚不支持面板、设置和 wire 贡献；因此不把完整功能伪装成现成可插拔扩展，也不为首期建设通用插件平台。保持现有 GitHub PR 模块职责不变。实施时需先更新扩展、workspace、wire、shell 等实际受影响的 owning specs；本文不提前改写当前生效契约。

被放弃的方案：通用扩展 API 扩容会显著扩大首期范围；外部服务增加部署、认证和断线恢复成本。

### ThinkRail 主线合并约束

目标是把同步上游时需要人工处理的冲突限制在已知接线点，不承诺零冲突。实施时记录实际接线文件及其必要性；超出下列清单的宿主改动须说明理由：

| 宿主接线点 | 必要职责 |
| --- | --- |
| Web shell 和布局注册 | 将 Issues 面板放入右侧工具栏，沿用现有布局生命周期。 |
| Contracts 与宿主路由 | 注册、校验类型化请求，将调用转发给 Issue 模块。 |
| 项目设置入口 | 接入项目绑定与连接配置；Token 存入宿主系统凭据库，重启后恢复，断开时删除。 |
| 会话与 workspace 服务适配 | 启动或恢复现有会话；调用宿主能力创建和注册 worktree。 |

GitLab 请求、标签验收、重试对账和 Tomato 阶段规则都留在 `issues` 边界内，不散入接线文件。通用会话、workspace 和 GitHub PR 服务不依赖 `issues`，也不识别 Tomato 阶段。

## 正文与评论契约

正文保留原始目标、背景及流程文档链接，设计阶段回填当前详细设计与验收标准。更新不得无提示覆盖人工编辑或删除原始需求。

评论持久化需要交接的信息：

- 重要讨论结论、决策及原因、方案变更和待澄清事项；不记录内部推理链。
- 每轮开发总结：变更、验证结果、剩余工作或阻塞。
- 每次待验收版本、批准与失效原因。
- 本地 commit SHA、远端 MR 编号/链接、CI 结果和最终合并结果。

新会话从最新正文和相关评论重建工作上下文，并核对引用的代码/MR。不得仅凭最近几条评论宣称已读完整记录。正文与评论冲突、引用失效、同步结果不确定或目标不明确时暂停向人澄清，不自行补全。

## 生命周期

### A：建单

主要由人在 GitLab 网页拆解目标建 open Issue，也允许 Agent 创建。标题清晰，正文简短，不在建单时要求详细设计。使用 `workflow::backlog`；bug 另加 `type::bug`。

### B：设计与验收

从 backlog 的“执行 → 设计”启动现有 workflow，在 Default workspace 中阅读代码、讨论及完成 spec coding 设计，不创建 worktree。此阶段保持 backlog，面板另显设计中/待验收。

设计写回正文，阶段结论与变更写 comments。设计验收记录与实施入口分离：设计验收不再是进入实施的强制前提，进入实施由面板的实施确认决定（见 C）。

### C：实施与验收

在面板点击“执行实施”后先弹出确认对话框；确认即视为批准实施，`workflow::backlog` 改为 `workflow::in-progress`，再创建或恢复该 Issue 对应 worktree；已处于 `workflow::in-progress` 或 `workflow::in-review` 的 Issue 不经改动直接启动。取消则不做任何改动。每轮总结、重大发现和方案变更写 comments；需要改变已讨论确认的设计时暂停请求确认，不用旧结论继续实施新方案。

本地提交后记录待验收 commit SHA，进入 `workflow::in-review`。实施验收必须针对明确的代码版本。验收后 push 远端临时分支、创建或关联 MR，并记录 MR 引用及 Issue 关联。

CI 通过且 GitLab 合并条件满足后，等待人单独确认合并；实施批准不是合并授权。最终合并仍遵守受保护 main 的权限。只有确认合并成功才记录最终结果、关闭 Issue；不得在发出合并请求时提前关闭。

`workflow::*` 在 CE 中作为普通标签使用，不依赖付费 scoped-label 排他能力。宿主维护已知流程标签的转换，同时保留其他标签；多个流程标签等冲突不得自动猜测。

## Worktree 路径

Issue 实施入口固定使用：`<项目根目录>/.worktrees/issue-<Issue 单号>`，例如 `#42` 对应 `.worktrees/issue-42`。项目根目录指绑定仓库的主工作树，不是当前嵌套 worktree。

- Pipeline B 不创建 worktree；普通 workspace 默认行为不变。
- Pipeline C 创建的 worktree 必须注册为绑定项目的正式 ThinkRail workspace，出现在左侧项目 panel 的现有工作区列表中；不得只创建磁盘目录或另建 Issue 专属工作区列表。
- 实施会话绑定同一个 `workspaceId`，文件、Git、终端和聊天均以其 `worktreePath` 为上下文。启动实施后定位到该 workspace；从左侧列表也能重新进入，不依赖右侧 Issues 面板。
- 工作区注册持久化并沿用宿主现有列表事件更新机制。重启、刷新及重复启动时恢复同一条记录，不重复建工作区；已存在有效 worktree 但注册中断时，先核验关联并补全注册，再启动实施会话。
- 已存在且确认属于该 Issue 的有效 worktree 可复用。
- 同名目录被普通文件、其他 worktree 或其他工单占用时暂停，不覆盖、不删除、不自动换名。
- 本地开发分支和远端 MR 临时分支是独立概念，不由目录名强制决定。
- `.worktrees/` 必须排除出主工作树版本管理；若未排除，提示并完成明确的仓库配置，而非将嵌套工作树纳入提交。
- 未来一个本地项目如需绑定多个 provider/远端项目，数字目录可能冲突；首期不支持多绑定，扩展时需重新确认目录规则，不能静默加前缀。

现有 managed workspace 使用数据目录。Issue 实施入口负责确定显式目标路径并传给宿主；通用 workspace 服务负责路径安全校验、注册、归属与生命周期，不识别 Issue 单号，也不改变默认目录策略。不得伪装成 external workspace 绕过边界；本轮未授权自动删除 worktree 或分支。

## 人工验收

ThinkRail 与 GitLab 网页两处均可批准；允许项目 Developer 及以上角色，最终 push/merge 权限仍由 GitLab 控制。

固定批准标签：

- `tomato::design-approved`
- `tomato::implementation-approved`

每轮提交新验收版本前清除对应旧批准标签，持久化本轮待验收标识。仅接受此后合资格用户重新添加的事件，不能仅凭标签当前存在判定批准。应用内验收同样绑定当前待验收版本，并留下远端记录。

通过 GitLab Free 的 Issue resource label events API 核对操作人、事件和时间，并核验项目角色。读取不到事件/权限、存在并发修改或无法证明批准针对当前版本时暂停。时间戳本身不是版本证明；需结合发布记录、当前正文/代码引用核对。

批准后正文设计或待交付 commit 变化时，旧批准不得继续放行；新版本需重新提交验收。首期不依赖付费审批规则或 webhook 服务。

参考：<https://docs.gitlab.com/api/resource_label_events/>。

## GitLab 关联入口

本地打开项目与克隆远端项目均支持关联：沿用现有打开/克隆流程，项目成功就绪后提供可跳过的 GitLab 关联步骤；失败或跳过不回滚、不删除项目。已打开项目从右侧 Issues 菜单进入关联、重新连接或断开连接。两个入口复用同一表单和宿主连接服务，不创建第二套绑定。

表单仅支持 HTTP/HTTPS GitLab 仓库地址和个人 Token，不支持 SSH 地址；地址可从 origin 安全预填但必须核验，不自动修改 Git remote。Token 仅用于 API，不注入克隆或 push；Git 仍用本机凭据。提交前清空输入。已连接项目重新打开时不重复要求 Token；凭据库缺失或解锁失败时显示可跳过的重连步骤。非本机 HTTP 实例在首次发送 Token 前须明确确认明文传输风险，确认与精确实例绑定。

复杂自托管地址的高级实例/项目路径字段按推荐方案暂定保留（用户未确认此细节），不自动携带 Token 探测多个猜测地址。双入口草图位于 `.thinkrail/context/mockups/issues-two-entry-proposal.html`；其内存存储说明已被后续系统凭据库决定取代，不代表已实现。

## 面板交互

右侧工具栏新增 Issues。窄栏采用纵向 Kanban list view，按 Backlog、In Progress、In Review、已关闭分组，显示工单号、标题、标签和阶段提示；已关闭项可折叠。标题打开 GitLab 网页，不内嵌正文/comments。

右键/行内菜单提供阶段动作：执行设计、验收设计、执行实施、验收实施、打开 MR、确认合并。不可用动作展示原因，不允许仅修改前端状态绕过宿主核验。已有会话/worktree 关联优先恢复，不重复创建。

显示连接、同步时间、离线和阻塞原因。原型位于本地忽略目录 `.thinkrail/context/mockups/issues-rail-proposal.html`，用于布局讨论，不作为生产样式或可移植设计资产。

## 同步、安全与恢复

写正文前检查远端是否变化；发现人工编辑或写入结果不确定时停止，不盲目覆盖。评论、标签、push、MR 创建与合并均需记录操作状态；重试前先查询远端结果，避免重复评论、MR 或错误关闭 Issue。

离线可显示带时间戳的缓存摘要，但不得据此批准、推进阶段或合并。读取可重试；副作用重试必须先对账。权限不足、token 失效、缺失 CI 或 CI 失败不能视为通过，不允许降级绕过人工关口。

个人 Token 保存到宿主用户的系统凭据库（Bun.secrets，Windows 使用 machine-local persistence），重启后恢复连接；不可用、锁定或写入失败时提示，不静默降级为明文文件。公开绑定与凭据分离，Token 不写项目配置。断开连接立即停止本机使用并删除该绑定已存 Token，保留公开绑定；删除失败须报告并阻止把操作误报为成功。连接输入仅经现有 transport 写入宿主，不在 Web store、读取响应或浏览器持久化中保留，也不进入 Agent 上下文、错误遥测、命令日志或 Issue。Issue 正文和评论是外部输入，不能作为越过权限与人工批准的指令。错误上报遵循现有 classifier-only 规则。

## 验证与实施前检查

本轮只批准设计，没有运行实现测试，也未交付运行能力。实施前需核对目标 GitLab CE 版本、凭据存储现有能力，以及免费版 Issue/MR 关联与实际 pipeline API 行为，不以 GitLab.com 文档替代目标实例验证。

验收重点：

1. 换机器、无原会话记录，仅凭正文/comments 与 commit/MR 引用能继续工作。
2. B 阶段无 worktree；C 阶段严格使用 `.worktrees/issue-<IID>`，占用路径不被覆盖。新 worktree 在左侧所属项目的工作区列表可见，实施会话、文件和终端绑定同一 workspace；刷新、重启和重复启动均不丢失关联或产生重复记录。
3. 网页/应用批准等价；旧标签、错误角色、设计改动及 commit 变化不能放行。
4. 网络失败、重启、重复点击和不确定写入不重复建单、评论、worktree 或 MR。
5. 受保护分支、CI 与独立合并确认不可绕过；合并成功前不关闭 Issue。
6. 针对协议、状态转换、GitLab 适配器和恢复进行单元/集成测试；用 disposable GitLab CE 项目做全流程兼容验证，实施后运行完整 no-agent browser suite 和必要的 focused live workflow tests。

7. 实施后在临时分支上合并一次比 fork 基线更新的 ThinkRail 主线，记录上游提交与冲突文件；以接线清单为基准检查冲突范围，说明并复核所有超出清单的冲突。合并后验证 Issue 流程可用，并在不启用 Issue 集成时回归普通会话、workspace 和现有 GitHub PR 路径。此演练不改动正式分支，本设计阶段尚未执行。

系统凭据库细节、协议字段、轮询频率及具体文件拆分属于后续实现计划；任何影响用户行为的新决定需再确认，不由本文暗中授权。README 与 owning specs 在交付真实能力时同步更新，本轮不宣称已支持。

## 最新简化决定

面板只保留设计/实施两个入口，允许来回穿插。实施直接启动，不弹批准框、不要求设计回执、不自动改流程标签；复用归属记录匹配的 worktree 和空闲会话。目录与工作区名为 issue-<IID>。验收和关单留给 GitLab。
