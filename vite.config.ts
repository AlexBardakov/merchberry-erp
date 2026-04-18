import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite' // <-- Добавляем этот импорт

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(), // <-- Вызываем плагин здесь
  ],
})