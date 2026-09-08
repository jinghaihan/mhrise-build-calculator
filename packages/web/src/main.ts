import { createApp } from 'vue'
import App from './App.vue'
import { i18n } from './i18n'
import '@unocss/reset/tailwind.css'
import '@antfu/design/styles/base.css'
import '@antfu/design/styles/scrollbar.css'
import 'uno.css'
import './styles.css'

createApp(App).use(i18n).mount('#app')
