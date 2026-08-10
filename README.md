# 📈 Apex Journal — Live MT5 Trading Journal

A live trading journal website for your **real MT5 account** — PnL calendar, cumulative equity chart, full trade history (your actual MT5 deals), live open positions, live prices, and an AI trading coach.

The **MT5 terminal app can stay closed** — the bridge launches it in the background. Log into MT5 on your phone anytime: when the broker kicks the bridge's session, it **reconnects automatically** within ~15 seconds and the journal heals itself.

## Requirements

- **MT5 installed** on this machine (you have it)
- **Node.js** (v22+) and **Python** (3.10+)

## Setup (first time)

```bash
npm install
python -m pip install MetaTrader5 flask
```

## Run

**Easy:** double-click `start.bat`
**Manual:**
```bash
python mt5_bridge.py     # terminal 1 — talks to MT5
npm run dev              # terminal 2 — website on http://localhost:3000
```

Open **http://localhost:3000**. Stop with `Ctrl+C` in both windows.

## Login — your real MT5 credentials

| Field    | Example          |
|----------|------------------|
| Server   | `Bybit-Live-7`   |
| Login ID | `558577341`      |
| Password | MT5 password (investor/read-only works and is safest) |

- Verified **by MT5 itself** — wrong credentials are rejected exactly like the MT5 app.
- After first login the bridge remembers the account (in `mt5_creds.json`, local only) and auto-reconnects whenever the session drops (e.g. after you log in on your phone).
- History = your **real deals**, paired in/out like the MT5 History tab: ticket, symbol, side, volume, open/close price, hold time, PnL incl. commission & swap.
- Balance / equity / floating PnL / positions / real bid-ask stream live every 2s — no reloads.

## Features

- **Overview** — cumulative PnL chart, daily PnL calendar (green/red days, month totals), live positions with floating profit, market watch, scrolling price ticker, 3D animated background
- **Trade History** — real MT5 history; sortable columns, filters (symbol / side / result / period)
- **AI Coach** — reviews your real journal (win rate, profit factor, RR mistakes, weak symbols, worst days, action plan). Built-in heuristic analysis works with no key; add an Anthropic `sk-ant-…` key via **⚙ AI Key** for full AI coaching (stored locally in `journal.db`).

## Files

- `server/index.js` — web server (website + WebSocket + proxies bridge)
- `mt5_bridge.py` — MT5 connector (auto-launch, auto-reconnect)
- `public/` — frontend (3D background, glass UI)
- `journal.db` — sessions + AI key only (no trading data stored)
- `mt5_creds.json` — stored MT5 login for auto-reconnect (local only; delete to forget)
