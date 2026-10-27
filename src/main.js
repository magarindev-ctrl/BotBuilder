import { Workshop } from './ui.js';

const api = typeof risuai !== 'undefined' ? risuai : globalThis.Risuai;
if (api) {
  const app = new Workshop(api, document);
  app.init().catch(error => {
    console.error('[봇빌더]', error);
    document.body.textContent = '봇빌더를 시작하지 못했습니다: ' + error.message;
  });
}
