# P0 验收记录

本文把 [`FORM_RFC.md`](./FORM_RFC.md) 中已经进入 P0 实现范围的要求映射到自动化测试。

## 阶段结论

P0 的目标是验证一个不依赖框架、控件包或第三方表单引擎的自研 Core。当前范围包括标量字段、嵌套对象叶子路径、值与基线、快照、订阅、事务、同步校验、提交和实例销毁。

以下能力不属于 P0 完成条件：数组字段、异步 validator、Feature、Renderer、React Hook、StrictMode 和 SSR。

## RFC 行为映射

| RFC ID | P0 场景 | 自动化证据 | 状态 |
| --- | --- | --- | --- |
| A01 | 无框架创建、读写、校验、重置和提交 | `runtime.test.ts`、`submission.test.ts`、发布包 smoke test | 通过 |
| A02 | 同一 Schema 创建的实例互相隔离 | `runtime.test.ts`：`creates isolated forms...` | 通过 |
| A07 | 输入改回基线后 dirty 恢复 | `runtime.test.ts`：快照、dirty、touched 与基线测试 | 通过 |
| A08 | 更新默认值不覆盖输入，并重新计算 dirty | `runtime.test.ts`：快照、dirty、touched 与基线测试 | 通过 |
| A09 | reset 使旧校验任务失效 | `runtime.test.ts`：stale/aborted ticket；`edgeCases.test.ts`：resetField | 通过（P0 同步校验范围） |
| A10 | 同一事务中的多个值只发布一次 | `runtime.test.ts`：原子事务与通知队列测试 | 通过 |
| A11 | 事务准备失败时保留旧快照和值 | `runtime.test.ts`：失败、嵌套和异步事务测试 | 通过 |
| A12 | 订阅者抛错不破坏提交状态和其他订阅 | `runtime.test.ts`：subscriber error 测试 | 通过 |
| A16 | 提交校验期间编辑返回 stale | `submission.test.ts`：stale submission 测试 | 通过 |
| A17 | 请求期间编辑不修改已发送 payload | `submission.test.ts`：handler 期间编辑测试 | 通过 |
| A18 | 并发提交返回 busy | `submission.test.ts`：concurrent submit 测试 | 通过 |
| A19 | transform/handler 抛错并恢复提交状态 | `submission.test.ts`：error result 测试 | 通过 |
| A26 | 无变化时重复读取返回相同快照 | `runtime.test.ts` 和发布包 runtime smoke test | 通过 |
| A31 | 发布依赖和公共类型不包含第三方表单引擎 | `scripts/testPackage.ts` | 通过 |
| A32 | 无框架入口使用同一 Core 命令链 | `runtime.test.ts`、`submission.test.ts` | 通过 |
| A33 | 校验规则只产出结果，Core 管理状态和过期 | `runtime.test.ts`、`edgeCases.test.ts` | 通过（P0 同步校验范围） |
| A44 | 其他系统创建的 Schema 被明确拒绝 | `runtime.test.ts`：schema system mismatch 测试 | 通过 |
| A48 | Core 产物不依赖 Renderer/Presentation | `scripts/testPackage.ts` | 通过 |

## 类型验收

以下内容由 `pnpm typecheck` 和发布包 smoke test 中的独立消费者工程验证：

- 字段路径和字段值相互约束。
- Schema 必须覆盖值模型中的全部标量叶子路径。
- `number | null` 不会因为默认值是 `null` 而错误收窄。
- 非空 context 模型要求提供 `initialContext`。
- 输入值和 transform 后的提交值保持不同类型。
- 公共 `.d.ts` 可由安装后的消费者独立编译。
- 错误字段、错误值和异步 transform 会在类型层被拒绝。

## 工程验收

`pnpm check` 必须依次通过：

1. 全项目 ESLint。
2. 源码及类型断言测试的 TypeScript 检查。
3. 包构建和运行时测试。
4. 发布包安装、运行时、公共类型和依赖边界 smoke test。
5. Demo 类型检查与生产构建。

GitHub Actions 在 push 和 pull request 上执行同一个 `pnpm check`，本地与 CI 不维护两套验收命令。

## P0 明确限制

- 字段值只支持 `string | number | boolean | null | undefined`。
- 支持嵌套对象的标量叶子路径，不支持数组条目身份和数组命令。
- validator 必须同步返回 issue 数组；异步 validator 属于 P2。
- transform 必须同步；业务 submit handler 可以异步。
- 当前包不包含 Presentation、Renderer、Control、Hook 或组件。
- 当前没有 Feature 状态切片和方法注入协议。

这些限制是阶段边界，不应通过 `any`、隐藏依赖或未定义行为绕过。
