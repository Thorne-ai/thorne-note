---
type: conversation-archive
created: 2026-10-15
updated: 2026-10-15
tags:
  - TMD
  - IDEA
  - Serena
  - Java
  - JDT-LS
  - 编译故障
status: archived
source: Codex conversation
project: tmd
---

# TMD 编译故障复盘 - Serena 自动构建污染与 IDEA 修复

## 一句话结论

**本次“程序包不存在”的主因是 Serena 使用的 Eclipse JDT LS 后台自动构建与 IDEA 共用 Maven 模块的 `target/classes`，错误编译产物进入了 IDEA 的编译输入。** 处理方式是关闭 Serena Java 后台自动构建、停止共用语言服务工作区的旧进程，再由 IDEA 重建。随后修复了重建暴露的过期测试 API。最终 IDEA Build Project 成功，两个相关测试类的 50 个单元测试全部通过。

Serena 当前连接因停止旧进程而断开；**配置已写入磁盘，但重新连接后的配置加载与语义索引行为尚未实测**。这与 IDEA 已恢复构建是两个不同的验收状态。

## 背景与范围

- 项目目录：`/Users/cd-mac-thorne/IdeaProjects/tmd`。
- 当时分支：`feature/SCRUM-13239`；HEAD：`708d054930`。
- 用户现象：IDEA 构建在 `BeDepositController.java` 等文件上报大量包不存在、找不到符号错误，要求解释并修复。
- 编译基线：Java 11；终端 Maven 3.9.14，Java 11.0.32.1；IDEA 使用 javac 11.0.32.1。
- 本次目标：恢复截图对应的项目构建，核实根因和工具影响，保留已有本地修改。
- 全文时间均为北京时间（Asia/Shanghai）。

![IDEA 报告 aggr 模块自身的程序包不存在](<assets/TMD 编译故障复盘 - Serena 自动构建污染与 IDEA 修复/01-idea-package-not-found.png>)

截图显示 2026-10-15 15:14 的构建失败，共 100 个错误；其中 `BeDepositController.java` 有 74 个错误，包含 `net.spotec.aggr.annotation`、`constant`、`conversion`、`entity.req` 等包不存在。它证明了编译器的报错位置和当次错误数量，不能单凭截图认定源码被删除、import 拼错、Maven 依赖缺失或 IDEA 索引损坏。

## 排查顺序与判断依据

### 1. 先记录工作区，再确认工具状态

首先记录 `git status --short --branch`，确认分支，并保留首次状态记录中已有的 `i18n` 修改和若干未跟踪文件。本次没有通过 checkout、reset、stash 或覆盖文件来清理工作区。

按项目规则检查直接和延迟工具注册表，发现 Serena 实际可用，随后完成项目激活、初始化说明读取、当前配置查询，以及具体 Java 文件上的轻量符号查询。

当时真实状态为：

- Serena 工具调用成功；
- 激活项目为 `tmd`；
- 语言后端为 LSP，Java 语言服务；
- `BeDepositController.java` 符号概览成功，证明当时的符号索引可用。

这些状态不等同于 Maven 编译正常，也不保证语言服务没有后台写入副作用。本轮排查随后观察到部分 class 在 15:16～15:17 被改写：**符号查询本身虽是只读请求，语言服务启动、项目导入和后台自动构建仍可能写文件。**

### 2. 确认源码存在，排除明显的源码路径与包名问题

精确核对截图中的 Controller import 和对应源码，确认 `AreaValid`、`FlagValidator`、`OnlineStateEnum`、`DepositDtoToVoMapper`、请求类等都存在，包声明与引用相符。

再核对 aggr 和 parent POM：没有发现自定义源码目录或编译排除规则可以解释同模块大量包消失，Java source/target 仍为 11。

因此，没有证据支持通过补 import、恢复这些源码、给模块添加“依赖自己”的 Maven 依赖，或修改生产业务代码来解决问题。

### 3. 核对 IDEA 实际模块模型，避免误删 IDE 配置

本地 `.idea/modules.xml` 表面上只列出 `tmd.iml`，但项目启用了外部构建模型存储。进一步检查 IDEA 实际使用的外部模块 XML，确认：

- 项目包含 74 个模块、722 个库；
- aggr 源码根为 `src/main/java`；
- 主输出为 `target/classes`，测试输出为 `target/test-classes`；
- Maven 模块和依赖关系实际存在。

