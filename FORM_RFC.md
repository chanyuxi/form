# `·Form：无头表单内核与内建 Renderer

> **文档状态：** 设计提案。本文规定完整目标 API 与行为契约，不表示所有阶段已经实现。
> **实现状态：** P0 Core 已进入验收收口；当前证据与限制见 [`P0_ACCEPTANCE.md`](./P0_ACCEPTANCE.md)。
> **日期：** 2026-10-09  
> **包命名：** `@chanyuxi/form-`*。工程目录和包边界用于说明职责，不要求所有模块分别发布。

## 摘要

Form 是一个由团队自行实现并维护内核的 Schema 驱动表单系统。无头 Core 独立管理字段、状态、校验、提交和 Feature；内建 Renderer 负责把字段运行时与使用者提供的 UI 组件连接起来。

**Presentation 是内建 Renderer 的配置，不是 Feature，也不是 Core 配置。**

框架入口先建立基础系统，再通过 `.ui(presentation)` 返回一个具备呈现能力的新系统。UI 扩展不修改基础系统，不创建表单实例，不追补既有 Schema 或实例。业务开发者仍然使用增强系统一次定义完整 Schema。

```ts
const base = configureForms({ features })
const forms = base.ui(presentation)

const schema = forms.defineSchema([
  { name: 'name', control: 'text', defaultValue: '' },
])

const form = forms.create(schema)
```

核心原则：

- 系统配置分阶段，业务 Schema 不拆成两份。
- 无头能力可以独立使用；自动呈现可以直接接入自定义 UI。
- 实例绑定固定的核心定义；日常数据变化和联动通过 Runtime 输入驱动。
- 表单状态只有一个权威来源；Renderer 不另建 values、校验或提交流程。
- 内部模块化不能变成业务用户必须完成的机械装配。

## 阅读约定

“必须”“不得”表示目标实现应当满足的约束。“建议”“待验证”表示接口细节或内部实现还需要原型和测试确认。

所有 `form` API 均为设计接口。能力矩阵、流程与示例一起构成契约；示例中省略的类型参数不代表可以用 `any` 替代类型检查。使用原生 JavaScript、TypeScript 和 React 的示例遵循相应语言与框架边界，技术参考集中于第 20 节。

## 目录

