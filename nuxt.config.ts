// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  runtimeConfig: {
    aiApiKey: process.env.AI_API_KEY || '',
    aiBaseUrl: process.env.AI_BASE_URL || 'https://api.deepseek.com',
  },
  // Windows + Node 22: pin IPv4 to avoid Vite/Nitro IPC ECONNRESET restart loops
  devServer: {
    host: '127.0.0.1',
    port: 3000,
  },
})
