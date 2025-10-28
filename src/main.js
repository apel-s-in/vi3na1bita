import { loadConfig, VERSION } from './core/config.js';
import { Player } from './player/player.js';

// Хелпер: отображаем уведомления из всех мест приложения
import { NotificationSystem } from './core/notifications.js';

let config = null;

async function bootstrap() {
  config = await loadConfig();
  // PROMOKOD BLOCK: работает ровно как было в вашей логике
  if (localStorage.getItem('promoPassed') === '1') {
    document.getElementById('main-block').classList.remove('hidden');
    document.getElementById('promocode-block').classList.add('hidden');
    Player.init(config);
    // ...Применяем сохранённое состояние PlayerState если есть
    const st = PlayerState.restore();
    if (st) PlayerState.apply(st, config, Player.showTrack.bind(Player));
  } else {
    document.getElementById('promo-btn').onclick = checkPromo;
    document.getElementById('promo-inp').addEventListener('keydown', function(e) {
      if (e.key === 'Enter') checkPromo();
    });
  }

  // …можно дальше навесить hotkeys, инициализацию кнопок, загрузку cover, и проч.
}

function checkPromo() {
  const inp = document.getElementById('promo-inp');
  const err = document.getElementById('promo-error');
  const val = (inp?.value || '').trim();
  if (!val) { err.innerText = "Введите промокод"; return; }
  if (val.toUpperCase() === (config?.promoCode || 'VITRINA2025').toUpperCase()) {
    localStorage.setItem('promoPassed', '1');
    document.getElementById('main-block').classList.remove('hidden');
    document.getElementById('promocode-block').classList.add('hidden');
    Player.init(config);
    const st = PlayerState.restore();
    if (st) PlayerState.apply(st, config, Player.showTrack.bind(Player));
  } else {
    err.innerText = "Неверный промокод. Попробуйте ещё!";
  }
}
window.checkPromo = checkPromo;

document.addEventListener('DOMContentLoaded', bootstrap);
