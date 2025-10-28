export class NotificationSystem {
  static queue = [];
  static isShowing = false;

  static show(message, type = 'info', duration = 3000) {
    this.queue.push({ message, type, duration });
    if (!this.isShowing) {
      this.processQueue();
    }
  }

  static async processQueue() {
    if (this.queue.length === 0) {
      this.isShowing = false;
      return;
    }
    this.isShowing = true;
    const { message, type, duration } = this.queue.shift();
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    await new Promise(r => setTimeout(r, 30));
    toast.classList.add('show');
    await new Promise(r => setTimeout(r, duration));
    toast.classList.remove('show');
    await new Promise(r => setTimeout(r, 300));
    toast.remove();
    this.processQueue();
  }
  static info(msg) { this.show(msg, 'info'); }
  static success(msg) { this.show(msg, 'success'); }
  static error(msg) { this.show(msg, 'error', 5000); }
  static warning(msg) { this.show(msg, 'warning', 4000); }
}
window.NotificationSystem = NotificationSystem;
