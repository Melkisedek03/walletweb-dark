#!/usr/bin/env python3
"""webwallet-watcher: incoming-transaction watcher for the Nusacoin web wallet.

Watches NUX addresses over the Electrum protocol
(`blockchain.scripthash.subscribe`) against the Nusacoin electrs, and sends
a standard Web Push message (pywebpush) whenever a new transaction
pays a watched address (including unconfirmed/mempool transactions).

Address -> endpoint mapping source: the subscription service that stores
the `POST /api/webpush/subscribe` payloads from the web wallet's opt-in
Notifications toggle (see webpush_mapping.py). Expected shape:

    {"<push endpoint>": {"addresses": ["<address>", ...],
                         "keys": {"p256dh": "...", "auth": "..."}}, ...}

The legacy list shape {"<endpoint>": ["<address>", ...]} is still
accepted (keys unknown: those endpoints are skipped at send time).

For local testing without the service, point MAPPING_FILE at a JSON file
with the same shape instead.

Two differences from the PUNDI watcher this reuses (pundi_watcher.py),
both required by the web wallet:
  1. Own sends must NOT notify. A transaction that spends from the
     watched address (the user's own send, including its change output)
     is detected server-side and skipped: every input's parent
     transaction is fetched and checked for an output paying the
     watched scripthash.
  2. Sends use the standard Web Push protocol (pywebpush), not
     firebase-admin: the raw subscription endpoint URL is NOT an FCM
     registration token, so firebase-admin could never address it.
     The encrypted payload is one JSON object,
     {"notification": {"title", "body"}, "data": {...}}, exactly what
     the wallet's service worker parses (see frontend/sw-template.js).
     A data-only payload displays nothing in a browser, so the
     notification field is not optional.

Secrets are NEVER committed: the VAPID private key is read from the
file named by VAPID_PRIVATE_KEY_FILE (one line: the raw base64url
private key, 43 chars, no padding — NOT a PEM file). The VAPID
subject claim comes from VAPID_SUBJECT.

Requires: pip install pywebpush   (stdlib otherwise)
"""

import hashlib
import json
import logging
import os
import queue
import socket
import threading
import time
import urllib.request

try:
    from pywebpush import WebPushException, webpush
    HAVE_PYWEBPUSH = True
except ImportError:  # pragma: no cover - allows unit-testing without it
    WebPushException = None
    webpush = None
    HAVE_PYWEBPUSH = False

# ------------------------------------------------------------------ config

ELECTRS_HOST = os.environ.get("ELECTRS_HOST", "127.0.0.1")
ELECTRS_PORT = int(os.environ.get("ELECTRS_PORT", "50009"))

# Where the {endpoint: [addresses]} mapping comes from. Exactly one of
# these is used; MAPPING_FILE wins when set (handy for testing).
MAPPING_URL = os.environ.get(
    "MAPPING_URL", "http://127.0.0.1:8085/internal/webpush_subscriptions")
MAPPING_FILE = os.environ.get("MAPPING_FILE", "")
MAPPING_REFRESH_S = int(os.environ.get("MAPPING_REFRESH_S", "300"))

# The subscription service's stale-cleanup hook: rows are deleted here
# when the push service reports the endpoint dead.
DELETE_URL = os.environ.get(
    "DELETE_URL", "http://127.0.0.1:8085/internal/webpush/delete")

# VAPID signing for standard Web Push. The private key file holds one
# line: the raw base64url private key (43 chars, no padding) — NOT a
# PEM file, so the path itself must never be passed to pywebpush (it
# would try to read it as PEM); read the string and pass that instead.
VAPID_PRIVATE_KEY_FILE = os.environ.get(
    "VAPID_PRIVATE_KEY_FILE",
    "/opt/webwallet-watcher/vapid-private-key.txt")
VAPID_SUBJECT = os.environ.get(
    "VAPID_SUBJECT", "https://dompet.nusacoin.org")

_vapid_key_cache = None


def _vapid_key():
    """Raw base64url VAPID private key string from VAPID_PRIVATE_KEY_FILE.

    Read once and cached; raises OSError / ValueError when the file is
    missing or empty, so main() can fail fast at startup.
    """
    global _vapid_key_cache
    if _vapid_key_cache is None:
        with open(VAPID_PRIVATE_KEY_FILE, encoding="utf-8") as fh:
            _vapid_key_cache = fh.read().strip()
        if not _vapid_key_cache:
            raise ValueError("empty VAPID private key file: %s"
                             % VAPID_PRIVATE_KEY_FILE)
    return _vapid_key_cache

