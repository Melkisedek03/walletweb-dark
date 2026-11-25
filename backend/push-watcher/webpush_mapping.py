#!/usr/bin/env python3
"""Web-wallet push subscription microservice.

Stores the browser push subscriptions created by the Nusacoin web
wallet's opt-in Notifications toggle, and serves the aggregated map to
webwallet_watcher.py.

A subscription is one row per push endpoint: the endpoint URL plus the
Web Push keys (p256dh, auth) and the wallet addresses it watches
(bech32 + legacy, at most two). The watcher reads the map, subscribes
the addresses on electrs, and sends a standard Web Push message
(pywebpush) when a new transaction pays one of them.

Endpoints (bind localhost only; all routes are prefix-less — in
production the public /api/webpush/ prefix is stripped by the nginx
proxy_pass before requests reach this service):
  POST /subscribe    upsert {endpoint, keys: {p256dh, auth}, addresses}
  POST /unsubscribe  delete one subscription by {endpoint}
  GET  /internal/webpush_subscriptions   {"<endpoint>": {"addresses": ["<address>", ...], "keys": {"p256dh": "...", "auth": "..."}}} (watcher)
  POST /internal/webpush/delete  delete one subscription by {endpoint} (stale cleanup)
  GET  /health                   {"ok": true, "subscriptions": N}

Bodies are JSON. The wallet (dompet.nusacoin.org) calls this service
cross-origin, so responses carry a single-origin CORS header
(https://dompet.nusacoin.org, never "*") and preflight OPTIONS is
answered.

Python stdlib only: no dependencies to install.

Adapted from the field-proven PUNDI mapping service
(pundi_mapping.py): same SQLite shape, same response envelope
({success, message, error}), same localhost-only binding. The
differences are the keyed-by-endpoint store (a browser push endpoint
replaces the FCM token), the Web Push keys, the two-address cap, and
CORS for the cross-origin web wallet.
"""

import json
import logging
import os
import sqlite3
import threading
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

LOG = logging.getLogger("webwallet-push")

BIND_HOST = os.environ.get("BIND_HOST", "127.0.0.1")
BIND_PORT = int(os.environ.get("BIND_PORT", "8085"))
DB_PATH = os.environ.get("DB_PATH", "subscriptions.db")

# The only origin allowed to call this service from a browser: the
# web wallet. Never "*", since subscriptions are per-device data.
ALLOWED_ORIGIN = os.environ.get(
    "ALLOWED_ORIGIN", "https://dompet.nusacoin.org")

MAX_ENDPOINT_LEN = 2048
MAX_KEY_LEN = 256
MAX_ADDRESSES = 2

_db_lock = threading.Lock()
_db = None


def db():
    global _db
    if _db is None:
        _db = sqlite3.connect(DB_PATH, check_same_thread=False)
        _db.execute(
            "CREATE TABLE IF NOT EXISTS subscriptions ("
            " endpoint TEXT PRIMARY KEY,"
            " p256dh TEXT NOT NULL DEFAULT '',"
            " auth TEXT NOT NULL DEFAULT '',"
            " addresses TEXT NOT NULL DEFAULT '',"
            " updated_at INTEGER NOT NULL)"
        )
        _db.commit()
    return _db


def _split_addresses(raw):
    """Accept a comma-separated string or a list; return clean list."""
    if raw is None:
        return []
    if isinstance(raw, (list, tuple)):
        items = [str(x).strip() for x in raw]
    else:
        items = [x.strip() for x in str(raw).split(",")]
    return [a for a in items if a][:MAX_ADDRESSES]


def upsert_subscription(endpoint, p256dh, auth, addresses):
    """Insert or replace a subscription. Empty addresses => delete."""
    addrs = _split_addresses(addresses)
    with _db_lock:
        if not addrs:
            db().execute("DELETE FROM subscriptions WHERE endpoint = ?",
                         (endpoint,))
        else:
            db().execute(
                "INSERT INTO subscriptions (endpoint, p256dh, auth,"
                " addresses, updated_at) VALUES (?, ?, ?, ?, ?)"
                " ON CONFLICT(endpoint) DO UPDATE SET"
                " p256dh = excluded.p256dh,"
                " auth = excluded.auth,"
                " addresses = excluded.addresses,"
                " updated_at = excluded.updated_at",
                (endpoint, p256dh or "", auth or "", ",".join(addrs),
                 int(time.time())),
            )
        db().commit()
    return addrs


def delete_subscription(endpoint):
    with _db_lock:
        db().execute("DELETE FROM subscriptions WHERE endpoint = ?",
                     (endpoint,))
        db().commit()


