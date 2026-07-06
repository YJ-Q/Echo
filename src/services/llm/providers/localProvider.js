export function createLocalProvider() {
  return {
    name: 'local',
    model: 'echo-local-reflective',
    async generateText({ fallback }) {
      return fallback();
    }
  };
}