PING_INTERVAL_S = int(os.environ.get("PING_INTERVAL_S", "120"))
RECONNECT_BACKOFF_S = (5, 10, 30, 60)

# NUX address parameters (must match the electrs --network nusacoin
# chainparams). Version bytes and HRPs are unique per network, so an
# address can only ever match one entry.
#   (name, p2pkh_version, p2sh_version, bech32_hrp)
NETWORKS = (
    ("mainnet", 0x35, 0x4B, "nu"),
    ("testnet", 111, 196, "tn"),
)

LOG = logging.getLogger("webwallet-watcher")

# ------------------------------------------------- bech32 (reference impl.)

_B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
_BECH32_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l"


def _bech32_polymod(values):
    gen = (0x3B6A57B2, 0x26508E6D, 0x1EA119FA, 0x3D4233DD, 0x2A1462B3)
    chk = 1
    for v in values:
        b = chk >> 25
        chk = (chk & 0x1FFFFFF) << 5 ^ v
        for i in range(5):
            chk ^= gen[i] if ((b >> i) & 1) else 0
    return chk


def _bech32_hrp_expand(hrp):
    return [ord(x) >> 5 for x in hrp] + [0] + [ord(x) & 31 for x in hrp]


def bech32_decode(bech):
    """Return (hrp, data, spec) or (None, None, None) on failure."""
    bech = bech.lower()
    pos = bech.rfind("1")
    if pos < 1 or pos + 7 > len(bech) or len(bech) > 90:
        return None, None, None
    hrp = bech[:pos]
    if any(ord(x) < 33 or ord(x) > 126 for x in bech):
        return None, None, None
    try:
        data = [_BECH32_CHARSET.index(x) for x in bech[pos + 1:]]
    except ValueError:
        return None, None, None
    chk = _bech32_polymod(_bech32_hrp_expand(hrp) + data)
    if chk == 1:
        spec = "bech32"
    elif chk == 0x2BC830A3:
        spec = "bech32m"
    else:
        return None, None, None
    return hrp, data[:-6], spec


def _convertbits(data, frombits, tobits, pad=True):
    acc, bits, ret = 0, 0, []
    maxv = (1 << tobits) - 1
    for value in data:
        if value < 0 or (value >> frombits):
            return None
        acc = (acc << frombits) | value
        bits += frombits
        while bits >= tobits:
            bits -= tobits
            ret.append((acc >> bits) & maxv)
    if pad:
        if bits:
            ret.append((acc << (tobits - bits)) & maxv)
    elif bits >= frombits or ((acc << (tobits - bits)) & maxv):
        return None
    return bytes(ret)


