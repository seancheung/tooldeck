import { main as greet } from './greet-on-open.mjs';

export function main(ctx, event) {
  ctx.clearOutput();
  ctx.log(`${event.type}: ${ctx.actionId}`);
  if (event.type === 'actionOpen' && ctx.actionId === 'greetOnOpen') greet(ctx);
}
