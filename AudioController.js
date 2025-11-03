// AudioController.js
export class AudioController {
  constructor() {
    this.audioElement = new Audio();
    this.audioElement.preload = 'metadata';
    this.audioElement.playsInline = true;
    this.audioElement.crossOrigin = 'anonymous';
    this.audioElement.addEventListener('ended', () => {
      // Отправить событие о завершении воспроизведения
    });
  }

  playTrack(url) {
    return new Promise((resolve, reject) => {
      this.audioElement.src = url;
      this.audioElement.play()
        .then(resolve)
        .catch(reject);
    });
  }

  pause() {
    this.audioElement.pause();
  }

  stop() {
    this.audioElement.pause();
    this.audioElement.currentTime = 0;
  }

  setVolume(volume) {
    this.audioElement.volume = volume;
  }

  getVolume() {
    return this.audioElement.volume;
  }

  getCurrentTime() {
    return this.audioElement.currentTime;
  }

  getDuration() {
    return this.audioElement.duration;
  }

  addEventListener(event, callback) {
    this.audioElement.addEventListener(event, callback);
  }

  removeEventListener(event, callback) {
    this.audioElement.removeEventListener(event, callback);
  }
}

// Создаем единственный экземпляр
export const audioController = new AudioController();
