# Web-wallet push backend

Two small Python services (stdlib + `firebase-admin`) that power the
web wallet's opt-in push notifications, running on the same VPS as the
PUNDI watcher (vps3278893). They are siblings of the field-proven
PUNDI services: `webpush_mapping.py` mirrors `pundi_mapping.py` and
`webwallet_watcher.py` mirrors `pundi_watcher.py`, with the web-push
differences called out in each file's header.

```
electrs (TCP 50009) --subscribe--> webwallet-watcher --Firebase Admin--> FCM --> browser
                                          ^
                    {endpoint: [addresses]} |
                      from webpush_mapping (POST /api/webpush/subscribe)
```

The wallet subscribes with both of its addresses (bech32 + legacy).
When a new transaction pays either address, the watcher sends an FCM
Web Push message ("Incoming NUX" / "<amount> NUX received"). The
user's own sends never notify: the watcher checks each new
transaction's inputs against the watched address first.

## Files

| File | Role |
| --- | --- |
| `webpush_mapping.py` | Subscription service: SQLite store, `POST /api/webpush/subscribe`, `POST /api/webpush/unsubscribe`, `GET /internal/webpush_subscriptions`, `POST /internal/webpush/delete`, `GET /health`. Binds `127.0.0.1:8085` by default. |
| `webwallet_watcher.py` | Electrum subscribe watcher + FCM Web Push sender. |
| `webwallet-push.service` | systemd unit for the subscription service. |
| `webwallet-watcher.service` | systemd unit for the watcher. |

## Deploy (vps3278893) — backend first, frontend second

The frontend toggle subscribes against this backend, so the backend
must be live before the frontend PR merges. Deploy order is part of
the change; do not merge the frontend first.

### 0. Confirm the port picture first

The proposed port 8085 was chosen because the live nginx routes the
PUNDI mapping service to :8083 and the rental backend to :8084, but
the `ss` output used for that check did not show 8083/8084 either,
so the port picture is incomplete. Before starting anything, run a
full listing and confirm 8085 is free — and resolve the discrepancy
that the PUNDI mapping copy defaults to `BIND_PORT 8081` while live
nginx routes `/api/fcm_mapping` to :8083, so the new service cannot
collide with it:

```bash
ss -tlnp
```

If 8085 is taken, pick another free port and change `BIND_PORT` in
`webwallet-push.service` and the `MAPPING_URL` / `DELETE_URL` in
`webwallet-watcher.service` (and the nginx location below) to match.

### 1. Copy the files

```bash
sudo mkdir -p /opt/webwallet-push /opt/webwallet-watcher
sudo cp webpush_mapping.py /opt/webwallet-push/
sudo cp webwallet_watcher.py /opt/webwallet-watcher/
```

### 2. Install the Firebase Admin SDK

```bash
pip install firebase-admin
```

### 3. Service-account key (separate copy, never in the repo)

Place a service-account JSON for the same Firebase project the
PUNDI watcher uses, as its own copy (rotating one must not break
the other):

```bash
# place the file directly on the VPS, e.g. by pasting it into the editor
sudo chmod 600 /opt/webwallet-watcher/firebase-service-account.json
```

### 4. Dedicated low-privilege user

```bash
sudo useradd -r -s /usr/sbin/nologin -d /opt/webwallet-push webpush
sudo chown -R webpush:webpush /opt/webwallet-push /opt/webwallet-watcher
```

### 5. nginx route (apitest block)

On the apitest server block, alongside the existing
`/api/fcm_mapping` location:

```nginx
location /api/webpush/ {
    proxy_pass http://127.0.0.1:8085/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
}
```

Then `nginx -t` and reload. The trailing slash strips the
`/api/webpush/` prefix, so the service sees `/subscribe`,
`/unsubscribe`, and `/health` directly.

### 6. Start the services

```bash
sudo cp webwallet-push.service webwallet-watcher.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now webwallet-push webwallet-watcher
journalctl -u webwallet-push -f
journalctl -u webwallet-watcher -f
```

### 7. Verify

```bash
curl http://127.0.0.1:8085/health
# {"ok": true, "subscriptions": 0}

curl https://apitest.taobot.org/api/webpush/health
# {"ok": true, "subscriptions": 0}
```

Then subscribe from the wallet (after the frontend is live) and
check the count rises; send a small incoming transaction with the
browser closed and confirm the notification arrives exactly once.

## Separate note: manifest MIME fix (dompet host VPS, not this one)

The frontend PR also needs one nginx line on the dompet host VPS so
the manifest is served as `application/manifest+json` (today it is
`application/octet-stream`): in the `location = /manifest.webmanifest`
block, add `default_type application/manifest+json;` and reload. That
change belongs to the dompet host, not to vps3278893.

## Configuration (environment variables)

### webpush_mapping.py

| Variable | Default | Description |
| --- | --- | --- |
| `BIND_HOST` / `BIND_PORT` | `127.0.0.1` / `8085` | Local bind; never expose directly. |
| `DB_PATH` | `subscriptions.db` | SQLite file (one row per push endpoint). |
| `ALLOWED_ORIGIN` | `https://dompet.nusacoin.org` | The only browser origin allowed (CORS). |

### webwallet_watcher.py

| Variable | Default | Description |
| --- | --- | --- |
| `GOOGLE_APPLICATION_CREDENTIALS` | (required) | Service-account JSON path. Never commit this file. |
| `ELECTRS_HOST` / `ELECTRS_PORT` | `127.0.0.1` / `50009` | electrs Electrum protocol endpoint. |
| `MAPPING_URL` | `http://127.0.0.1:8085/internal/webpush_subscriptions` | Endpoint map from the subscription service. |
| `DELETE_URL` | `http://127.0.0.1:8085/internal/webpush/delete` | Stale-endpoint cleanup hook. |
| `MAPPING_FILE` | (unset) | If set, read the mapping from a JSON file instead (handy for testing). |
| `MAPPING_REFRESH_S` | `300` | How often to reload the mapping. |
| `PING_INTERVAL_S` | `120` | Electrum keepalive interval. |

## Notes

- A failed FCM send for a transient reason is lost, not retried:
  the txid stays in the watcher's `seen` set, so it will not
  re-notify forever. The in-app notice still shows the arrival when
  the wallet is next opened.
- Dead endpoints (`UnregisteredError`, `SenderIdMismatchError`) are
  deleted from the subscription store automatically via
  `/internal/webpush/delete`.
- The subscription service keeps no logs of amounts or txids; the
  watcher's logs keep only truncated txids, as the PUNDI watcher does.