def b58check_decode(s):
    """Return (version_byte, payload) or raise ValueError."""
    n = 0
    for c in s:
        n = n * 58 + _B58.index(c)
    raw = n.to_bytes((n.bit_length() + 7) // 8 or 1, "big")
    pad = len(s) - len(s.lstrip("1"))
    raw = b"\x00" * pad + raw
    if len(raw) < 5:
        raise ValueError("too short")
    payload, chk = raw[:-4], raw[-4:]
    if hashlib.sha256(hashlib.sha256(payload).digest()).digest()[:4] != chk:
        raise ValueError("bad checksum")
    return payload[0], payload[1:]


def address_to_script(addr):
    """NUX address -> output script bytes. Raises ValueError if unknown.

    Tries every known network (mainnet + testnet); version bytes and
    bech32 HRPs are unique per network so there is no ambiguity.
    """
    # base58 P2PKH / P2SH first
    try:
        ver, h160 = b58check_decode(addr)
        if len(h160) == 20:
            for _name, p2pkh_ver, p2sh_ver, _hrp in NETWORKS:
                if ver == p2pkh_ver:
                    return b"\x76\xa9\x14" + h160 + b"\x88\xac"
                if ver == p2sh_ver:
                    return b"\xa9\x14" + h160 + b"\x87"
    except ValueError:
        pass
    # bech32 / bech32m segwit
    hrp, data, spec = bech32_decode(addr)
    if hrp and data and spec:
        for _name, _p2pkh_ver, _p2sh_ver, bech32_hrp in NETWORKS:
            if hrp != bech32_hrp:
                continue
            witver = data[0]
            prog = _convertbits(data[1:], 5, 8, False)
            if prog is None or not (2 <= len(prog) <= 40):
                raise ValueError("bad witness program")
            if witver == 0 and spec != "bech32":
                raise ValueError("v0 must be bech32")
            if witver != 0 and spec != "bech32m":
                raise ValueError("v1+ must be bech32m")
            return bytes([0x00 if witver == 0 else 0x50 + witver,
                          len(prog)]) + prog
    raise ValueError("unknown address format: %r" % (addr,))


def scripthash_of(addr):
    """Electrum scripthash hex for a NUX address."""
    return hashlib.sha256(address_to_script(addr)).digest()[::-1].hex()


# ------------------------------------------------------- electrum client

class ElectrumClient:
    """Minimal Electrum-protocol TCP client with a reader thread.

    Notifications (messages carrying 'method') go to .notifications;
    request/response pairs are matched by id.
    """

    def __init__(self, host, port):
        self.host, self.port = host, port
        self._id = 0
        self._lock = threading.Lock()
        self._pending = {}
        self._cond = threading.Condition()
        self.notifications = queue.Queue()
        self._stop = threading.Event()
        self.sock = None

    @property
    def dead(self):
        return self._stop.is_set()

    def connect(self):
        self.sock = socket.create_connection((self.host, self.port),
                                             timeout=15)
        # The connect timeout must not leak into reads: an idle electrs
        # sends nothing for minutes, and readline() would otherwise raise
        # socket.timeout every 15s and trigger a needless reconnect.
        self.sock.settimeout(None)
        self._rfile = self.sock.makefile("r")
        self._stop.clear()
        self._reader = threading.Thread(target=self._read_loop, daemon=True)
        self._reader.start()
        LOG.info("connected to electrs %s:%d", self.host, self.port)

    def _read_loop(self):
        try:
            while not self._stop.is_set():
                line = self._rfile.readline()
                if not line:
                    break
                try:
                    msg = json.loads(line)
                except ValueError:
                    continue
                if "method" in msg:
                    self.notifications.put(msg)
                elif "id" in msg:
                    with self._cond:
                        self._pending[msg["id"]] = msg
                        self._cond.notify_all()
        except Exception as exc:  # noqa: BLE001
            LOG.warning("reader error: %s", exc)
        finally:
            self._stop.set()
            LOG.warning("electrs connection lost")

    def request(self, method, params=None, timeout=30):
        with self._lock:
            self._id += 1
            rid = self._id
        payload = json.dumps({"jsonrpc": "2.0", "id": rid,
                              "method": method, "params": params or []})
        try:
            self.sock.sendall((payload + "\n").encode())
        except OSError as exc:
            self._stop.set()
            raise ConnectionError("send failed: %s" % exc)
        deadline = time.time() + timeout
        with self._cond:
            while rid not in self._pending:
                if self._stop.is_set():
                    raise ConnectionError("disconnected")
                wait = deadline - time.time()
                if wait <= 0:
                    raise TimeoutError("request timed out: %s" % method)
                self._cond.wait(wait)
            msg = self._pending.pop(rid)
        if msg.get("error"):
            raise RuntimeError("electrs error: %s" % (msg["error"],))
        return msg.get("result")

    def close(self):
        self._stop.set()
        try:
            if self.sock:
                self.sock.close()
        except OSError:
            pass


# ---------------------------------------------------------------- watcher

def load_mapping():
    """Return {endpoint: {"addresses": [...], "keys": {...} | None}}.

    Accepts the current shape (object with addresses + keys) and the
    legacy list shape {"<endpoint>": ["<address>", ...]} (keys None:
    those endpoints cannot receive pushes and are skipped at send
    time). A keys object missing p256dh or auth is treated as None.
    """
    if MAPPING_FILE:
        with open(MAPPING_FILE, encoding="utf-8") as fh:
            data = json.load(fh)
    else:
        req = urllib.request.Request(
            MAPPING_URL, headers={"User-Agent": "webwallet-watcher/1.0"})
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.load(resp)
    if not isinstance(data, dict):
        raise ValueError("mapping must be a JSON object")
    out = {}
    for endpoint, value in data.items():
        endpoint = str(endpoint)
        if isinstance(value, dict):
            addrs = [str(a) for a in value.get("addresses") or []]
            keys = value.get("keys") or None
            if keys is not None:
                keys = {"p256dh": str(keys.get("p256dh") or ""),
                        "auth": str(keys.get("auth") or "")}
                if not keys["p256dh"] or not keys["auth"]:
                    keys = None
        else:
            # Legacy list shape: addresses only, no keys.
            addrs = [str(a) for a in value]
            keys = None
        if addrs:
            out[endpoint] = {"addresses": addrs, "keys": keys}
    return out


def _short_addr(address):
    return address[:10] + "..." if len(address) > 14 else address


NUSAN_PER_NUX = 100_000_000


def _fmt_nux(nusan):
    """Integer nusan -> shortest NUX string, e.g. 150000000 -> '1.5'."""
    whole, frac = divmod(nusan, NUSAN_PER_NUX)
    return ("%d.%08d" % (whole, frac)).rstrip("0").rstrip(".")


def _read_varint(buf, pos):
    b = buf[pos]
    if b < 0xfd:
        return b, pos + 1
    if b == 0xfd:
        return int.from_bytes(buf[pos + 1:pos + 3], "little"), pos + 3
    if b == 0xfe:
        return int.from_bytes(buf[pos + 1:pos + 5], "little"), pos + 5
    return int.from_bytes(buf[pos + 1:pos + 9], "little"), pos + 9


def parse_tx(buf):
    """Parse a raw transaction.

    Returns (prevouts, outputs) where prevouts is a list of
    (prev_txid_display_hex, vout) and outputs is a list of
    (value_nusan, script_bytes). Handles both legacy and segwit
    serialization (outputs precede the witness data).

    Raises IndexError / ValueError on malformed input.
    """
    pos = 4  # version
    if buf[pos] == 0x00 and buf[pos + 1] == 0x01:  # segwit marker/flag
        pos += 2
    n_in, pos = _read_varint(buf, pos)
    prevouts = []
    for _ in range(n_in):
        # Prev txid is stored in internal byte order; the display txid
        # is the byte-reversed hex.
        prev_txid = buf[pos:pos + 32][::-1].hex()
        vout = int.from_bytes(buf[pos + 32:pos + 36], "little")
        pos += 36
        slen, pos = _read_varint(buf, pos)
        pos += slen + 4  # scriptSig + sequence
        prevouts.append((prev_txid, vout))
    n_out, pos = _read_varint(buf, pos)
    outputs = []
    for _ in range(n_out):
        value = int.from_bytes(buf[pos:pos + 8], "little")
        pos += 8
        slen, pos = _read_varint(buf, pos)
        script = buf[pos:pos + slen]
        pos += slen
        outputs.append((value, script))
    return prevouts, outputs


def _fetch_raw_tx(client, txid):
    """Raw transaction bytes for a txid, or None on failure."""
    try:
        raw = client.request("blockchain.transaction.get", [txid], timeout=30)
        return bytes.fromhex(raw)
    except Exception as exc:  # noqa: BLE001
        LOG.warning("transaction.get failed for %.12s...: %s", txid, exc)
        return None


def get_tx_amount_nusan(client, txid, scripthash):
    """Sum tx outputs paying scripthash, in integer nusan. None on failure.

    electrs does not support verbose blockchain.transaction.get, so the
    raw tx hex is fetched and parsed locally. Output values in the raw
    format are native integer nusan, so no float/decimal conversion is
    needed.
    """
    buf = _fetch_raw_tx(client, txid)
    if buf is None:
        return None
    try:
        _prevouts, outputs = parse_tx(buf)
    except (IndexError, ValueError) as exc:
        LOG.warning("tx parse failed for %.12s...: %s", txid, exc)
        return None
    total = 0
    for value, script in outputs:
        if hashlib.sha256(script).digest()[::-1].hex() == scripthash:
            total += value
    return total


def tx_spends_from(client, txid, scripthash, parent_cache):
    """True if any input of txid spends an output of scripthash.

    For each input, the parent transaction is fetched (cached per call
    in parent_cache) and its outputs are checked against the watched
    scripthash. Coinbase inputs (all-zero prev txid) cannot spend from
    the address and are skipped. A parent that cannot be fetched is
    logged and treated as not spending from the address, so a fetch
    failure can at worst cause a spurious notification, never a missed
    incoming one.
    """
    buf = _fetch_raw_tx(client, txid)
    if buf is None:
        return False
    try:
        prevouts, _outputs = parse_tx(buf)
    except (IndexError, ValueError) as exc:
        LOG.warning("tx parse failed for %.12s...: %s", txid, exc)
        return False
    for prev_txid, vout in prevouts:
        if prev_txid == "00" * 32:
            continue  # coinbase input: no parent to check
        if prev_txid not in parent_cache:
            parent_cache[prev_txid] = _fetch_raw_tx(client, prev_txid)
        parent = parent_cache[prev_txid]
        if parent is None:
            continue
        try:
            _p_prev, p_outputs = parse_tx(parent)
        except (IndexError, ValueError):
            continue
        if vout < len(p_outputs):
            _value, script = p_outputs[vout]
            if hashlib.sha256(script).digest()[::-1].hex() == scripthash:
                return True
    return False


def delete_endpoint(endpoint):
    """Ask the subscription service to drop a dead endpoint. Best-effort."""
    try:
        body = json.dumps({"endpoint": endpoint}).encode("utf-8")
        req = urllib.request.Request(
            DELETE_URL, data=body,
            headers={"Content-Type": "application/json",
                     "User-Agent": "webwallet-watcher/1.0"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            resp.read()
        LOG.info("deleted dead endpoint %.20s...", endpoint)
    except Exception as exc:  # noqa: BLE001
        LOG.warning("stale delete failed for %.20s...: %s", endpoint, exc)


def send_push(endpoint, address, txid, amount_nusan=None, keys=None):
    """Send a standard Web Push message for an incoming tx. Never raises.

    The payload is one JSON object, {"notification": {...}, "data": ...},
    exactly what the wallet's service worker parses: the notification
    title/body are what the user sees; the txid and amount travel in
    `data` for the service worker. A data-only payload displays nothing
    in a browser, so the notification field is not optional.
    """
    if not HAVE_PYWEBPUSH:
        LOG.warning("pywebpush not installed, would push %s -> %.12s...",
                    address, txid)
        return
    if not keys:
        LOG.warning("no Web Push keys for endpoint %.20s..., skipping %.12s...",
                    endpoint, txid)
        return
    if amount_nusan:
        body = "%s NUX received" % _fmt_nux(amount_nusan)
        data = {"type": "incoming_tx",
                "txid": txid,
                "amount_nux": _fmt_nux(amount_nusan),
                "address": address}
    else:
        body = "Coins received"
        data = {"type": "incoming_tx",
                "txid": txid,
                "address": address}
    payload = {"notification": {"title": "Incoming NUX", "body": body},
               "data": data}
    try:
        webpush(
            subscription_info={"endpoint": endpoint, "keys": keys},
            data=json.dumps(payload),
            vapid_private_key=_vapid_key(),
            vapid_claims={"sub": VAPID_SUBJECT},
        )
        LOG.info("push sent endpoint=%.20s... addr=%s tx=%.12s...",
                 endpoint, address, txid)
    except Exception as exc:  # noqa: BLE001
        status = getattr(exc, "status_code", None)
        if status in (404, 410):
            # The browser uninstalled the app or the subscription
            # expired: drop the row so it is never retried.
            LOG.warning("dead endpoint %.20s... (HTTP %s); deleting it",
                        endpoint, status)
            delete_endpoint(endpoint)
        else:
            LOG.warning("push failed for %.20s...: %s: %s",
                        endpoint, type(exc).__name__, exc)


def sync_history(client, scripthash, state, notify):
    """Fetch history, detect new txids, optionally push. Never raises."""
    try:
        hist = client.request("blockchain.scripthash.get_history",
                              [scripthash]) or []
    except Exception as exc:  # noqa: BLE001
        LOG.warning("get_history failed for %.12s...: %s", scripthash, exc)
        return
    current = {h.get("tx_hash") for h in hist if h.get("tx_hash")}
    new = current - state["seen"]
    if notify:
        parent_cache = {}
        for txid in sorted(new):
            # The user's own sends (including change) must not notify.
            if tx_spends_from(client, txid, scripthash, parent_cache):
                LOG.info("own send %.12s... skipped (spends from watched"
                         " address)", txid)
                continue
            amount = get_tx_amount_nusan(client, txid, scripthash)
            for addr in sorted(state["addrs"]):
                for endpoint in sorted(state["endpoints"]):
                    send_push(endpoint, addr, txid, amount,
                              state.get("keys", {}).get(endpoint))
    state["seen"] = current


class Watcher:
    def __init__(self):
        self.client = ElectrumClient(ELECTRS_HOST, ELECTRS_PORT)
        # scripthash -> {"addrs": set, "endpoints": set,
        #                "keys": {endpoint: {"p256dh", "auth"}},
        #                "seen": set(txids)}
        self.watch = {}

    def ensure_connected(self):
        attempt = 0
        while True:
            try:
                self.client = ElectrumClient(ELECTRS_HOST, ELECTRS_PORT)
                self.client.connect()
                # Re-subscribe everything; then catch up on missed history.
                for sh in list(self.watch):
                    self.client.request("blockchain.scripthash.subscribe",
                                        [sh])
                for sh, st in self.watch.items():
                    sync_history(self.client, sh, st, notify=True)
                return
            except Exception as exc:  # noqa: BLE001
                wait = RECONNECT_BACKOFF_S[
                    min(attempt, len(RECONNECT_BACKOFF_S) - 1)]
                LOG.warning("connect failed (%s), retry in %ds", exc, wait)
                attempt += 1
                time.sleep(wait)

    def refresh_mapping(self):
        """Reload {endpoint: {addresses, keys}}; subscribe new, drop removed."""
        try:
            mapping = load_mapping()
        except Exception as exc:  # noqa: BLE001
            LOG.warning("mapping refresh failed: %s", exc)
            return
        wanted = {}
        for endpoint, sub in mapping.items():
            for addr in sub["addresses"]:
                try:
                    sh = scripthash_of(addr)
                except ValueError as exc:
                    LOG.warning("skipping bad address %r: %s", addr, exc)
                    continue
                st = wanted.setdefault(
                    sh, {"addrs": set(), "endpoints": set(),
                         "keys": {}, "seen": set()})
                st["addrs"].add(addr)
                st["endpoints"].add(endpoint)
                if sub["keys"] is not None:
                    st["keys"][endpoint] = sub["keys"]
        # subscribe newcomers (baseline history, no push spam for old txs)
        new_shs = []
        for sh, st in wanted.items():
            if sh in self.watch:
                st["seen"] = self.watch[sh]["seen"]
            else:
                try:
                    self.client.request("blockchain.scripthash.subscribe",
                                        [sh])
                except Exception as exc:  # noqa: BLE001
                    LOG.warning("subscribe failed %.12s...: %s", sh, exc)
                    del wanted[sh]  # retry on next mapping refresh
                    continue
                sync_history(self.client, sh, st, notify=False)
                new_shs.append(sh)
                LOG.info("watching %.12s... (%d addr)", sh, len(st["addrs"]))
        # unsubscribe removed
        for sh in set(self.watch) - set(wanted):
            try:
                self.client.request("blockchain.scripthash.unsubscribe",
                                    [sh])
            except Exception:  # noqa: BLE001
                pass
            LOG.info("unwatched %.12s...", sh)
        self.watch = wanted
        # Catch-up for newcomers: anything that landed between the baseline
        # above and this assignment still gets pushed.
        for sh in new_shs:
            sync_history(self.client, sh, self.watch[sh], notify=True)

    def run(self):
        self.ensure_connected()
        self.refresh_mapping()
        last_ping = time.time()
        last_mapping = time.time()
        LOG.info("watcher running: %d scripthashes", len(self.watch))
        while True:
            try:
                msg = self.client.notifications.get(timeout=5)
            except queue.Empty:
                msg = None
            now = time.time()
            if self.client.dead:
                LOG.warning("reconnecting...")
                self.ensure_connected()
                continue
            if now - last_ping > PING_INTERVAL_S:
                try:
                    self.client.request("server.ping")
                except Exception as exc:  # noqa: BLE001
                    LOG.warning("ping failed (%s), reconnecting", exc)
                    self.ensure_connected()
                    continue
                last_ping = now
            if now - last_mapping > MAPPING_REFRESH_S:
                self.refresh_mapping()
                last_mapping = now
            if msg is None:
                continue
            if msg.get("method") == "blockchain.scripthash.subscribe":
                params = msg.get("params") or []
                if params:
                    st = self.watch.get(params[0])
                    if st is not None:
                        sync_history(self.client, params[0], st,
                                     notify=True)


def main():
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)-7s %(message)s")
    if not HAVE_PYWEBPUSH:
        LOG.warning("pywebpush not installed; pushes are logged only "
                    "(pip install pywebpush)")
    else:
        try:
            _vapid_key()
        except (OSError, ValueError) as exc:
            raise SystemExit("cannot read VAPID private key file %s: %s"
                             % (VAPID_PRIVATE_KEY_FILE, exc))
        LOG.info("VAPID key loaded from %s", VAPID_PRIVATE_KEY_FILE)
    LOG.info("electrs=%s:%d mapping=%s", ELECTRS_HOST, ELECTRS_PORT,
             MAPPING_FILE or MAPPING_URL)
    Watcher().run()


if __name__ == "__main__":
    main()
