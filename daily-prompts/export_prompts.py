#!/usr/bin/env python3
"""Export Copilot chat prompts into a dated running log (chat-prompts.txt).

Reads the local Copilot chat session store (SQLite) and appends the user
prompts for the requested day(s) under a date header. Re-running for the
same day refreshes that day's block instead of duplicating it.
"""

import argparse
import datetime as dt
import os
import re
import sqlite3
import sys

# Default location of the Copilot chat session store on Windows.
DEFAULT_DB = os.path.join(
    os.environ.get("APPDATA", ""),
    "Code", "User", "globalStorage", "github.copilot-chat", "session-store.db",
)

LOG_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "chat-prompts.txt")

BEGIN = "----- {date} -----"
END = "----- end {date} -----"


def get_prompts(db_path, day):
    """Return a list of (time, workspace, prompt) tuples for the given local date."""
    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    try:
        rows = conn.execute(
            """
            SELECT time(t.timestamp, 'localtime') AS t,
                   COALESCE(NULLIF(s.repository, ''),
                            NULLIF(s.cwd, ''), '') AS ws,
                   t.user_message AS msg
            FROM turns t
            JOIN sessions s ON s.id = t.session_id
            WHERE date(t.timestamp, 'localtime') = ?
              AND t.user_message IS NOT NULL
              AND trim(t.user_message) <> ''
            ORDER BY t.timestamp ASC
            """,
            (day,),
        ).fetchall()
    finally:
        conn.close()
    return rows


def format_block(day, rows):
    weekday = dt.date.fromisoformat(day).strftime("%A")
    lines = [BEGIN.format(date=day) + f"  ({weekday})"]
    if not rows:
        lines.append("  (no prompts recorded)")
    for t, ws, msg in rows:
        ws_name = os.path.basename(ws.rstrip("/\\")) if ws else ""
        header = f"[{t[:5]}]" + (f" {ws_name}" if ws_name else "")
        lines.append(header)
        for i, line in enumerate(msg.splitlines() or [msg]):
            prefix = "  > " if i == 0 else "    "
            lines.append(prefix + line)
        lines.append("")
    lines.append(END.format(date=day))
    return "\n".join(lines).rstrip() + "\n"


def strip_existing_block(content, day):
    """Remove a previously written block for the same date, if present."""
    pattern = re.compile(
        r"\n?" + re.escape(BEGIN.format(date=day)) + r".*?"
        + re.escape(END.format(date=day)) + r"\n?",
        re.DOTALL,
    )
    return pattern.sub("\n", content)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--date", help="Date to export (YYYY-MM-DD). Default: today.")
    parser.add_argument("--days", type=int, default=1,
                        help="Export the last N days ending on --date. Default: 1.")
    parser.add_argument("--db", default=DEFAULT_DB, help="Path to session-store.db.")
    args = parser.parse_args()

    if not os.path.exists(args.db):
        sys.exit(f"Session store not found: {args.db}")

    end_date = (dt.date.fromisoformat(args.date) if args.date else dt.date.today())
    days = [ (end_date - dt.timedelta(days=n)).isoformat()
             for n in range(args.days - 1, -1, -1) ]

    if os.path.exists(LOG_FILE):
        with open(LOG_FILE, "r", encoding="utf-8") as f:
            content = f.read()
    else:
        content = "==================================================================\n LOG\n==================================================================\n"

    total = 0
    for day in days:
        rows = get_prompts(args.db, day)
        total += len(rows)
        content = strip_existing_block(content, day)
        content = content.rstrip() + "\n\n" + format_block(day, rows)

    with open(LOG_FILE, "w", encoding="utf-8") as f:
        f.write(content.rstrip() + "\n")

    print(f"Exported {total} prompt(s) across {len(days)} day(s) to {LOG_FILE}")


if __name__ == "__main__":
    main()
