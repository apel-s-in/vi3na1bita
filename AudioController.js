/**
 * AudioController.js
 * Единый глобальный контроллер для управления воспроизведением.
 * Решает проблемы: утечки памяти, дублирующиеся <audio> элементы, нестабильные события.
 */
export class AudioController {
  constructor() {
    // Создаем единственный <audio> элемент
    this.audio = document.createElement('audio');
    this.audio.id = 'global-audio';
    this.audio.preload = 'metadata';
    this.audio.playsInline = true;
    this.audio.crossOrigin = 'anonymous';
    this.audio.style.position = 'absolute';
    this.audio.style.width = '1px';
    this.audio.style.height = '1px';
    this.audio.style.opacity = '0';
    this.audio.style.pointerEvents = 'none';
    document.body.appendChild(this.audio);

    // Привязываем обработчики событий
    this.audio.addEventListener('play', () => this.onPlay());
    this.audio.addEventListener('pause', () => this.onPause());
    this.audio.addEventListener('ended', () => this.onEnded());
    this.audio.addEventListener('timeupdate', (e) => this.onTimeUpdate(e));
    this.audio.addEventListener('loadedmetadata', (e) => this.onLoadedMetadata(e));

    // Состояние
    this.isPlaying = false;
    this.currentTrackUrl = null;
    this.onPlayCallback = null;
    this.onPauseCallback = null;
    this.onEndedCallback = null;
    this.onTimeUpdateCallback = null;
    this.onMetadataLoadedCallback = null;
  }

  // --- Публичные методы API ---

  /**
   * Загружает и начинает воспроизведение трека.
   * @param {string} url - URL аудиофайла.
   * @param {number} [startTime=0] - Время начала воспроизведения в секундах.
   */
  async playTrack(url, startTime = 0) {
    if (this.currentTrackUrl !== url) {
      this.currentTrackUrl = url;
      this.audio.src = url;
      this.audio.currentTime = startTime;
    } else if (startTime !== this.audio.currentTime) {
      this.audio.currentTime = startTime;
    }

    try {
      await this.audio.play();
      this.isPlaying = true;
    } catch (error) {
      console.warn('AudioController: Не удалось воспроизвести трек', error);
      this.isPlaying = false;
      throw error;
    }
  }

  /**
   * Ставит воспроизведение на паузу.
   */
  pause() {
    this.audio.pause();
    this.isPlaying = false;
  }

  /**
   * Останавливает воспроизведение и сбрасывает позицию.
   */
  stop() {
    this.audio.pause();
    this.audio.currentTime = 0;
    this.isPlaying = false;
  }

  /**
   * Устанавливает громкость.
   * @param {number} volume - Значение от 0.0 до 1.0.
   */
  setVolume(volume) {
    this.audio.volume = Math.max(0, Math.min(1, volume));
  }

  /**
   * Перематывает воспроизведение.
   * @param {number} time - Абсолютное время в секундах.
   */
  seekTo(time) {
    this.audio.currentTime = Math.max(0, Math.min(this.audio.duration || Infinity, time));
  }

  /**
   * Устанавливает обработчик события "play".
   * @param {Function} callback
   */
  onPlay(callback) {
    this.onPlayCallback = callback;
  }

  /**
   * Устанавливает обработчик события "pause".
   * @param {Function} callback
   */
  onPause(callback) {
    this.onPauseCallback = callback;
  }

  /**
   * Устанавливает обработчик события "ended".
   * @param {Function} callback
   */
  onEnded(callback) {
    this.onEndedCallback = callback;
  }

  /**
   * Устанавливает обработчик события "timeupdate".
   * @param {Function} callback
   */
  onTimeUpdate(callback) {
    this.onTimeUpdateCallback = callback;
  }

  /**
   * Устанавливает обработчик события "loadedmetadata".
   * @param {Function} callback
   */
  onLoadedMetadata(callback) {
    this.onMetadataLoadedCallback = callback;
  }

  // --- Приватные обработчики событий ---

  onPlay() {
    this.isPlaying = true;
    if (this.onPlayCallback) this.onPlayCallback();
  }

  onPause() {
    this.isPlaying = false;
    if (this.onPauseCallback) this.onPauseCallback();
  }

  onEnded() {
    if (this.onEndedCallback) this.onEndedCallback();
  }

  onTimeUpdate(event) {
    if (this.onTimeUpdateCallback) this.onTimeUpdateCallback(event);
  }

  onLoadedMetadata(event) {
    if (this.onMetadataLoadedCallback) this.onMetadataLoadedCallback(event);
  }

  // --- Свойства для удобного доступа ---
  get currentTime() { return this.audio.currentTime; }
  get duration() { return this.audio.duration; }
  get volume() { return this.audio.volume; }
}

// Создаем и экспортируем единственный экземпляр (Singleton)
export const audioController = new AudioController();