因此，“模块 XML 列表看起来很短”不是模块丢失的充分证据。本次没有删除 `.idea`、重建模块定义或修改项目 SDK 来碰运气。

### 4. 使用 Maven 作独立对照，但明确其验证边界

执行过：

```shell
mvn -o -f be-spotec-aggr/pom.xml -DskipTests compile
```

该命令在依赖解析阶段失败，两个 AWS SDK 依赖没有可供该次离线解析使用的缓存：

- `software.amazon.awssdk:third-party-jackson-core:2.20.68`
- `software.amazon.awssdk:profiles:2.20.68`

这是一项独立的本地 Maven 缓存限制。**这次命令没有走到 Java 编译阶段，不能据此声称 Maven 编译成功，也不能用它解释同模块包不存在。** 本次没有为此联网下载依赖或更改仓库地址。

### 5. 在 IDEA 中复现，继续读取“第一个实质错误”

15:20 对 aggr 执行普通模块构建，仍然失败，但错误变为 59 个，主要是 `ApiResult`、`UidSearchDTO` 无法访问，以及大量泛型推断和 `RpcClientUtil.sync` 调用失败。

这时没有将每个 Controller 当作独立业务缺陷逐个修改，而是检查其依赖的 RPC 二进制文件。

### 6. 用 javap 找到决定性证据：错误 class，而非普通缺包

检查 `crm-rpc/target/classes/.../TmdUserQueryClient.class`，发现：

```text
Unresolved compilation problems:
The import net.spotec.common.entity cannot be resolved
ApiResult cannot be resolved to a type
UidSearchDTO cannot be resolved to a type
```

同时，字节码方法描述符中出现了：

```text
LApiResult;
LUidSearchDTO;
```

正常结果应包含完整类型，例如：

```text
Lnet/spotec/common/entity/vo/ApiResult;
Lnet/spotec/common/entity/dto/UidSearchDTO;
```

还发现 ECJ 的 `MissingTypes` 属性。这类文件是 Eclipse 编译器在未能解析类型时生成的错误占位编译产物，不是正常编译成功的 class，也不是指文件发生了随机磁盘损坏。

部分时间戳落在 15:16～15:17，与 IDEA 15:14、15:20 的构建时间不同，进一步支持另一个编译器正在改写输出目录。

对生产输出目录进行二进制标记扫描后，共找到 **776 个包含 `Unresolved compilation problem` 标记的 class，分布在 13 个模块输出目录**：

| 模块输出 | 含错误标记的 class 数量 |
|---|---:|
| be-spotec-common | 1 |
| be-spotec-aggr | 272 |
| copy-trading-service | 14 |
| blockchain-service | 3 |
| message-service | 1 |
| mt4-service | 33 |
| operation-config-service | 15 |
| finance-service | 34 |
| finance-rpc | 1 |
| finance-ck-service | 1 |
| crm-rpc | 259 |
| crm-ck-service | 31 |
| crm-service | 111 |
| **合计** | **776** |

扫描数量指匹配到该错误标记的 class 数，不代表项目只有 776 个 class，也不是统计源码错误数量。

### 7. 定位写入来源：Serena 的 Eclipse JDT LS

通过进程清单，发现多组 Serena 与其 JDT LS 子进程，共用同一个语言服务工作区。实际修复时停止了 **8 组**相关服务。

安装源码提供了配置层面的佐证：

- `solidlsp/language_servers/eclipse_jdtls.py` 默认设置 `java.autobuild.enabled=true`；
- 初始化后会把最终设置通过 `workspace/didChangeConfiguration` 发送给 JDT LS；
- 该项目是 Maven 工程，后台编译输出进入模块的 `target/classes`，与 IDEA 输出目录相同。

因此根因链条为：

```text
Serena 初始化 / 导入 Java 工程
  → JDT LS 自动构建
  → 在类型或依赖解析未完整时生成 ECJ problem class
  → 与 IDEA 共用的 target/classes 被覆盖或处于重建中
  → IDEA 增量编译读取缺失或错误的二进制类型
  → 包不存在、ApiResult 无法访问、泛型推断失败等连锁错误
```

