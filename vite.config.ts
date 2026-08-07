import { defineConfig } from 'vite';

export default defineConfig({
  // Відносні шляхи: збірка працює і на GitHub Pages (підкаталог
  // /scuderia-mozarella/), і відкрита просто з диска як file://
  base: './',
});
