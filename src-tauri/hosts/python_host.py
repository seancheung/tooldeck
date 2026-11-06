import asyncio
import importlib.util
import inspect
import json
import math
from pathlib import Path
import socket
import sys
from types import SimpleNamespace


def run():
    connection = socket.create_connection(("127.0.0.1", int(sys.argv[2])))
    with connection, connection.makefile("r", encoding="utf-8") as incoming:
        context = json.loads(incoming.readline())
        sequence = 0

        def emit(kind, payload):
            nonlocal sequence
            sequence += 1
            event = {"version": 1, "runId": context["runId"], "seq": sequence, "type": kind, "payload": payload}
            connection.sendall((json.dumps(event, ensure_ascii=False, allow_nan=False) + "\n").encode("utf-8"))
            ack = incoming.readline().strip()
            if ack != "ok":
                raise RuntimeError(ack or "Host did not acknowledge event")

        def log(message, level="info"):
            if not isinstance(message, str) or level not in ("debug", "info", "warning", "error"):
                raise TypeError("Invalid log")
            emit("log", {"message": message, "level": level})

        def progress(update):
            if "value" in update or "total" in update:
                value, total = update.get("value"), update.get("total")
                if not all(isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) for v in (value, total)) or total <= 0 or not 0 <= value <= total:
                    raise ValueError("Invalid progress")
            elif not isinstance(update.get("message"), str):
                raise ValueError("Progress needs value/total or message")
            emit("progress", update)

        def link(value):
            if value.get("kind") not in ("file", "directory", "url") or not isinstance(value.get("target"), str):
                raise ValueError("Invalid link")
            emit("link", value)

        def table(value):
            columns, rows = value.get("columns"), value.get("rows")
            if not isinstance(columns, list) or not columns or any(not isinstance(c, dict) or not isinstance(c.get("key"), str) or not c["key"] or ("label" in c and not isinstance(c["label"], str)) for c in columns):
                raise ValueError("Table needs column keys")
            if len({c["key"] for c in columns}) != len(columns):
                raise ValueError("Table needs unique column keys")
            if not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows):
                raise ValueError("Table rows must be objects")
            emit("table", {"columns": columns, "rows": rows})

        def details(value):
            if (not isinstance(value, dict) or not all(isinstance(value.get(k), str) for k in ("id", "title", "text"))
                    or not value["id"].strip() or not value["title"].strip()):
                raise TypeError("Details require an id, title and text")
            emit("details", {k: value[k] for k in ("id", "title", "text")})

        context["paths"] = SimpleNamespace(**context["paths"])
        event = context.pop("hookEvent", None)
        ctx = SimpleNamespace(**context, log=log, json=lambda value: emit("output", value), progress=progress, link=link, table=table, details=details)
        entry = Path(sys.argv[1]).resolve()
        sys.path.insert(0, str(entry.parent))
        sys.dont_write_bytecode = True
        spec = importlib.util.spec_from_file_location("tooldeck_action", entry)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        if event is None:
            ctx.clearOutput = lambda: emit("clearOutput", None)
            ctx.updateParams = lambda patch: emit("updateParams", patch)
            result = module.main(ctx)
        else:
            ctx.clearOutput = lambda: emit("clearOutput", None)
            ctx.updateParams = lambda patch: emit("updateParams", patch)
            result = module.main(ctx, event)
        if inspect.isawaitable(result):
            asyncio.run(result)


if __name__ == "__main__":
    run()
