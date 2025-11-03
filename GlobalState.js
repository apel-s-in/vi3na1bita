/**
 * GlobalState.js
 * Централизованное хранилище состояния приложения.
 * Решает проблемы: синхронизация режимов плеера, потеря состояния, несогласованность UI.
 * Использует паттерн "Observer" для реактивности.
 */
export class GlobalState {
  constructor() {
    // Состояние приложения
    this.state = {
      // Альбомы
      albums: [],
      currentAlbumKey: null,
      currentAlbumConfig: null,

      // Воспроизведение
      playingAlbumKey: null,
      playingTrackIndex: -1,
      isPlaying: false,
      shuffleMode: false,
      repeatMode: false,
      favoritesOnlyMode: false,

      // UI и режимы
      viewMode: 'album', // 'album', 'favorites', 'reliz'
      isMiniPlayerActive: false,
      lyricsViewMode: 'normal', // 'normal', 'hidden', 'expanded'
      animationEnabled: false,
      bitEnabled: false,

      // Галерея
      coverGallery: [],
      currentCoverIndex: 0
    };

    // Список подписчиков (callback-функций)
    this.subscribers = new Set();
  }

  /**
   * Получает текущее состояние.
   * @returns {Object} Текущее состояние.
   */
  getState() {
    return { ...this.state };
  }

  /**
   * Устанавливает новое состояние и уведомляет подписчиков.
   * @param {Object} newState - Частичное или полное новое состояние.
   */
  setState(newState) {
    this.state = { ...this.state, ...newState };
    this.notifySubscribers();
  }

  /**
   * Подписывает функцию на изменения состояния.
   * @param {Function} callback - Функция, которая будет вызвана при изменении состояния.
   * @returns {Function} Функция для отписки.
   */
  subscribe(callback) {
    this.subscribers.add(callback);
    // Возвращаем функцию для отписки
    return () => {
      this.subscribers.delete(callback);
    };
  }

  /**
   * Уведомляет всех подписчиков о том, что состояние изменилось.
   * @private
   */
  notifySubscribers() {
    this.subscribers.forEach(callback => {
      try {
        callback(this.getState());
      } catch (error) {
        console.error('GlobalState: Ошибка в подписчике', error);
      }
    });
  }

  // --- Утилиты для удобства ---

  /**
   * Проверяет, просматривает ли пользователь другой альбом, чем тот, что играет.
   * @returns {boolean}
   */
  isBrowsingOtherAlbum() {
    const { playingAlbumKey, currentAlbumKey, viewMode } = this.state;
    if (!playingAlbumKey) return false;
    if (viewMode === 'favorites') return playingAlbumKey !== '__favorites__';
    if (viewMode === 'reliz') return true;
    return !!(currentAlbumKey && playingAlbumKey !== currentAlbumKey);
  }

  /**
   * Проверяет, совпадает ли альбом просмотра с альбомом воспроизведения.
   * @returns {boolean}
   */
  isBrowsingSameAsPlaying() {
    return !!(this.state.playingAlbumKey && this.state.playingAlbumKey === this.state.currentAlbumKey);
  }
}

// Создаем и экспортируем единственный экземпляр (Singleton)
export const globalState = new GlobalState();