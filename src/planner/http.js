export function endpoint(base,route,allowedHosts) {
  const url=new URL(base.replace(/\/$/,'')+'/'+route);
  if(url.protocol!=='https:' || url.username || url.password || !allowedHosts.includes(url.hostname)) throw Error('AI endpoint must use HTTPS on an explicitly allowed host');
  return url;
}
export async function limitedResponse(response,max=512*1024) {
  if(!response.ok) {await response.body?.cancel();throw Error(`Service HTTP ${response.status}`);}
  const chunks=[];let size=0;
  for await(const chunk of response.body) {size+=chunk.length;if(size>max) throw Error('Service response limit');chunks.push(chunk);}
  return Buffer.concat(chunks);
}
export const serviceConfig=()=>({base:process.env.AI_BASE_URL ?? 'https://api.openai.com/v1',key:process.env.AI_API_KEY,hosts:(process.env.AI_ALLOWED_HOSTS ?? 'api.openai.com').split(',')});
