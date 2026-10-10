/* global console */

import { performance } from 'node:perf_hooks'

import { configureForms } from '@chanyuxi/form'

type BenchmarkValues = Record<string, number>

const iterations = 1_000
const sampleCount = 5
const warmupIterations = 200

for (const fieldCount of [10, 100, 500]) {
  const fields = Array.from({ length: fieldCount }, (_, index) => ({
    defaultValue: 0,
    name: `field${index}`,
  }))
  const forms = configureForms()
  const schema = forms.defineSchema<BenchmarkValues>()(fields)
  const form = forms.create(schema)

  for (let index = 1; index <= warmupIterations; index += 1) {
    form.setValue('field0', index)
  }

  const samples = Array.from({ length: sampleCount }, (_, sampleIndex) => {
    const offset = warmupIterations + sampleIndex * iterations
    const startedAt = performance.now()
    for (let index = 1; index <= iterations; index += 1) {
      form.setValue('field0', offset + index)
    }
    return performance.now() - startedAt
  }).sort((left, right) => left - right)

  const median = samples[Math.floor(samples.length / 2)] ?? 0
  console.log(`${fieldCount} fields: ${median.toFixed(1)} ms median / ${iterations} setValue calls`)
}
