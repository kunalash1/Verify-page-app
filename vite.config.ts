import { defineConfig, loadEnv } from "vite"
import react from "@vitejs/plugin-react"

export default defineConfig(({ mode }) => {

  const env = loadEnv(mode, process.cwd())

  const verifyBaseUrl =
    env.VITE_VERIFY_BASE_URL || "https://verify.kunalash.com"

  return {

    plugins: [react()],

    server: {
      allowedHosts: [
        "qr.kunalash.com"
      ],

      proxy: {
        "/verify": {
          target: verifyBaseUrl,
          changeOrigin: true,
          secure: true,
          ws: false,
          rewrite: (path) => path.replace(/^\/verify/, "")
        }
      }
    }

  }
})