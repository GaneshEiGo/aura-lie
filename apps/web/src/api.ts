export async function streamChat(
  query: string,
  mode: string,
  onEvent: (event: any) => void,
  onError: (err: any) => void
) {
  try {
    const response = await fetch('/v1/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer aura-lie-dev-token'
      },
      body: JSON.stringify({ query, mode })
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const reader = response.body?.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = JSON.parse(line.replace('data: ', '').trim());
            onEvent(data);
          }
        }
      }
    }
  } catch (err) {
    onError(err);
  }
}