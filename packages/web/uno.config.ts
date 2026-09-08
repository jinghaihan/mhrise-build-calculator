import { presetAnthonyDesign } from '@antfu/design/unocss'
import { icons } from '@iconify-json/ph'
import presetIcons from '@unocss/preset-icons'
import transformerDirectives from '@unocss/transformer-directives'
import { defineConfig, presetWind4 } from 'unocss'

export default defineConfig({
  presets: [
    presetAnthonyDesign({ primary: '#5d5d99' }),
    presetIcons({ collections: { ph: () => icons } }),
    presetWind4(),
  ],
  transformers: [transformerDirectives()],
  shortcuts: {
    'z-dropdown': 'z-[40]',
  },
})
