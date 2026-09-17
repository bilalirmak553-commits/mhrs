const API = 'https://api.telegram.org/bot';

async function botBilgisi(token) {
    const res = await fetch(API + token + '/getMe', { signal: AbortSignal.timeout(10000) });
    const json = await res.json().catch(() => null);
    if (!json || !json.ok) {
        throw new Error((json && json.description) || 'Bot doğrulanamadı (HTTP ' + res.status + ')');
    }
    return json.result;
}

async function mesajGonder(token, chatId, metin) {
    const res = await fetch(API + token + '/sendMessage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(10000),
        body: JSON.stringify({ chat_id: String(chatId).trim(), text: metin })
    });
    const json = await res.json().catch(() => null);
    if (!json || !json.ok) {
        throw new Error((json && json.description) || 'Mesaj gönderilemedi (HTTP ' + res.status + ')');
    }
    return json.result;
}

module.exports = { botBilgisi, mesajGonder };
