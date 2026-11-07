// Adapt only the request fields and JSON response used by the existing PHC handlers.
// Keep this helper outside both the public directory and function entry directory.
const invoke = async (handler, request, bodyLimit) => {
  let body = '';
  if (request.body && !['GET', 'HEAD'].includes(request.method)) {
    const reader = request.body.getReader();
    const chunks = []; let size = 0;
    while (true) {
      const {value, done} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > bodyLimit) {
        await reader.cancel();
        return new Response(JSON.stringify({error:'Request too large'}), {
          status:413, headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}
        });
      }
      chunks.push(Buffer.from(value));
    }
    body = Buffer.concat(chunks).toString('utf8');
  }
  const url = new URL(request.url);
  const result = await handler({
    httpMethod:request.method,
    headers:Object.fromEntries(request.headers),
    queryStringParameters:Object.fromEntries(url.searchParams),
    body, isBase64Encoded:false
  });
  return new Response(result.body, {status:result.statusCode, headers:result.headers});
};
module.exports = {invoke};
