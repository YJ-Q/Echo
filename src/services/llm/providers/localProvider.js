export function createLocalProvider() {
  return {
    name: 'local',
    model: 'margin-local-reflective',
    async generateText({ fallback }) {
      return fallback();
    }
  };
}
