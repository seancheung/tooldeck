from messages import text
from pathlib import Path


def main(ctx):
    tool = Path(ctx.paths.tool)
    guide = tool / ("README.zh.md" if ctx.locale == "zh-CN" else "README.md")
    ctx.table({
        "columns": [{"key": "name", "label": text(ctx.locale, "File")}, {"key": "size", "label": text(ctx.locale, "Size (bytes)")}],
        "rows": [
            {"name": {"kind": "file", "target": str(guide), "label": text(ctx.locale, "User guide")}, "size": guide.stat().st_size},
            {"name": {"kind": "directory", "target": str(tool), "label": text(ctx.locale, "Tool directory")}, "size": None},
        ],
    })
