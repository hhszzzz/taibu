import "server-only";
import { lookup } from "node:dns/promises";
import ipaddr from "ipaddr.js";
import { Agent as HttpAgent, fetch as undiciFetch } from "undici";
import { byokAddressError } from "@/lib/byok/config";

/** VPN 的 fake-IP 网段：不是内网，外部域名被本地解析器映射到这里，再经隧道转发。 */
function isVirtualAddress(parsed: ipaddr.IPv4 | ipaddr.IPv6) {
  return parsed.kind() === "ipv4"
    ? parsed.match(ipaddr.parse("198.18.0.0") as ipaddr.IPv4, 15) // Clash / Surge 等 dns fake-ip
    : parsed.match(ipaddr.parse("2001:2::") as ipaddr.IPv6, 48); // sing-box / tun 的 IPv6 fake-ip
}

export function isPublicAgentAddress(address: string) {
  try {
    let parsed = ipaddr.parse(address.replace(/^\[|\]$/gu, ""));
    if (
      parsed.kind() === "ipv6" &&
      (parsed as ipaddr.IPv6).isIPv4MappedAddress()
    )
      parsed = (parsed as ipaddr.IPv6).toIPv4Address();
    if (isVirtualAddress(parsed)) return true;
    return parsed.range() === "unicast";
  } catch {
    return false;
  }
}
function isPrivateHostname(url: URL) {
  const host = url.hostname.replace(/^\[|\]$/gu, "");
  return host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    (ipaddr.isValid(host) && !isPublicAgentAddress(host));
}
/** The address of an own model whose calls this site makes: public HTTPS, without credentials, query or fragment. */
export function validateAgentProviderUrl(url: string) {
  const error = byokAddressError(url);
  if (error) throw new Error(error);
  if (isPrivateHostname(new URL(url))) {
    throw new Error("模型服务地址必须指向公开 HTTPS 服务");
  }
}
/** Each request an own model makes from here; the SDK may add a query (Anthropic's `?beta=true`). */
function validateProviderRequestUrl(url: string) {
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new Error("模型服务地址格式无效"); }
  if (parsed.protocol !== "https:" || !parsed.hostname) throw new Error("仅支持 HTTPS 地址");
  if (parsed.username || parsed.password) throw new Error("模型服务地址不应包含认证信息");
  if (isPrivateHostname(parsed)) throw new Error("模型服务地址必须指向公开 HTTPS 服务");
}
/** An MCP endpoint may carry query parameters (some services take their key or tool list there). */
export function validateMcpServerUrl(url: string) {
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new Error("MCP 服务地址格式无效"); }
  if (url.length > 2048) throw new Error("MCP 服务地址过长");
  if (parsed.protocol !== "https:" || !parsed.hostname) throw new Error("MCP 服务地址必须是 HTTPS");
  if (parsed.username || parsed.password) throw new Error("MCP 服务地址不应包含认证信息，请改用密钥请求头");
  if (parsed.hash) throw new Error("MCP 服务地址不应包含片段");
  if (isPrivateHostname(parsed)) throw new Error("MCP 服务地址必须指向公开 HTTPS 服务");
}

export async function resolveAgentAddresses(
  hostname: string,
  resolve = (host: string) => lookup(host, { all: true, verbatim: true }),
) {
  const addresses = await resolve(hostname);
  if (
    !addresses.length ||
    addresses.some((item) => !isPublicAgentAddress(item.address))
  )
    throw new Error("AGENT_PRIVATE_ADDRESS_BLOCKED");
  return addresses;
}

// Validation occurs in the socket resolver, not in an earlier DNS preflight.
const dispatcher = new HttpAgent({
  connect: {
    lookup: (hostname, options, callback) => {
      void resolveAgentAddresses(hostname)
        .then((addresses) => {
          if (options.all) callback(null, addresses);
          else {
            const item =
              addresses.find(
                (item) => !options.family || item.family === options.family,
              ) ?? addresses[0];
            callback(null, item.address, item.family);
          }
        })
        .catch((error) => callback(error, []));
    },
  },
});

export function createAgentSafeFetch(
  transport: typeof undiciFetch = undiciFetch,
  {
    validate = validateProviderRequestUrl, redirectMessage = "模型服务重定向被拒绝，请配置最终 HTTPS 地址", resolveAddresses = true,
    timeoutMs = 120_000,
  }: {
    validate?: (url: string) => void;
    redirectMessage?: string;
    /** False for addresses an administrator chose: the socket resolver is skipped, so no DNS preflight at all. */
    resolveAddresses?: boolean;
    /** Bounds the whole exchange, the streamed body included. */
    timeoutMs?: number;
  } = {},
): typeof globalThis.fetch {
  return async (input, init) => {
    const request = new Request(input, init);
    validate(request.url);
    const response = await transport(request.url, {
      ...(init as Parameters<typeof undiciFetch>[1]),
      method: request.method,
      headers: request.headers,
      body: request.body as NonNullable<
        Parameters<typeof undiciFetch>[1]
      >["body"],
      duplex: "half",
      ...(resolveAddresses ? { dispatcher } : {}),
      redirect: "manual",
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(timeoutMs)]),
    });
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      throw new Error(redirectMessage);
    }
    return response as unknown as Response;
  };
}
/** Own models' calls from this site: a long answer may stream for minutes. */
export const agentSafeFetch = createAgentSafeFetch(undiciFetch, { timeoutMs: 600_000 });
export const mcpSafeFetch = createAgentSafeFetch(undiciFetch, {
  validate: validateMcpServerUrl,
  redirectMessage: "MCP 服务重定向被拒绝，请填写最终地址",
});
/** Platform MCP servers: an administrator supplied the address, so it is connected as given. */
export const mcpAdminFetch = createAgentSafeFetch(undiciFetch, {
  validate: validateMcpServerUrl,
  redirectMessage: "MCP 服务重定向被拒绝，请填写最终地址",
  resolveAddresses: false,
});
