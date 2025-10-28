import { NotificationSystem } from "../core/notifications.js";
import { PositionManager } from "./position.js";
import { PlayerState } from "./state.js";
import { formatTime } from "../core/utils.js";

// --- Основной JS для плеера ---
export const Player = {
  config: null,
  currentTrack: -1,
  favoritesFilterActive: false,
  favoritesOnlyMode: false,

  init(config) {
    this.config = config;
    // ...другой код инициализации, который выносим из старого initializeMainUi:
    // - кэшируем DOM-элементы
    // - строим плейлист (buildTrackList)
    // - восстанавливаем состояния фильтра, repeat, shuffle, favoriteOnlyMode
    // - навешиваем обработчики кнопок
    // - эмулируем прошлую PlayerState.restore+apply
  },

  buildTrackList() {
    // ...Старый код buildTrackList, аккуратно используя this.config
  },

  pickAndPlayTrack(n) {
    // ...showTrack(n, true) + позиция
  },

  showTrack(n, doPlay) {
    // ... полный перенос showTrack
  },

  // ... и так далее (вынесем ВСЕ функции связанные с логикой плеера: togglePlayPause, stopPlayback и пр).

  toggleFavoritesFilter() { /* ... */ },
  // ...Все функции управления (UI, обработчики, копирование, prev/next, sleep, lyrics, анимации)
};

window.toggleFavoritesFilter = Player.toggleFavoritesFilter.bind(Player);
window.pickAndPlayTrack = Player.pickAndPlayTrack.bind(Player);
window.toggleLike = function(idx, e) { Player.toggleLike(idx, e); };
// и так далее для всех функций, вызываемых из inline onclick
