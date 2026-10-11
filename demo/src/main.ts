import { configureForms } from '@chanyuxi/form'

import './style.css'

interface DemoContext {
  minimumAge: number
}

interface DemoValues {
  age: null | number
  name: string
}

const forms = configureForms<DemoContext>()

debugger
const schema = forms.defineSchema<DemoValues>()([
  {
    defaultValue: '',
    name: 'name',
    validate: ({ value }) => value.trim() === ''
      ? [{ code: 'required', message: '请输入姓名' }]
      : [],
  },
  {
    defaultValue: null,
    name: 'age',
    validate: ({ context, value }) => {
      if (value === null) {
        return [{ code: 'required', message: '请输入年龄' }]
      }
      return value < context.minimumAge
        ? [{ code: 'minimum', message: `年龄不能小于 ${context.minimumAge}` }]
        : []
    },
  },
])

debugger
const form = forms.create(schema, {
  initialContext: { minimumAge: 18 },
})

const formElement = getElement<HTMLFormElement>('demo-form')
const nameInput = getElement<HTMLInputElement>('name')
const ageInput = getElement<HTMLInputElement>('age')
const minimumAgeInput = getElement<HTMLInputElement>('minimum-age')
const nameErrors = getElement<HTMLElement>('name-errors')
const ageErrors = getElement<HTMLElement>('age-errors')
const stateOutput = getElement<HTMLElement>('state-output')
const revision = getElement<HTMLElement>('revision')
const result = getElement<HTMLElement>('result')

nameInput.addEventListener('input', () => {
  debugger
  form.setValue('name', nameInput.value)
})
nameInput.addEventListener('blur', () => {
  debugger
  form.markTouched('name')
})

ageInput.addEventListener('input', () => {
  debugger
  form.setValue('age', ageInput.value === '' ? null : ageInput.valueAsNumber)
})
ageInput.addEventListener('blur', () => {
  debugger
  form.markTouched('age')
})

minimumAgeInput.addEventListener('input', () => {
  debugger
  if (!Number.isNaN(minimumAgeInput.valueAsNumber)) {
    form.patchContext({ minimumAge: minimumAgeInput.valueAsNumber })
  }
})

formElement.addEventListener('submit', (event) => {
  debugger
  event.preventDefault()
  void form.submit(async (payload) => {
    await new Promise(resolve => setTimeout(resolve, 300))
    return payload
  }).then((submission) => {
    result.textContent = `submit() → ${submission.status}`
  })
})

getElement<HTMLButtonElement>('fill').addEventListener('click', () => {
  debugger
  form.transaction((transaction) => {
    transaction.setValue('name', 'Jason')
    transaction.setValue('age', 28)
  })
  result.textContent = 'transaction() → committed'
})

getElement<HTMLButtonElement>('manual-error').addEventListener('click', () => {
  debugger
  form.setError('name', {
    code: 'demo',
    message: '这是通过 setError() 写入的手动错误',
  })
  result.textContent = 'setError() → committed'
})

getElement<HTMLButtonElement>('reset').addEventListener('click', () => {
  debugger
  form.reset()
  form.patchContext({ minimumAge: 18 })
  minimumAgeInput.value = '18'
  result.textContent = 'reset() → committed'
})

console.log(form)
console.log(form.getField('name'))

// const validation = await form.validateField('name')
// console.log(validation)

debugger
const unsubscribe = form.subscribe(render)

window.addEventListener('beforeunload', () => {
  unsubscribe()
  form.dispose()
})

render()

function getElement<TElement extends HTMLElement>(id: string): TElement {
  const element = document.querySelector(`#${id}`)
  if (!(element instanceof HTMLElement)) {
    throw new Error(`Missing demo element: #${id}`)
  }
  return element as TElement
}

function render(): void {
  const state = form.state
  const nameState = form.getField('name').state
  const ageState = form.getField('age').state

  nameInput.value = form.getValue('name')
  const age = form.getValue('age')
  ageInput.value = age === null ? '' : String(age)
  nameErrors.textContent = nameState.errors.map(error => error.message).join('；')
  ageErrors.textContent = ageState.errors.map(error => error.message).join('；')
  revision.textContent = `revision ${state.revision}`
  stateOutput.textContent = JSON.stringify(state, null, 2)
}
