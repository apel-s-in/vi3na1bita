export class PositionManager {
  static save(trackId, position) {
    localStorage.setItem('current_track_position', JSON.stringify({
      trackId,
      position,
      timestamp: Date.now()
    }));
  }
  static get(trackId) {
    const saved = localStorage.getItem('current_track_position');
    if (!saved) return null;
    try {
      const data = JSON.parse(saved);
      if (data.trackId !== trackId) return null;
      const age = Date.now() - data.timestamp;
      if (age > 3600000) {
        localStorage.removeItem('current_track_position');
        return null;
      }
      return data.position;
    } catch {
      return null;
    }
  }
  static clear() { localStorage.removeItem('current_track_position'); }
}
