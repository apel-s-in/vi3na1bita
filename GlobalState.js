// GlobalState.js
export const globalState = {
  state: {
    currentAlbumKey: null,
    playingAlbumKey: null,
    playingTrackIndex: -1,
    isPlaying: false,
    shuffleMode: false,
    repeatMode: false,
    favoritesOnlyMode: false,
    animationEnabled: false,
    bitEnabled: false,
    bitIntensity: 100,
    // Другие поля...
  },

  setState(newState) {
    Object.assign(this.state, newState);
    // Сохраняем состояние в localStorage
    localStorage.setItem('appState', JSON.stringify(this.state));
    // Здесь можно добавить рассылку событий, если это нужно
  },

  getState() {
    return { ...this.state };
  },

  // Пример метода для получения треков альбома
  getTracksForAlbum(albumKey) {
    // Реализуйте логику получения треков из `albumsIndex`
    const album = albumsIndex.find(a => a.key === albumKey);
    if (album && album.config && Array.isArray(album.config.tracks)) {
      return album.config.tracks;
    }
    return [];
  },

  // Другие необходимые методы...
};

// Инициализируем состояние из localStorage
const savedState = localStorage.getItem('appState');
if (savedState) {
  try {
    globalState.state = JSON.parse(savedState);
  } catch (e) {
    console.warn('Не удалось восстановить состояние', e);
  }
}
