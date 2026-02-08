# vrplike EDO signing-agent (OUTBOUND_WS, MVP)

Этот агент запускается **в контуре клиента** (там, где доступны CryptoPro/КЭП) и сам устанавливает исходящее соединение (WSS) с vrplike, чтобы получать команды подписи.

В текущем MVP агент делает **реальную подпись CryptoPro** только для операции `AUTH_CHALLENGE_ATTACHED` (подпись строки challenge для Astral `auth/byCertificate`).

- `AUTH_CHALLENGE_ATTACHED`: **реализовано** (возвращает binary CMS/PKCS#7 attached `signedData`, отправляется как base64 по WS).
- `DRAFT_DETACHED`: **TODO** (подпись документов будет добавлена позже; сейчас возвращает `SIGN_NOT_IMPLEMENTED`).

## 1) Требования

- Доступ к `wss://.../ws/edo-signer` (наружу из контура клиента)

### Windows (для REAL подписи)

- **Готовность к подписи (readiness)**: в хранилище сертификатов Windows должен быть **хотя бы один сертификат с доступным закрытым ключом**
  - проверяются `CurrentUser\My` и `LocalMachine\My`
  - если сертификата с закрытым ключом нет — агент будет возвращать `CERT_NOT_FOUND`
- **Основной способ подписи (Windows)**: через **CAdESCOM (COM)** (PowerShell), **без зависимости от** `cryptcp.exe` / `csptest.exe`
  - отсутствие `cryptcp/csptest` — это нормально
  - `cryptcp/csptest` остаются только как **fallback** для dev/нестандартных окружений
- CryptoPro CSP должен быть установлен/доступен в системе, а сертификат/контейнер — доступен на этой машине (реестр/токен/смарт‑карта)
- (Fallback) Агент **автоматически находит** `cryptcp.exe` / `csptest.exe` (без настройки `PATH`, без прав администратора)
  - при необходимости можно задать override:
    - `CRYPTCP_PATH` / `CSPTEST_PATH` (абсолютный путь к exe)
    - `CRYPTOPRO_HOME` (каталог, где лежат `cryptcp.exe` / `csptest.exe`)

## Windows distribution (canonical): normal installer `setup.exe`

Канон: **установленное приложение** через Inno Setup 6 (без portable/self-install/PE-патчей).

- Web download URL: `https://app.vrplike.io/downloads/vrplike-signer-setup.exe`
- Каноничная инструкция релиза: `docs/dev/release-signer-installer.md`

Состав установленного приложения:

- `vrplike-signer-tray.exe` (WinForms WinExe): autorun + URL protocol handler (`vrplike-signer://...`)
- `vrplike-signer.exe` (Node/pkg): agent runtime (`--installed`, без registry self-registration)
- `tray.ico`

Runtime:

- tray-host стартует по `HKCU\...\Run` и **сам** поднимает agent (скрыто, без консоли)
- deeplink запускает tray-host, который стартует agent с `--installed "<url>"`

### CryptoPro autodetect (Windows)

Если включён/нужен fallback на CryptoPro tools, агент ищет `cryptcp/csptest` в порядке:

1) `CRYPTCP_PATH` / `CSPTEST_PATH` (если файл существует)  
2) `CRYPTOPRO_HOME\\cryptcp.exe` / `CRYPTOPRO_HOME\\csptest.exe`  
3) `where cryptcp` / `where csptest` (PATH)  
4) стандартные пути:
   - `C:\\Program Files\\Crypto Pro\\CSP\\cryptcp.exe`
   - `C:\\Program Files (x86)\\Crypto Pro\\CSP\\cryptcp.exe`
   - `C:\\Program Files\\Crypto Pro\\CSP\\csptest.exe`
   - `C:\\Program Files (x86)\\Crypto Pro\\CSP\\csptest.exe`

Если выбранный `CRYPTOPRO_TOOL` не найден — агент пробует второй.

### Support mode (`--doctor`)

```powershell
.\vrplike-signer.exe --doctor
```

