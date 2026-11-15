import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// In development the API (npm run api, port 4000) serves the data and the
// downloaded images; Vite forwards those requests to it.
const API = "http://127.0.0.1:4000";

export default defineConfig({
    plugins: [react(), tailwindcss()],
    server: {
        port: 5173,
        proxy: {
            "/api": API,
            "/storage": API,
        },
    },
});