1. [产品目标与设计原则](#s1)
2. [架构决策与范围](#s2)
3. [默认使用流程](#s3)
4. [系统扩展、Renderer 与依赖方向](#s4)
5. [统一 Schema、类型与 Control 契约](#s5)
6. [Definition、Runtime、View](#s6)
7. [动态规则：drive、命令与异步资源](#s7)
8. [固定定义、实例身份与数据更新](#s8)
9. [Form / Field API 与状态语义](#s9)
10. [Control、Field 与呈现覆盖](#s10)
11. [快照、订阅与更新协议](#s11)
12. [校验、错误与提交](#s12)
13. [数组、嵌套字段与身份](#s13)
14. [Feature 扩展协议](#s14)
15. [实例生命周期与 React 适配](#s15)
16. [无头入口、多框架与工程边界](#s16)
17. [系统组合、复用与完整使用场景](#s17)
18. [实现阶段与验收用例](#s18)
19. [取舍、范围外能力与待验证事项](#s19)
20. [技术参考](#s20)



## 1. 产品目标与设计原则

### 1.1 产品目标

1. 使用 Schema 减少重复字段 JSX，复用字段配置和行为。
2. 在定义 Schema 前注册 Feature 和可选 UI 能力，获得准确的配置、字段值和实例方法提示。
3. 让无头 Core、内建 Renderer、Control、Field 和 Whole Form 分别承担明确职责。
4. 提供 React、Vue、Solid 等框架入口，共享核心行为，允许符合框架习惯的呈现方式。
5. 让普通用户通过少量稳定入口完成表单，不要求理解内部 Helper、编译结果或门面装配。
6. 支持在没有任何视图时读写、校验、重置和提交表单。

### 1.2 能力分阶段，定义保持统一

```text
configureForms(coreOptions)
    ↓
BaseSystem：基础字段定义、Feature、无头创建能力
    ↓ 可选
baseForms.ui(presentation)
    ↓
UiSystem：基础能力 + 内建 Renderer 的配置与呈现能力
    ↓
forms.defineSchema(fields)
    ↓
一份字段定义同时表达值契约、Feature 配置与呈现
    ↓
forms.create(schema) / forms.useForm(schema)
```

`.ui()` 不是在运行中的表单上挂载组件，也不是通用插件注册器。它发生在系统配置阶段，为新返回的系统绑定一个 Renderer 配置快照。

不使用 UI 时，BaseSystem 已经是可用的表单系统。使用 UI 时，用户不必把字段拆成 Core Schema 和 UI Schema。

### 1.3 区分规则、输入与结果

Schema 描述字段契约和规则；Runtime 保存每张表单的输入与状态；Renderer 消费运行状态，计算呈现并连接组件。

```text
“国家为空时禁用城市”     → 定义中的纯规则
“当前国家是 ID”          → Runtime 输入
“当前城市控件未禁用”     → Renderer 派生结果
“把结果传给 Select”      → 框架呈现
```

普通联动不重新安装 Feature，不重新初始化字段，也不改变默认值基线。真正改变核心字段契约时显式开启新实例。

### 1.4 成功标准

- `configureForms` 的配置类型不包含 `presentation`，且不要求任何 UI 注册项。
- `.ui()` 返回新对象，原基础系统的行为和类型能力不变。
- Presentation 不进入 Feature 列表，不使用 Feature 钩子安装 Renderer。
- 最终只需填写一份业务 Schema；控件选择、props 和 Feature 配置获得联合检查。
- 不安装框架、控件包或第三方表单引擎，Core 仍然可独立执行。
- 共享系统或 Schema 不导致表单之间共享 values、错误、任务与缓存。
- 控件未挂载时，逻辑字段仍然存在。
- 缓存与组件记忆化不是保留输入的正确性前提。
- 静态类型不承诺运行时无法保证的字段值或可用方法。



## 2. 架构决策与范围

### 2.1 架构决策


| 编号  | 决策                                   | 意义与边界                                       |
| --- | ------------------------------------ | ------------------------------------------- |
| D01 | 团队自行实现并维护 Core Runtime               | 不对接 RHF 或其他表单引擎，不提供可切换后端                    |
| D02 | `configureForms` 只接收基础系统配置           | Feature、context 和 Core 策略不与 Presentation 混合 |
| D03 | `.ui(presentation)` 返回新的增强系统         | 不修改原系统；不创建 FormInstance；注册信息绑定于返回值          |
| D04 | Presentation 属于内建 Renderer           | 不是 Feature，也不进入 Core 运行时与配置协议               |
| D05 | 增强系统提供统一 `defineSchema`              | 用户一次填写数据、行为和呈现，不管理两份平行定义                    |
| D06 | Control 的值契约可提取                      | 定义工具可推导值类型，Core 不运行或导入 UI 组件                |
| D07 | 一个 FormInstance 绑定固定 Core Definition | 不自动采用新 Schema 引用；换契约时显式新建实例                 |
| D08 | `drive` 是 Renderer 的同步纯派生            | 计算显示配置，不修改值、Schema 或 Feature 安装集合           |
| D09 | 值、基线、错误、校验与提交归自研 Core                | 框架和 Renderer 不维护第二份权威表单状态                   |
| D10 | 字段成员关系独立于视图挂载                        | 隐藏、未渲染与删除字段不是同一个操作                          |
| D11 | 各框架共享 Core 行为                        | 框架适配订阅、生命周期和呈现，不各自实现表单语义                    |
| D12 | Whole Form 由使用者组合                    | 提供字段入口，不强制整表布局 DSL                          |


### 2.2 非目标

- 包装 RHF 的 Hook、控制对象、订阅、resolver 或提交流程。
- 提供第三方表单引擎的 API/行为兼容层或后端切换接口。
- 用 `uiFeature()`、通用 Feature 钩子或 Core 配置承载 Presentation。
- 在 `.ui()` 中修改基础系统、增强已有实例，或热替换已使用的注册表。
- 通过深比较判断闭包、校验器和组件是否语义等价。
- 根据 Schema 对象引用变化自动销毁用户正在填写的实例。
- 默认要求用户创建 Renderer、Helper 并手动连接编译产物。
- 要求所有 UI 局部状态进入 Runtime。
- 提供统一 Whole Form 布局语言。
- 未经测试就承诺所有非受控输入、序列化值类型或性能优势。

### 2.3 实现责任与可复用工具

本项目负责表单状态、字段生命周期、事务提交、数组身份、异步校验调度、提交结果与 Feature 协议。

允许复用通用数据结构、不可变更新工具和独立校验库。它们不能成为另一套表单状态或字段生命周期的所有者。自研 Core 不等于所有基础算法必须自行实现。

具体数据结构、类型构造、SSR 资源管理与可选校验器接入需要原型验证；这些待验证事项不改变 Core 所有权和 Renderer 独立性的架构边界。



## 3. 默认使用流程

### 3.1 项目级：建立基础系统

```tsx
// form-system.ts
import {
  configureForms,
  formFeatures,
  cache,
  dev,
} from '@chanyuxi/form-react'

import { TextControl, NumberControl } from './controls'
import { StandardField, CompactField } from './fields'

export const baseForms = configureForms({
  features: formFeatures([
    cache(),
    dev(),
  ]),
})
```

`baseForms` 已具备无头定义和实例化能力。来自 React 包的基础门面还提供 React 生命周期与订阅接入；它尚未绑定内建 Renderer 的 Presentation。

此时没有 FormInstance、用户值、缓存实例或控件连接。`configureForms` 只配置可复用工厂。

### 3.2 项目级：可选 UI 扩展

```tsx
export const forms = baseForms.ui({
  controls: {
    text: TextControl,
    number: NumberControl,
  },

  fields: {
    standard: StandardField,
    compact: CompactField,
  },

  defaultField: 'standard',
})
```

`TextControl`、`NumberControl` 是已声明值契约并完成绑定的 Control 描述；`StandardField`、`CompactField` 是遵循基础 Field props 协议的自定义外观。

`.ui()` 返回新系统，不修改 `baseForms`。业务模块通常只导入 `forms`，不重复系统配置。

不需要复用基础系统变量时，可以链式书写：

```tsx
export const forms = configureForms({
  features,
}).ui(presentation)
```

两个写法的语义完全相同。忽略 `.ui()` 的返回值，不会为原对象增加任何能力。

### 3.3 业务级：定义一份 Schema

```ts
// profile-schema.ts
import { forms } from './form-system'

export const profileSchema = forms.defineSchema([
  {
    name: 'name',
    control: 'text',
    label: '姓名',
    defaultValue: '',
    enableCache: false,
  },
  {
    name: 'age',
    control: 'number',
    label: '年龄',
    defaultValue: null,
    enableCache: true,
  },
  {
    name: 'nickname',
    control: 'text',
    label: '昵称',
    field: 'compact',
    defaultValue: '',
  },
])

// 预期推导：
// { name: string; age: number | null; nickname: string }
```

同一个字段对象可以同时使用 Core、Feature 和 Renderer 提供的配置。增强后的 `defineSchema` 统一检查它们，内部按归属处理。

`number` Control 的值契约是 `number | null`，因此 `null` 默认值不会把类型收窄成只能为 `null`。

### 3.4 页面级：创建与呈现

```tsx
// profile-form.tsx
import { forms } from './form-system'
import { profileSchema } from './profile-schema'

interface ProfilePayload {
  name: string
  age: number | null
  nickname: string
}

export function ProfileForm({
  save,
}: {
  save: (values: ProfilePayload) => Promise<void>
}) {
  const form = forms.useForm(profileSchema)

  return (
    <form noValidate onSubmit={form.handleSubmit(save)}>
      {form.renderField('name')}
      {form.renderField('age')}
      {form.renderField('nickname', { field: 'standard' })}

      <button type="submit">保存</button>
    </form>
  )
}
```

`useForm` 创建并保留自研 Core 实例。UI 系统返回的实例门面额外提供字段呈现入口，但所有数据与提交仍来自同一个 Core。

`noValidate` 配合 Runtime 校验；示例不使用浏览器原生约束作为另一套隐式提交流程。提交错误、重复提交与结果通道见第 12 节。

### 3.5 无 Hook 创建

```ts
const form = forms.create(profileSchema)

form.setValue('name', 'Jason')
form.getField('age').set(28)

const values = form.values
```

此时无需挂载组件即可读写、校验、重置和提交。来自 UI 系统的实例门面具有呈现能力，但控件只在真正渲染时连接。

### 3.6 默认路径不要求额外装配

```text
项目共享配置：
configureForms → 可选 .ui

每张表单：
defineSchema → useForm / create
```

用户不必额外调用 `createRenderer`、`createHelper`、`definePresentationSchema` 或 `bindCoreAndPresentation`。这些职责由库的内部模块完成。



## 4. 系统扩展、Renderer 与依赖方向

### 4.1 三类能力的归属


| 模块          | 负责                                                   | 不负责                           |
| ----------- | ---------------------------------------------------- | ----------------------------- |
| Core        | 字段定义、值与基线、元数据、校验、事务、提交、数组身份                          | 组件、Control 名称、UI props、布局、DOM |
| Feature     | 受协议约束的定义扩展、状态切片、方法和资源行为                              | 安装内建 Renderer，解释 Presentation |
| 内建 Renderer | Presentation 注册、UI Schema 配置、呈现投影、Control 与 Field 装配 | 另建 values、业务校验和提交所有权          |
| 框架适配        | Hook/ref/订阅、事件与生命周期连接                                | 决定字段数据语义，注册另一套表单引擎            |


Presentation 是 Renderer 的配置对象；`Presentation Plan` 是统一 Schema 中呈现部分的归一化结果。两者都不属于 Core Feature。

“内建”表示库提供现成 Renderer 实现和 `.ui()` 配置入口，不表示库强制提供或绑定某套视觉组件库。

### 4.2 .ui() 的不可变扩展契约

```ts
const baseForms = configureForms({ features })

const adminForms = baseForms.ui(adminPresentation)
const mobileForms = baseForms.ui(mobilePresentation)
```

必须满足：

1. `adminForms !== baseForms`，`mobileForms !== baseForms`。
2. 基础配置与 Feature 的只读描述可以复用；注册表、呈现默认值分别绑定到增强系统。
3. 不修改 `baseForms` 的公开方法集合、Schema 配置能力或行为。
4. 不创建 Runtime、FieldInstance、Feature 实例状态、DOM 或外部订阅。
5. 不修改已经定义的 Schema 或已创建的表单。
6. 每次 `.ui()` 返回独立系统句柄；同一 Presentation 对象重复传入也不表示返回相同系统身份。
7. 配置校验失败时不影响基础系统或其已有的其他增强系统。
8. 忽略返回值等于没有采用该次 UI 扩展。

Presentation 在配置时归一化为库拥有的只读记录。随后原地修改调用者传入的配置对象，不是注册表更新入口；组件与函数引用本身无需递归冻结。

UI 系统的注册表在其生命周期内固定。当前公开契约只在基础系统上提供 `.ui()`；已增强系统不提供二次 `.ui()` 合并或覆盖。需要另一套 UI 时，从基础系统创建另一个增强系统。

### 4.3 配置系统与表单实例是不同层次

```text
configureForms / .ui
    → 配置工厂

defineSchema
    → 创建只读定义

create / useForm
    → 创建具体表单实例

renderField
    → 创建某个字段的视图入口
```

创建两个 UI 系统不会创建两张表单。用同一个 UI 系统创建两张表单，也不会让它们共享用户数据。

`.ui()` 是系统级 API，不是 `form.ui()` 或 `field.ui()`。它不用于把已存在的纯 Core 实例事后升级成可自动渲染的实例。

### 4.4 能力矩阵与类型累积


| 能力                                                       | React 基础系统   | 调用 .ui() 返回的 React UI 系统   |
| -------------------------------------------------------- | ------------ | -------------------------- |
| Core 与 Feature 配置                                        | 有            | 有，复用基础描述                   |
| 显式值模型的纯数据 Schema                                         | 有            | 底层能力可复用；默认入口使用统一 UI Schema |
| `create` / `useForm`                                     | 有            | 有                          |
| Core 状态、命令与 Feature 方法                                   | 有            | 有                          |
| `useFormState` / `useFieldState`                         | 框架导出的订阅能力可使用 | 同一订阅能力                     |
| `handleSubmit`                                           | 框架事件适配       | 同一 Core 提交流程               |
| `control`、`controlProps`、`field`、`fieldProps`、呈现 `drive` | 不作为内建配置提供    | 来自当前 Presentation          |
| `renderField`、`field.render`、`field.Field`               | 无            | Renderer 提供                |
| 基于 Control 连接的 `focus`                                   | 无自动连接        | Renderer 提供                |
| `.ui(presentation)`                                      | 返回新 UI 系统    | 不提供注册表二次变更入口               |


概念类型：

```text
BaseSystem<TFeatures, TContext>
  → UiSystem<TFeatures, TContext, TControls, TFields>
```

这表示返回值获得额外类型信息，不使用断言原地拓宽 `baseForms`，也不依赖全局声明合并让未扩展系统意外获得 UI 属性。

上述基础系统指框架包的基础门面。纯 Core 包不导出 React Hook、事件适配或 `.ui()`，见第 16 节。

### 4.5 一份 Schema 的处理链

```text
baseForms.ui(presentation)
    │
    ▼
UiSystem
  ├─ 基础 Core / Feature 配置
  └─ 内建 Renderer 绑定的 Presentation
    │
    ▼
forms.defineSchema(统一字段配置)
    │
    ├─ 数据与 Feature 配置 → Core 定义处理器
    └─ 呈现配置            → Renderer 定义处理器
    │
    ▼
AppSchema（一个公开、只读、带所属系统身份的句柄）
  ├─ 私有 Core Definition
  └─ 私有 Presentation Plan
    │
    ▼
forms.create / useForm
  ├─ Core 只接收 Core Definition
  └─ Renderer 门面持有 Presentation Plan
    │
    ▼
一份 Core 状态 + 多个按需订阅的字段视图
```

内部可以分阶段或组合执行归一化，但不得让 Core 依赖 Renderer 类型，也不得通过 Feature 钩子让 Presentation 混入 Feature 状态。

`control: 'text'` 由 Renderer 的定义处理器解析。它可把注册描述中的默认值工厂、值契约等转换成独立的数据描述，再交给 Core。Core 不查找 `'text'`，不导入 `TextControl`，不等待控件挂载。

### 4.6 Schema 配置键的所有权


| 配置类别                                                         | 所有者        |
| ------------------------------------------------------------ | ---------- |
| `name`、`kind`、数据模板、默认值、`validate`、`validateWhen`             | Core       |
| `enableCache` 等 Feature 自有属性                                 | 对应 Feature |
| `control`、`controlProps`、`field`、`fieldProps`                | Renderer   |
| `label`、`description`、呈现 `visible/disabled/readOnly`、`drive` | Renderer   |


Feature 只能声明自己拥有的配置键。`.ui()` 创建增强系统时，Renderer 检查自身保留键与 Feature 声明是否冲突；冲突明确报错，不按扩展或注册顺序覆盖。

Core 无需内置 Renderer 保留键列表。该跨域检查位于框架装配与统一 Schema 处理层。Field/Control 的运行时锁定等业务能力如有提供，必须使用独立 Core 契约，不能把 UI `disabled` 直接解释成业务授权。

### 4.7 门面与依赖图

```text
应用
  → 框架入口 configureForms
      → 自研 Core
      → 内建 Renderer（仅框架/呈现方向依赖）
          → 用户注册的 Control / Field

Core
  → 通用数据工具、独立校验接口
  × Renderer / React / Vue / 控件库 / 第三方表单引擎
```

`.ui()` 由框架入口提供，委托库内建 Renderer 处理配置。方法出现在基础系统门面上，不意味着 Core Runtime 或 Core 包实现了 UI 逻辑。

未调用 `.ui()` 时，不创建 Renderer 注册表或视图运行资源。构建是否完全移除未使用 Renderer 代码，需要单独的产物测试，不凭 API 形式承诺零体积。

UI Form/Field 门面只委托同一个 Core；不得镜像或双向同步另一份可写 values。Renderer 派生缓存和控件连接表不是业务值的第二个所有者。

### 4.8 自研内核责任


| 内核模块     | 项目负责的协议                                  |
| -------- | ---------------------------------------- |
| 字段定义与注册表 | 路径、逻辑成员、稳定句柄与结构模板                        |
| 值与基线     | values、defaultValues、dirty、touched、reset |
| 状态与事务    | 准备、提交、快照、版本、通知与退订                        |
| 数组       | 创建、删除、重排、itemId 与默认值定位                   |
| 校验       | 触发、输入快照、条件、结果有效性与错误来源                    |
| 提交       | 快照、校验、转换、锁、结果与取消                         |
| Feature  | 状态切片、方法注入、冲突与 reset 协议                   |
| 生命周期     | 资源租约、任务失效、所有权与 dispose                   |


不依赖 `react-hook-form`、`@hookform/resolvers` 或其他第三方表单引擎完成上述行为，不透传对应控制对象或类型。独立校验器只计算结果，不能接管字段或提交状态。



## 5. 统一 Schema、类型与 Control 契约

### 5.1 基础定义与增强定义

基础系统的 `defineSchema` 只处理 Core 和已注册 Feature 的配置。字段值类型由显式值模型或独立数据描述提供：

```ts
interface ProfileValues {
  name: string
}

const schema = baseForms.defineSchema<ProfileValues>()([
  {
    name: 'name',
    defaultValue: '',
    enableCache: false,
  },
])
```

UI 系统的 `defineSchema` 额外绑定当前 Renderer 注册表，默认从已适配的 Control 描述获得值契约：

```ts
const forms = baseForms.ui(presentation)

const schema = forms.defineSchema([
  {
    name: 'name',
    control: 'text',
    defaultValue: '',
    enableCache: false,
    label: '姓名',
  },
])
```

用户只填写一次字段；不返回要求用户手动传递的 `coreSchema` / `uiSchema` 对。

统一定义处理器必须完成：

1. 检查字段名、路径和结构冲突。
2. 按 Core、Feature、Renderer 的配置键所有权检查输入。
3. 检查 Control / Field 属于当前 UI 系统的注册表。
4. 合成默认数据描述与呈现默认值，分别交由对应模块处理。
5. 建立字段名、值类型、Control props、Field props 和 Feature API 的类型关系。
6. 返回不可变定义；不创建运行状态，不挂载组件，不发起异步任务。

### 5.2 系统身份与定义复用

每份编译后的 Schema 绑定创建它的系统作用域。基础系统、两个从同一基础系统扩展的 UI 系统，以及独立配置的系统，均有明确身份。

```ts
const adminForms = baseForms.ui(adminPresentation)
const mobileForms = baseForms.ui(mobilePresentation)

const schema = adminForms.defineSchema(fields)

adminForms.create(schema)  // 属于当前系统
// mobileForms.create(schema)  // 不允许隐式改用另一套注册表
```

静态类型尽可能检查可表达的注册契约差异；两个工厂结构完全相同时，不能仅凭 TypeScript 结构类型宣称已证明它们是同一个运行时系统。实例创建仍需验证所属系统身份。

同一系统可以复用编译后的 Schema 并创建多个独立实例。跨系统复用的是源字段配置、值模型或纯规则，再由目标系统定义；不是将一个已编译句柄强制解释为另一套 UI。

`.ui()` 不修改已有基础 Schema 的类型和内容，也不会让它自动获得 `control`。默认顺序是先完成所需扩展，再通过相应系统定义 Schema。

Core 实例的 `schema` 只暴露 Core Definition。UI 实例门面的 `schema` 可以暴露其所属 AppSchema；Core 在内部只持有其中的数据定义，不会反向读取 Presentation Plan。

### 5.3 值类型的来源

默认路径由 Control 的**显式值契约**提供类型，并验证用户默认值；不是反射任意组件，也不是仅从 `defaultValue: ''` 推导一个字符串字面量类型。

```tsx
// 由 Control 作者写一次，业务用户反复复用。
export const TextControl = defineControl<string>({
  defaultValue: '',
  render: TextControlView,
})

export const NumberControl = defineControl<number | null>({
  defaultValue: null,
  render: NumberControlView,
})
```

采用两段式泛型调用是 API 形状提议：显式指定值类型后，仍保留对组件额外 props 的推导空间。完整可行性必须由类型测试验证。

对象/数组默认值需要 `createDefault()`，每次实例化获得独立值。`defaultValue` 与 `createDefault` 不得同时声明。

Control 描述可以提供默认值工厂或纯数据 codec，但这些成员必须能独立于渲染组件运行。仅渲染层负责控件草稿、事件和 ref。

### 5.4 默认值不等于运行时验证

静态值类型不意味着外部数据自动合法。服务端数据、持久化数据和 JavaScript 调用必须经过显式解析或验证边界。类型注解不会代替运行时验证。[R8](https://www.typescriptlang.org/docs/handbook/2/basic-types.html)

普通模式不强制写 Values 接口；高级模式允许显式输入模型或独立校验 Schema。两种模式都不允许用类型断言掩盖控件写回值与字段类型的冲突。

### 5.5 Control 是双向读写契约

兼容性要求：

```text
字段可能产生的值 → Control 能读取
Control 可能写回的值 → 字段能够接受
```

例如 `'admin' | 'user'` 不能仅因为属于 `string`，就安全交给会写回任意字符串的输入框。可使用受限编辑器或显式 codec/校验边界。

类型实现须验证此双向约束，不依赖宽松函数参数检查碰巧通过。

### 5.6 输入值与提交结果分离

核心类型需要预留：

```ts
FormInstance<TInputValues, TSubmitValues, TContext>
```

默认 `TSubmitValues = TInputValues`。只有显式提交转换或解析器声明才改变输出类型，不能把显示格式化当成输出类型转换。

字段的 `get/set` 使用输入值类型；提交回调使用输出类型。转换不能悄悄覆盖当前输入值。

### 5.7 名称与路径

普通字段以规范化 `name` 确定数据绑定与逻辑身份。

第一阶段至少验证：

- 同层名称重复。
- `profile` 叶子字段与 `profile.name` 子路径冲突。
- 无效数组寻址及越界命令。
- 危险路径段（如 `__proto__`）和原型链穿透。
- field name 和路径语法的转义规则。

嵌套结构不依赖任意 `eval` 或表达式解析。数组稳定身份另见第 13 节。

### 5.8 “不可变”的准确含义

`readonly` 提供类型约束；运行时归一化复制库拥有的普通记录/数组，开发模式可冻结这些结果。

不得递归冻结使用者的 React 组件、外部库实例或函数闭包。`Object.freeze` 不能使闭包捕获的外部状态不可变；因此 `drive`、校验器等规则仍须遵守输入与纯度约束。

数据容器的默认支持范围是标量、普通对象与数组。Date、Map、File、自定义类等必须有明确的复制、比较、校验与序列化策略，不能靠 JSON 克隆冒充完整支持。



## 6. Definition、Runtime、View

### 6.1 三类职责


| 层          | 保存或负责什么                         | 不负责什么                   |
| ---------- | ------------------------------- | ----------------------- |
| Definition | 字段契约、结构模板、规则、feature 配置         | 当前用户输入、当前请求结果           |
| Runtime    | 值、基线、元数据、context、规则执行、任务、逻辑实例   | DOM、组件布局、控件库私有 props 解释 |
| View       | 呈现计划求值、字段订阅、Control 绑定、Field 外观 | 擅自删除字段、改变值契约、重建默认值      |


统一 Schema 的呈现规则被编译为内建 Renderer 的 Presentation Plan。Core 不解释 UI 属性，Feature 也不负责执行该计划。Renderer 只读取已提交的 Core 输入并管理自己的派生缓存。

### 6.2 “规则不变，结果改变”

```text
定义：
没有选择国家时，城市字段禁用

输入一：
country = ''

结果一：
disabled = true

输入二：
country = 'ID'

结果二：
disabled = false
```

结果改变不代表定义改变。新的派生对象也不代表新的字段实例。

### 6.3 三类状态所有权

```text
表单数据与业务状态：
Core Runtime

标签/placeholder/控件选项等规则的投影：
Presentation Plan + 已提交 Runtime 快照

弹层展开、hover、局部编辑草稿：
具体 Control 或框架组件
```

局部草稿若会影响提交，必须有显式 flush/commit 协议，不能一直藏在控件里却让引擎提交旧值。

当前实现范围默认 Control 采用每次输入即可写入 Core 的值模型。需要保留 `'-'`、`'1.'` 等编辑态时，可以把输入模型设计为字符串，再在提交阶段解析；`number | null` 并不自动解决所有数字编辑态。完整的独立草稿提交协议在验证前不列为默认能力。

### 6.4 可写输入与只读派生结果分开

`values`、`context`、任务结果通过命令更新。`drive` 的结果只读，不能既由规则生成又由 `setDisabled` 等命令无约定地覆盖。

需要当前 JSX 提供外观覆盖时，使用明确的呈现覆盖层；覆盖不写回 Schema，也不隐式改变业务规则。



## 7. 动态规则：drive、命令与异步资源

### 7.1 drive 的职责

`drive` 是由 `.ui()` 增加到统一 Schema 的 Renderer 配置能力。它是同步纯函数，定义由 Renderer 处理，求值读取当前 Core 输入快照，不注册为 Feature：

```ts
type Drive<TValues, TContext, TPresentation> = (
  input: {
    readonly values: Readonly<TValues>
    readonly context: Readonly<TContext>
  },
) => Partial<TPresentation>
```

正式类型需要递归只读；这里的 `Readonly` 只用于压缩示例。

当前实现范围允许输出：

```ts
interface DrivenPresentation<TControlProps, TFieldProps> {
  readonly label?: string | null
  readonly description?: string | null
  readonly visible?: boolean
  readonly disabled?: boolean
  readonly controlProps?: Readonly<Partial<TControlProps>>
  readonly fieldProps?: Readonly<Partial<TFieldProps>>
}
```

不得输出：

```text
name / 数据路径 / 值类型 / 字段集合 / 数组模板
control 名称 / feature 安装集合 / 实例方法
当前值 / 默认值基线 / 可变校验器集合
```

`controlProps` 必须排除引擎掌握的绑定入口，例如受控 `value/checked`、核心写入回调和内部 ref。不得通过 `controlProps` 间接重新定义数据绑定。

`drive` 的职责不是接收任意 `Partial<FieldDefinition>`。

### 7.2 配置 context，而不是捕获某次渲染

下面的地址表单将运行环境配置在基础系统，将 UI 注册配置在 `.ui()`；业务字段仍使用一份 Schema。

```ts
interface AddressContext {
  locale: 'zh' | 'en'
  readOnly: boolean
  cityOptionsByCountry: Readonly<
    Record<string, readonly { value: string; label: string }[]>
  >
}

function createAddressContext(): AddressContext {
  return {
    locale: 'zh',
    readOnly: false,
    cityOptionsByCountry: {},
  }
}

const addressBase = configureForms({
  features: formFeatures([]),
  createContext: createAddressContext,
})

const addressForms = addressBase.ui({
  controls: {
    select: StringSelectControl,
  },
  fields: {
    standard: StandardField,
  },
  defaultField: 'standard',
})

const EMPTY_OPTIONS: readonly { value: string; label: string }[] = []

const addressSchema = addressForms.defineSchema([
  {
    name: 'country',
    control: 'select',
    defaultValue: '',
    label: '国家',
  },
  {
    name: 'city',
    control: 'select',
    defaultValue: '',

    drive: ({ values, context }) => ({
      label: context.locale === 'zh' ? '城市' : 'City',
      disabled: context.readOnly || values.country === '',
      controlProps: {
        options:
          context.cityOptionsByCountry[values.country]
          ?? EMPTY_OPTIONS,
      },
    }),
  },
])
```

`createContext` 在每个实例上创建独立容器，必须是纯工厂。context 内部的只读外部数据可以共享引用，但不得被 Runtime 原地修改。更新嵌套 context 数据时必须提供新引用；不得先原地修改旧对象，再期待引用比较能够发现变化。

```ts
const form = addressForms.create(addressSchema)

form.setValue('country', 'ID')
form.patchContext({ locale: 'en' })
form.patchContext({ cityOptionsByCountry: nextOptions })
```

这些命令不替换 Schema，不重新安装 feature。

### 7.3 当前实现范围不以复杂依赖图为前提

默认在相关 Runtime 输入快照变化后重新计算需要读取的字段投影；当前实现范围可以保守地重新计算全部 `drive`。

这是求值优化问题，不是字段生命周期问题。

后续可增加显式依赖或自动追踪，但必须保留一个正确的保守路径。不得要求使用者漏填一个依赖就静默得到旧值，却又不说明依赖声明的正确性责任。

当前实现范围不允许 `drive` 任意读取另一个字段的派生结果，从源头避免派生循环图。读取原始 values 与 context 已足以覆盖大量联动。

### 7.4 派生结果不必成为第二套可写仓库

呈现层可以对同一个已提交 Core 快照计算并缓存结果：

```text
CoreSnapshot revision = 12
        ↓
evaluatePresentation(plan, snapshot)
        ↓
FieldViewSnapshot revision = 12
```

同一字段视图不得混用 revision 12 的值与 revision 11 的选项。

缓存可以是框架适配层内部实现，但必须满足稳定快照契约；不得每次 `getSnapshot()` 返回没有变化的新对象。

### 7.5 数据联动是命令，不是 drive

国家变化时清空城市：

```ts
form.transaction(tx => {
  tx.setValue('country', nextCountry)
  tx.setValue('city', '')
}, {
  cause: 'user:change-country',
})
```

初始化数据则可以是：

```ts
form.reset({
  values: {
    country: 'ID',
    city: 'jakarta',
  },
})
```

两者不应被一个“country 变化就永远清空 city”的 watcher 混为一谈。

当前实现范围优先用同步事务命令表达数据联动；通用 reaction DSL 延期。真正的同步业务约束必须在一次提交前完成，不通过多轮通知后补写制造中间无效状态。

### 7.6 异步联动是受管理的任务

请求城市列表不是 `async drive`。

```text
提交 country 的新值
    ↓
在副作用阶段启动带 requestKey 的任务
    ↓
请求完成
    ↓
检查 form epoch、requestKey、requestId 是否仍有效
    ↓
发布资源输入或 context
    ↓
重新计算呈现
```

约束：

- 旧国家的结果不得覆盖新国家。
- 加载期间空 options 不自动代表当前 city 无效。
- 取消请求用于节省资源；版本检查保证正确性。
- 不自动重实现服务端缓存；允许接入外部数据层。
- `create`、`drive` 和 `getSnapshot` 不启动网络请求。

公共资源 API 暂不定名。当前实现范围可以由应用 effect/数据层调用 `patchContext`，但应用必须处理请求竞态。库提供资源 feature 时再统一接管。

### 7.7 React props 和 Runtime context 的边界

当前 label、Field 外观、纯 UI disabled 可以直接传给 `renderField`，不必先写入 Core：

```tsx
form.renderField('city', {
  label: t('city'),
  disabled: readOnly,
})
```

影响校验、提交或 Schema `drive` 的共享输入，应通过明确的 Runtime context 通道提供；仅在当前 JSX 中消费的文案、主题与外观可留在框架 props/Context。业务环境不能只改 UI 后假定 Core 已同步。

本 RFC `useForm` 的 context 初始化参数叫 `initialContext`，不把“只读一次”伪装成响应式输入。后续修改通过 `patchContext`；由 React props 同步时，在提交后 effect 中执行，而不是 render 中修改共享实例。

这种桥接存在一次提交阶段的同步边界：引擎在发布新 context 前仍使用旧的完整快照。不得同时把新 props 当作已生效业务环境，却用旧 context 提交数据。要求同刻生效的业务切换应通过同一个事件命令更新 Runtime，或者显式切换表单会话。

自动的受控 context 桥接列为后续能力，不把未经验证的 render-time ref 写入当成解决方案。



## 8. 固定定义、实例身份与数据更新

### 8.1 固定的是 Core Definition

**一个 FormInstance 在其生命周期内绑定一份 Core Definition。**

不提供公开 `replaceSchema`。普通字段类型、路径、规则函数和 feature 安装集合不热替换。

这是有意减少状态迁移承诺，而不是“不可变对象”的逻辑必然结论。

以下操作不构成定义替换：

- 改变 values、默认值基线或 context。
- 根据已有规则改变显隐、标签、选项、禁用状态。
- 按已定义模板增删数组项。
- 为当前视图选择兼容 Control 或 Field 外观。

### 8.2 useForm 参数是初始化参数

```ts
forms.useForm(initialSchema, {
  initialValues,
  initialContext,
  defaultField,
})
```

其中全部为当前实例的初始配置。

后续收到另一个 Schema 引用：

- 不重建实例。
- 不自动采用新定义。
- 不清空输入。
- 开发环境发出一次明确的“初始化定义变化被忽略”诊断。
- 不进行闭包语义比较；对象是否等价不影响输入保留。

推荐在模块级定义可复用 Schema。允许内联构造但不推荐其开销；缓存只是优化，不是数据安全前提。React 对 `useMemo` 的定位也是性能优化，而非正确性保证。[R5](https://react.dev/reference/react/useMemo)

同一 Hook 调用不能承诺随着运行时参数变化而改变静态 `TValues`；条件性的不同值契约应隔离到不同的表单会话和组件类型边界。

### 8.3 真正更换定义：显式创建新会话

```tsx
<ProfileEditor
  key={formSessionId}
  schema={selectedSchema}
  initialValues={migratedValues}
/>
```

只有业务上决定开启新会话时才改变 key。React 的 key 可用来重置对应组件子树状态；它不能自动销毁组件外共享的 Core 实例。[R6](https://react.dev/learn/preserving-and-resetting-state)

显式迁移流程：

```text
验证目标 Schema
    ↓
纯函数迁移当前值
    ↓
成功创建新实例
    ↓
应用切换到新实例
    ↓
旧实例停止任务、解除连接、由所有者清理
```

先创建失败不得破坏当前可用表单。迁移值不等于迁移 dirty、touched、错误、缓存、焦点或异步任务。

### 8.4 异步加载初始数据不是换 Schema

```ts
form.reset({ values: loadedProfile })
```

此操作明确建立新的值与默认值基线。切换记录时，应用必须选择新会话或明确 reset；不能依赖某个 `initialValues` prop 新引用悄悄覆盖输入。

请求 A/B 的先后竞态应由请求身份解决，不能仅检查返回数据的字段名。

### 8.5 成员、视图、校验与提交分别定义


| 操作/状态                 | 仍是成员 | 保留值 | 默认参与校验 | 默认进入提交输入 |
| --------------------- | ---- | --- | ------ | -------- |
| 未调用 `renderField`     | 是    | 是   | 是      | 是        |
| `visible: false`      | 是    | 是   | 是      | 是        |
| 仅 UI `disabled: true` | 是    | 是   | 是      | 是        |
| Schema 中已存在的数组条目被删除   | 否    | 否   | 否      | 否        |
| 换用兼容 Control          | 是    | 是   | 是      | 是        |


这里的提交来自 Core values，不采用浏览器 `FormData` 的默认序列化规则。

需要跳过校验，使用显式规则；需要从请求体省略字段，使用提交转换。当前实现范围不加入隐式 `submit: false` 再让返回类型假装始终完整。



## 9. Form / Field API 与状态语义

### 9.1 命名原则

Form 操作带目标名；Field 已绑定目标，允许较短命名：

```ts
form.getValue('name')
field.value
```

重置值且清理元数据统一叫 `resetField` / `field.reset`，不叫含义模糊的 `resetValue`。当前实现范围不同时提供多套等价别名。

### 9.2 Core Form API

以下是能力分组，不是完整声明文件。


| API                                    | 语义                                    |
| -------------------------------------- | ------------------------------------- |
| `state`                                | 当前已提交的只读快照，不自动建立 React 订阅             |
| `schema`                               | 本实例绑定的只读定义；Core 不包含可执行 UI 依赖          |
| `values` / `getValue(name)`            | 读取完整值或指定字段值，不执行校验或副作用                 |
| `setValue(name, value, options?)`      | 更新字段值                                 |
| `setValues(values)`                    | 整体替换当前值；不自动修改默认值基线                    |
| `patchValues(patch)`                   | 顶层键 patch；嵌套路径使用 `setValue`，不做含糊的递归合并 |
| `defaultValues`                        | 读取当前默认值基线                             |
| `setDefaultValues(patch)`              | 只修改指定基线，不覆盖当前输入                       |
| `reset(options?)`                      | 恢复/建立数据基线并清理会话元数据                     |
| `resetField(name)`                     | 重置该字段及其错误、touched、校验任务                |
| `context` / `patchContext(patch)`      | 读取/更新运行环境；对象属性按显式 patch 更新            |
| `fields` / `getField(name)`            | 字段集合和逻辑句柄                             |
| `validate()` / `validateField(name)`   | 执行校验，返回有状态的结果                         |
| `hasError(name?)`                      | 是否存在当前错误，不等价于“已经验证通过”                 |
| `setError(...)` / `clearErrors(...)`   | 按来源设置/清理问题                            |
| `transaction(callback, options?)`      | 同步、可准备后提交的批次写入                        |
| `subscribe(listener)`                  | 订阅已提交快照，返回退订函数                        |
| `submit(handler)`                      | 无 DOM 依赖的提交入口                         |
| `dispose()`                            | 明确终止实例资源与命令能力                         |


`values` 和其他快照属性返回只读数据；不得把外部原地修改当成合法更新。写入边界必须防止调用者之后修改同一个数组/对象绕过通知。

`fields` 返回当前顶层逻辑节点，顺序来自定义；数组条目通过数组句柄枚举。`getField(path)` 在调用时把路径解析为当前逻辑字段，不存在时返回明确的 `FIELD_NOT_FOUND` 错误。需要跨重排持有子字段时使用稳定条目句柄，不反复复用旧索引路径。

### 9.3 Field API

```ts
field.name
field.state
field.value
field.set(value)
field.set(value, options)

field.defaultValue
field.setDefault(value)
field.reset()

field.isDirty
field.hasError
field.markTouched()
field.validate()
field.clearErrors()

field.subscribe(listener)
```

普通字段的方法与实例身份稳定。数组字段/条目使用扩展句柄，不靠创建新方法闭包捕获不断变化的索引。

### 9.4 框架适配与 Renderer 门面的能力

React 事件适配层提供 `handleSubmit`，委托 Core 的 `submit`。通过 `.ui()` 建立的系统另外返回 Renderer 门面，提供 `renderField`、字段组件与焦点连接。以下为完整 UI 实例的额外入口；基础实例不自动具备字段呈现方法：

```ts
form.renderField(name)
form.renderField(name, options)
form.handleSubmit(onValid)
form.handleSubmit(onValid, options)
form.setFocus(name)

field.render()
field.render(options)
field.Field
field.focus()
```

`focus` 返回是否找到可用控制连接。没有视图时返回失败，不删除字段、不创建 DOM。

`field.Field` 的组件类型在同一个逻辑字段生命周期内必须稳定；不得因为一次值变化或 drive 求值重新制造组件类型。

### 9.5 状态集合

建议基础状态：

```ts
interface FormState<TValues> {
  readonly revision: number
  readonly values: TValues
  readonly defaultValues: TValues

  readonly isDirty: boolean
  readonly dirtyFields: Readonly<Record<string, boolean>>
  readonly touchedFields: Readonly<Record<string, boolean>>

  readonly validationStatus:
    | 'unvalidated'
    | 'validating'
    | 'valid'
    | 'invalid'

  readonly isValid: boolean
  readonly isValidating: boolean
  readonly errors: readonly FormIssue[]

  readonly isSubmitting: boolean
  readonly isSubmitted: boolean
  readonly isSubmitSuccessful: boolean
  readonly submitCount: number

  readonly features: Readonly<Record<string, unknown>>
}
```

完整实现会使用精确路径类型和递归只读，而不是最终停留在 `Record<string, unknown>`。

基础状态由本项目的行为规范决定，不从其他表单库复制状态列表。当前不默认提供 `isReady`、`isLoading`：同步构造成功即得到可读实例；外部数据加载或 resource loading 使用有明确定义的资源状态。相似命名不代表与第三方表单库语义兼容。

### 9.6 dirty 与 touched

默认语义：

```text
isDirty = 当前值与当前默认值基线不同
```

用户改回基线后，dirty 恢复 false。若需要“历史上修改过”，另用 feature，不重用 dirty。

`touched` 默认由 Control 失焦或显式 `markTouched` 产生。`setValue` 不默认把字段标记 touched。

整表 dirty 根据完整数据与集合结构判断，不简单等于叶子字段 dirty 的 OR；数组增删、顺序改变也可能让整表 dirty。

### 9.7 默认值与 reset 的确定语义

初始化分成“默认值基线”和“当前值”两个阶段，二者不能混为一谈。

默认值基线按以下优先级合成：

```text
CreateOptions.defaultValues 的显式字段值
    > 字段 defaultValue/createDefault
    > Control/值描述的默认值
    > 缺失错误，或值契约明确允许的 undefined
```

当前值再按以下优先级合成：

```text
CreateOptions.initialValues 的显式字段值
    > 已合成的默认值基线
```

`initialValues` 只描述实例创建时的当前值，不隐式改写 `defaultValues`。因此两者不同的字段创建后立即为 dirty；省略 `initialValues` 时，当前值直接采用默认值基线。

缺失判断使用属性是否存在，不把 `0`、`false`、`''`、`null` 当作缺失。


| 调用                                     | 当前值         | 默认值基线      | 元数据                      |
| -------------------------------------- | ----------- | ---------- | ------------------------ |
| `setValue`                             | 更新          | 不变         | dirty 重算；不自动 touched     |
| `setDefaultValues`                     | 不变          | 按 patch 更新 | dirty 重算                 |
| `reset()`                              | 恢复当前基线      | 不变         | 清除错误/touched/提交状态，失效化旧任务 |
| `reset({ values })`                    | 使用显式 values | 同时建立新基线    | 同上                       |
| `reset({ values, asDefaults: false })` | 使用显式 values | 保留旧基线      | 同上，但 dirty 可为 true       |
| `resetField(name)`                     | 恢复字段基线      | 不变         | 仅清理该字段相关元数据和任务           |


`reset` 不修改绑定定义，不清空 context。feature 的 reset 语义由其明文协议决定，不能统一重新安装 feature。

### 9.8 读写状态与已提交快照

```ts
const before = form.state

form.setValue('name', 'Jason')

const after = form.state
```

如果本次值确实发生变化，`after` 是新快照；没有变化则保留引用。

同步命令返回后，Core getter 可以读取提交后的值。组件当前 render 已获得的快照不会被原地改写。



## 10. Control、Field 与呈现覆盖

### 10.1 内建 Renderer 的三层呈现边界


| 层          | 职责                        |
| ---------- | ------------------------- |
| Control    | 具体输入协议、值转换、失焦、可选编辑草稿和焦点连接 |
| Field      | 标签、说明、错误、Control 插槽和无障碍关联 |
| Whole Form | 应用编写表单容器、分组、顺序、按钮与布局      |


不默认提供 `form.render()` 或 `form.Form`。可复用布局由应用封装，并调用已有字段入口。

### 10.2 自定义 Control 接入

内建 Renderer 提供绑定与组合协议，不接管使用者的视觉实现。适配作者实现 Control 描述中的 `render`，通过 `.ui({ controls })` 注册；业务 Schema 再用注册名引用。普通表单不需要重复实现值和事件绑定。

```tsx
interface ControlViewProps<TValue, TProps> {
  field: FieldInstance<TValue>
  props: Readonly<TProps>

  disabled: boolean
  readOnly: boolean

  a11y: {
    controlId: string
    describedBy?: string
    invalid: boolean
  }

  connect: (target: { focus(): void } | null) => void
}

interface TextProps {
  placeholder?: string
  autoComplete?: string
}

function TextControlView({
  field,
  props,
  disabled,
  readOnly,
  a11y,
  connect,
}: ControlViewProps<string, TextProps>) {
  const { value } = useFieldState(field)

  return (
    <input
      ref={connect}
      id={a11y.controlId}
      aria-describedby={a11y.describedBy}
      aria-invalid={a11y.invalid}
      value={value}
      disabled={disabled}
      readOnly={readOnly}
      placeholder={props.placeholder}
      autoComplete={props.autoComplete}
      onChange={event => {
        field.set(event.currentTarget.value, { cause: 'input' })
      }}
      onBlur={() => {
        field.markTouched()
      }}
    />
  )
}
```

`connect` 属于框架适配层，不把 DOM 对象存进不可变业务状态。每次连接有独立的清理标识，旧 ref cleanup 不能移除更新后的连接。

`field` 由自研 Core 创建，`useFieldState` 订阅该 Core 的字段快照；事件绑定直接调用本库字段命令。连接只增加一个视图入口，不负责创建字段成员或业务值。

文本框 `value` 与 Checkbox 的 `checked` 需要不同事件映射；这些由 Control 负责，不由 Core 假设。[R7](https://react.dev/reference/react-dom/components/input)

### 10.3 Field 共享基础 props

Field 适配契约至少接受：

```ts
interface FieldViewProps {
  controlId: string
  label?: React.ReactNode
  description?: React.ReactNode
  errors: readonly FormIssue[]
  touched: boolean
  required: boolean
  control: React.ReactNode
}
```

`required` 的呈现值不是唯一业务校验来源；真正约束必须由校验器实现。

具体 `ReactNode` 只存在 React 层。Vue/Solid 使用自己的插槽与类型，不要求共享这个接口的源码类型。

### 10.4 Field 外观优先级

Field 外观按以下优先级解析：

```text
单次 renderField.field
    > Schema.field
    > create/useForm 初始 defaultField
    > 当前 UI 系统绑定的 presentation.defaultField
```

选项使用已注册名称，不在同一个字段参数中混用名称与组件对象。

### 10.5 普通呈现属性的合成

标签、说明与可覆盖 props：

```text
系统默认
    → Schema 静态配置
    → drive 的当前结果
    → 本次 renderField 覆盖
```

按属性浅合并；嵌套对象按对应层整体替换，不引入任意深合并。

- 未提供属性表示继承；显式 `undefined` 也表示未覆盖。
- 需要删除标签/说明时使用契约允许的 `null`。
- `controlProps`/`fieldProps` 自身按键合并，内部对象仍整体替换。
- 引擎绑定参数及 id/错误插槽不得被普通 props 覆盖。

禁用采用更保守的规则：Core 的业务锁定（若启用）不能被呈现层解锁；呈现层只可附加禁用。标签或驱动的 UI disabled 不等于服务端权限保证。

### 10.6 兼容 Control 的呈现切换

可以提供：

```tsx
form.renderField('subscribed', { control: 'switch' })
```

前提是注册的 `switch` 与该字段的**双向值契约**兼容。

切换 Control 不改变 Core Definition，不套用新 Control 的默认值，不重置 feature。新的局部焦点和编辑草稿不保证保留。

第一阶段可以先只支持默认 Control，兼容切换在类型验证通过后开放；不允许以 `any` 绕过这个限制。

### 10.7 多入口与视图移动

当前实现范围限制一个逻辑字段同时最多有一个可编辑 Control 连接；重复挂载在开发环境给出确定诊断。允许多个只读订阅视图。

字段移动或重挂载不重置 Core 数据，但不承诺保留具体 UI 子树的所有局部状态。

`renderField` 返回可独立订阅的稳定入口，不依赖父组件重新执行才能看见字段更新。`React.memo` 是减少渲染的手段，不是更新通知机制。

自动布局组件如需遍历字段，必须订阅字段/数组条目集合。仅读取一次 `fields` 不构成响应式订阅。

### 10.8 Presentation 注册与渲染执行分离

`.ui()` 只登记不可变的控件描述、Field 实现及默认外观。它不渲染组件，也不为每个 Control 创建隐藏字段。

`renderField` 在真正使用时才解析当前字段的 Presentation Plan，完成：

```text
读取同一提交版本的字段输入
    ↓
计算 drive 与当次呈现覆盖
    ↓
解析 Field / Control 选择
    ↓
创建框架字段入口
    ↓
挂载时连接事件、ref 和无障碍关联
```

卸载时清理的是这次视图连接。Core 字段和 Feature 状态继续遵循各自的成员与生命周期协议。



## 11. 快照、订阅与更新协议

### 11.1 单一权威状态

值与元数据只由自研 Core 命令修改。`form.state`、`field.state` 与框架 Hook 读取同一条提交链上的快照，不从其他表单引擎拉取、镜像或双向同步状态。

```text
React useState(values) ↔ Effect ↔ form.values
```

这样的双向同步不是默认架构。若将来支持受控 values，必须另行定义唯一所有者与更新请求协议。

组件仍可用 `useState` 保存展开状态、局部弹层等 UI 数据。无头 Runtime 不以“消灭 useState”为目标。

### 11.2 已提交快照

建议内部至少区分：

```text
inputsRevision：
影响数据、context 和校验输入的版本

snapshotRevision：
所有可观察状态提交的版本

formEpoch：
reset、终止或会话失效时递增的代次

fieldGeneration：
字段/数组条目逻辑生命周期的代次
```

不能让“feature cache 改了”无条件使一次与缓存无关的业务校验失效。版本粒度先保守正确，之后优化。

快照必须是缓存的不可变视图；无变化时重复读取引用相同。React 的 `useSyncExternalStore` 要求稳定读取与变化通知。[R1](https://react.dev/reference/react/useSyncExternalStore)

### 11.3 同步命令流程

```text
检查实例与目标是否有效
    ↓
在不可见的工作状态中应用写入
    ↓
执行必要的同步约束和元数据计算
    ↓
确定待失效的异步任务
    ↓
一次提交新 Core 快照
    ↓
通知订阅者
    ↓
启动提交后任务
```

准备失败不发布半成品状态；订阅回调抛错属于提交后的观察者错误，不能伪装为已提交状态被回滚。Core 会继续通知其他订阅者，写命令保持成功，并把聚合异常交给 `configureForms({ onSubscriberError })` 的独立错误通道。

这里的原子性只指一个 Core 命令的可观察状态，不涵盖网络、浏览器 DOM 或任意用户副作用。

### 11.4 transaction 的范围

`transaction` 只接收同步回调与受限的写入上下文：

```ts
form.transaction(tx => {
  tx.setValue('country', 'ID')
  tx.setValue('city', '')
})
```

- 回调抛错则丢弃未提交改动。
- 不接受 Promise；异步前后必须是不同操作。
- 不允许在回调里启动外部请求后期望回滚请求。
- 嵌套事务并入同一工作单元，或者当前实现范围明确拒绝；实现必须选定并测试。当前选择拒绝嵌套，报 `NESTED_TRANSACTION`。
- 通知期间的后续写入应排队到当前通知完成后，避免递归通知破坏遍历。
- 函数式计算需要读最新值时，读取事务工作状态而非旧外部快照。

### 11.5 Core 提交与呈现错误分别处理

Core 的数据一致性不依赖某个 React renderer 是否成功渲染。

`drive` 属于呈现投影时，异常进入明确的呈现错误通道，保留已经提交的业务状态，不自动回滚一次用户输入。开发模式应指出字段与规则；不得静默吞掉后使用任意旧 UI 结果。

业务同步约束属于 Core 命令的准备阶段；其失败可以阻止 Core 提交。

这一区分避免把“库内事务”夸大为“渲染和网络也能统一回滚”。

### 11.6 订阅分层

当前实现范围提供：

```ts
useFormState(form)
useFieldState(field)
```

默认字段级快照即可；不强迫每个用户声明 selector。

后续可以增加：

```ts
useFieldState(field, selector, isEqual)
```

但 selector 只是减少更新的工具。依赖扫描、全表校验、数组操作和对象复制的成本仍须测量。

### 11.7 读取快照与即时查询

渲染使用订阅快照。事件、事务和任务调度可以查询当前 Runtime。

同一个 UI 计算不得把一次订阅快照与若干无订阅即时 getter 混合，形成跨版本结果。原始 getter 不提供自动追踪能力。



## 12. 校验、错误与提交

### 12.1 校验规则属于定义，校验结果属于运行时

```ts
const schema = forms.defineSchema([
  {
    name: 'age',
    control: 'number',
    defaultValue: null,

    validate: ({ value }) => {
      if (value === null) {
        return [{ code: 'required', message: '请输入年龄' }]
      }

      if (value < 0) {
        return [{ code: 'minimum', message: '年龄不能小于 0' }]
      }

      return []
    },
  },
])
```

标准调用上下文应包含当前字段值、完整输入值、context 与 `AbortSignal`。结果可以同步或异步；任务完成后的写入必须经过有效性检查。

定义固定不妨碍规则读取动态门槛：

```ts
validate: ({ value, context }) => {
  return value >= context.minimumAge
    ? []
    : [{ code: 'minimum', message: '未达到当前年龄要求' }]
}
```

不需要为新的 `minimumAge` 替换验证器函数。

### 12.2 校验器与触发策略分开

`CreateOptions.mode` 只决定自动触发时机；显式 `validate()`、`validateField()` 与 `submit()` 始终可以执行校验。当前 Core 支持：

| mode | 当前 Core 语义 |
| --- | --- |
| `onSubmit` | 默认值；仅提交自动校验 |
| `onChange` | 字段当前值变化后校验该字段 |
| `onBlur` | `markTouched(name)` 时校验该字段；UI 适配层把 blur 映射到该命令 |
| `onTouched` | 第一次 `markTouched(name)` 时校验；之后该 touched 字段的值变化也校验 |
| `all` | 同时采用 `onChange` 与 `onBlur` |

补充约束：

- 初始创建不自动执行校验。
- 同一同步写入批次触发的字段校验在微任务中合并。
- 当前 Core 没有 `reValidateMode`；提交之后的自动触发仍由 `mode` 决定，不能把第三方库的二阶段策略隐式混入 `mode`。
- 任意 values/context 变化后，可保守使所有相关校验结果过期，避免旧结果继续宣称 `isValid === true`；自动重新执行仍只遵循上表。
- 没有验证器的字段视为已满足自身校验；整表验证器仍独立计算。

`hasError() === false` 仅说明没有当前有效错误，不代表所有规则已经执行。

### 12.3 可见性不是校验参与条件

需要条件校验时显式声明：

```ts
const taxIdField = {
  name: 'taxId',
  control: 'text',

  validateWhen: ({ values }) => values.customerType === 'company',

  validate: ({ value }) => value
    ? []
    : [{ code: 'required', message: '请输入税号' }],

  drive: ({ values }) => ({
    visible: values.customerType === 'company',
  }),
}
```

`validateWhen` 是 Core 规则，`drive.visible` 是呈现规则。两者可以依赖同一输入，但不隐式相互推导。

规则转为不参与时，旧的该来源校验结果被撤销，旧任务失效；手动/服务端错误按各自生命周期处理。

### 12.4 错误来源

```ts
interface FormIssue {
  readonly id: string
  readonly path?: string
  readonly code: string
  readonly message: string
  readonly source: 'validation' | 'manual' | 'server' | 'submit'
}
```

内部还需保存字段身份、输入版本或请求身份，不能只依赖当前 path。

建议默认策略：


| 来源         | 输入改变后             | reset 后 |
| ---------- | ----------------- | ------- |
| validation | 相关结果失效，按触发策略重算    | 清除      |
| manual     | 保留，直到显式清除         | 清除      |
| server     | 与请求输入绑定；目标输入改变则失效 | 清除      |
| submit     | 与对应提交尝试绑定，不冒充字段规则 | 清除      |


不能通过一次普通标签重渲染清空服务端错误。

服务端错误默认只应用到它实际校验过的数据版本；不得直接用旧响应覆盖用户已经修正的值。

### 12.5 异步结果身份

至少比较：

```ts
interface ValidationTicket {
  formEpoch: number
  fieldGeneration: number
  inputsRevision: number
  requestId: number
}
```

整表校验可不带某个单独字段代次，但要关联完整输入版本和字段集合。

`validate()` 的结果必须区分：

```text
valid / invalid / stale / aborted
```

过期结果不是 valid，也不是当前表单 invalid。终止请求失败时，版本检查仍须拒绝回写。

### 12.6 完整提交顺序

```text
获取本次提交锁
    ↓
捕获 values/context/epoch 快照
    ↓
执行字段与整表校验
    ↓
执行显式 transform
    ↓
再次确认快照仍允许发送
    ↓
调用业务 onValid
    ↓
记录本次提交结果，释放锁
```

当前实现范围不并发提交、不排队。正在提交时新调用得到 `busy`；是否要覆盖提交或排队是未来策略。

在校验/转换期间输入改变，默认返回 `stale`，不发送旧 payload；不无界自动重试。

一旦业务请求已经发出，后续编辑不会改写该请求的 payload。可以记录旧请求的成功/失败，但不能用其结果重置新输入或写入不匹配的字段错误。

`isSubmitting` 覆盖校验、转换和业务回调整个已接受的提交流程。

### 12.7 Core submit 结果

```ts
type SubmitResult<TResult = unknown> =
  | { status: 'success'; result: TResult; inputsRevision: number }
  | { status: 'invalid'; issues: readonly FormIssue[] }
  | { status: 'busy' }
  | { status: 'stale' }
  | { status: 'aborted' }
  | { status: 'error'; error: unknown }
```

`submit` 返回结果对象，用户回调异常记录为 `error`，不伪装成成功。编程错误与非法调用仍可同步抛出明确异常。

`submitCount` 统计已接受的尝试，不包含被拒绝的 busy 调用。当前 epoch 内出现 success、invalid 或 error 结果后，`isSubmitted` 为 true；stale/aborted 不单独把它置为 true。开始一次新尝试时清除 `isSubmitSuccessful`，只有 success 将其置为 true。它表示最近尝试成功，不表示当前输入已经保存。

成功不自动 reset，也不自动更新默认值基线。需要把响应作为新基线时由应用明确操作，并防止覆盖提交期间的新编辑。

### 12.8 React handleSubmit

`handleSubmit` 是框架事件适配，不是独立提交逻辑：

```text
阻止原生默认行为
    ↓
调用同一个 Core submit
    ↓
通过 onInvalid/onError/状态快照公开结果
```

`onError` 与可观察的提交错误状态至少存在一个稳定处理通道，不能产生未处理 Promise 拒绝或完全静默失败。应用可选择通知、错误摘要或内联 UI。

异步提交回调使用创建当前事件处理器时提供的业务回调；不把首次 render 的回调永久锁进 Form 实例。

### 12.9 transform 与省略字段

```ts
const schema = forms.defineSchema(fields, {
  transform: (values) => {
    if (values.customerType === 'person') {
      const { taxId, ...payload } = values
      return payload
    }

    return values
  },
})
```

这是明确的输出契约，提交回调需要接受相应联合输出类型。

当前实现范围不把“字段隐藏”解释为“从输出自动移除”，也不让 `values` 有时返回少字段却仍声称完整的 `TValues`。

### 12.10 独立校验器适配，不是表单引擎对接

自研内核不要求自研所有验证算法。允许项目直接接入独立校验函数或校验库，但只把它们当作输入到结果的计算能力：

```text
Core 捕获校验输入与任务身份
    ↓
调用独立校验器
    ↓
适配输入/输出类型、错误路径与问题格式
    ↓
Core 检查版本、取消状态和字段生命周期
    ↓
Core 提交当前仍有效的结果
```

校验适配器不拥有 values、errors、dirty、字段注册、submitCount 或提交锁，不自行通知字段视图。同步/异步触发、条件校验、错误合并及过期处理仍由本库维护。

不得通过 RHF resolver、`@hookform/resolvers` 或第三方表单控制器间接完成调度。具体独立校验器的适配在验证输入/输出、转换次序、错误路径及异步语义后再发布；不得绕过第 12.6 节已经规定的校验与 transform 顺序。



## 13. 数组、嵌套字段与身份

### 13.1 数组模板是定义，条目是运行时

```ts
const schema = forms.defineSchema([
  {
    name: 'users',
    kind: 'array',
    createItem: () => ({
      name: '',
      age: null,
    }),

    item: [
      { name: 'name', control: 'text' },
      { name: 'age', control: 'number' },
    ],
  },
])
```

对应输入：

```ts
const values = {
  users: [
    { name: 'Judy', age: 20 },
    { name: 'John', age: null },
  ],
}
```

此处 `kind: 'array'` 是 Core 结构节点，不是假装自己是一个普通 Control。数组可有独立 Field 外观和局部布局，但不纳入 Whole Form 布局 DSL。

`createItem` 在显式 append/insert 命令中调用，不在 render、快照读取或为了猜测类型而执行。

### 13.2 原始值数组与对象数组

字符串数组可以使用单字段模板：

```ts
const favoriteFruitsField = {
  name: 'favoriteFruits',
  kind: 'array',
  createItem: () => '',
  item: {
    control: 'text',
  },
}
```

对象数组使用相对子字段名；不要为了复用某个底层库的 API，强迫把 `string[]` 变成 `{ value: string }[]`。

嵌套数组使用相同身份原则，但在完成基础数组测试前不承诺任意深度的类型性能。

### 13.3 稳定 itemId 与当前路径不同

```text
itemId：
同一个运行时条目是谁

index：
它此刻排在哪里

path：
此刻如何从 values 寻址
```

itemId 保存在内部，不自动写入用户业务对象。

Bob 从 `users[1]` 移到 `users[0]` 后：

- 值、touched、错误、cache 跟随 Bob 的条目身份。
- 当前 path 更新。
- 同一条目下 FieldInstance 不因为索引变化而重建。
- 删除 Bob 后再添加值相同的新条目，是新身份。
- 旧异步结果与旧句柄不能命中新条目。

### 13.4 数组 API

```ts
const users = form.getArray('users')

users.append()
users.append({ name: 'Jason', age: 28 })
users.insert(0, { name: 'Chen', age: null })

users.remove(itemId)
users.move(itemId, targetIndex)
users.replaceAll(nextValues)

users.getItems()
users.subscribe(listener)
```

`remove/move` 以 itemId 定位，避免异步回调持有旧 index。需要索引便利方法可在未来增加，但不得混淆两个参数语义。

整个数组 `setValue/replaceAll` 默认作为集合替换，创建新条目身份；不猜测两个相似对象是否同一个人。细粒度编辑使用条目句柄或稳定寻址后的字段命令。

### 13.5 React 局部布局示意

```tsx
function UsersEditor({ form }: { form: UsersForm }) {
  const users = form.getArray('users')
  const { items } = useArrayState(users)

  return (
    <section>
      <button type="button" onClick={() => users.append()}>
        添加用户
      </button>

      {items.map(item => (
        <div key={item.id}>
          {item.renderField('name')}
          {item.renderField('age')}

          <button
            type="button"
            onClick={() => users.remove(item.id)}
          >
            删除
          </button>
        </div>
      ))}
    </section>
  )
}
```

`UsersForm` 表示该 Schema 推导出的应用 Form 类型。`useArrayState` 与条目呈现门面是拟议接口，和普通 Field 一样由框架层提供。

数组本身不强制内置某种 Row/Grid。可由应用封装一个数组组件。

### 13.6 默认值与 reset

整表 dirty 对完整业务值和默认值比较；数组顺序、数量改变可使整表 dirty。

内部默认值定位必须保留条目身份信息，不能让一次 move 把 Bob 的默认值误配到 Alice。新增条目的局部字段基线来自本次条目初始化；集合相对整表默认值的结构差异仍然存在。

`reset()` 或数组级 `resetField()` 按默认数组重建条目身份。旧条目句柄与任务失效；不承诺 reset 后复用先前的 itemId。

### 13.7 异步与服务端路径

校验/提交启动时保存条目身份到请求路径的映射。返回 `users.1.name` 错误时，不能直接指向当前 index=1 的条目。

只有请求快照仍匹配、或可按明确身份映射安全应用时，才能写回。否则结果标记过期。

数组是发布前的关键设计验证，不是可以在所有 API 定型后再补的细节。



## 14. Feature 扩展协议

### 14.1 Feature 的定义与能力

```ts
const features = formFeatures([
  cache(),
  dev(),
])

const baseForms = configureForms({ features })
const forms = baseForms.ui(presentation)
```

feature 可以贡献：

- Schema 配置键及默认值。
- 独立的 Form/Field 状态切片。
- Form/Field 方法。
- 已命名的纯规则或生命周期处理。
- 可选的外部资源激活与清理。

共享 Feature 定义，不共享运行时状态。

Presentation 不属于上述扩展能力集合。它不进入 `formFeatures`，不调用 Feature 的 `createForm/createField/onActivate` 安装 Renderer，也不占用 `state.features` 中的状态切片。`.ui()` 使用库内建 Renderer 的独立配置协议。

### 14.2 生命周期阶段

```text
验证 feature 集合与所有权
    ↓
应用默认字段配置
    ↓
验证并编译字段定义
    ↓
创建 Form feature 状态
    ↓
安装 Form 方法
    ↓
创建 Field feature 状态与方法
    ↓
实例可用
    ↓
必要时激活受管理的外部资源
```

Form 方法先于 Field 方法安装，使 Field 创建逻辑可以访问已安装的 Form 能力。

### 14.3 接口草图

下列 `unknown` 表示本节省略了完整类型参数，不是建议公共 API 放弃类型安全。

```ts
interface FormFeature {
  readonly name: string
  readonly dependsOn?: readonly string[]
  readonly schemaKeys?: readonly string[]

  validateDefinition?(definition: unknown): void
  getDefaultFieldDefinition?(): object
  compileField?(definition: unknown): object

  getInitialFormState?(schema: unknown): unknown
  getInitialFieldState?(field: unknown): unknown

  createForm?(form: unknown, context: unknown): object
  createField?(field: unknown, form: unknown, context: unknown): object | void

  onReset?(context: unknown): void

  // 受资源租约管理；返回本次激活的清理函数。
  onActivate?(context: unknown): void | (() => void)
}
```

`onReset` 运行于受限的状态事务上下文，不直接订阅或发请求。`onActivate` 才允许管理外部资源。

`compileField` 只产生该 Feature 所拥有的定义附加数据，不创建字段实例，也不处理 Renderer 的 Presentation Plan。

### 14.4 状态访问权限

feature context 只能写当前 feature 的状态切片：

```text
getFormState / updateFormState
getFieldState / updateFieldState
```

允许通过只读接口观察 Core 值，并调用合法 Core 命令；不得直接修改其他 feature 的私有状态或 snapshot 对象。

feature 更新必须进入同一个自研 Core 提交协议，不通过旁路通知制造两套不一致的视图。feature context 不暴露任何外部表单引擎控制对象；所有扩展只使用本库定义的只读快照、受限状态切片和合法命令。

### 14.5 命名冲突必须确定失败

配置阶段检查：

- feature name 重复。
- 声明的 Schema 属性归属冲突；UI 扩展阶段另行检查与 Renderer 保留键的冲突。
- 缺失依赖、依赖环。
- 编译附加字段覆盖 Core 保留字段。

实例构造时检查：

- 注入核心已有方法。
- 两个 feature 注入同名方法。
- 注入受保护的状态访问与生命周期成员。

不得“最后注册的覆盖前一个”。错误应包含冲突名称和双方来源。

默认配置按“库默认 → feature 所拥有键的默认 → 用户显式配置”合成。共享某个键的 feature 不是靠注册顺序解决冲突，而是通过单一所有者或命名空间设计解决。

### 14.6 固定定义使方法集合稳定

按固定 Schema 配置决定是否安装字段方法：

```ts
[
  { name: 'name', control: 'text', enableCache: false },
  { name: 'age', control: 'number', enableCache: true },
]
```

启用的 `age` 字段可有 `clearCache`；明确禁用的字段没有该方法。

`enableCache` 在定义阶段固定。`drive` 不改变 Feature 启用集合，因此方法安装与静态类型保持一致。运行时缓存内容变化不等于能力集合变化。

若配置类型是宽泛 `boolean` 而不是字面量，类型只能给出可选能力或需要检查的联合，不能无条件声称方法存在。

### 14.7 cache 的建议默认行为

- 仅实例内存缓存；不默认访问 localStorage、文件或网络。
- 默认不启用字段缓存，字段显式开启。
- Form 提供 `getCache/setCache/clearCache`；已启用 Field 提供相应短方法。
- `setCache` 写入未启用字段时明确报错；清除未启用字段可以无操作。
- 普通值变化、drive 求值、视图卸载不清缓存。
- `reset` 默认保留缓存，但不把缓存自动写回 values。
- 删除数组条目、整体替换条目集合或 dispose 时清理对应缓存。
- 新实例不继承旧实例缓存。

cache 是否应该随 reset 清除可以作为 feature 自身显式选项，但默认契约必须唯一。

### 14.8 创建纯度与敏感数据

定义处理、初始状态创建与方法安装必须无外部副作用；不在构造时读取浏览器存储或发请求。

缓存和 Devtools 不能默认记录全部输入。可定义 Core `sensitive: true` 元数据；内置缓存拒绝保存敏感字段，调试视图遮盖值。不能仅从 Control 名称猜测是否敏感。

dev Feature 可以提供只读观测能力；Devtools 面板是另外的框架组件，可以消费这些能力，但不能成为 Core import 的隐式依赖。面板不等于 Presentation，Presentation 也不能借用 dev Feature 的安装过程接入 Renderer。



## 15. 实例生命周期与 React 适配

### 15.1 create 与 useForm

`configureForms` 与 `.ui()` 只产生工厂配置，不参与实例资源激活。以下生命周期从 `create/useForm` 创建实际 FormInstance 时开始；Renderer 的控件连接还要等对应视图挂载。

`create`：

- 直接由自研 Core 构造独立 Runtime、字段注册表和状态仓库，不创建外部表单库的控制对象。
- 同步纯初始化。
- 不绑定组件生命周期。
- 不启动外部订阅。
- 由调用者负责共享与最终释放。

`useForm`：

- 为当前组件会话保留上述自研 Core 实例。
- 将 Core 的快照和通知接入订阅与框架生命周期，不包装第三方表单 Hook。
- 不因父组件重渲染重建。
- 不在 render 中修改已有 Runtime。
- 管理其拥有实例的资源租约。

普通 getter 仍不触发 React 更新，组件通过 `useFormState/useFieldState` 消费快照。

### 15.2 外部 Store 不违反 React，但有边界

React 提供 `useSyncExternalStore` 接入外部数据；官方同时建议适当场景优先使用内置 state。这里选择外部 Runtime 的理由是独立实例、字段订阅和无 UI 执行，而不是它必然更好。[R1](https://react.dev/reference/react/useSyncExternalStore)

外部 Store 修改不能直接获得 React state 的非阻塞 Transition 语义。[R1](https://react.dev/reference/react/useSyncExternalStore)

渲染读取必须纯粹。`form.patchContext`、请求、提交和任务取消不在 render 中执行。[R2](https://react.dev/reference/rules/components-and-hooks-must-be-pure)

### 15.3 初始化与 effect 激活分开

内部可使用稳定实例引用；不得简单写成：

```tsx
const form = useMemo(() => createForm(schema), [schema])
```

并把 memo 当成生命周期保证。

资源管理至少区分：

```text
construct：
纯构造，允许 React 放弃尚未提交的结果

activate：
提交后建立 feature 外部订阅

deactivate：
撤销本次激活，允许随后再次激活

dispose：
显式永久终止实例
```

React StrictMode 在开发环境会额外检查渲染和 effect setup/cleanup，因此不能在每次 effect cleanup 时永久 destroy 同一个仍可能重新激活的实例。[R3](https://react.dev/reference/react/StrictMode)

### 15.4 租约模型

建议内部采用资源租约：

```ts
const release = form.activate()

// release 可重复调用，但只释放本次租约一次。
release()
```

这是独立创建实例的高级资源入口；普通 `useForm` 自动管理，用户不增加一步。

规则：

- 首个资源租约触发必要的 `onActivate`。
- 最后一个租约释放时停止这些外部资源。
- setup → cleanup → setup 后实例仍可用。
- 每次激活的清理函数只处理本次资源。
- 显式 `validate/submit` 等命令可以在无 UI 时执行，不要求先挂载组件。
- Hook 所拥有会话停止时，使其未完成任务失效；再次激活不得接受旧任务结果。

`deactivate` 和 `dispose` 不是同义词。Hook 清理负责资源与任务，不应声称所有 JavaScript 对象引用立刻消失。

### 15.5 所有权


| 实例来源              | 所有者       | 组件卸载                |
| ----------------- | --------- | ------------------- |
| `useForm` 内部创建    | 该 Hook 会话 | 释放其资源租约与任务；正常对象可被回收 |
| 外部 `forms.create` | 调用者       | 消费组件只解除自己的订阅/连接     |
| 多组件共享实例           | 显式共享方     | 一个消费者卸载不销毁整个实例      |


不建议把 Hook 私有实例作为跨页面长期单例使用。需要共享时从无 Hook 入口创建，明确 `.dispose()` 的调用方。

### 15.6 dispose 语义

- 幂等。
- 撤销资源订阅与控件连接。
- 使异步结果失效。
- 写命令报 `FORM_DISPOSED`。
- 只读调试快照可以保留，不能再次激活。
- 数组删除后的字段句柄写入报 `FIELD_DISPOSED`，不转发到同名新字段。

### 15.7 SSR 与 hydration

React 的服务端与首次客户端快照需要数据一致，`getServerSnapshot` 应来自明确初始化数据。[R1](https://react.dev/reference/react/useSyncExternalStore)

提案要求：

- FormInstance 按请求/会话创建，不跨用户共享可写实例。
- 不在服务端创建时读取 window、localStorage 或 DOM。
- DOM id 在框架层生成并保持 hydration 一致。
- 初始数组条目身份生成在服务端与客户端具有可重建规则。
- 随机数、当前时间和外部读取不能偷偷进入渲染期默认值工厂。
- 对不支持序列化的值和 feature 明确限制，而不是假定全部 snapshot 可 JSON 化。

### 15.8 当前 props 不等于初始化配置

React 中“把 props 只读入初始状态”会忽略后续变化，官方建议这种 API 明确表达 initial/default 语义。[R4](https://react.dev/learn/choosing-the-state-structure)

因此：

- `initialValues/initialContext` 只读一次。
- `renderField` 的本次呈现 props 持续生效。
- `reset/patchContext` 是显式 Runtime 更新。
- `useForm` 不接收一份宽泛 options 后含糊地区分有些动态、有些静态。
- 若未来加入受控 values/context，必须规定唯一所有者，不与命令接口无条件双向竞争。



## 16. 无头入口、多框架与工程边界

### 16.1 纯 Core 入口

不使用框架或自动呈现时，从 Core 包建立系统：

```ts
import {
  configureForms,
  formFeatures,
  cache,
} from '@chanyuxi/form-core'

interface ProfileValues {
  name: string
  age: number | null
}

const forms = configureForms({
  features: formFeatures([cache()]),
})

const schema = forms.defineSchema<ProfileValues>()([
  {
    name: 'name',
    defaultValue: '',
    enableCache: false,
  },
  {
    name: 'age',
    defaultValue: null,
    enableCache: true,
  },
])

const form = forms.create(schema)

form.setValue('name', 'Jason')
form.getField('age').set(28)

form.dispose()
```

此入口不包含 Presentation、Control、`.ui()`、Hook 或组件。字段契约来自显式值模型和运行时定义。独立 value-schema 推导可以作为可选能力，不要求所有用户重复声明模型。

纯 Core 包与框架包统一使用 `configureForms` 命名；框架入口只在同一个 Core Runtime 之上增加订阅、生命周期和可选 Renderer 门面。

### 16.2 框架基础系统也可手动组合 UI

```tsx
import {
  configureForms,
  useFieldState,
} from '@chanyuxi/form-react'

const baseForms = configureForms({ features })

const schema = baseForms.defineSchema<{ name: string }>()([
  { name: 'name', defaultValue: '' },
])

function NameEditor() {
  const form = baseForms.useForm(schema)
  const field = form.getField('name')
  const state = useFieldState(field)

  return (
    <input
      aria-label="姓名"
      value={state.value}
      onChange={event => {
        field.set(event.currentTarget.value)
      }}
      onBlur={() => {
        field.markTouched()
      }}
    />
  )
}
```

该模式不调用 `.ui()`，也不使用内建 Renderer 的字段装配。使用者直接组合 UI，并负责标签、错误与焦点关联。

需要 Schema 自动选择 Control 和 Field 时，再使用 `.ui(presentation)` 创建增强系统。两种使用深度不要求两套表单状态实现。

### 16.3 工厂绑定内部 Helper

```text
基础系统：
Core Schema Helper + Feature 定义处理

UI 系统：
基础定义处理 + Renderer 的 UI 配置处理
    ↓
同一个公开 defineSchema
```

Helper 是内部职责边界，不是用户必需创建的对象。类型参数描述契约，实际工厂仍需持有运行时配置和注册表。[R8](https://www.typescriptlang.org/docs/handbook/2/basic-types.html)

Renderer 可以在自己的定义处理中验证 Control 与 Field，但 Core 定义处理器不能导入这些实现。

### 16.4 工程布局

```text
packages/
  form-core/
    src/
      index.ts
      core/
        configureForms.ts
        fieldPath.ts
        formError.ts
        formRuntime.ts
        formSchema.ts
        types.ts
        validation.ts
        valueStore.ts

  form-react/
    src/
      configure-forms.ts       # 基础系统门面与 .ui 配置入口
      system/
        base-system.ts
        ui-system.ts
      hooks/                   # 无 Renderer 时也能订阅 Core
      lifecycle/
      events/                  # 原生提交事件到 Core submit
      renderer/                # 库内建模块，不是 Feature
        presentation/
        schema/
        projection/
        controls/
        fields/
        connections/
        types/

  form-vue/
    src/
      configure-forms.ts
      bindings/
      lifecycle/
      renderer/

  form-solid/
    src/
      configure-forms.ts
      bindings/
      lifecycle/
      renderer/
```

目录用于表达职责，不要求每个目录独立发包。Renderer 的框架无关纯工具可在内部共享，但 Core 不反向依赖 Renderer。

不设 `rhf-adapter`、其他表单引擎后端或 `presentation-feature`。复杂泛型可以放入独立类型模块；不要让执行逻辑被大量声明遮蔽。

### 16.5 多框架协议

各框架共享自研 Core，分别提供自己的基础系统门面、UI 扩展与 Renderer：

```text
React：configureForms → .ui → React 组件与订阅
Vue：  configureForms → .ui → 模板/组件与响应式接入
Solid：configureForms → .ui → 对应框架的呈现接入
```

框架不会独立定义 reset、dirty、数组身份或提交竞态规则。

不承诺 React AppSchema 直接用于 Vue，不承诺同一个 Control 描述跨框架运行，不要求所有视图入口采用相同语法。共享的是核心数据行为；框架专属注册表与编译句柄保持作用域隔离。

Vue 等框架可以使用自然的响应式接入，但不能因此拥有第二份可独立修改的表单业务值。

### 16.6 开放深度


| 使用需求           | 入口                                                                |
| -------------- | ----------------------------------------------------------------- |
| 普通 Schema 自动呈现 | `configureForms(...).ui(...)` → `defineSchema` → `useForm/create` |
| 多套项目 UI        | 一个 `baseForms` 分别 `.ui(...)`，返回独立系统                               |
| 自定义输入控件        | `defineControl` + `.ui({ controls })`                             |
| 自定义字段外观        | `.ui({ fields, defaultField })`                                   |
| 自己编写字段 JSX     | 基础系统 + FieldInstance + 字段订阅                                       |
| 不使用任何框架        | Core `configureForms`                                             |
| 独立校验器          | Core 的校验协议                                                        |
| 通用数据工具         | Core 内部实现选择，不是表单引擎插件                                              |


用户按需要深入，不必从最底层开始装配。公开的扩展入口少而明确，内部实现模块不自动升级成公共插件体系。



## 17. 系统组合、复用与完整使用场景

### 17.1 一套基础能力，多套 Presentation

```tsx
const baseForms = configureForms({
  features: formFeatures([cache(), dev()]),
})

const desktopForms = baseForms.ui({
  controls: {
    text: DesktopTextControl,
  },
  fields: {
    standard: DesktopField,
  },
  defaultField: 'standard',
})

const compactForms = baseForms.ui({
  controls: {
    text: CompactTextControl,
  },
  fields: {
    standard: CompactField,
  },
  defaultField: 'standard',
})
```

两者复用基础 Feature 定义，但分别拥有 Renderer 注册作用域。即使都叫 `'text'`，也不表示相同组件或可互换的编译 Schema。

定义源可以复用：

```ts
const nameFields = [
  {
    name: 'name',
    control: 'text',
    defaultValue: '',
    enableCache: true,
  },
] as const

const desktopSchema = desktopForms.defineSchema(nameFields)
const compactSchema = compactForms.defineSchema(nameFields)
```

目标系统分别检查 Control 的值契约与 props；源码复用不跳过验证。两个系统随后各自创建实例时，values、cache、errors 与任务独立。

### 17.2 Control 作者与业务作者的分工

Control 作者实现一次组件绑定并声明值契约：

```tsx
export const TextControl = defineControl<string>({
  defaultValue: '',
  render: TextControlView,
})
```

项目配置者注册一次：

```ts
const forms = baseForms.ui({
  controls: { text: TextControl },
  fields: { standard: StandardField },
  defaultField: 'standard',
})
```

业务作者反复使用：

```ts
const schema = forms.defineSchema([
  {
    name: 'nickname',
    control: 'text',
    label: '昵称',
    controlProps: {
      placeholder: '请输入昵称',
    },
  },
])
```

Control 的字段绑定与无障碍契约由第 10 节定义。业务 Schema 不需要重复写 `value/onChange/ref`，也不需要重新创建 Renderer。

### 17.3 单次呈现不修改系统

```tsx
form.renderField('nickname', {
  field: 'compact',
  label: t('nickname'),
})
```

这是对当前视图的覆盖，不改变：

- `baseForms` 的基础配置。
- UI 系统的 Presentation 注册表。
- 当前 Schema 的静态定义。
- FieldInstance 的值契约和 Feature 状态。

所选 Field 必须已注册。覆盖不能作为运行中安装组件注册项的替代接口。

### 17.4 忽略返回值没有注册效果

```ts
const baseForms = configureForms({ features })

baseForms.ui(presentation)

// baseForms 仍然是基础系统。
// 不因上一次调用获得 control 配置或 renderField。
```

正确使用返回值：

```ts
const forms = baseForms.ui(presentation)
```

类型信息随返回值传播；不存在按导入顺序生效的全局 Renderer、隐式最后一次注册表或原地类型扩展。

库可在文档和静态使用示例中强调返回值，但不应为了补救误用而偷偷修改基础系统。

### 17.5 已存在定义不被追补

```text
基础系统定义 Core Schema
    ↓
创建纯数据 FormInstance
    ↓
从同一基础系统调用 .ui
```

第三步不会改变前两步产物。它只创建另一个能够定义统一 UI Schema 的系统。

本 RFC 不提供“把既有实例直接升级为 UI 实例”的自动入口。需要复用字段配置时，由目标系统重新定义；需要延续数据时，用显式数据初始化创建目标实例。输入值迁移不自动延续错误、dirty、缓存或异步任务。

### 17.6 对系统变化的分类


| 需求                     | 操作                                   |
| ---------------------- | ------------------------------------ |
| 修改用户输入                 | Core 值命令                             |
| 修改联动使用的 locale/选项/权限输入 | 明确的 context 或资源输入更新                  |
| 根据既定规则改变显隐和 UI 属性      | Renderer `drive` 求值                  |
| 改变当前 Field 外观或标签       | `renderField` 呈现覆盖                   |
| 增加既定数组模板的条目            | 数组命令                                 |
| 更换项目的组件注册表             | 从基础系统 `.ui(nextPresentation)` 创建另一系统 |
| 更改字段类型、路径、规则函数或模板      | 在目标系统中定义 Schema，并显式创建新表单实例           |


系统配置、字段定义、运行状态和单次视图，各有独立入口，不用同一个“更新 Schema”操作承担全部变化。

### 17.7 完整路径的验收问题

普通使用者应当只需要回答：

```text
我需要哪些 Feature？
我使用哪些输入组件和 Field 外观？
这张表单有哪些字段和规则？
字段放在哪里，提交时做什么？
```

不应要求他回答：

```text
怎样手动实例化库内 Renderer？
怎样连接编译后的核心片段与 UI 片段？
怎样把第二套 values 同步回 Core？
怎样把 Presentation 伪装成 Feature？
```

这种分工是默认体验的要求，而不是只在示例里才能成立的特例。



## 18. 实现阶段与验收用例

### 18.1 分阶段推进


| 阶段        | 建设内容                                                                      | 出口条件                          |
| --------- | ------------------------------------------------------------------------- | ----------------------------- |
| P0：自研内核验证 | 定义归一化、自有 store/事务、标量 Field、基线/reset、快照、无 UI 命令、基本校验调度                     | 无第三方表单引擎的独立 Core 状态、依赖与类型测试通过 |
| P1：系统与呈现  | configureForms、不可变 .ui 扩展、统一 Schema、内建 Renderer、Control/Field、React 订阅与提交 | 基础系统可独立使用，UI 系统无需手动装配         |
| P2：关键边界   | 数组身份、异步竞态、feature、StrictMode、SSR                                          | 高风险场景通过；才能声称通用可用              |
| P3：可选能力   | 其他框架、资源 Feature、选择器优化、兼容 Control 切换                                       | 用具体场景验证，不提前扩大承诺               |


P0/P1 可作为内部原型，不应在数组与异步测试缺失时宣称已经完成完整表单引擎。各阶段均使用同一个自研 Core；不以 RHF 实现临时运行路径，再承诺后续替换。

### 18.2 行为验收矩阵


| ID  | 场景                              | 必须满足的结果                                            |
| --- | ------------------------------- | -------------------------------------------------- |
| A01 | 没有 React/Vue、控件包和第三方表单引擎        | 自研 Core 可创建、读写、校验、重置、提交                            |
| A02 | 同一 Schema 创建两张表单                | values、缓存、errors 和任务互不共享                           |
| A03 | 重新渲染时传入新 Schema 引用              | 不清空输入，不暗中替换定义；诊断初始化语义                              |
| A04 | 切换 locale 或 options             | drive 更新结果，FieldInstance 与 feature 状态延续            |
| A05 | 只修改渲染 props                     | 当次视图采用新值，Core 数据不被重置                               |
| A06 | 字段视图卸载                          | 字段仍是成员，校验和提交按定义执行                                  |
| A07 | 输入改回默认值                         | dirty 恢复 false                                     |
| A08 | setDefaultValues                | 不覆盖用户输入，dirty 按新基线重算                               |
| A09 | reset 与旧异步校验交错                  | reset 后旧结果不能重新写入                                   |
| A10 | 国家与城市在同一事务更新                    | 观察者看不到半更新 Core 状态                                  |
| A11 | 事务准备中抛错                         | 旧快照和值完整保留                                          |
| A12 | 一个订阅者抛错                         | 状态仍是已提交版本，其他订阅不永久失效                                |
| A13 | 数组项移动                           | 值、错误、touched、cache 跟随 itemId                       |
| A14 | 数组项删除后重建同值条目                    | 新身份；旧句柄和异步结果不得命中                                   |
| A15 | 整体 reset 数组                     | 按默认值重建，旧条目句柄失效                                     |
| A16 | 提交校验期间继续输入                      | 返回 stale，不发送旧快照                                    |
| A17 | 业务请求期间继续编辑                      | 响应不覆盖新值、不重置当前输入                                    |
| A18 | 双击提交                            | 第二次得到 busy，不发第二个请求                                 |
| A19 | onValid 抛错                      | 状态与结果公开错误，isSubmitting 最终恢复                        |
| A20 | StrictMode setup/cleanup 重放     | 不泄漏资源，不使用永久销毁的实例                                   |
| A21 | 多组件共享 create 实例                 | 一个卸载不销毁整个 Form                                     |
| A22 | SSR hydration                   | 初始快照、DOM 关联与条目身份一致                                 |
| A23 | feature 方法/配置键冲突                | 确定报错，不按顺序覆盖                                        |
| A24 | drive 抛错                        | 有明确呈现错误，不悄悄退回不一致旧 UI                               |
| A25 | 父组件被 memo 跳过                    | 字段订阅仍可收到新状态                                        |
| A26 | 未变化时重复 getSnapshot              | 返回同一个引用                                            |
| A27 | 替换兼容 Control                    | Core 状态保留，不套用新控件默认值                                |
| A28 | 重复可编辑字段入口                       | 确定诊断，ref 不互相覆盖                                     |
| A29 | 敏感字段缓存或 Devtools                | 遵循拒绝/遮盖策略，不隐式持久化                                   |
| A30 | 纯展示 disabled                    | 不被误解为跳过业务校验或服务端授权                                  |
| A31 | 检查发布依赖、导入图与公共类型                 | Core/框架产物不依赖 RHF、其 resolver 集成或其他表单引擎，不泄露对应控制对象与类型 |
| A32 | 比较无框架创建与框架门面的命令链                | 同一 Core 协议处理值、reset、校验与提交；门面不持有另一份权威 values        |
| A33 | 接入独立校验器                         | 校验器只产出结果；自研 Core 统一执行触发、过期检查、错误合并和状态提交             |
| A34 | 调用 `baseForms.ui(presentation)` | 返回新系统，原对象与原能力不变                                    |
| A35 | 忽略 `.ui()` 返回值                  | 基础系统不获得隐式呈现能力                                      |
| A36 | 同一基础系统扩展两套 UI                   | 注册表、默认 Field 和定义作用域彼此独立                            |
| A37 | `.ui()` 配置校验失败                  | 基础系统、既有 Schema 与其他 UI 系统均不受影响                      |
| A38 | 配置系统和调用 `.ui()`                 | 不创建 Form/Field/Feature 实例状态，不启动资源或挂载组件             |
| A39 | 传入的 Presentation 对象在注册后被修改      | 不原地改变已绑定注册表；采用配置快照                                 |
| A40 | `.ui()` 前已创建基础 Schema 和实例       | 不被追补 UI 属性或呈现方法                                    |
| A41 | 检查 Renderer 安装路径                | 不是 Feature，不进入 Feature 列表或状态切片                     |
| A42 | Feature 键与 Renderer 保留键冲突       | UI 扩展阶段明确失败，不按顺序覆盖                                 |
| A43 | 统一 Schema 归一化                   | Core 仅收到 Core 定义，组件与 drive 留在 Renderer 计划          |
| A44 | 错用另一 UI 系统的已编译 Schema           | 可表达的类型差异静态拒绝；运行时仍检查系统身份                            |
| A45 | 未调用 `.ui()` 的 React 基础系统        | 可用 FieldInstance 与订阅手动组合 UI，无自动 renderField        |
| A46 | UI 系统创建多张表单                     | 仅共享只读配置；运行状态和任务仍逐实例隔离                              |
| A47 | 同一 Presentation 重复 `.ui()`      | 返回不同系统句柄，不形成隐式全局单例                                 |
| A48 | Core 导入图与类型检查                   | 不依赖 Renderer/Presentation，不通过泛型或 Feature 偷渡 UI 类型  |


以上是对应能力开放时的验收要求，不表示每个阶段都已实现全部 API。例如 A27 随兼容 Control 切换能力开放时执行；在此之前不能宣传该能力已经可用。

### 18.3 类型验收

必须写实际 `tsc`/类型断言测试，而不是根据 IDE 截图判断：

```ts
form.setValue('name', 'Jason')

// @ts-expect-error 字段类型不匹配
form.setValue('name', 123)

// @ts-expect-error 不存在的字段
form.getValue('unknown')

// @ts-expect-error 未注册的 Control
forms.defineSchema([{ name: 'x', control: 'not-registered' }])
```

还需验证：

- number|null 不因 null 默认值收窄成 null。
- 显式 Core Values 模式的默认值检查。
- Control 读写类型的双向兼容。
- props 排除保留绑定属性。
- feature 字面量启用与宽 boolean 的不同返回类型。
- drive 获得完整 values/context 提示，而不是退化为 any。
- 数组 item 推导与深路径性能。
- 输入和提交输出类型分离。
- 不同注册表的 Schema 误用；结构类型相同的系统仍需运行时身份检查。
- `.ui()` 返回值保留 Feature/context 类型，同时增加准确的 Control/Field 键与 props 类型。
- `baseForms` 不因 `.ui()` 调用获得 UI 配置类型；两个增强系统的名称联合不互相污染。
- `configureForms({ presentation })` 不是合法配置；Presentation 只经 `.ui()` 进入 Renderer。
- 基础实例不拥有自动 `renderField/field.Field`；UI 实例拥有对应门面。
- `Presentation` 不能作为 `FormFeature` 注册，不用全局声明合并扩展所有系统。
- 调用者未使用 `as const` 时保留必要的字段名推导。

若“同一次 defineSchema 推导所有字段后又给 drive 提供上下文类型”无法稳定实现，必须公开一个**高级可选**的显式 Values 入口，不把不安全 any 当成已经实现。

类型验收还必须确认公共 `.d.ts` 不依赖 RHF 或其他表单引擎的类型；不能把外部库的类型换名后当作自研协议。

### 18.4 性能验收

至少区分：

```text
命令准备/复制
派生规则计算
校验计算
订阅通知
React 组件执行
实际 DOM 提交
```

覆盖小表单、大量字段、数组重排与异步校验并发场景。性能阈值在基准原型中确定；本文不编造数字。

原型可以全量重算纯 drive，但不得因性能优化省略正确更新。优化排序优先是避免错误重建、减少重复状态，然后才是更细粒度选择器。

### 18.5 开发体验验收

让未参与架构设计的业务开发者完成一张表单：

```text
两个输入字段
一个联动字段
一个自定义 Control
一个数组
一次提交
```

记录他必须新学习的概念和必须维护的关联。项目级只需基础配置和可选 `.ui()`；每张表单只需统一 Schema 与实例入口。不应要求他创建 Renderer/Helper 或手动连接两份定义。

默认文档先呈现第 3 节的路径，再提供无头与高级能力，不按内部源码分层顺序教学。

### 18.6 内核独立性的工程检查

除行为测试外，持续集成应验证：

- Core 的独立运行测试使用无 DOM 环境，依赖范围不包含框架包、控件包或第三方表单引擎。
- 检查发布依赖、构建导入图与公共类型；示例或测试目录安装了某个包，不能成为生产路径的隐式依赖。
- 框架包的 `useForm` 创建或保留自研 Core 实例；订阅直接来自本库快照协议，提交直接调用本库 `submit`。
- 不存在以 Feature、兼容 adapter 或隐藏工厂形式引入外部表单控制对象的路径。
- Renderer 位于内建框架呈现模块，Presentation 类型与实现不进入 Core 产物。
- `.ui()` 委托 Renderer 定义扩展，不通过 Feature 安装钩子创建呈现能力。
- React 基础系统的订阅能力不要求已有 Presentation；未挂载视图不影响无头命令。
- 校验器、通用不可变更新工具等允许依赖与表单引擎依赖分开检查，不能误把“自研内核”等同于“零第三方工具”。

这些是待实现的验收要求，不表示本文已经执行过依赖检查或通过了运行时代码测试。



## 19. 取舍、范围外能力与待验证事项

### 19.1 已接受的取舍


| 取舍                 | 选择                                |
| ------------------ | --------------------------------- |
| 动态定义自由度 vs 生命周期可预测 | 当前选择固定 Core Definition            |
| 任意 UI 接入 vs 简单默认绑定 | 先受控适配，特殊输入显式扩展                    |
| 无头独立 vs 默认易用       | 基础系统独立；`.ui()` 明确扩展；业务只写统一 Schema |
| 泛型极致推导 vs 编译成本     | 核心场景强类型，高级模式允许显式模型                |
| 微观性能 vs 正确性        | 先保守求值与明确快照                        |
| 多引擎可替换 vs 稳定行为     | 一个自有 Runtime，不提供通用后端协议            |
| 原地注册方便 vs 作用域可预测   | `.ui()` 返回新系统，注册表固定               |
| 通用插件统一 vs 职责清楚     | Feature 与内建 Renderer 分立，不强求同一扩展协议 |


### 19.2 仍须通过原型决定

1. 统一 Schema 中 drive 的完整上下文推导是否在目标 TypeScript 版本可行。
2. Control 组件 props 推导与双向值检查采用何种描述类型。
3. 数组基线、集合替换和嵌套类型是否满足性能与状态一致性。
4. hook-owned 资源租约、SSR 与 StrictMode 的具体实现。
5. 自研 store 的内部数据结构与通用不可变更新工具取舍；不是表单引擎选型，不改变自行维护 Core 的前提。
6. API 是否公开 selector、自定义值 codec、自动 context 桥接，以及它们的最小契约。
7. `.ui()` 如何在保留基础泛型的同时约束注册表、实现双向 Control 值检查，并控制大型 Schema 的类型计算成本。
8. 系统身份校验、Renderer 代码按需构建与配置快照是否通过实际产物和运行时测试。

这些不是留给运行时猜测的行为。进入相应实现阶段前，应补充决策记录和测试。

### 19.3 当前不提供的可选能力

- 任意 Core Schema 热替换与状态迁移。
- 任意 feature 的动态安装/卸载。
- 自动依赖追踪与通用 reaction DSL。
- 完整资源请求与缓存管理 API。
- 多可编辑视图共享一个字段。
- 全类型值的持久化/序列化。
- 所有框架一次性发布。

第三方表单引擎对接、Presentation Feature 化、可变 UI 注册表与 Whole Form 布局 DSL 属于第 2 节排除的设计路线。

### 19.4 评审时要回答的核心问题

不是“有没有做到最纯粹的 headless”，而是：

> 同一份业务事实是否只需声明一次？  
> 普通用户是否能不理解内部装配就完成工作？  
> UI 是否只扩展返回系统，而不改变基础系统与已有实例？  
> Presentation 是否确实由内建 Renderer 独立处理？  
> Core 是否真能独立运行？  
> 动态变化是否经过明确且可预测的协议？  
> 静态类型和运行时承诺是否一致？

若一个抽象只增加公开对象和连接步骤，却没有减少重复事实、维护风险或实现复杂度，应考虑留在内部。



## 20. 技术参考

以下参考说明语言与框架的边界，不定义 Form 的业务语义，也不是接口已经实现或测试通过的证明。实现时应按项目锁定的依赖版本验证相应行为。

- [R1](https://react.dev/reference/react/useSyncExternalStore) React：`useSyncExternalStore`。外部 Store、稳定快照、SSR 与 Transition 边界。
- [R2](https://react.dev/reference/rules/components-and-hooks-must-be-pure) React：Components and Hooks must be pure。渲染纯度与副作用阶段。
- [R3](https://react.dev/reference/react/StrictMode) React：`StrictMode`。开发环境的渲染与 effect 检查。
- [R4](https://react.dev/learn/choosing-the-state-structure) React：Choosing the State Structure。初始化 props、重复状态与状态所有权。
- [R5](https://react.dev/reference/react/useMemo) React：`useMemo`。缓存与正确性保证的区别。
- [R6](https://react.dev/learn/preserving-and-resetting-state) React：Preserving and Resetting State。组件身份与 key 的重置范围。
- [R7](https://react.dev/reference/react-dom/components/input) React：`<input>`。受控 value/checked 与事件映射。
- [R8](https://www.typescriptlang.org/docs/handbook/2/basic-types.html) TypeScript：The Basics。类型注解与运行时值的区别。

---

## 设计摘要

```text
基础系统：
configureForms(coreOptions)

可选 UI 扩展：
baseForms.ui(presentation) → 新的 UiSystem

Presentation 归属：
内建 Renderer；不是 Feature，不进入 Core

统一定义：
forms.defineSchema(fields)

实例：
forms.create(schema) / forms.useForm(schema)

状态：
自研 Core 唯一拥有 values、元数据、校验与提交

普通联动：
固定规则 + 当前输入 → Renderer 派生结果

数据联动：
Core 命令 → 一次一致的状态提交

真正换契约：
新 Schema → 显式新实例

无头组合 UI：
自行订阅字段，或注册 Control / Field 使用内建 Renderer
```

**基础系统独立成立，UI 作为返回值上的能力扩展，最终仍然使用一份 Schema。**
