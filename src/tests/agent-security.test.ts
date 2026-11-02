import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import type { fetch as undiciFetch } from "undici";
import { openByokRunKeys, sealByokRunKeys } from "../lib/byok/secrets.server";
import {
  createAgentSafeFetch,
  isPublicAgentAddress,
  resolveAgentAddresses,
  validateAgentProviderUrl,
} from "../lib/agent/safe-fetch.server";

test("browser keys a task carries are randomized, authenticated and bound to owner, run and connection", () => {
  const previous = process.env.AGENT_CREDENTIAL_ENCRYPTION_KEY;
  process.env.AGENT_CREDENTIAL_ENCRYPTION_KEY =
    randomBytes(32).toString("base64");
  try {
    const keys = { "conn-a": "fixture-private-key", "conn-b": "other-key" };
    const a = sealByokRunKeys("owner", "run", keys)!,
      b = sealByokRunKeys("owner", "run", keys)!;
    assert.equal(a.version, 2);
    assert.notEqual(a.keys["conn-a"].data, b.keys["conn-a"].data);
    assert.ok(!JSON.stringify(a).includes("fixture-private-key"));
    assert.deepEqual(openByokRunKeys("owner", "run", a), keys);
    assert.deepEqual(openByokRunKeys("other", "run", a), {});
    assert.deepEqual(openByokRunKeys("owner", "other", a), {});
    assert.deepEqual(openByokRunKeys("owner", "run", { version: 2, keys: { "conn-b": a.keys["conn-a"] } }), {},
      "a value moved to another connection does not open");
    assert.deepEqual(openByokRunKeys("owner", "run", { version: 2, keys: { ...a.keys, "conn-a": { ...a.keys["conn-a"], data: Buffer.from("tampered").toString("base64") } } }),
      { "conn-b": "other-key" }, "a tampered key is left out; the others still open");
    assert.deepEqual(openByokRunKeys("owner", "run", { version: 1, data: "x" }), {}, "the old single-key format is not read");
    assert.equal(sealByokRunKeys("owner", "run", {}), null, "a task without browser keys stores no credential");
    delete process.env.AGENT_CREDENTIAL_ENCRYPTION_KEY;
    assert.throws(() => sealByokRunKeys("owner", "run", keys), /KEY_NOT_CONFIGURED/);
    process.env.AGENT_CREDENTIAL_ENCRYPTION_KEY = "not-a-valid-key";
    assert.throws(() => sealByokRunKeys("owner", "run", keys), /KEY_NOT_CONFIGURED/);
  } finally {
    if (previous === undefined)
      delete process.env.AGENT_CREDENTIAL_ENCRYPTION_KEY;
    else process.env.AGENT_CREDENTIAL_ENCRYPTION_KEY = previous;
  }
});

test("Agent custom URLs and socket DNS reject private, reserved, mixed and rebound targets", async () => {
  for (const address of [
    "127.0.0.1",
    "10.0.0.1",
    "172.31.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "::1",
    "fc00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
    "2001:db8::1",
    "2002:7f00:1::",
  ])
    assert.equal(isPublicAgentAddress(address), false, address);
  for (const address of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"])
    assert.equal(isPublicAgentAddress(address), true, address);
  // VPN 的 fake-IP 段：本地解析器把外部域名映射到这里，经隧道转发，不是内网。
  for (const address of ["198.18.0.18", "2001:2::26"])
    assert.equal(isPublicAgentAddress(address), true, address);
  for (const url of [
    "http://model.example/v1",
    "https://localhost/v1",
    "https://local.local/v1",
    "https://127.1/v1",
    "https://[::1]/v1",
    "https://user:pass@model.example/v1",
    "https://model.example/v1?api_key=secret",
    "https://model.example/v1#fragment",
  ])
    assert.throws(() => validateAgentProviderUrl(url), url);
  validateAgentProviderUrl("https://model.example/v1");
  const publicAnswer = [{ address: "1.1.1.1", family: 4 }];
  assert.deepEqual(
    await resolveAgentAddresses("model.example", async () => publicAnswer),
    publicAnswer,
  );
  await assert.rejects(
    resolveAgentAddresses("model.example", async () => [
      ...publicAnswer,
      { address: "10.0.0.1", family: 4 },
    ]),
    /PRIVATE_ADDRESS_BLOCKED/,
  );
  await assert.rejects(
    resolveAgentAddresses("model.example", async () => []),
    /PRIVATE_ADDRESS_BLOCKED/,
  );
  let round = 0;
  const rebinding = async () =>
    ++round === 1 ? publicAnswer : [{ address: "127.0.0.1", family: 4 }];
  await resolveAgentAddresses("model.example", rebinding);
  await assert.rejects(
    resolveAgentAddresses("model.example", rebinding),
    /PRIVATE_ADDRESS_BLOCKED/,
  );
});

test("Agent safe transport preserves Request authentication/body/cancel and refuses redirects", async () => {
  const calls: Request[] = [];
  const transport: typeof undiciFetch = async (input, init) => {
    assert.equal(init?.redirect, "manual");
    assert.ok(init?.dispatcher);
    const request = new Request(String(input), init as RequestInit);
    calls.push(request);
    return new Response("ok") as unknown as Awaited<
      ReturnType<typeof undiciFetch>
    >;
  };
  const safe = createAgentSafeFetch(transport),
    controller = new AbortController();
  await safe(
    new Request("https://model.example/v1", {
      method: "POST",
      headers: { Authorization: "Bearer fixture" },
      body: '{"model":"fixture"}',
      signal: controller.signal,
    }),
  );
  assert.equal(calls[0].headers.get("Authorization"), "Bearer fixture");
  assert.equal(await calls[0].text(), '{"model":"fixture"}');
  controller.abort();
  assert.equal(calls[0].signal.aborted, true);
  const redirect = createAgentSafeFetch(
    async () =>
      new Response(null, {
        status: 302,
        headers: { Location: "http://127.0.0.1" },
      }) as unknown as Awaited<ReturnType<typeof undiciFetch>>,
  );
  await assert.rejects(redirect("https://model.example/v1"), /重定向被拒绝/);
  await assert.rejects(safe("https://127.0.0.1/v1"), /公开 HTTPS/);
  assert.equal(calls.length, 1);
});
