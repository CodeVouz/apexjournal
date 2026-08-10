"""
MT5 Bridge — connects the trading journal to the local MetaTrader 5 terminal.

The MT5 terminal app can stay CLOSED: the bridge launches terminal64.exe by itself
and logs in with the stored credentials. When you log into MT5 on your phone
(broker kicks this session), the bridge detects the drop and automatically
reconnects — your journal heals itself within ~15 seconds. It's a tug-of-war
with your phone, but the journal always wins back when the phone disconnects.

Endpoints (all JSON):
  GET  /status    -> { connected, login, server, name, currency, pending }
  POST /login     {login, password, server}  -> verify + store creds, connect
  POST /logout    -> disconnect and forget
  GET  /snapshot  -> account info, live positions, prices, 180d equity curve
  GET  /history?days=N -> paired trades (MT5 History-tab style), curve, deposits
  GET  /ai-context -> compact stats for the AI coach
"""
import json
import math
import os
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import MetaTrader5 as mt5
from flask import Flask, jsonify, request

app = Flask(__name__)
lock = threading.Lock()
CREDS_FILE = Path(__file__).parent / "mt5_creds.json"

state = {"connected": False, "login": None, "server": None, "pending": False}

# locate the installed MT5 terminal (for launching when it's not running)
TERMINAL_CANDIDATES = [
    r"C:\Program Files\MetaTrader 5\terminal64.exe",
    r"C:\Program Files (x86)\MetaTrader 5\terminal64.exe",
]


def find_terminal():
    for p in TERMINAL_CANDIDATES:
        if os.path.exists(p):
            return p
    return None


# ---------------- credential persistence ----------------
def load_creds():
    try:
        return json.loads(CREDS_FILE.read_text())
    except Exception:
        return None


def save_creds(c):
    CREDS_FILE.write_text(json.dumps(c))


def clear_creds():
    try:
        CREDS_FILE.unlink()
    except Exception:
        pass


# ---------------- connection core ----------------
def connect(creds):
    """(Re)initialize the terminal IPC and authorize. Returns error string or None."""
    mt5.shutdown()
    kwargs = {"login": int(creds["login"]), "password": creds["password"], "server": creds["server"]}
    path = find_terminal()
    if path:
        kwargs["path"] = path
    if not mt5.initialize(**kwargs):
        return f"terminal init: {mt5.last_error()}"
    if not mt5.login(int(creds["login"]), password=creds["password"], server=creds["server"]):
        return f"login: {mt5.last_error()}"
    info = mt5.account_info()
    if not info or int(info.login) != int(creds["login"]):
        return "authorization failed — wrong server, login or password"
    return None


def reconnect_loop():
    """Background thread: if we have stored creds and the connection drops
    (e.g. you logged into MT5 on your phone), reconnect automatically."""
    while True:
        time.sleep(10)
        creds = load_creds()
        if not creds:
            continue
        with lock:
            try:
                info = mt5.account_info()
                if info and int(info.login) == int(creds["login"]):
                    if not state["connected"]:
                        state.update(connected=True, login=int(info.login), server=info.server, pending=False)
                        print(f"  [bridge] attached to terminal session #{info.login}", flush=True)
                    continue
            except Exception as e:
                print(f"  [bridge] account_info error: {e}", flush=True)
            # dropped (or never connected) — try to (re)connect
            if not state["pending"]:
                print("  [bridge] session lost — attempting reconnect…", flush=True)
            state.update(connected=False, pending=True)
            try:
                err = connect(creds)
                if err is None:
                    info = mt5.account_info()
                    state.update(connected=True, login=int(info.login), server=info.server, pending=False)
                    print(f"  [bridge] (re)connected #{info.login} @ {info.server}", flush=True)
                elif "Authorization failed" in err or "Invalid account" in err:
                    # stored password is wrong/stale — retrying forever is pointless
                    print(f"  [bridge] stored credentials rejected ({err}) — forgetting them. Log in again via the website.", flush=True)
                    clear_creds()
                    state.update(connected=False, pending=False)
                else:
                    print(f"  [bridge] reconnect failed: {err} — retrying in 30s", flush=True)
                    time.sleep(20)
            except Exception as e:
                print(f"  [bridge] reconnect error: {e}", flush=True)


