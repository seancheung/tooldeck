export function main(ctx, event) {
  ctx.clearOutput();
  ctx.log(`${event.type}: ${ctx.actionId}`);
}
