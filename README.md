<p align="center">
  <img src="./assets/images/github_banner_image.png" alt="@chanyuxi/form" width="100%" />
</p>

# @chanyuxi/form

Under Development

## Core submit

```ts
const forms = configureForms()
const schema = forms.defineSchema<ProfileValues>()(fields, {
  transform: ({ values }) => ({ name: values.name.trim() }),
})
const form = forms.create(schema)

const result = await form.submit(async (payload, { signal }) => {
  return saveProfile(payload, { signal })
})
```

`submit()` 会先校验并锁定输入快照，同时处理 `success`、`invalid`、`busy`、`stale`、`aborted` 和 `error`。提交状态通过 `form.state.isSubmitting`、`isSubmitted`、`isSubmitSuccessful` 和 `submitCount` 读取。
