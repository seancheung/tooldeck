import json
from pathlib import Path

_chinese = json.loads(Path(__file__).with_name("zh-CN.json").read_text(encoding="utf-8"))


def text(locale, english):
    return _chinese.get(english, english) if locale == "zh-CN" else english


def greeting(ctx):
    prefix = ctx.settings.get("prefix") or text(ctx.locale, "Hello")
    message = f"{prefix}, {ctx.params['name']}!"
    return message.upper() if ctx.settings["uppercase"] else message
