from messages import greeting


def main(ctx):
    message = greeting(ctx)
    ctx.output({"message": message})
    ctx.log(message)