多份语言服务共用同一工作区增加了并发冲突风险。不过，不能仅凭进程数量断言某一次具体错误由哪个 PID 写入；直接证据是错误字节码、输出时间戳、自动构建设置与输出目录重叠。本次没有执行系统级文件写入跟踪。

## 修复方式与取舍

### 1. 在全局 Serena 配置中关闭 Java 自动构建

修改文件：

```text
/Users/cd-mac-thorne/.serena/serena_config.yml
```

关键设置层级为：

```yaml
ls_specific_settings:
  java:
    initializationOptions:
      settings:
        java:
          autobuild:
            enabled: false
```

**上面的 YAML 仅展示关键路径，不能直接当作完整替换配置照抄。** 当前安装版本在合并 `initializationOptions` 时使用浅层 `dict.update`；只提供一个简短 `settings` 会替换整块默认设置。

实际处理读取了本机已安装适配器生成的完整默认 settings，只把 `autobuild.enabled` 改为 false，并保留其余 33 个 Java 顶层设置项，避免意外丢失 Maven、运行时、导入等默认配置。

原全局 `ls_specific_settings` 为 `{}`。修改前已保存原配置备份；备份位于系统临时存储，本笔记不把它视为永久保留的回滚档案，也不复制可能包含其他私人配置的完整全局配置到知识库。

### 2. 为什么没有只修改项目 .serena/project.yml

本机全局 `trusted_project_path_patterns` 当时为空。安装代码明确规定，只有受信任项目才会合入项目级 `ls_specific_settings`。

所以仅改项目配置不会生效。本次选择全局 Java 配置，避免为了这个开关扩大项目信任范围。**没有新增 trusted project 匹配规则。**

### 3. 停止持有旧配置的冲突进程

配置保存到磁盘后，已经运行的服务不会自动重新加载：再次激活同一个项目也不会强制重建语言服务。

因此对识别出的同工作区 JDT LS 及其 Serena 父进程发送正常终止信号，实际停止 8 组相关服务。随后进程检查未发现仍运行的 JDT LS。

这是后续 Serena 工具返回 `Transport closed` 的直接原因：旧连接被主动终止了。它与“Serena 未安装”“工具未暴露”或“IDEA 编译仍失败”不是同一回事。

归档时又执行了一次已知 Java 文件上的轻量符号查询，仍返回 `Transport closed`，因此当前状态按事实报告为连接失败、项目 tmd、已知配置后端 LSP/Java、索引未验证。

### 4. 使用 IDEA 完整重建，再恢复普通增量构建

在 IDEA 执行 `Build → Rebuild Project`，让 javac 重新生成全项目输出。重建完成后，原来错误的 RPC 类型签名恢复为完整包名，错误 class 扫描结果变为 0。

完整重建还暴露了原先被增量缓存掩盖的测试源码问题。这些测试错误与 JDT LS 污染是两类独立问题，需要分别处理，不能再归因于缺包。

## 仓库实际修改：仅测试代码

没有修改生产 Java 代码、POM、业务接口或 API 版本。实际涉及 4 个既有测试文件和 1 个新测试文件：

| 文件（相对 TMD 根目录） | 调整内容 |
|---|---|
| `be-spotec-aggr/src/test/java/net/spotec/aggr/aop/DepositFailLogAspectTest.java` | 同步新增的 `TmdUserClient` 构造依赖，提供固定用户详情 mock；将一处过期金额单位期望改为 USD。 |
| `be-spotec-mt4/mt4-ck-service/src/test/java/net/spotec/mt4/ck/controller/ClientAccessLogTest.java` | 将调用已删除 `saveLog` 的旧写入测试迁出，保留两个查询测试。 |
| `be-spotec-mt4/mt4-ck-service/src/test/java/net/spotec/mt4/ck/consumer/SaveVisitLogConsumerTest.java` | 新增两个纯 Mockito 单元测试，覆盖首次插入、重复消息不再插入，并用 captor 验证转换字段。 |
| `be-spotec-mt4/mt4-service/src/test/java/net/spotec/mt4/service/impl/FollowAccountTypeServiceImplTest.java` | 移除基础配置请求已删除的语言、名称字段，验证基础配置更新后语言名称保持不变。 |
| `be-spotec-mt4/mt4-service/src/test/java/net/spotec/mt4/service/impl/TmdFollowAccountProfitServiceImplTest.java` | 移除请求类已删除的 `adminRemark` setter 调用，保留测试方法。 |