# ---------------- helpers ----------------
def clean(obj):
    if obj is None:
        return None
    if isinstance(obj, (int, float, str, bool)):
        if isinstance(obj, float) and (math.isnan(obj) or math.isinf(obj)):
            return 0
        return obj
    # namedtuples (TradePosition/TradeDeal/AccountInfo) are tuple subclasses —
    # check _asdict BEFORE the generic tuple branch or they become lists.
    if hasattr(obj, "_asdict"):
        return clean(obj._asdict())
    if isinstance(obj, dict):
        return {k: clean(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [clean(x) for x in obj]
    return str(obj)


def require_conn():
    if not state["connected"]:
        if state["pending"]:
            return jsonify({"error": "reconnecting to MT5 — try again in a few seconds", "reconnecting": True}), 503
        return jsonify({"error": "not connected"}), 401
    return None


def position_dict(p):
    d = clean(p)
    d["side"] = "buy" if d["type"] == mt5.POSITION_TYPE_BUY else "sell"
    d["unrealized"] = round(d.get("profit", 0) + d.get("swap", 0), 2)
    d["volume"] = d.get("volume")
    d["price_open"] = d.get("price_open")
    d["price_current"] = d.get("price_current")
    return d


def symbol_prices(positions):
    """Live quotes for every symbol the broker offers (like MT5 Market Watch)."""
    out = {}
    try:
        all_syms = mt5.symbols_get() or []
    except Exception:
        all_syms = []
    open_syms = {p["symbol"] for p in positions}
    for info in all_syms:
        try:
            # make sure the symbol is subscribed so ticks flow
            if not info.visible:
                mt5.symbol_select(info.name, True)
            t = mt5.symbol_info_tick(info.name)
            if t and (t.bid or t.ask):
                out[info.name] = {"bid": t.bid, "ask": t.ask}
        except Exception:
            pass
    for s in open_syms:  # guarantee open-position symbols are priced
        if s not in out:
            try:
                mt5.symbol_select(s, True)
                t = mt5.symbol_info_tick(s)
                if t and (t.bid or t.ask):
                    out[s] = {"bid": t.bid, "ask": t.ask}
            except Exception:
                pass
    return out


def history_days(days):
    """Closed deals -> paired trades + daily pnl (mirrors MT5 History tab)."""
    now = datetime.now()
    start = now - timedelta(days=days)
    deals = [clean(d) for d in (mt5.history_deals_get(start, now) or [])]
    trades, deposits, daily = {}, [], {}
    for d in deals:
        if d["type"] in (mt5.DEAL_TYPE_BALANCE, mt5.DEAL_TYPE_CREDIT):
            if d.get("profit"):
                deposits.append({"time": d["time"], "amount": d["profit"], "comment": d.get("comment", "")})
            continue
        pos_id = d.get("position_id")
        profit = d.get("profit", 0) + d.get("commission", 0) + d.get("swap", 0)
        if d["entry"] in (mt5.DEAL_ENTRY_OUT, mt5.DEAL_ENTRY_INOUT, mt5.DEAL_ENTRY_OUT_BY) and pos_id is not None:
            t = trades.get(pos_id)
            if t:
                t["close_price"] = d["price"]
                t["close_time"] = d["time"]
                t["pnl"] = round(t.get("pnl", 0) + profit, 2)
                t["lots"] = max(t["lots"], d.get("volume") or 0)
                t["status"] = "closed"
            else:
                trades[pos_id] = {
                    "ticket": pos_id, "symbol": d["symbol"],
                    "side": "buy" if d["type"] == mt5.DEAL_TYPE_SELL else "sell",
                    "lots": d.get("volume"), "open_price": None, "close_price": d["price"],
                    "open_time": None, "close_time": d["time"], "pnl": round(profit, 2),
                    "status": "closed",
                }
            day = datetime.fromtimestamp(d["time"]).strftime("%Y-%m-%d")
            rec = daily.setdefault(day, {"pnl": 0.0, "trades": 0})
            rec["pnl"] = round(rec["pnl"] + profit, 2)
            rec["trades"] += 1
        elif d["entry"] == mt5.DEAL_ENTRY_IN and pos_id is not None:
            trades[pos_id] = {
                "ticket": pos_id, "symbol": d["symbol"],
                "side": "buy" if d["type"] == mt5.DEAL_TYPE_BUY else "sell",
                "lots": d.get("volume"), "open_price": d["price"],
                "open_time": d["time"], "close_time": None,
                "pnl": round(profit, 2), "status": "open-in-window",
            }
    closed = sorted((t for t in trades.values() if t["status"] == "closed"),
                    key=lambda t: t["close_time"] or 0, reverse=True)
    info = mt5.account_info()
    net = sum(v["pnl"] for v in daily.values())
    bal = round((info.balance if info else 0) - net, 2)
    curve = []
    for day in sorted(daily):
        bal = round(bal + daily[day]["pnl"], 2)
        curve.append({"day": day, "pnl": daily[day]["pnl"], "trades": daily[day]["trades"], "balance": bal})
    return closed, curve, deposits


# ---------------- routes ----------------
@app.post("/login")
def login():
    body = request.get_json(force=True)
    creds = {"login": int(body.get("login") or 0), "password": str(body.get("password") or ""),
             "server": str(body.get("server") or "").strip()}
    if not (creds["login"] and creds["password"] and creds["server"]):
        return jsonify({"error": "login, password and server are required"}), 400
    with lock:
        # already connected to this exact account (terminal session) -> reuse
        mt5.initialize()
        cur = mt5.account_info()
        if cur and int(cur.login) == creds["login"] and cur.server.lower() == creds["server"].lower():
            save_creds(creds)
            state.update(connected=True, login=int(cur.login), server=cur.server, pending=False)
            return jsonify({"ok": True, "account": clean(cur), "reused": True})
        err = connect(creds)
        if err:
            return jsonify({"error": f"MT5 rejected these credentials ({err}) — check server, login and password"}), 401
        save_creds(creds)
        info = mt5.account_info()
        state.update(connected=True, login=int(info.login), server=info.server, pending=False)
        return jsonify({"ok": True, "account": clean(info)})


@app.post("/logout")
def logout():
    with lock:
        clear_creds()
        state.update(connected=False, login=None, server=None, pending=False)
        mt5.shutdown()
    return jsonify({"ok": True})


@app.get("/status")
def status():
    with lock:
        out = {"connected": state["connected"], "pending": state["pending"]}
        if state["connected"]:
            info = mt5.account_info()
            if info:
                out.update(login=int(info.login), server=info.server, name=info.name, currency=info.currency)
            else:
                out["connected"] = False
        return jsonify(out)


@app.get("/snapshot")
def snapshot():
    e = require_conn()
    if e:
        return e
    with lock:
        info = mt5.account_info()
        if not info:
            state.update(connected=False)
            return jsonify({"error": "connection lost"}), 502
        positions = [position_dict(p) for p in (mt5.positions_get() or [])]
        prices = symbol_prices(positions)
        _, curve, _ = history_days(180)
        return jsonify({
            "account": {
                "login": info.login, "server": info.server, "name": info.name,
                "currency": info.currency, "balance": info.balance, "equity": info.equity,
                "margin": info.margin, "free_margin": info.margin_free,
                "margin_level": info.margin_level, "leverage": info.leverage,
                "unrealized": round(info.equity - info.balance, 2),
            },
            "positions": positions, "prices": prices, "equityCurve": curve,
        })


@app.get("/history")
def history():
    e = require_conn()
    if e:
        return e
    days = min(int(request.args.get("days", 365)), 1825)
    with lock:
        closed, curve, deposits = history_days(days)
        return jsonify({"trades": closed, "equityCurve": curve, "deposits": deposits})


@app.get("/ai-context")
def ai_context():
    e = require_conn()
    if e:
        return e
    with lock:
        closed, curve, _ = history_days(180)
        info = mt5.account_info()
    wins = [t for t in closed if t["pnl"] > 0]
    losses = [t for t in closed if t["pnl"] <= 0]
    gw = sum(t["pnl"] for t in wins)
    gl = abs(sum(t["pnl"] for t in losses))
    by_symbol = {}
    for t in closed:
        s = by_symbol.setdefault(t["symbol"], {"n": 0, "pnl": 0.0, "wins": 0})
        s["n"] += 1
        s["pnl"] = round(s["pnl"] + t["pnl"], 2)
        if t["pnl"] > 0:
            s["wins"] += 1
    holds = [(t["close_time"] - t["open_time"]) / 60 for t in closed if t.get("open_time")]
    worst = sorted((c for c in curve if c["trades"]), key=lambda c: c["pnl"])[:3]
    return jsonify({
        "balance": info.balance if info else 0, "currency": info.currency if info else "",
        "total": len(closed),
        "winRate": round(len(wins) / len(closed) * 100, 1) if closed else 0,
        "profitFactor": round(gw / gl, 2) if gl else None,
        "avgWin": round(gw / len(wins), 2) if wins else 0,
        "avgLoss": round(gl / len(losses), 2) if losses else 0,
        "avgHoldMin": round(sum(holds) / len(holds), 0) if holds else 0,
        "bySymbol": by_symbol, "worstDays": worst,
        "recent": [f"{t['side']} {t['lots']} {t['symbol']} @ {t.get('open_price')} -> {t.get('close_price')} = {t['pnl']:+.2f}"
                   for t in closed[:15]],
    })


if __name__ == "__main__":
    threading.Thread(target=reconnect_loop, daemon=True).start()
    print("MT5 bridge on http://127.0.0.1:5000 (auto-reconnect enabled)")
    app.run(host="127.0.0.1", port=5000, threaded=True)
