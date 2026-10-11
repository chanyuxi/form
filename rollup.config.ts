import type { RollupOptions } from 'rollup'

import { resolve } from 'node:path'

import { nodeResolve } from '@rollup/plugin-node-resolve'
import typescript from '@rollup/plugin-typescript'
import del from 'rollup-plugin-delete'

const rootDirectory = process.cwd()
const sourceDirectory = resolve(rootDirectory, 'src')
const distDirectory = resolve(rootDirectory, 'dist')
const cleanTarget = resolve(distDirectory, '*').replaceAll('\\', '/')

const config: RollupOptions = {
  external: id => id === '@chanyuxi/utils' || id.startsWith('@chanyuxi/utils/'),
  input: resolve(sourceDirectory, 'index.ts'),
  output: {
    dir: distDirectory,
    format: 'es',
    preserveModules: true,
    preserveModulesRoot: sourceDirectory,
    sourcemap: true,
  },
  plugins: [
    del({
      runOnce: true,
      targets: cleanTarget,
    }),
    nodeResolve({ extensions: ['.mjs', '.js', '.json', '.ts'] }),
    typescript({
      tsconfig: resolve(rootDirectory, 'tsconfig.rollup.json'),
    }),
  ],
}

export default config
