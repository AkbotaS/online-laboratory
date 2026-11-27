import { handleDatabaseRequest } from '../server.mjs';

export default function handler(request, response) {
  const url = new URL(request.url, 'http://localhost');
  if (url.pathname === '/api/laboratory') {
    const route = url.searchParams.get('labRoute') || '';
    if (!/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(route)) {
      response.writeHead(404);
      return response.end();
    }
    url.searchParams.delete('labRoute');
    request.url = '/api/' + route + url.search;
  }
  return handleDatabaseRequest(request, response);
}
