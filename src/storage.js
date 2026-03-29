// Drop-in replacement for Claude Artifacts' window.storage API
// Uses localStorage for persistence across sessions

const storage = {
  async get(key) {
    try {
      const value = localStorage.getItem(`claims:${key}`);
      if (value === null) throw new Error('Key not found');
      return { key, value, shared: false };
    } catch (e) {
      throw e;
    }
  },

  async set(key, value) {
    try {
      localStorage.setItem(`claims:${key}`, value);
      return { key, value, shared: false };
    } catch (e) {
      console.error('Storage set error:', e);
      return null;
    }
  },

  async delete(key) {
    try {
      localStorage.removeItem(`claims:${key}`);
      return { key, deleted: true, shared: false };
    } catch (e) {
      return null;
    }
  },

  async list(prefix = '') {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k.startsWith(`claims:${prefix}`)) {
        keys.push(k.replace('claims:', ''));
      }
    }
    return { keys, prefix, shared: false };
  }
};

export default storage;
