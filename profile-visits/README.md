# Счётчики обращений к GitHub-профилю

Один Cloudflare Worker `github-profile-visits` и одна D1-база `github-profile-visits`.
Работают на бесплатном тарифе, без Cron, KV, Durable Objects, внешних ключей и JavaScript в профильном README.

## Публичные адреса

Базовый URL: <https://github-profile-visits.criticalroots.workers.dev/>

| URL | Что делает GET |
| --- | --- |
| [/visit.svg](https://github-profile-visits.criticalroots.workers.dev/visit.svg) | Регистрирует одно обращение и возвращает прозрачное SVG 1×1 |
| [/badges/today.json](https://github-profile-visits.criticalroots.workers.dev/badges/today.json) | Visits Today |
| [/badges/week.json](https://github-profile-visits.criticalroots.workers.dev/badges/week.json) | Visits This Week |
| [/badges/month.json](https://github-profile-visits.criticalroots.workers.dev/badges/month.json) | Visits This Month |
| [/badges/total.json](https://github-profile-visits.criticalroots.workers.dev/badges/total.json) | Visits Total |

`HEAD` разрешён и никогда не увеличивает счётчики. Остальные методы на существующих URL возвращают `405` с `Allow: GET, HEAD`, неизвестные пути — `404`. Ошибка D1 возвращает `503` и `Retry-After: 60`, без внутренних деталей ошибки. GET `/` возвращает описание сервиса без обращения к базе.

## Устройство

- [src/index.ts](src/index.ts) — маршруты, HTTP-заголовки, JSON Shields.io и изображение.
- [src/counters.ts](src/counters.ts) — UTC-периоды и запросы D1.
- [migrations/0001_counters.sql](migrations/0001_counters.sql) — таблица `visit_counts`.
- [cloudflare.config.ts](cloudflare.config.ts) — имя Worker, D1 binding `DB` и настройки публикации через `cf`.
- [test/counters.test.mjs](test/counters.test.mjs) — тесты с настоящим локальным D1 API Miniflare.

В D1 сохраняются только ключ дня `YYYY-MM-DD`, число обращений за него и строка `total`. Одно SQL-выражение `INSERT ... ON CONFLICT DO UPDATE` атомарно увеличивает дневную строку и общий итог. Чтения не создают строк. Поздний запрос за предыдущий день не сбрасывает новый день. История занимает одну строку в день плюс общий итог.

Today — с 00:00 UTC; Week — с понедельника 00:00 UTC; Month — с первого числа 00:00 UTC. Total — с начала работы этого проекта. Для чтения используется основной экземпляр D1; реплики отключены. Суммы периодов читают диапазон ключей по первичному ключу, максимум 31 дневную строку.

Код не читает и не сохраняет IP, User-Agent, cookies, Referer или идентификаторы посетителей. Workers Logs/Traces отключены, приложение ничего не логирует. Это относится к приложению; собственную обработку сетевых данных провайдерами Cloudflare, GitHub и Shields.io приложение не контролирует. Account ID и D1 UUID в конфигурации — идентификаторы ресурсов, а не секреты.

## Плашки и кеширование

Профиль использует официальный [Shields Endpoint Badge](https://shields.io/badges/endpoint-badge): `https://img.shields.io/endpoint?url=<URL-кодированный JSON URL>`. Формат ответа: `schemaVersion: 1`, `label`, строка `message`, `color`; дополнительно единые `labelColor` и `style`.

Тёмные цвета: `161b22` для подписи, `30363d` для значения, стиль `flat`. `URLSearchParams` в [scripts/verify-live.mjs](scripts/verify-live.mjs) показывает корректное кодирование адресов.

Worker отдаёт `Cache-Control: no-store, no-cache, max-age=0, must-revalidate`, запрет кеширования CDN и не использует ETag/304. Это не гарантирует обращение к Worker при каждом просмотре профиля: GitHub Camo и браузер могут кешировать изображение. Shields.io отдельно кеширует плашки; указан `cacheSeconds=300`, но сервис применяет собственный минимум. Обновление может запаздывать, включая переход дня/недели/месяца. Порядок загрузки пикселя и плашек не гарантирован.

Это **число GET-запросов к изображению, достигших Worker**, не точные и не уникальные посещения GitHub. Боты, собственные проверки, повторные загрузки и прямые запросы учитываются; кешированные просмотры могут не учитываться. Публичный endpoint допускает накрутку. Тестовые обращения остаются в общем итоге.

## Проверка и обновление

Нужен Node.js `^22.23.0`, `^24.22.0` или `^26.12.0` (требование зафиксированного `cf` 1.0 RC).

```sh
cd profile-visits
npm ci
npm test
npm run typecheck
npm run build
npx cf auth login
npm run deploy
```

База и таблица уже созданы. Обычный `deploy` не сбрасывает данные и не меняет SQL-схему. При переносе в другой аккаунт нужно создать свою D1-базу, применить SQL из `migrations/0001_counters.sql` и заменить идентификаторы в конфигурации. Токены держать только в авторизации CLI или переменной `CLOUDFLARE_API_TOKEN`, вне Git.

```sh
npm run verify:live
```

Эта проверка **добавляет 12 обращений**: проверяет конкурентные запросы, неизменность счётчиков при GET/HEAD статистики и запросах Shields.io, HTTP-методы, SVG и действительные значения в четырёх плашках. Для Shields проверка добавляет к JSON URL одноразовый параметр `verify`, который не меняет статистику, но исключает старую плашку из кеша сервиса. Для точной проверки дельты запускайте её вне смены суток UTC, без одновременного внешнего трафика.

Первичная проверка 23.11.2026: 9/9 автоматизированных тестов, включая 50 конкурентных локальных инкрементов и откат SQL при ошибке; TypeScript и сборка прошли. В опубликованный Worker отправлены 12 конкурентных GET изображения: все четыре значения выросли с 0 до 12. Чтения JSON, HEAD и запросы Shields.io итог не изменили; четыре SVG Shields.io содержали значение 12. После повторного развёртывания итог сохранился равным 12.

## Бесплатные лимиты

При настройке платных подписок нет; тариф и биллинг не менялись. [Workers Free](https://developers.cloudflare.com/workers/platform/pricing/) включает 100 000 запросов в сутки; [D1 Free](https://developers.cloudflare.com/d1/platform/pricing/) — 5 млн прочитанных и 100 000 записанных строк в сутки, 5 ГБ на аккаунт. Один учтённый запрос изменяет две строки D1, поэтому расход записи обычно ограничивает эту схему раньше лимита Worker. Лимиты общие с другими проектами аккаунта. При исчерпании бесплатных квот возможны ошибки, а соответствующие обращения не попадут в статистику. Автоматический переход на платный тариф не настроен.

Документация проверена 23 ноября 2026 года: [cf](https://developers.cloudflare.com/cf/get-started/first-worker/), [D1 API](https://developers.cloudflare.com/d1/worker-api/d1-database/), [Endpoint Badge](https://shields.io/badges/endpoint-badge).