Выводит (без секретов):
- platform
- readiness по Windows certificate store: сколько сертификатов найдено и сколько из них с закрытым ключом
- найден ли `cryptcp/csptest` + источник (ENV / PATH / STANDARD_PATH) или список проверенных путей
- путь к `agent.json`
- зарегистрирован ли `vrplike-signer://` (через `reg.exe query`)
- tray-host diagnostics (Windows):
  - ожидаемый путь к `vrplike-signer-tray.exe` рядом с `vrplike-signer.exe` (installed) или legacy `%APPDATA%\\vrplike-signer\\bin\\tray-host.exe`
  - имя/путь named pipe `vrplike-signer-tray-<USER_SID>`
  - запущен ли tray-host (probe подключения к pipe)

### Где хранится состояние (`agent.json`)

По умолчанию файл состояния хранится **в профиле пользователя** (без прав администратора):

- Windows: `%APPDATA%\vrplike-signer\agent.json`
- Fallback (если `APPDATA` нет): `~/.vrplike-signer/agent.json`

Переопределение пути (dev/ops): `AGENT_STATE_PATH`.

## 2) Pairing (первый запуск)

1) Получите одноразовый pairing token (admin endpoint):

- `POST /admin/edo-signer/pairing-token`
- Headers: `X-Admin-Token: ...`
- Body: `{ "legalEntityId": "..." }`

Ответ содержит:
- `pairingToken` (TTL 10 минут, одноразовый)
- `wsUrl` (WSS URL для подключения агента)

2) Запустите агент:

```bash
export VRPLIKE_WSS_URL="wss://api.vrplike.io/ws/edo-signer"
export PAIRING_TOKEN="...одноразовый..."
export CERTIFICATE_REF="optional" # thumbprint/alias (используется по умолчанию, если payload.certificateRef не передан)

pnpm --filter @vrplike/edo-signer-agent build
node apps/edo-signer-agent/dist/index.js
```

При успехе агент:
- получит `WELCOME` с `agentId` и `agentSecret`
- сохранит их локально в `agent.json` (см. “Где хранится состояние” выше)

## 3) Reconnect (последующие запуски)

Если рядом есть `agent.json`, токен pairing больше не нужен:

```bash
export VRPLIKE_WSS_URL="wss://api.vrplike.io/ws/edo-signer"
node apps/edo-signer-agent/dist/index.js
```

## 4) Конфигурация подписи (ENV)

Агент получает `certificateRef` двумя путями:

- из `SIGN_REQUEST.payload.certificateRef` (если vrplike/оператор передаёт его), иначе
- из `CERTIFICATE_REF` (env) как “дефолт”.

Дальше `certificateRef` трактуется как:

- **thumbprint** (если похоже на hex 40/64), иначе
- “alias”/строка (по умолчанию трактуется как `SUBJECT`/DN; при необходимости настройте соответствующий флаг через `*_ARGS_TEMPLATE`), либо
- fallback на `CERT_THUMBPRINT` / `CERT_SUBJECT` / `CONTAINER_NAME`.

### Основные ENV

- `CRYPTOPRO_TOOL`: `cryptcp` | `csptest` (default: `cryptcp`)
- `CRYPTCP_PATH`: путь к `cryptcp` (default: `cryptcp`)
- `CSPTEST_PATH`: путь к `csptest` (default: `csptest`)
- `CERT_THUMBPRINT`: thumbprint сертификата (если `certificateRef` не передан)
- `CERT_SUBJECT`: subject/DN (альтернатива thumbprint; зависит от поддерживаемых флагов CLI)
- `CONTAINER_NAME`: имя контейнера (альтернатива)
- `CERT_PIN`: PIN (optional, **не логируется**; используйте только если CSP требует)
- `TMP_DIR`: папка для временных файлов (optional)
- `CRYPTOPRO_TIMEOUT_MS`: таймаут подписи (default: `20000`)

### Переопределение аргументов CLI (важно)

У разных версий CryptoPro CLI набор флагов может отличаться, поэтому команда подписи **шаблонная**:

- `CRYPTCP_ARGS_TEMPLATE` (для `cryptcp`)
- `CSPTEST_ARGS_TEMPLATE` (для `csptest`)

Поддерживаемые плейсхолдеры:

