from messages import greeting


def main(ctx):
    message = greeting(ctx)
    ctx.json({"message": message})
    ctx.log(message)
