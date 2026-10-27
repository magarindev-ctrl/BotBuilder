import { Workshop } from './ui.js';

const api = typeof risuai !== 'undefined' ? risuai : globalThis.Risuai;
if (api) {
  const app = new Workshop(api, document);
  app.init().catch(error => {
    console.error('[이야기 공방]', error);
    document.body.textContent = '이야기 공방을 시작하지 못했습니다: ' + error.message;
  });
}
