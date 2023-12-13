import { defineConfig } from 'rollup'
// import { resolve, dirname } from 'node:path'
// import { fileURLToPath } from 'node:url'
import terser from '@rollup/plugin-terser'
import typescript from '@rollup/plugin-typescript'
import dts from 'rollup-plugin-dts'

export default defineConfig([
  {
    input: './src/index.ts',
    output: [
      {
        file: './dist/index.mjs',
        format: 'esm',
      },
      {
        file: './dist/index.cjs',
        format: 'cjs',
      },
    ],
    plugins: [typescript()],
  },
  {
    input: './src/index.ts',
    output: {
      file: './dist/index.d.ts',
      format: 'esm',
    },
    plugins: [dts()],
  },
])
