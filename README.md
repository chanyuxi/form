# @chanyuxi/form

无 UI、Schema 驱动的自研表单内核。当前版本是 P0：支持标量字段、嵌套对象路径、不可变快照、dirty/touched、同步事务、同步校验和手动错误。

## Quick start

```ts
import { configureForms } from '@chanyuxi/form'

interface ProfileValues {
  name: string
  age: null | number
}

const forms = configureForms()
const schema = forms.defineSchema<ProfileValues>()([
  {
    name: 'name',
    defaultValue: '',
    validate: ({ value }) => value === ''
      ? [{ code: 'required', message: '请输入姓名' }]
      : [],
  },
  { name: 'age', defaultValue: null },
])

const form = forms.create(schema)
form.setValue('name', 'Jason')
await form.validate()
```

## Runtime contracts

- `state`、`values`、`defaultValues`、`context`、`fields` 和 Field 快照是缓存的只读属性；必须通过命令更新数据。
- `fields` 用于按定义顺序遍历，返回宽字段联合；需要精确路径和值类型时使用 `getField(name)`。
- values 的中间容器必须是非空的普通对象；nullable/optional 只用于叶子字段。
- 值与 Context 的标量范围是 `string | number | boolean | null | undefined`；Context 另外支持普通对象和数组。BigInt、Symbol、Date、Map、自定义类及函数会被拒绝。
- `transaction()` 只接受同步回调，并在成功时发布一次快照。
- 订阅者异常不回滚已提交状态，也不会让写命令伪装成失败。可通过 `configureForms({ onSubscriberError })` 接收异常。
- P0 校验器必须同步返回 issue 数组；异步校验、数组字段、Feature 和框架适配尚未开放。

## Development

Development requires Node.js 18.12 or newer and pnpm 12.

```bash
pnpm check
pnpm demo
```

`pnpm check` 会执行 lint、类型检查、Core 测试和 demo 构建。
