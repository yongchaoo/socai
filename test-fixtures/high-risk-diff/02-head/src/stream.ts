/** SSE client — touches EventSource + auth token handling */
export function connectStream(url: string, token: string) {
  const es = new EventSource(url, { withCredentials: true });
  es.addEventListener('auth', () => {
    console.log('session', token);
  });
  return es;
}