金额断言没有随意迎合实际输出：核对历史提交 `792c0002edf18f362cc9438a2589d57aa7c798fb`（2026-07-20，#12720），当前实现已固定日志金额单位为 USD；`UnionPayBaseDepositReq.amount` 注释也是“总金额-USD”，与支付币种字段分开。因此将旧测试的 `500.00 EUR` 修正为 `500.00 USD`，使测试匹配现有实现与历史变更。这里只核对了代码和提交证据，没有重新向产品方验收业务需求；`extractAmount` 的既有 JavaDoc 仍残留优先读取 `getCurrency()` 的旧描述，本次未扩大范围修改。

访问日志写入口已迁移为 `SaveVisitLogConsumer.onMessage(ClientAccessLogSaveReq)`。旧测试的写入场景迁到当前入口，并新增插入及去重断言，不是简单禁用测试来绕过编译。

## 验证过程与最终结果

| 时间 / 阶段 | 验证结果 | 正确解读 |
|---|---|---|
| 15:14 原截图 | 100 个错误 | 原始故障现象，编译器有错误数量上限，不能视为全项目只有这些问题。 |
| 15:20 aggr 模块普通构建 | 59 个错误 | 错误 class 被识别后继续暴露类型访问问题。 |
| 15:25～15:27 完整重建 | 1 个错误、565 个警告，耗时约 1 分 59 秒 | 生产代码重建完成；失败来自过期的访问日志测试。警告不在本次清理范围。 |
| 后续普通 Build Project | 5 个错误、21 个警告 | 其他模块测试继续编译后暴露旧构造器和已删请求字段。 |
| 15:34 普通 Build Project | 成功，5 个警告 | 全项目源码和测试源码已能编译。 |
| 15:37 最终普通 Build Project | 成功，耗时约 2.068 秒 | 最后一次断言修改也已编译，无需每次完整重建。 |
| 错误 class 复扫 | 776 → 0 | 在修复后已扫描的生产输出目录中，不再发现该 ECJ 错误标记。 |
| `SaveVisitLogConsumerTest` | 2/2 通过 | 首次写入与重复不写入两个纯单元测试通过。 |
| `DepositFailLogAspectTest` | 最终 48/48 通过 | 构造器及币种约定同步后通过。 |
| `git diff --check` | 通过 | 本次差异未发现空白格式问题。 |

两个相关测试类合计 **50/50** 通过。测试使用 Java 11、IDEA 当前模块模型解析出的 classpath 和 JUnit Platform 运行，未依赖 Maven 重新下载依赖。

切面测试使用 Mockito 静态模拟，在沙箱中因 Java 动态附加能力受限而初始化失败；获准在沙箱外复验后，先得到 47/48，再修正旧币种期望并复验为 48/48。该轮测试的 RPC 和消息调用均为 mock。

**验证边界：** IDEA Build Project / Rebuild Project 验证了编译，不等于执行全仓库测试。只实际运行了上述两个单元测试类；没有执行真实数据库、真实 RPC 的集成测试，也没有宣称 Maven 离线编译成功。

## 修复后对 IDEA、Serena 与 Git 的影响

