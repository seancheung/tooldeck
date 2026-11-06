export function main(ctx) {
  let message = ctx.settings.prefix + ', ' + ctx.params.name + '!';
  if (ctx.settings.uppercase) message = message.toUpperCase();
  ctx.json({ message });
  ctx.log(message);
}
