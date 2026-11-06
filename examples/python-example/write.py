from messages import greeting, text
from pathlib import Path


def main(ctx):
    ctx.progress({"value": 0, "total": 1, "message": text(ctx.locale, "Preparing to write")})
    message = greeting(ctx)
    destination = Path(ctx.params["destination"])
    if not destination.is_absolute():
        raise ValueError(text(ctx.locale, "Choose an absolute destination path."))
    try:
        with destination.open("x", encoding="utf-8", newline="\n") as stream:
            stream.write(message + "\n")
    except FileExistsError as error:
        raise FileExistsError(text(ctx.locale, "The destination file already exists.")) from error
    ctx.json({"message": message, "savedTo": str(destination)})
    ctx.link({"kind": "file", "target": str(destination), "label": text(ctx.locale, "Open greeting file")})
    ctx.link({"kind": "directory", "target": str(destination.parent), "label": text(ctx.locale, "Open containing directory")})
    ctx.progress({"value": 1, "total": 1, "message": text(ctx.locale, "Done")})
