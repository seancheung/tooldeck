export function main(ctx) {
  const { password, ...params } = ctx.params;
  ctx.json({ ...params, password: password ? '已填写' : '未填写' });
}
