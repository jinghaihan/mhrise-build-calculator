import { presetAnthonyDesign } from '@antfu/design/unocss'
import transformerDirectives from '@unocss/transformer-directives'
import { defineConfig, presetWind4 } from 'unocss'

export default defineConfig({
  presets: [
    presetAnthonyDesign({ primary: '#d68b4c', darkBackground: '#101416' }),
    presetWind4(),
  ],
  transformers: [transformerDirectives()],
  shortcuts: {
    'z-dropdown': 'z-[40]',
  },
})