| 对象 | 实际影响 | 边界和后续注意 |
|---|---|---|
| IDEA | 清理并重新生成编译输出和构建缓存；普通增量构建恢复成功。 | 没有手工更改项目 SDK、模块依赖、源码根、POM 或编译器参数。IDEA 自身可能保存正常 UI / 构建状态。 |
| IDEA 注解处理 | 继续由既有 javac / IDEA 编译配置生成 Lombok、MapStruct 等所需产物。 | 关闭 Serena 自动构建不等于关闭 IDEA 注解处理；本次没有关闭注解处理。 |
| Serena Java 自动构建 | 关闭 `autobuild` 路径，目标是减少后台编译覆盖 IDEA class 输出的风险。 | 这是全局配置，对其他 Java 项目后续新建的 Serena 连接也有效；不是只作用于 tmd。没有验证或承诺语言服务绝不会以其他方式写入 target。 |
| Serena 语义导航与索引 | 配置的目标是关闭产物构建，不是禁用 LSP、符号查询或源码分析。 | 当前旧连接已停；重连后的符号查询、诊断完整性和项目导入结果尚未验证，不能保证毫无诊断差异。 |
| Serena 配置维护 | 为绕开当前浅合并行为，保存了完整默认 settings 后只改一个开关。 | 这会把当时的默认值和运行时路径固定在全局配置中；升级 Serena、JDT LS 或更换安装路径时，应重新核对。 |
| Serena 当前会话 | 原 MCP 传输已关闭，工具查询返回 `Transport closed`。 | 需要重启 / 重新连接持有旧配置的 Serena 会话；仅重复激活同项目不足以证明已重载。 |
| TMD Git 历史 | 分支和 HEAD 未因本次操作变化；没有 commit、push、reset、stash、切分支或合并。 | 本次测试修复留在工作区，可单独审查、暂存和提交。 |
| TMD Git 工作区 | 4 个已跟踪测试被修改，1 个新测试尚未跟踪。 | 首次状态记录中的 i18n 和其他未跟踪内容保留，不能把它们都算作本次新增。 |
| 构建产物与本机配置 | `target`、`.idea`、`*.iml` 被项目规则忽略；Serena 全局配置在仓库外。 | 不会自动进入 TMD 提交；单独提交测试代码也不会把其他机器的 Serena 开关一并修好。 |
| thorne'note Git | 本次归档新增本笔记和 1 张截图，并追加归档索引链接。 | 归档前已有两份笔记删除和索引修改；本次保留这些已有变更，不自动提交或推送知识库。 |

Java 语言服务本身可能使用较新的运行时启动，这与业务源码的 Java 11 编译目标是两回事。本次没有升级项目 Java 版本。

## 后续行动与回滚说明

1. **重新连接 Serena。** 确认新进程加载 `java.autobuild.enabled=false`，而不是仍使用旧进程内存中的配置。
2. **分别验证四个状态。** 连接成功、激活 tmd、后端 LSP/Java、具体文件符号查询成功，应分别取得证据。
3. **验证没有再次改写编译输出。** 重连 / 导入前后可比较代表 class 的修改时间和错误标记扫描，再进行一次 IDEA 增量构建；仅配置文件里有 false 不等于完成了运行态验收。
4. 如以后需要 Maven 构建，另行解决本次离线解析缺失的两个 AWS SDK 依赖，再执行 Maven 验证。
5. 审查并按需求提交这 5 个测试文件；不要将已有 i18n 或其他无关工作区内容混入。

本次没有恢复 `autobuild=true`。若需要回滚 Serena 设置，应只移除本次新增的 Java `initializationOptions.settings` 覆写，保留之后其他人新增的配置；修改前先核对当前文件差异。恢复后台自动构建会重新引入同目录输出冲突风险，不能只回滚开关而忽略输出隔离问题。

若放弃测试修复，应仅按文件或 hunk 撤销本次测试差异，不对整个工作区执行 reset。本笔记不自动执行任何回滚。

## 可复用的排障顺序

1. 保存 Git 状态与原始报错，确认是哪种构建入口失败。
2. 核对报错类型对应的源码、包声明和最小模块模型。
3. 用另一个构建入口作对照；明确失败发生在依赖解析、源码编译还是测试运行阶段。
4. 大量级联类型错误时，先检查第一个实质错误和其依赖的 class，必要时使用 `javap -verbose`。
5. 结合 class 时间戳、编译日志和进程，寻找多个工具写入同一输出目录的证据。
6. 先止住竞争写入，再重建输出；不要让另一个自动编译器在重建后继续覆盖。
7. 将产物污染与真正的过期源码 / 测试问题分开处理。
8. 最后分别验收普通增量构建、必要单测、错误产物扫描和工具重连状态。

## 相关

- [[Serena 接入与 Codex 提效规则归档]]
- 项目说明：`AGENTS.md` 中的 Serena 四状态验证、精确检索和 Git 工作区保护规则。
- 本机关键配置：`~/.serena/serena_config.yml`。
- 本机代码证据：已安装的 `solidlsp/language_servers/eclipse_jdtls.py`、`solidlsp/initialize_params.py` 与 `serena/project.py`。

本笔记是 2026-10-15 排障会话的事实快照。后续连接、依赖缓存、IDE 状态和工作区内容可能变化，使用时应重新核实。
