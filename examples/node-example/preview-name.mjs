export function main(ctx) {
  ctx.clearOutput();
  if (ctx.params.name) ctx.log(`Name for this greeting: ${ctx.params.name}`);
}