- `{IN}`, `{OUT}`
- `{THUMBPRINT}` / `{SUBJECT}` / `{CONTAINER}`
- `{CERTIFICATE_REF}`
- `{PIN}` (если нужен)

Пример (best‑effort, может потребовать адаптации под вашу версию):

```bash
export CRYPTOPRO_TOOL="cryptcp"
export CERT_THUMBPRINT="AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" # 40 hex
export CRYPTCP_ARGS_TEMPLATE='-sign -thumbprint {THUMBPRINT} -in {IN} -out {OUT}'
```

## 5) Smoke-test подписи (локально, до подключения к vrplike)

Цель: проверить CryptoPro CSP на машине агента **без** vrplike.

```bash
pnpm --filter @vrplike/edo-signer-agent build

# Вариант 1: напрямую
node apps/edo-signer-agent/dist/cli/smoke-sign-challenge.js --challenge "ping" --certificateRef "<thumbprint-or-alias>"

# Вариант 2: через npm script (внутри workspace)
pnpm --filter @vrplike/edo-signer-agent smoke:sign-challenge -- --challenge "ping" --certificateRef "<thumbprint-or-alias>"
```

Ожидаемый вывод:

- `OK signature bytes length=...`

Подпись (base64/bytes) **не печатается**.

## 6) Troubleshooting

- **“не найден сертификат / NO_CERTIFICATE_SELECTED”**:
  - передайте `--certificateRef` (thumbprint) в smoke, или
  - задайте `CERT_THUMBPRINT` / `CERT_SUBJECT` / `CONTAINER_NAME`
- **CryptoPro CSP установлен, но `cryptcp/csptest` отсутствуют**:
  - это нормально: на Windows signer подписывает через **CAdESCOM (COM)** и не требует CLI утилит
  - для проверки запустите `vrplike-signer.exe --doctor` (покажет `CAdESCOM available` и `cert exists in store`)
- **`CADESCOM_NOT_AVAILABLE`**:
  - на машине не доступна компонента CAdESCOM (COM не зарегистрирован/не установлен)
  - установите/включите компоненты CryptoPro/CAdESCOM (часто ставится вместе с CryptoPro CSP / плагином), затем повторите
  - проверьте через `vrplike-signer.exe --doctor`
- **`SIGNING_TOOL_NOT_FOUND`** (fallback): 
  - это относится только к CLI fallback (`cryptcp/csptest`) и **не означает**, что CSP не установлен
  - если вам нужен CLI fallback (dev/нестандартные окружения) — установите **CryptoPro Tools** или задайте `CRYPTCP_PATH` / `CSPTEST_PATH` / `CRYPTOPRO_HOME`
- **`CERT_NOT_FOUND`** (нет сертификата с закрытым ключом):
  - установите сертификат в хранилище Windows или подключите токен/смарт‑карту
  - убедитесь, что закрытый ключ доступен текущему пользователю/службе
- **`CERT_NO_PRIVATE_KEY`**:
  - сертификат по thumbprint найден, но закрытый ключ недоступен текущему пользователю/службе
- **“нужен PIN”**:
  - задайте `CERT_PIN` и добавьте `{PIN}` в args template (если ваша версия CLI поддерживает передачу PIN)
- **“ошибка подписи / SIGNING_FAILED / SIGN_FAILED”**:
  - включите корректные флаги через `CRYPTCP_ARGS_TEMPLATE` / `CSPTEST_ARGS_TEMPLATE`
  - проверьте, что выбранный сертификат доступен текущему пользователю/службе
- **“выбран не тот сертификат”**:
  - vrplike в REAL `connect/test` сделает strict binding и вернёт `CERTIFICATE_ABONENT_MISMATCH`
  - выберите другой сертификат (обычно — другой thumbprint) и повторите

## 7) Безопасность (MVP)

- `agentSecret` хранится **только локально** (в `agent.json`), vrplike хранит только **hash**.
- Не коммитьте `agent.json` в репозиторий.
- Для production-пилота добавьте операционные меры: allowlist/VPN, контроль хоста агента, audit trail на стороне агента.

---

## Dev-only: запуск через Node (для разработчиков)

В production канон — **установленное приложение** (installer `setup.exe`). Запуск через `node dist/index.js` оставляем только для разработки/отладки.