def all_subscriptions():
    """Return {endpoint: {"addresses": [...], "keys": {...}}} for rows
    with addresses. The keys are included so the watcher can send
    standard Web Push messages; this route is localhost-only."""
    with _db_lock:
        rows = db().execute(
            "SELECT endpoint, p256dh, auth, addresses FROM subscriptions"
        ).fetchall()
    out = {}
    for endpoint, p256dh, auth, addrs in rows:
        lst = _split_addresses(addrs)
        if lst:
            out[endpoint] = {"addresses": lst,
                             "keys": {"p256dh": p256dh, "auth": auth}}
    return out


def subscription_count():
    with _db_lock:
        row = db().execute("SELECT COUNT(*) FROM subscriptions").fetchone()
    return row[0] if row else 0


class Handler(BaseHTTPRequestHandler):
    server_version = "webwallet-push/1.0"

    def log_message(self, fmt, *args):  # route through logging
        LOG.info("%s %s", self.address_string(), fmt % args)

    def _send_json(self, obj, status=200):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", ALLOWED_ORIGIN)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_json_body(self):
        """Parse a JSON request body into a dict; {} on any failure."""
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        raw = self.rfile.read(length) if length > 0 else b""
        try:
            data = json.loads(raw.decode("utf-8") or "{}")
            return data if isinstance(data, dict) else {}
        except (ValueError, UnicodeDecodeError):
            return {}

    def _ok(self, message):
        self._send_json({"success": True, "message": message, "error": ""})

    def _fail(self, error, status=400):
        self._send_json({"success": False, "message": "", "error": error},
                        status=status)

    def do_OPTIONS(self):
        # Preflight for the cross-origin wallet: allow the subscribe /
        # unsubscribe POSTs from the single allowed origin only.
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", ALLOWED_ORIGIN)
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        path = urllib.parse.urlsplit(self.path).path.rstrip("/") or "/"
        if path == "/internal/webpush_subscriptions":
            self._send_json(all_subscriptions())
        elif path == "/health":
            self._send_json({"ok": True,
                             "subscriptions": subscription_count()})
        else:
            self._send_json({"success": False, "message": "",
                             "error": "not found"}, status=404)

    def _read_endpoint(self, fields):
        return str(fields.get("endpoint") or "").strip()

    def do_POST(self):
        path = urllib.parse.urlsplit(self.path).path.rstrip("/") or "/"
        if path == "/subscribe":
            fields = self._read_json_body()
            endpoint = self._read_endpoint(fields)
            if not endpoint.startswith("https://"):
                self._fail("endpoint must be an https:// URL")
                return
            if len(endpoint) > MAX_ENDPOINT_LEN:
                self._fail("endpoint too long")
                return
            keys = fields.get("keys") or {}
            p256dh = str(keys.get("p256dh") or "").strip()
            auth = str(keys.get("auth") or "").strip()
            if not p256dh or not auth:
                self._fail("keys.p256dh and keys.auth are required")
                return
            if len(p256dh) > MAX_KEY_LEN or len(auth) > MAX_KEY_LEN:
                self._fail("keys too long")
                return
            addrs = upsert_subscription(endpoint, p256dh, auth,
                                        fields.get("addresses"))
            LOG.info("subscribe endpoint=%.20s... addrs=%d",
                     endpoint, len(addrs))
            self._ok("subscription saved (%d addresses)" % len(addrs))
        elif path == "/unsubscribe":
            fields = self._read_json_body()
            endpoint = self._read_endpoint(fields)
            if not endpoint:
                self._fail("endpoint is required")
                return
            delete_subscription(endpoint)
            LOG.info("unsubscribe endpoint=%.20s...", endpoint)
            self._ok("subscription deleted")
        elif path == "/internal/webpush/delete":
            fields = self._read_json_body()
            endpoint = self._read_endpoint(fields)
            if not endpoint:
                self._fail("endpoint is required")
                return
            delete_subscription(endpoint)
            LOG.info("stale delete endpoint=%.20s...", endpoint)
            self._ok("subscription deleted")
        else:
            self._send_json({"success": False, "message": "",
                             "error": "not found"}, status=404)


def main():
    logging.basicConfig(level=logging.INFO,
                        format="%(asctime)s %(levelname)-7s %(message)s",
                        datefmt="%Y-%m-%d %H:%M:%S")
    db()  # ensure schema exists before serving
    server = ThreadingHTTPServer((BIND_HOST, BIND_PORT), Handler)
    LOG.info("listening on %s:%d db=%s", BIND_HOST, BIND_PORT, DB_PATH)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
