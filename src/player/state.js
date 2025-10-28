export class PlayerState {
  static save(currentTrack, audio) {
    const state = {
      trackIndex: currentTrack,
      position: audio ? audio.currentTime : 0,
      volume: audio ? audio.volume : 1,
      savedVolume: localStorage.getItem('playerVolume'),
      liked: PlayerState.getLiked(),
      timestamp: Date.now()
    };
    localStorage.setItem('playerState', JSON.stringify(state));
  }
  static restore() {
    try {
      const saved = localStorage.getItem('playerState');
      if (!saved) return null;
      const state = JSON.parse(saved);
      if (Date.now() - state.timestamp > 24 * 3600_000) return null;
      return state;
    } catch {
      return null;
    }
  }
  static apply(state, config, showTrack) {
    if (!state || !config) return;
    if (state.savedVolume) {
      localStorage.setItem('playerVolume', state.savedVolume);
    }
    if (state.trackIndex >= 0 && state.trackIndex < config.tracks.length) {
      showTrack(state.trackIndex, false);
      setTimeout(() => {
        const audio = document.getElementById('audio');
        if (audio && state.position > 0) {
          audio.currentTime = state.position;
          audio.volume = state.volume || 1;
        }
      }, 500);
    }
  }
  static getLiked() {
    try { return JSON.parse(localStorage.getItem('likedTracks') || "[]"); }
    catch { return []; }
  }
}
