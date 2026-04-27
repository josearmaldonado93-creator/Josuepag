import { defineConfig } from 'vite'

export default defineConfig({
  preview: {
    allowedHosts: [
      'josuepag-production.up.railway.app',
      '.railway.app',
      'www.psicjosueberru.com',
      'psicjosueberru.com'
    ]
  }
})
