export function main(ctx) {
  const greeting = `${ctx.settings.prefix || 'Hello'}, ToolDeck!`;
  ctx.log(ctx.settings.uppercase ? greeting.toUpperCase() : greeting);
}
