<p align="center">
  <img src="./assets/images/github_banner_image.png" alt="@chanyuxi/form" width="100%" />
</p>

# @chanyuxi/form

一个 Schema 驱动、强类型、无 UI 依赖的表单内核。

当前实现处于 **P0 Core** 阶段：标量字段、嵌套叶子路径、不可变快照、dirty/touched、事务、同步校验、提交和生命周期已经具备自动化测试。Renderer、React 适配、数组、异步 validator 和 Feature 尚未进入当前能力范围。

完整设计和阶段边界见 [`FORM_RFC.md`](./FORM_RFC.md)，P0 验收证据见 [`P0_ACCEPTANCE.md`](./P0_ACCEPTANCE.md)。

## 快速开始

```ts
import { configureForms } from '@chanyuxi/form'

interface ProfileContext {
  minimumAge: number
}

interface ProfileValues {
  age: number | null
  profile: {
    name: string
  }
}

const forms = configureForms<ProfileContext>()
const schema = forms.defineSchema<ProfileValues>()(
  [
    {
      defaultValue: '',
      name: 'profile.name',
      validate: ({ value }) => value === ''
        ? [{ code: 'required', message: '请输入姓名' }]
        : [],
    },
    {
      defaultValue: null,
      name: 'age',
      validate: ({ context, value }) => value === null || value < context.minimumAge
        ? [{ code: 'minimum', message: '年龄不满足要求' }]
        : [],
    },
  ],
  {
    transform: ({ values }) => ({
      age: values.age,
      name: values.profile.name.trim(),
    }),
  },
)

const form = forms.create(schema, {
  defaultValues: { profile: { name: 'Anonymous' } },
  initialContext: { minimumAge: 18 },
  initialValues: { profile: { name: 'Draft' } },
  mode: 'onTouched',
})

form.setValue('profile.name', 'Ada')
form.setValue('age', 36)
form.markTouched('profile.name')

console.log(form.state.values)
console.log(form.state.dirtyFields)
```

同一个 Schema 可以创建多个实例；values、错误、提交和校验任务互不共享。其他 `configureForms()` 系统创建的 Schema 会被明确拒绝。

## 快照与订阅

`form.state` 和 `field.state` 是当前已提交状态的不可变快照。无变化的写入不会制造新快照或发送通知。

```ts
const unsubscribe = form.subscribe(() => {
  console.log(form.state.revision, form.state.values)
})

const name = form.getField('profile.name')
const unsubscribeName = name.subscribe(() => {
  console.log(name.state)
})

unsubscribeName()
unsubscribe()
```

字段订阅只在该字段快照变化时触发。通知期间发起的新写入会排队到当前通知结束后执行。

## 基线、dirty 与 reset

创建实例时，schema 的字段默认值先组成最底层默认值，`defaultValues` 在其上建立实例基线，`initialValues` 最后只覆盖当前值。`initialValues` 不会隐式改写基线，因此它与基线不同的字段会从创建时就处于 dirty 状态。

```ts
form.setDefaultValues({
  profile: { name: 'Ada' },
})

form.resetField('age')
form.reset()

form.reset({
  values: {
    age: 36,
    profile: { name: 'Ada' },
  },
})
```

- `setDefaultValues` 只更新基线，不覆盖当前输入。
- 输入改回当前基线后，dirty 恢复为 `false`。
- `reset()` 恢复当前基线，并清理错误、touched 和提交元数据。
- `reset({ values })` 同时使用新值建立新基线。
- `reset({ values, asDefaults: false })` 保留旧基线。

## 原子事务

```ts
form.transaction((transaction) => {
  transaction.setValue('profile.name', 'Grace')
  transaction.setValue('age', 40)
})
```

事务回调必须同步。回调抛错时不提交任何变化；嵌套事务和返回 Promise 的事务会被明确拒绝。

## 校验和错误

```ts
const result = await form.validate()
const fieldResult = await form.validateField('profile.name')

form.setError('profile.name', {
  code: 'taken',
  message: '该姓名不可用',
})

form.clearErrors('profile.name', { source: 'manual' })
```

`CreateOptions.mode` 控制自动校验，默认值是 `onSubmit`：

| mode | 自动校验时机 |
| --- | --- |
| `onSubmit` | 仅 `submit()`；显式 `validate*()` 始终可用 |
| `onChange` | 字段值变化后 |
| `onBlur` | 调用 `markTouched()` 时；在 UI 适配层中对应 blur |
| `onTouched` | 第一次 `markTouched()`，以及该字段 touched 后的每次值变化 |
| `all` | change 与 touch 两者 |

同一轮同步写入触发的自动校验会在微任务中合并。当前 Core 没有单独的 `reValidateMode`；提交后的自动校验仍由 `mode` 决定。

校验结果区分 `valid`、`invalid`、`stale` 和 `aborted`。输入、context 或会话变化后，旧结果不能回写当前状态。

P0 validator 必须同步返回 issue 数组。虽然 `validate()` 返回 Promise 并提供任务过期语义，但 validator 本身暂不接受 Promise。

## Core submit

```ts
const result = await form.submit(async (payload, { signal }) => {
  return saveProfile(payload, { signal })
})
```

`submit()` 会先校验并锁定输入快照，同时处理 `success`、`invalid`、`busy`、`stale`、`aborted` 和 `error`。提交状态通过 `form.state.isSubmitting`、`isSubmitted`、`isSubmitSuccessful` 和 `submitCount` 读取。

成功提交不会自动 reset，也不会自动修改默认值基线。

## 生命周期

```ts
form.dispose()
```

`dispose()` 幂等，会中止当前验证和提交任务。销毁后仍可读取最后一个调试快照，但所有写命令都会抛出 `FORM_DISPOSED`。

## 当前阶段不支持

- 数组字段、数组条目身份和重排命令
- 异步 validator
- Feature 扩展协议
- `.ui()`、Presentation 和 Renderer
- React/Vue/Solid Hook 与组件
- StrictMode 资源租约和 SSR hydration 协议

这些能力分别属于 RFC 的 P1、P2 和 P3，不会在 P0 中以不完整 API 提前暴露。

## 开发与验收

```bash
pnpm install
pnpm check
```

常用命令：

```bash
pnpm lint          # 全项目静态检查
pnpm typecheck     # 源码和类型断言测试
pnpm build         # 构建 ESM JavaScript、声明文件及 source map
pnpm build:js      # 仅执行 Rollup 构建，并在构建前清理 dist
pnpm build:types   # 仅生成声明文件并规范化内部导入路径
pnpm test          # 构建并执行运行时测试
pnpm test:package  # 安装发布 tarball，验证运行时、类型和依赖边界
pnpm benchmark     # setValue 基准
pnpm demo          # 启动 P0 Core Demo
```

`pnpm check` 是本地和 CI 的统一门禁。
